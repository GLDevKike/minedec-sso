import crypto from 'node:crypto';
import {
  PartitionAdvisoryLock,
  SyncDiagnosticBuilder,
  SyncQuotaGovernor,
  derivePartitionAdvisoryLockKey,
  hashPayloadGws,
} from '@minedec/shared';
import {
  CheckpointConciliacion,
  EstadoEjecucionCheckpoint,
  TipoProcesoConciliacion,
} from '../../domain/entities/sync-entities';
import {
  ICheckpointRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

const ORPHAN_THRESHOLD_MS = 15 * 60 * 1000;

export class PartitionActiveConflictError extends Error {
  public readonly httpStatus = 409;
  public readonly code = 'PARTITION_ALREADY_ACTIVE';
  public readonly diagnosticoLenguajeNatural: string;
  public readonly accionRecomendada: string;

  constructor(dominio: string, orgUnitPath: string, workerId: string | null) {
    const diag = SyncDiagnosticBuilder.build({
      escenario: 'PARTITION_CONFLICT_ACTIVE',
      dominio,
      orgUnitPath,
      detalleError: `Worker activo: ${workerId ?? 'desconocido'}`,
    });
    super(
      `La partición (${dominio}, ${orgUnitPath}) ya se encuentra EN_PROGRESO con latido vigente por ${workerId ?? 'otro worker'}.`,
    );
    this.name = 'PartitionActiveConflictError';
    this.diagnosticoLenguajeNatural = diag.resumenEjecutivo;
    this.accionRecomendada = diag.accionRecomendada;
  }
}

/**
 * Caso de uso administrativo `ListReconciliationCheckpointsUseCase` (`T051` / US4).
 */
export class ListReconciliationCheckpointsUseCase {
  constructor(private readonly checkpointRepo: ICheckpointRepositoryPort) {}

  public async execute(filters?: {
    dominio?: string;
    tipoProceso?: TipoProcesoConciliacion;
    estadoEjecucion?: EstadoEjecucionCheckpoint;
  }): Promise<{
    totalParticiones: number;
    particionesHuerfanasDetectadas: number;
    items: CheckpointConciliacion[];
  }> {
    const rawItems = await this.checkpointRepo.listCheckpoints(filters);
    let orphans = 0;

    const items = rawItems.map((cp) => {
      const isOrphan =
        cp.estadoEjecucion === 'EN_PROGRESO' &&
        Date.now() - Date.parse(cp.heartbeatEn) > ORPHAN_THRESHOLD_MS;
      if (isOrphan) {
        orphans++;
      }
      return {
        ...cp,
        esParticionHuerfana: isOrphan,
      };
    });

    return {
      totalParticiones: items.length,
      particionesHuerfanasDetectadas: orphans,
      items,
    };
  }
}

export interface TriggerPartitionInput {
  dominio: string;
  orgUnitPath: string;
  tipoProceso: TipoProcesoConciliacion;
  workerInstanciaId?: string;
  maxPaginasPorEjecucion?: number;
  confirmarBajasPorAusenciaAlCompletar?: boolean;
  traceId: string;
}

export interface TriggerPartitionOutput {
  checkpoint: CheckpointConciliacion;
  reclamoParticionHuerfana: boolean;
  tokenReanudadoDesde: string | null;
  paginasProcesadasEnCiclo: number;
  diagnosticoLenguajeNatural: string;
}

/**
 * Caso de uso administrativo `TriggerPartitionReconciliationUseCase` (`T051` / US4):
 * - Verifica que el dominio esté activo en `dominio_institucional` (`D-21`).
 * - Verifica si la partición ya está `EN_PROGRESO` con `heartbeat_en <= 15 minutos` o bloqueo activo
 *   en `pg_try_advisory_lock`, devolviendo `409 Conflict` con diagnóstico en español.
 * - Si la partición tiene `heartbeat_en > 15 minutos`, la reclama como huérfana y reanuda desde el último `nextPageToken`.
 */
export class TriggerPartitionReconciliationUseCase {
  constructor(
    private readonly checkpointRepo: ICheckpointRepositoryPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly gwsPort: IGoogleDirectoryReadOnlyPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly advisoryLockManager?: PartitionAdvisoryLock,
  ) {}

  public async execute(input: TriggerPartitionInput): Promise<TriggerPartitionOutput> {
    const normalizedDomain = input.dominio.toLowerCase();
    const isDomainActive = await this.syncIdentityRepo.isDomainActive(normalizedDomain);
    if (!isDomainActive) {
      throw new Error(`El dominio ${normalizedDomain} no está activo en dominio_institucional.`);
    }

    const existing = await this.checkpointRepo.findByPartition(
      normalizedDomain,
      input.orgUnitPath,
      input.tipoProceso,
    );

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let reclamoParticionHuerfana = false;

    if (existing && existing.estadoEjecucion === 'EN_PROGRESO') {
      const heartbeatAgeMs = nowMs - Date.parse(existing.heartbeatEn);
      if (heartbeatAgeMs <= ORPHAN_THRESHOLD_MS) {
        throw new PartitionActiveConflictError(
          normalizedDomain,
          input.orgUnitPath,
          existing.workerInstanciaId,
        );
      }
      reclamoParticionHuerfana = true;
    }

    const workerId = input.workerInstanciaId ?? `admin-trigger-${crypto.randomUUID().slice(0, 8)}`;
    const lockKey = derivePartitionAdvisoryLockKey(
      normalizedDomain,
      input.orgUnitPath,
      input.tipoProceso,
    );

    const runWork = async (): Promise<TriggerPartitionOutput> => {
      await this.quotaGovernor.setBatchJobActive(true);
      try {
        const tokenReanudadoDesde =
          existing && existing.estadoEjecucion !== 'COMPLETADO' && existing.estadoEjecucion !== 'COMPLETADA'
            ? existing.nextPageToken
            : null;

        let currentToken: string | null = tokenReanudadoDesde;
        let paginasProcesadasEnCiclo = 0;
        let cuentasProcesadas = existing?.cuentasProcesadas ?? 0;
        let cuentasActualizadas = existing?.cuentasActualizadas ?? 0;
        let cuentasOmitidasHash = existing?.cuentasOmitidasHash ?? 0;
        const maxPages = input.maxPaginasPorEjecucion ?? 10;

        let checkpointState: CheckpointConciliacion = {
          checkpointId: existing?.checkpointId ?? crypto.randomUUID(),
          dominio: normalizedDomain,
          orgUnitPath: input.orgUnitPath,
          tipoProceso: input.tipoProceso,
          nextPageToken: currentToken,
          cuentasProcesadas,
          cuentasActualizadas,
          cuentasOmitidasHash,
          cuentasBajaDetectadas: existing?.cuentasBajaDetectadas ?? 0,
          anomaliasAbiertas: existing?.anomaliasAbiertas ?? 0,
          estadoEjecucion: 'EN_PROGRESO',
          workerInstanciaId: workerId,
          lockAdvisoryKey: lockKey,
          heartbeatEn: nowIso,
          iniciadoEn: existing?.iniciadoEn ?? nowIso,
          completadoEn: null,
          ultimoErrorCodigo: null,
          diagnosticoOperativo: null,
          esParticionHuerfana: false,
        };

        checkpointState = await this.checkpointRepo.upsertCheckpoint(checkpointState);

        while (paginasProcesadasEnCiclo < maxPages) {
          const quota = await this.quotaGovernor.tryAcquire('BATCH_RECONCILIATION', 1);
          if (!quota.allowed) {
            checkpointState = await this.checkpointRepo.upsertCheckpoint({
              ...checkpointState,
              estadoEjecucion: 'PAUSADO_CUOTA',
              heartbeatEn: new Date().toISOString(),
            });
            break;
          }

          const page = await this.gwsPort.listUsersReadOnly(
            {
              domain: normalizedDomain,
              orgUnitPath: input.orgUnitPath,
              pageToken: currentToken ?? undefined,
              maxResults: 500,
            },
            input.traceId,
          );
          paginasProcesadasEnCiclo++;

          for (const user of page.users) {
            cuentasProcesadas++;
            const computedHash = hashPayloadGws(user);
            const meta = await this.syncIdentityRepo.findAccountSyncMetadata(
              user.id,
              user.primaryEmail,
            );
            if (meta && meta.hashPayloadGws === computedHash) {
              cuentasOmitidasHash++;
              continue;
            }
            const res = await this.syncIdentityRepo.upsertSyncedIdentity({
              idEventoExterno: `PARTITION:${normalizedDomain}:${user.id}:${Date.now()}`,
              gwsUser: user,
              hashPayloadGws: computedHash,
              origenCanal: 'SYNC_BATCH_JOB',
              modoDespacho: 'LOTE_LIST_500',
              traceId: input.traceId,
            });
            if (res.outcome === 'SIN_CAMBIOS_HASH') {
              cuentasOmitidasHash++;
            } else {
              cuentasActualizadas++;
              await this.cacheInvalidator.invalidateAccountScope({
                idInternoPersona: res.idInternoPersona,
                cuentaId: res.cuentaId,
                googleSubId: res.googleSubId,
                emailPrincipal: res.emailPrincipal,
                motivo: 'BATCH_PARTITION_SYNC',
                traceId: input.traceId,
              });
            }
          }

          currentToken = page.nextPageToken ?? null;
          const isCompleted = currentToken === null;
          const stepNowIso = new Date().toISOString();

          checkpointState = await this.checkpointRepo.upsertCheckpoint({
            ...checkpointState,
            nextPageToken: currentToken,
            cuentasProcesadas,
            cuentasActualizadas,
            cuentasOmitidasHash,
            estadoEjecucion: isCompleted ? 'COMPLETADO' : 'EN_PROGRESO',
            heartbeatEn: stepNowIso,
            completadoEn: isCompleted ? stepNowIso : null,
          });

          if (isCompleted) {
            break;
          }
        }

        const diag = SyncDiagnosticBuilder.build({
          escenario: reclamoParticionHuerfana
            ? 'PARTITION_ORPHAN_RECOVERED'
            : 'HEALTH_SUMMARY',
          dominio: normalizedDomain,
          orgUnitPath: input.orgUnitPath,
        });

        return {
          checkpoint: checkpointState,
          reclamoParticionHuerfana,
          tokenReanudadoDesde,
          paginasProcesadasEnCiclo,
          diagnosticoLenguajeNatural: diag.resumenEjecutivo,
        };
      } finally {
        await this.quotaGovernor.setBatchJobActive(false);
      }
    };

    if (this.advisoryLockManager) {
      const lockOutcome = await this.advisoryLockManager.withPartitionLock(
        normalizedDomain,
        input.orgUnitPath,
        input.tipoProceso,
        runWork,
      );
      if (!lockOutcome.acquired || !lockOutcome.result) {
        throw new PartitionActiveConflictError(
          normalizedDomain,
          input.orgUnitPath,
          existing?.workerInstanciaId ?? 'worker-bloqueo-consultivo',
        );
      }
      return lockOutcome.result;
    }

    return runWork();
  }
}
