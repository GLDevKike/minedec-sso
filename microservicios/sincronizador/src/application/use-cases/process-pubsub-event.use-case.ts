import { RedisCacheClient, SyncQuotaGovernor } from '@minedec/shared';
import {
  ModoDespachoSincronizacion,
  TipoEventoDirectorio,
} from '../../domain/entities/sync-entities';
import {
  IProcessedEventRepositoryPort,
  ISyncIdentityRepositoryPort,
  ISyncTaskDispatcherPort,
} from '../../domain/ports/sync-ports';

export interface PubSubPushIngressInput {
  messageId: string;
  publishTime?: string;
  dataBase64?: string;
  idEventoExterno?: string;
  tipoEvento?: TipoEventoDirectorio | string;
  googleSubId?: string;
  emailPrincipal?: string;
  dominio?: string;
  orgUnitPath?: string;
  timestampEventoGws?: string;
  esRegistroCaliente?: boolean;
  colaPendientesEstimada?: number;
  antiguedadMensajeMasViejoSegundos?: number;
  traceId: string;
}

export interface PubSubPushIngressOutput {
  idEventoExterno: string;
  status:
    | 'ENQUEUED'
    | 'ENQUEUED_INCREMENTAL'
    | 'ENQUEUED_PRIORITY_HOT_REG'
    | 'IGNORED_DUPLICATE'
    | 'IGNORED_OBSOLETE'
    | 'IGNORED_INACTIVE_DOMAIN';
  modoDespachoActual: ModoDespachoSincronizacion;
  colaPendientesEstimada: number;
}

/**
 * Caso de uso `ProcessPubSubEventUseCase` (`T024` / US1):
 * - Valida el sobre Pub/Sub y que el dominio esté activo en `dominio_institucional` (`D-21`).
 * - Deduplica de forma rápida en Redis L2 (`TTL 24h`) y en la tabla `evento_sincronizacion_procesado`.
 * - Descarta eventos obsoletos (`timestampEventoGws` anterior al último evento procesado para la cuenta).
 * - Evalúa la máquina de histéresis (`>= 100` pendientes o `> 10 s` activa `LOTE_LIST_500`; `< 20` restaura `INDIVIDUAL_GET`).
 * - Encola en Cloud Tasks (`sync-priority-hot-reg-queue` o `sync-incremental-queue`).
 */
export class ProcessPubSubEventUseCase {
  constructor(
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly processedEventRepo: IProcessedEventRepositoryPort,
    private readonly taskDispatcher: ISyncTaskDispatcherPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly redisClient?: RedisCacheClient,
  ) {}

