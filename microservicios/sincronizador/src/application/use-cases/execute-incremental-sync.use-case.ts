import {
  ExponentialBackoffPolicy,
  SyncQuotaGovernor,
  hashPayloadGws,
  pipMetrics,
} from '@minedec/shared';
import {
  ModoDespachoSincronizacion,
  ResultadoSincronizacionCuenta,
  TipoEventoDirectorio,
} from '../../domain/entities/sync-entities';
import {
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';
import { HandleAccountLifecycleChangeUseCase } from './handle-account-lifecycle-change.use-case';
import { RecordSyncFailureDlqUseCase } from './record-sync-failure-dlq.use-case';

export interface IncrementalSyncTaskInput {
  idEventoExterno: string;
  tipoEvento: TipoEventoDirectorio | string;
  googleSubId?: string;
  emailPrincipal?: string;
  dominio?: string;
  orgUnitPath?: string;
  timestampEventoGws: string;
  colaPendientesAlDespachar?: number;
  antiguedadMensajeMasViejoSegundos?: number;
  intentoActual?: number;
  traceId: string;
}

/**
 * Caso de uso `ExecuteIncrementalSyncUseCase` (`T025` y `T035` / US1 & US2):
 * - Consume cuota en `SyncQuotaGovernor` (`<= 23 req/s` o `<= 8 req/s` con lote masivo activo).
 * - Conmuta con histéresis entre `INDIVIDUAL_GET` (`users.get`) y `LOTE_LIST_500` (`users.list(maxResults=500)`).
 * - Calcula `hashPayloadGws` y omite escrituras redundantes si coincide con `cuenta_institucional.hash_payload_gws`.
 * - Delega eventos de ciclo de vida (`DELETE_USER`, `SUSPEND_USER`, `UNSUSPEND_USER`) a `HandleAccountLifecycleChangeUseCase`.
 * - Invalida inmediatamente la caché L2 en Redis (`< 5 s` p95) cuando hay cambios de estado, `orgUnitPath` o `MINEDEC_Perfil`.
 * - Ante agotamiento de los 5 intentos con retroceso exponencial, deriva a `DLQ`.
 */
export class ExecuteIncrementalSyncUseCase {
  constructor(
    private readonly gwsPort: IGoogleDirectoryReadOnlyPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly processedEventRepo: IProcessedEventRepositoryPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
    private readonly lifecycleUseCase: HandleAccountLifecycleChangeUseCase,
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly recordDlqUseCase?: RecordSyncFailureDlqUseCase,
  ) {}

  public async execute(
    input: IncrementalSyncTaskInput,
  ): Promise<ResultadoSincronizacionCuenta> {
    // 1. Verificar idempotencia en AlloyDB
    const alreadyProcessed = await this.processedEventRepo.findByIdEventoExterno(
      input.idEventoExterno,
    );
    if (alreadyProcessed) {
      return {
        idEventoExterno: input.idEventoExterno,
        resultado: 'DUPLICADO_IGNORADO',
        modoDespacho: 'OMITIDO_DUPLICADO',
        cuentasProcesadasEnLote: 0,
        cacheInvalidated: false,
      };
    }

    // 2. Verificar obsolescencia monotónica respecto a eventos previos procesados
    if (input.googleSubId) {
      const latestProcessedTs = await this.processedEventRepo.findLatestTimestampForUser(
        input.googleSubId,
      );
      if (
        latestProcessedTs &&
        Date.parse(input.timestampEventoGws) < Date.parse(latestProcessedTs)
      ) {
        await this.processedEventRepo.recordProcessedEvent({
          idEventoExterno: input.idEventoExterno,
          googleSubId: input.googleSubId,
          emailPrincipal: input.emailPrincipal ?? null,
          dominio: input.dominio ?? '',
          tipoEvento: input.tipoEvento,
          timestampEventoGws: input.timestampEventoGws,
          origenCanal: 'PUBSUB_AUDIT_LOG',
          modoDespacho: 'DIRECT_EXTRACT',
          resultado: 'DESCARTADO_OBSOLETO',
          hashPayloadGws: null,
          procesadoEn: new Date().toISOString(),
        });
        return {
          idEventoExterno: input.idEventoExterno,
          resultado: 'OBSOLETO_IGNORADO',
          modoDespacho: 'OMITIDO_OBSOLETO',
          cuentasProcesadasEnLote: 0,
          cacheInvalidated: false,
        };
      }
    }

    // 3. Evaluar dominio activo (D-21)
    const domainToCheck = (
      input.dominio ??
      (input.emailPrincipal ? input.emailPrincipal.split('@')[1] : undefined) ??
      ''
    ).toLowerCase();

    if (domainToCheck) {
      const active = await this.syncIdentityRepo.isDomainActive(domainToCheck);
      if (!active) {
        return {
          idEventoExterno: input.idEventoExterno,
          resultado: 'OBSOLETO_IGNORADO',
          modoDespacho: 'OMITIDO_OBSOLETO',
          cuentasProcesadasEnLote: 0,
          cacheInvalidated: false,
        };
      }
    }

    // 4. Evaluar histéresis de modo lote vs individual
    const hysteresis = await this.quotaGovernor.evaluateBatchSwitchHysteresis({
      pendingEventsCount: input.colaPendientesAlDespachar ?? 0,
      oldestPendingAgeSeconds: input.antiguedadMensajeMasViejoSegundos ?? 0,
    });
    const modoDespacho: ModoDespachoSincronizacion = hysteresis.currentMode;

    // 5. Si es eliminación directa en GWS (DELETE_USER), aplicar baja lógica diferenciada de inmediato
    if (input.tipoEvento === 'DELETE_USER' && input.googleSubId) {
      const lifecycle = await this.lifecycleUseCase.execute({
        googleSubId: input.googleSubId,
        emailPrincipal: input.emailPrincipal,
        tipoCambio: 'CUENTA_ELIMINADA_GWS',
        origenCanal: 'SYNC_INCREMENTAL',
        traceId: input.traceId,
      });

      await this.processedEventRepo.recordProcessedEvent({
        idEventoExterno: input.idEventoExterno,
        googleSubId: input.googleSubId,
        emailPrincipal: input.emailPrincipal ?? null,
        dominio: domainToCheck,
        tipoEvento: input.tipoEvento,
        timestampEventoGws: input.timestampEventoGws,
        origenCanal: 'PUBSUB_AUDIT_LOG',
        modoDespacho: 'DIRECT_EXTRACT',
        resultado: 'PROCESADO',
        hashPayloadGws: null,
        procesadoEn: new Date().toISOString(),
      });

      return {
        idEventoExterno: input.idEventoExterno,
        resultado: 'APLICADO',
        modoDespacho: 'INDIVIDUAL_GET',
        cuentasProcesadasEnLote: 1,
        idInternoPersona: lifecycle.idInternoPersona,
        cuentaId: lifecycle.cuentaId,
        estadoPersonaResultante: lifecycle.estadoPersonaResultante,
        estadoCuentaResultante: lifecycle.estadoCuentaResultante,
        cacheInvalidated: lifecycle.cacheInvalidated,
      };
    }

    // 6. Consumir cuota en el gobernador distribuido (<= 28 req/s agregado)
    const quotaDecision = await this.quotaGovernor.tryAcquire('INCREMENTAL', 1);
    if (!quotaDecision.allowed) {
      const quotaErr = new Error(
        `Presupuesto de cuota incremental agotado (${quotaDecision.currentGlobalRps}/${quotaDecision.hardCeilingRps} req/s). Retry-After: ${Math.ceil(quotaDecision.retryAfterMs / 1000)}s`,
      ) as Error & { httpStatus?: number; retryAfterSeconds?: number };
      quotaErr.httpStatus = 429;
      quotaErr.retryAfterSeconds = Math.max(1, Math.ceil(quotaDecision.retryAfterMs / 1000));
      throw quotaErr;
    }

    try {
      if (modoDespacho === 'LOTE_LIST_500' && domainToCheck) {
        return await this.executeBatchMode500(input, domainToCheck);
      }
      return await this.executeIndividualGetMode(input, domainToCheck);
    } catch (error) {
      if (this.recordDlqUseCase && (input.intentoActual ?? 1) >= ExponentialBackoffPolicy.MAX_ATTEMPTS) {
        const httpStatus =
          error && typeof error === 'object' && 'httpStatus' in error
            ? Number((error as Record<string, unknown>).httpStatus)
            : null;
        await this.recordDlqUseCase.execute({
          idEventoExterno: input.idEventoExterno,
          origenCanal: 'PUBSUB_AUDIT_LOG',
          googleSubId: input.googleSubId ?? null,
          emailPrincipal: input.emailPrincipal ?? null,
          dominio: domainToCheck || null,
          tipoEvento: input.tipoEvento,
          timestampEventoGws: input.timestampEventoGws,
          payloadOriginal: { ...input },
          intentosRealizados: input.intentoActual ?? 5,
          codigoError: httpStatus === 429 ? 'GWS_QUOTA_EXCEEDED' : 'GWS_SYNC_EXECUTION_ERROR',
          httpStatusGws: httpStatus,
          detalleErrorTecnico: error instanceof Error ? error.message : String(error),
          traceId: input.traceId,
        });

        return {
          idEventoExterno: input.idEventoExterno,
          resultado: 'DERIVADO_A_DLQ',
          modoDespacho,
          cuentasProcesadasEnLote: 0,
          cacheInvalidated: false,
        };
      }
      throw error;
    }
  }

  private async executeIndividualGetMode(
    input: IncrementalSyncTaskInput,
    domainToCheck: string,
  ): Promise<ResultadoSincronizacionCuenta> {
    const userKey = input.googleSubId ?? input.emailPrincipal ?? '';
    const gwsUser = await this.gwsPort.getUserReadOnly(userKey, input.traceId);

    if (!gwsUser) {
      // Si el usuario ya no existe en GWS, tratar como baja en GWS
      if (input.googleSubId) {
        const lifecycle = await this.lifecycleUseCase.execute({
          googleSubId: input.googleSubId,
          emailPrincipal: input.emailPrincipal,
          tipoCambio: 'CUENTA_ELIMINADA_GWS',
          origenCanal: 'SYNC_INCREMENTAL',
          traceId: input.traceId,
        });
        return {
          idEventoExterno: input.idEventoExterno,
          resultado: 'APLICADO',
          modoDespacho: 'INDIVIDUAL_GET',
          cuentasProcesadasEnLote: 1,
          idInternoPersona: lifecycle.idInternoPersona,
          cuentaId: lifecycle.cuentaId,
          estadoPersonaResultante: lifecycle.estadoPersonaResultante,
          estadoCuentaResultante: lifecycle.estadoCuentaResultante,
          cacheInvalidated: lifecycle.cacheInvalidated,
        };
      }
      return {
        idEventoExterno: input.idEventoExterno,
        resultado: 'OBSOLETO_IGNORADO',
        modoDespacho: 'INDIVIDUAL_GET',
        cuentasProcesadasEnLote: 0,
        cacheInvalidated: false,
      };
    }

    const computedHash = hashPayloadGws(gwsUser);
    const existingMeta = await this.syncIdentityRepo.findAccountSyncMetadata(
      gwsUser.id,
      gwsUser.primaryEmail,
    );

    if (existingMeta && existingMeta.hashPayloadGws === computedHash) {
      await this.processedEventRepo.recordProcessedEvent({
        idEventoExterno: input.idEventoExterno,
        googleSubId: gwsUser.id,
        emailPrincipal: gwsUser.primaryEmail,
        dominio: domainToCheck || (gwsUser.primaryEmail.split('@')[1] ?? ''),
        tipoEvento: input.tipoEvento,
        timestampEventoGws: input.timestampEventoGws,
        origenCanal: 'PUBSUB_AUDIT_LOG',
        modoDespacho: 'FETCH_BY_SUB',
        resultado: 'OMITIDO_HASH_IDENTICO',
        hashPayloadGws: computedHash,
        procesadoEn: new Date().toISOString(),
      });
      pipMetrics.recordSyncEventProcessed('OMITIDO_HASH_IDENTICO');

      return {
        idEventoExterno: input.idEventoExterno,
        resultado: 'SIN_CAMBIOS_HASH',
        modoDespacho: 'INDIVIDUAL_GET',
        cuentasProcesadasEnLote: 1,
        idInternoPersona: existingMeta.idInterno,
        cuentaId: existingMeta.cuentaId,
        estadoCuentaResultante: existingMeta.estadoSincronizacion,
        cacheInvalidated: false,
      };
    }

    const upsertRes = await this.syncIdentityRepo.upsertSyncedIdentity({
      idEventoExterno: input.idEventoExterno,
      gwsUser,
      hashPayloadGws: computedHash,
      origenCanal: 'SYNC_INCREMENTAL',
      modoDespacho: 'INDIVIDUAL_GET',
      traceId: input.traceId,
    });

    let cacheInvalidated = upsertRes.requiresCacheInvalidation;
    if (upsertRes.outcome !== 'SIN_CAMBIOS_HASH') {
      const inv = await this.cacheInvalidator.invalidateAccountScope({
        idInternoPersona: upsertRes.idInternoPersona,
        cuentaId: upsertRes.cuentaId,
        googleSubId: upsertRes.googleSubId,
        emailPrincipal: upsertRes.emailPrincipal,
        motivo: `SYNC_INCREMENTAL:${input.tipoEvento}`,
        traceId: input.traceId,
      });
      cacheInvalidated = inv.invalidatedKeysCount >= 0;
    }

    await this.processedEventRepo.recordProcessedEvent({
      idEventoExterno: input.idEventoExterno,
      googleSubId: gwsUser.id,
      emailPrincipal: gwsUser.primaryEmail,
      dominio: upsertRes.dominio,
      tipoEvento: input.tipoEvento,
      timestampEventoGws: input.timestampEventoGws,
      origenCanal: 'PUBSUB_AUDIT_LOG',
      modoDespacho: 'FETCH_BY_SUB',
      resultado:
        upsertRes.outcome === 'SIN_CAMBIOS_HASH' ? 'OMITIDO_HASH_IDENTICO' : 'PROCESADO',
      hashPayloadGws: computedHash,
      procesadoEn: new Date().toISOString(),
    });
    pipMetrics.recordSyncEventProcessed('PROCESADO');

    return {
      idEventoExterno: input.idEventoExterno,
      resultado: upsertRes.outcome,
      modoDespacho: 'INDIVIDUAL_GET',
      cuentasProcesadasEnLote: 1,
      idInternoPersona: upsertRes.idInternoPersona,
      cuentaId: upsertRes.cuentaId,
      estadoPersonaResultante: upsertRes.estadoPersona,
      estadoCuentaResultante: upsertRes.estadoCuenta,
      cacheInvalidated,
      anomaliasGeneradasIds: upsertRes.anomaliasGeneradasIds,
    };
  }

  private async executeBatchMode500(
    input: IncrementalSyncTaskInput,
    domain: string,
  ): Promise<ResultadoSincronizacionCuenta> {
    const page = await this.gwsPort.listUsersReadOnly(
      {
        domain,
        orgUnitPath: input.orgUnitPath,
        maxResults: 500,
      },
      input.traceId,
    );

    let appliedCount = 0;
    let lastUpsert: Awaited<ReturnType<ISyncIdentityRepositoryPort['upsertSyncedIdentity']>> | null =
      null;

    for (const user of page.users) {
      const computedHash = hashPayloadGws(user);
      const res = await this.syncIdentityRepo.upsertSyncedIdentity({
        idEventoExterno: `${input.idEventoExterno}:${user.id}`,
        gwsUser: user,
        hashPayloadGws: computedHash,
        origenCanal: 'SYNC_INCREMENTAL',
        modoDespacho: 'LOTE_LIST_500',
        traceId: input.traceId,
      });
      if (res.outcome !== 'SIN_CAMBIOS_HASH') {
        appliedCount++;
        await this.cacheInvalidator.invalidateAccountScope({
          idInternoPersona: res.idInternoPersona,
          cuentaId: res.cuentaId,
          googleSubId: res.googleSubId,
          emailPrincipal: res.emailPrincipal,
          motivo: 'SYNC_BATCH_HYSTERESIS_500',
          traceId: input.traceId,
        });
      }
      lastUpsert = res;
    }

    await this.processedEventRepo.recordProcessedEvent({
      idEventoExterno: input.idEventoExterno,
      googleSubId: input.googleSubId ?? page.users[0]?.id ?? 'BATCH_500',
      emailPrincipal: input.emailPrincipal ?? page.users[0]?.primaryEmail ?? null,
      dominio: domain,
      tipoEvento: input.tipoEvento,
      timestampEventoGws: input.timestampEventoGws,
      origenCanal: 'PUBSUB_AUDIT_LOG',
      modoDespacho: 'DIRECT_EXTRACT',
      resultado: appliedCount > 0 ? 'PROCESADO' : 'OMITIDO_HASH_IDENTICO',
      hashPayloadGws: null,
      procesadoEn: new Date().toISOString(),
    });

    return {
      idEventoExterno: input.idEventoExterno,
      resultado: appliedCount > 0 ? 'APLICADO' : 'SIN_CAMBIOS_HASH',
      modoDespacho: 'LOTE_LIST_500',
      cuentasProcesadasEnLote: page.users.length,
      idInternoPersona: lastUpsert?.idInternoPersona,
      cuentaId: lastUpsert?.cuentaId,
      estadoPersonaResultante: lastUpsert?.estadoPersona,
      estadoCuentaResultante: lastUpsert?.estadoCuenta,
      cacheInvalidated: appliedCount > 0,
    };
  }
}
