import {
  AuditEventWriter,
  DatabaseTransactionManager,
  SyncQuotaGovernor,
  hashPayloadGws,
  pipMetrics,
} from '@minedec/shared';
import {
  EstadoRegistroDlq,
  RegistroFalloSincronizacion,
} from '../../domain/entities/sync-entities';
import {
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

/**
 * Caso de uso administrativo `ListDlqFailuresUseCase` (`T059` / US5).
 */
export class ListDlqFailuresUseCase {
  constructor(private readonly dlqRepo: IDlqRepositoryPort) {}

  public async execute(filters?: {
    estadoDlq?: EstadoRegistroDlq;
    dominio?: string;
    limit?: number;
  }): Promise<{
    totalPendientes: number;
    items: RegistroFalloSincronizacion[];
  }> {
    return this.dlqRepo.listDlqRecords(filters);
  }
}

export interface ReplayDlqInput {
  dlqIds?: string[];
  dominio?: string;
  maxRegistros?: number;
  adminIdentificacion: string;
  motivoReplay: string;
  traceId: string;
}

export interface ReplayDlqOutput {
  totalEvaluados: number;
  totalReprocesadosExitosos: number;
  totalResueltosPorObsolescencia: number;
  totalFallidosNuevamente: number;
  resumenLenguajeNatural: string;
}

/**
 * Caso de uso administrativo `ReplayDlqFailuresUseCase` (`T059` / US5):
 * - Reprocesa eventos de la bandeja `DLQ` (`registro_fallo_sincronizacion`) respetando el techo `<= 28 req/s`.
 * - Compara `timestamp_evento_gws` del fallo contra `cuenta_institucional.ultima_sincronizacion_en`:
 *   si la cuenta ya tiene un estado más reciente (`timestamp_evento_gws < ultima_sincronizacion_en`),
 *   el registro en `DLQ` se marca como `RESUELTO_POR_OBSOLESCENCIA` sin sobrescribir la cuenta.
 * - Si el evento sigue vigente, consulta Google Workspace, aplica el upsert y marca `RESUELTO_REPROCESADO`.
 */
export class ReplayDlqFailuresUseCase {
  constructor(
    private readonly dlqRepo: IDlqRepositoryPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly gwsPort: IGoogleDirectoryReadOnlyPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly txManager?: DatabaseTransactionManager,
    private readonly auditWriter?: AuditEventWriter,
  ) {}

  public async execute(input: ReplayDlqInput): Promise<ReplayDlqOutput> {
    const { items } = await this.dlqRepo.listDlqRecords({
      estadoDlq: input.dlqIds && input.dlqIds.length > 0 ? undefined : 'PENDIENTE_REVISION',
      dominio: input.dominio,
      limit: input.maxRegistros ?? 50,
      dlqIds: input.dlqIds,
    });

    let totalEvaluados = 0;
    let totalReprocesadosExitosos = 0;
    let totalResueltosPorObsolescencia = 0;
    let totalFallidosNuevamente = 0;

    for (const record of items) {
      totalEvaluados++;
      const nowIso = new Date().toISOString();

      // 1. Verificar protección de obsolescencia contra cuenta_institucional.ultima_sincronizacion_en
      if (record.googleSubId || record.emailPrincipal) {
        const accountMeta = await this.syncIdentityRepo.findAccountSyncMetadata(
          record.googleSubId ?? '',
          record.emailPrincipal,
        );
        if (
          accountMeta &&
          Date.parse(record.timestampEventoGws) <
            Date.parse(accountMeta.ultimaSincronizacionEn)
        ) {
          await this.dlqRepo.upsertDlqFailure({
            ...record,
            estadoDlq: 'RESUELTO_POR_OBSOLESCENCIA',
            resueltoPorIdentificacion: input.adminIdentificacion,
            motivoResolucion: `Descartado por obsolescencia (${record.timestampEventoGws} < ultima_sincronizacion_en ${accountMeta.ultimaSincronizacionEn}). Motivo admin: ${input.motivoReplay}`,
            actualizadoEn: nowIso,
            resueltoEn: nowIso,
          });

          if (this.txManager && this.auditWriter) {
            await this.txManager.withTransaction(async (tx) => {
              await this.auditWriter!.appendEvent(tx, {
                tipoEvento: 'EVENTO_DLQ_REPROCESADO',
                idInterno: accountMeta.idInterno,
                cuentaId: accountMeta.cuentaId,
                actorSub: input.adminIdentificacion,
                origenCanal: 'PAP_ADMIN',
                resumenCambio: `DLQ_DESCARTADO_OBSOLESCENCIA para evento ${record.idEventoExterno}`,
                datosPrevios: { estadoDlq: record.estadoDlq },
                datosNuevos: {
                  estadoDlq: 'RESUELTO_POR_OBSOLESCENCIA',
                  timestampEventoGws: record.timestampEventoGws,
                  ultimaSincronizacionEn: accountMeta.ultimaSincronizacionEn,
                },
                traceId: input.traceId,
              });
            });
          }

          totalResueltosPorObsolescencia++;
          continue;
        }
      }

      // 2. Consumir cuota regulada <= 28 req/s
      const quotaDecision = await this.quotaGovernor.tryAcquire('INCREMENTAL', 1);
      if (!quotaDecision.allowed) {
        totalFallidosNuevamente++;
        continue;
      }

      try {
        const userKey = record.googleSubId ?? record.emailPrincipal ?? '';
        const gwsUser = await this.gwsPort.getUserReadOnly(userKey, input.traceId);

        if (gwsUser) {
          const computedHash = hashPayloadGws(gwsUser);
          const upsertRes = await this.syncIdentityRepo.upsertSyncedIdentity({
            idEventoExterno: record.idEventoExterno,
            gwsUser,
            hashPayloadGws: computedHash,
            origenCanal: 'SYNC_INCREMENTAL',
            modoDespacho: 'INDIVIDUAL_GET',
            traceId: input.traceId,
            forceUpsert: true,
          });

          await this.cacheInvalidator.invalidateAccountScope({
            idInternoPersona: upsertRes.idInternoPersona,
            cuentaId: upsertRes.cuentaId,
            googleSubId: upsertRes.googleSubId,
            emailPrincipal: upsertRes.emailPrincipal,
            motivo: 'DLQ_REPLAY_SUCCESS',
            traceId: input.traceId,
          });
        }

        await this.dlqRepo.upsertDlqFailure({
          ...record,
          estadoDlq: 'RESUELTO_REPROCESADO',
          resueltoPorIdentificacion: input.adminIdentificacion,
          motivoResolucion: `Reprocesado exitosamente por ${input.adminIdentificacion}: ${input.motivoReplay}`,
          actualizadoEn: nowIso,
          resueltoEn: nowIso,
        });

        if (this.txManager && this.auditWriter) {
          await this.txManager.withTransaction(async (tx) => {
            await this.auditWriter!.appendEvent(tx, {
              tipoEvento: 'EVENTO_DLQ_REPROCESADO',
              actorSub: input.adminIdentificacion,
              origenCanal: 'PAP_ADMIN',
              resumenCambio: `DLQ_REPROCESADO_EXITOSO para evento ${record.idEventoExterno}`,
              datosPrevios: { estadoDlq: record.estadoDlq },
              datosNuevos: { estadoDlq: 'RESUELTO_REPROCESADO' },
              traceId: input.traceId,
            });
          });
        }

        totalReprocesadosExitosos++;
      } catch {
        totalFallidosNuevamente++;
      }
    }

    const pendingAfter = await this.dlqRepo.countPendingDlq();
    pipMetrics.setSyncDlqPendingRecords(pendingAfter);

    return {
      totalEvaluados,
      totalReprocesadosExitosos,
      totalResueltosPorObsolescencia,
      totalFallidosNuevamente,
      resumenLenguajeNatural: `Se evaluaron ${totalEvaluados} registros de la bandeja DLQ bajo el techo de 28 req/s: ${totalReprocesadosExitosos} reprocesados en vivo (RESUELTO_REPROCESADO), ${totalResueltosPorObsolescencia} descartados automáticamente por obsolescencia (RESUELTO_POR_OBSOLESCENCIA) para proteger cambios más recientes en AlloyDB, y ${totalFallidosNuevamente} pendientes por reintentar.`,
    };
  }
}
