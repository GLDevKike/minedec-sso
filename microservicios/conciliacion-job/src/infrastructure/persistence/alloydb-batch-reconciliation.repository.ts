import crypto from 'node:crypto';
import {
  hashPayloadGws,
  isPartitionHeartbeatOrphaned,
  quotePipIdentifier,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  CheckpointConciliacion,
  HandleAccountLifecycleChangeUseCase,
  ICheckpointRepositoryPort,
  ISyncIdentityRepositoryPort,
  RecordSyncFailureDlqUseCase,
  TipoProcesoConciliacion,
} from '@minedec/sincronizador';
import {
  BatchUpsertPageSummary,
  DominioSincronizable,
  GwsDirectoryUserProfile,
  IBatchReconciliationRepositoryPort,
  PartitionAlreadyActiveConflictError,
  SavePageCheckpointCommand,
} from '../../domain/batch-reconciliation.types';

/**
 * Repositorio AlloyDB para Carga Inicial y Conciliación Nocturna Masiva (US4 / T049).
 * Utiliza consultas SQL 100% parametrizadas ($1..$n) e identificadores validados por lista blanca.
 */
export class AlloyDbBatchReconciliationRepository
  implements IBatchReconciliationRepositoryPort
{
  private checkpointByIdCache = new Map<string, CheckpointConciliacion>();

  public constructor(
    private readonly sqlExecutor: SqlQueryExecutor,
    private readonly checkpointRepo: ICheckpointRepositoryPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly lifecycleUseCase: HandleAccountLifecycleChangeUseCase,
    private readonly dlqUseCase: RecordSyncFailureDlqUseCase,
  ) {}

  public async listActiveDomains(tx?: SqlQueryExecutor): Promise<DominioSincronizable[]> {
    const domains = await this.syncIdentityRepo.listActiveDomains(tx);
    return domains.map((dominio) => ({ dominio, activo: true }));
  }

  public async findDomainByName(
    dominio: string,
    tx?: SqlQueryExecutor,
  ): Promise<DominioSincronizable | null> {
    const normalized = dominio.trim().toLowerCase();
    const isActive = await this.syncIdentityRepo.isDomainActive(normalized, tx);
    return isActive ? { dominio: normalized, activo: true } : null;
  }

  public async findOrCreatePartitionCheckpoint(
    dominio: string,
    orgUnitPath: string,
    tipoProceso: TipoProcesoConciliacion,
    lockAdvisoryKey: string,
    forzarReinicioDesdeCero: boolean,
    tx?: SqlQueryExecutor,
  ): Promise<{
    checkpoint: CheckpointConciliacion;
    rescatadaDeHuerfana: boolean;
  }> {
    const existing = await this.checkpointRepo.findByPartition(
      dominio,
      orgUnitPath,
      tipoProceso,
      tx,
    );

    const isRunning =
      existing?.estadoEjecucion === 'EN_PROGRESO' ||
      (existing?.estadoEjecucion as string) === 'EN_EJECUCION';

    if (
      existing &&
      isRunning &&
      !isPartitionHeartbeatOrphaned(existing.heartbeatEn)
    ) {
      throw new PartitionAlreadyActiveConflictError(
        `La partición (${dominio}, ${orgUnitPath}, ${tipoProceso}) ya tiene un checkpoint activo con latido vigente (${existing.heartbeatEn}).`,
        `PARTICIÓN EN EJECUCIÓN ACTIVA: La partición (${dominio}, ${orgUnitPath}, ${tipoProceso}) reporta actividad reciente (${existing.heartbeatEn} <= 15 min). Espere a que concluya o reclámela tras 15 minutos sin latido.`,
      );
    }

    const rescatadaDeHuerfana =
      existing !== null &&
      isRunning &&
      isPartitionHeartbeatOrphaned(existing.heartbeatEn);

    const resetTokenAndCounters =
      forzarReinicioDesdeCero ||
      existing?.estadoEjecucion === 'COMPLETADO' ||
      existing?.estadoEjecucion === 'COMPLETADA';

    const nowIso = new Date().toISOString();
    const checkpointToSave: CheckpointConciliacion = {
      checkpointId: existing?.checkpointId ?? crypto.randomUUID(),
      dominio,
      orgUnitPath,
      tipoProceso,
      nextPageToken: resetTokenAndCounters ? null : (existing?.nextPageToken ?? null),
      cuentasProcesadas: resetTokenAndCounters ? 0 : (existing?.cuentasProcesadas ?? 0),
      cuentasActualizadas: resetTokenAndCounters ? 0 : (existing?.cuentasActualizadas ?? 0),
      cuentasOmitidasHash: resetTokenAndCounters ? 0 : (existing?.cuentasOmitidasHash ?? 0),
      cuentasBajaDetectadas: resetTokenAndCounters ? 0 : (existing?.cuentasBajaDetectadas ?? 0),
      anomaliasAbiertas: resetTokenAndCounters ? 0 : (existing?.anomaliasAbiertas ?? 0),
      estadoEjecucion: 'EN_PROGRESO',
      workerInstanciaId: `conciliacion-job-${process.pid}`,
      lockAdvisoryKey,
      heartbeatEn: nowIso,
      iniciadoEn: resetTokenAndCounters ? nowIso : (existing?.iniciadoEn ?? nowIso),
      completadoEn: null,
      ultimoErrorCodigo: null,
      diagnosticoOperativo: rescatadaDeHuerfana
        ? 'Partición huérfana reclamada y reanudada desde último nextPageToken confirmado.'
        : 'Ejecución de partición en progreso.',
    };

    const checkpoint = await this.checkpointRepo.upsertCheckpoint(checkpointToSave, tx);
    this.checkpointByIdCache.set(checkpoint.checkpointId, checkpoint);

    return {
      checkpoint,
      rescatadaDeHuerfana,
    };
  }

  public async getExistingHashesByGoogleSubIds(
    googleSubIds: readonly string[],
    tx?: SqlQueryExecutor,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    for (const subId of googleSubIds) {
      const meta = await this.syncIdentityRepo.findAccountSyncMetadata(subId, null, tx);
      if (meta) {
        result.set(subId, meta.hashPayloadGws);
      }
    }
    return result;
  }

  public async processPageChangedProfiles(
    profiles: readonly GwsDirectoryUserProfile[],
    dominio: string,
    tipoProceso: TipoProcesoConciliacion,
  ): Promise<BatchUpsertPageSummary> {
    let actualizados = 0;
    let omitidosSinCambios = 0;
    let anomaliasAbiertas = 0;
    let fallosDlq = 0;

    for (const profile of profiles) {
      const googleSubId = profile.googleSubId || profile.id;
      const emailPrincipal = profile.emailPrincipal || profile.primaryEmail;
      try {
        const hash = hashPayloadGws(profile);
        const upsertRes = await this.syncIdentityRepo.upsertSyncedIdentity({
          idEventoExterno: `batch-${tipoProceso}-${googleSubId}`,
          gwsUser: profile,
          hashPayloadGws: hash,
          origenCanal: 'SYNC_BATCH_JOB',
          modoDespacho: 'LOTE_LIST_500',
          traceId: `trace-batch-${googleSubId}`,
        });

        if (upsertRes.outcome === 'SIN_CAMBIOS_HASH') {
          omitidosSinCambios += 1;
        } else {
          actualizados += 1;
        }
        anomaliasAbiertas += upsertRes.anomaliasGeneradasIds.length;

        const rawFecha =
          profile.customSchemas?.MINEDEC_Perfil?.fechaFinVigencia ??
          profile.minedecPerfil?.fechaFinVigencia ??
          null;
        const fechaFinVigencia = typeof rawFecha === 'string' ? rawFecha : null;
        const isExpiredVigencia = this.isVigenciaExpired(fechaFinVigencia);
        if (profile.suspended || profile.suspendedEnGws || isExpiredVigencia) {
          await this.lifecycleUseCase.execute({
            googleSubId,
            emailPrincipal,
            tipoCambio: 'CUENTA_SUSPENDIDA_GWS',
            origenCanal: 'SYNC_BATCH_JOB',
            motivo:
              profile.suspended || profile.suspendedEnGws
                ? 'Cuenta suspendida en Google Workspace detectada en conciliación masiva'
                : 'Vigencia vencida detectada en conciliación masiva',
            traceId: `trace-batch-lifecycle-${googleSubId}`,
          });
        }
      } catch (err) {
        fallosDlq += 1;
        await this.dlqUseCase.execute({
          idEventoExterno: `batch-err-${googleSubId}`,
          origenCanal: 'CONCILIACION_MASIVA',
          googleSubId,
          emailPrincipal,
          dominio,
          tipoEvento: tipoProceso,
          timestampEventoGws: profile.lastLoginTime ?? new Date().toISOString(),
          payloadOriginal: {
            googleSubId,
            primaryEmail: emailPrincipal,
            orgUnitPath: profile.orgUnitPath,
            tipoProceso,
          },
          intentosRealizados: 5,
          ultimoBackoffMs: 16000,
          codigoError: 'BATCH_UPSERT_ERROR',
          detalleErrorTecnico: err instanceof Error ? err.message : String(err),
          traceId: `trace-batch-dlq-${googleSubId}`,
        });
      }
    }

    return {
      actualizados,
      omitidosSinCambios,
      anomaliasAbiertas,
      fallosDlq,
    };
  }

  public async savePageCheckpoint(
    command: SavePageCheckpointCommand,
    tx?: SqlQueryExecutor,
  ): Promise<CheckpointConciliacion> {
    const cached = this.checkpointByIdCache.get(command.checkpointId);
    const nowIso = new Date().toISOString();
    const updated: CheckpointConciliacion = {
      checkpointId: command.checkpointId,
      dominio: cached?.dominio ?? 'educacion.gob.ec',
      orgUnitPath: cached?.orgUnitPath ?? '/',
      tipoProceso: cached?.tipoProceso ?? 'CONCILIACION_NOCTURNA',
      nextPageToken: command.nextPageToken,
      cuentasProcesadas: (cached?.cuentasProcesadas ?? 0) + command.deltaProcesados,
      cuentasActualizadas: (cached?.cuentasActualizadas ?? 0) + command.deltaActualizados,
      cuentasOmitidasHash:
        (cached?.cuentasOmitidasHash ?? 0) + command.deltaOmitidosSinCambios,
      cuentasBajaDetectadas: cached?.cuentasBajaDetectadas ?? 0,
      anomaliasAbiertas:
        (cached?.anomaliasAbiertas ?? 0) + command.deltaAnomaliasAbiertas,
      estadoEjecucion: command.estadoEjecucion,
      workerInstanciaId: cached?.workerInstanciaId ?? `conciliacion-job-${process.pid}`,
      lockAdvisoryKey: cached?.lockAdvisoryKey ?? '0',
      heartbeatEn: nowIso,
      iniciadoEn: cached?.iniciadoEn ?? nowIso,
      completadoEn: command.completadoEn ?? null,
      ultimoErrorCodigo: command.ultimoErrorResumen ? 'BATCH_ERROR' : null,
      diagnosticoOperativo:
        command.ultimoErrorResumen ?? cached?.diagnosticoOperativo ?? null,
    };

    const saved = await this.checkpointRepo.upsertCheckpoint(updated, tx);
    this.checkpointByIdCache.set(saved.checkpointId, saved);
    return saved;
  }

  public async updateHeartbeat(checkpointId: string, tx?: SqlQueryExecutor): Promise<void> {
    const executor = tx ?? this.sqlExecutor;
    const table = quotePipIdentifier('checkpoint_conciliacion');
    const nowIso = new Date().toISOString();
    await executor.query(
      `UPDATE ${table} SET heartbeat_en = $2, actualizado_en = $2 WHERE checkpoint_id = $1`,
      [checkpointId, nowIso],
    );
  }

  private isVigenciaExpired(fechaFinVigencia: string | null): boolean {
    if (!fechaFinVigencia) {
      return false;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    return fechaFinVigencia.slice(0, 10) < todayStr;
  }
}