  public async execute(input: PubSubPushIngressInput): Promise<PubSubPushIngressOutput> {
    let decoded: Record<string, unknown> = {};
    if (input.dataBase64) {
      try {
        decoded = JSON.parse(
          Buffer.from(input.dataBase64, 'base64').toString('utf8'),
        ) as Record<string, unknown>;
      } catch {
        decoded = {};
      }
    }

    const idEventoExterno = String(
      input.idEventoExterno ?? decoded.idEventoExterno ?? input.messageId,
    );
    const tipoEvento = String(
      input.tipoEvento ?? decoded.tipoEvento ?? 'CHANGE_USER_CUSTOM_SCHEMAS',
    );
    const googleSubId =
      input.googleSubId ??
      (typeof decoded.googleSubId === 'string' ? decoded.googleSubId : undefined);
    const emailPrincipal =
      input.emailPrincipal ??
      (typeof decoded.emailPrincipal === 'string' ? decoded.emailPrincipal : undefined);
    const orgUnitPath =
      input.orgUnitPath ??
      (typeof decoded.orgUnitPath === 'string' ? decoded.orgUnitPath : undefined);
    const timestampEventoGws = String(
      input.timestampEventoGws ??
        decoded.timestampEventoGws ??
        input.publishTime ??
        new Date().toISOString(),
    );
    const esRegistroCaliente = Boolean(
      input.esRegistroCaliente ?? decoded.esRegistroCaliente ?? false,
    );

    const colaPendientes = input.colaPendientesEstimada ?? 0;
    const antiguedadSeg = input.antiguedadMensajeMasViejoSegundos ?? 0;

    const hysteresis = await this.quotaGovernor.evaluateBatchSwitchHysteresis({
      pendingEventsCount: colaPendientes,
      oldestPendingAgeSeconds: antiguedadSeg,
    });

    const resolvedDomain = (
      input.dominio ??
      (typeof decoded.dominio === 'string' ? decoded.dominio : undefined) ??
      (emailPrincipal ? emailPrincipal.split('@')[1] : undefined) ??
      ''
    ).toLowerCase();

    if (resolvedDomain) {
      const activeDomain = await this.syncIdentityRepo.isDomainActive(resolvedDomain);
      if (!activeDomain) {
        return {
          idEventoExterno,
          status: 'IGNORED_INACTIVE_DOMAIN',
          modoDespachoActual: 'OMITIDO_OBSOLETO',
          colaPendientesEstimada: colaPendientes,
        };
      }
    }

    // 1. Deduplicación rápida en Redis L2 y persistente en AlloyDB
    const redisDedupKey = `minedec:sync:dedup:${idEventoExterno}`;
    if (this.redisClient) {
      const cached = await this.redisClient.getJson<{ idEventoExterno: string }>(
        redisDedupKey,
      );
      if (cached) {
        return {
          idEventoExterno,
          status: 'IGNORED_DUPLICATE',
          modoDespachoActual: 'OMITIDO_DUPLICADO',
          colaPendientesEstimada: colaPendientes,
        };
      }
    }

    const existingEvent = await this.processedEventRepo.findByIdEventoExterno(
      idEventoExterno,
    );
    if (existingEvent) {
      return {
        idEventoExterno,
        status: 'IGNORED_DUPLICATE',
        modoDespachoActual: 'OMITIDO_DUPLICADO',
        colaPendientesEstimada: colaPendientes,
      };
    }

    // 2. Verificación de orden monotónico por usuario
    if (googleSubId) {
      const latestTimestamp = await this.processedEventRepo.findLatestTimestampForUser(
        googleSubId,
      );
      if (
        latestTimestamp &&
        Date.parse(timestampEventoGws) < Date.parse(latestTimestamp)
      ) {
        return {
          idEventoExterno,
          status: 'IGNORED_OBSOLETE',
          modoDespachoActual: 'OMITIDO_OBSOLETO',
          colaPendientesEstimada: colaPendientes,
        };
      }
    }

    if (this.redisClient) {
      await this.redisClient.setJson(
        redisDedupKey,
        { idEventoExterno },
        300,
      );
    }

    // 3. Despacho a cola prioritaria (`REGISTRO_CALIENTE`) o cola incremental
    if (
      esRegistroCaliente ||
      tipoEvento === 'REGISTRO_CALIENTE_RECONCILE'
    ) {
      await this.taskDispatcher.enqueuePriorityHotRegistration({
        idEventoExterno,
        googleSubId: googleSubId ?? '',
        emailPrincipal: emailPrincipal ?? '',
        dominio: resolvedDomain,
        solicitadoEn: timestampEventoGws,
        traceId: input.traceId,
      });

      return {
        idEventoExterno,
        status: 'ENQUEUED_PRIORITY_HOT_REG',
        modoDespachoActual: hysteresis.currentMode,
        colaPendientesEstimada: colaPendientes,
      };
    }

    await this.taskDispatcher.enqueueIncrementalSync({
      idEventoExterno,
      tipoEvento,
      googleSubId,
      emailPrincipal,
      dominio: resolvedDomain || undefined,
      orgUnitPath,
      timestampEventoGws,
      colaPendientesAlDespachar: colaPendientes,
      antiguedadMensajeMasViejoSegundos: antiguedadSeg,
      traceId: input.traceId,
    });

    return {
      idEventoExterno,
      status: 'ENQUEUED_INCREMENTAL',
      modoDespachoActual: hysteresis.currentMode,
      colaPendientesEstimada: colaPendientes,
    };
  }
}
