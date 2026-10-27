import {
  AuditEventWriter,
  derivePartitionAdvisoryLockKey,
  hashPayloadGws,
  PartitionAdvisoryLock,
  SyncDiagnosticBuilder,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  IGoogleDirectoryReadOnlyPort,
  TipoProcesoConciliacion,
} from '@minedec/sincronizador';
import {
  ConfiguracionParticionJob,
  GwsDirectoryUserProfile,
  IBatchReconciliationRepositoryPort,
  IBatchReconciliationRunnerPort,
  PartitionAlreadyActiveConflictError,
  ResultadoEjecucionParticion,
} from '../../domain/batch-reconciliation.types';

/**
 * Caso de uso de Carga Inicial y Conciliación Nocturna Masiva Particionada (US4 / T048).
 * - Gobernado estrictamente por los dominios activos en `dominio_institucional` (D-21).
 * - Lotes de 500 cuentas con tope `<= 20 req/s` (reservando `>= 8 req/s` para tráfico en tiempo real).
 * - Omisión de escrituras cuando `hash_payload_gws` no cambió.
 * - Persistencia transaccional de `next_page_token` por página.
 * - Exclusión mutua con `pg_try_advisory_lock(lock_advisory_key)` y rescate de huérfanas (`heartbeat_en > 15 min`).
 * 100% libre de decoradores de framework (Principio IV).
 */
export class RunPartitionReconciliationUseCase implements IBatchReconciliationRunnerPort {
  public constructor(
    private readonly batchRepository: IBatchReconciliationRepositoryPort,
    private readonly gwsDirectory: IGoogleDirectoryReadOnlyPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly advisoryLock: PartitionAdvisoryLock,
    private readonly auditWriter: AuditEventWriter = new AuditEventWriter(),
    private readonly diagnosticBuilder: SyncDiagnosticBuilder = new SyncDiagnosticBuilder(),
  ) {}

  public async runPartition(
    config: ConfiguracionParticionJob,
  ): Promise<ResultadoEjecucionParticion> {
    const dominio = config.dominio.trim().toLowerCase();
    const orgUnitPath = config.orgUnitPath.trim() || '/';
    const tipoProceso = config.tipoProceso;
    const pageSize = Math.min(Math.max(config.pageSize ?? 500, 1), 500);
    const forzarReinicio = config.forzarReinicioDesdeCero ?? false;
    const actor = config.actorIdentificacion ?? 'sa-sso-sync-job';

    // 1. Verificar que el dominio esté activo en dominio_institucional (D-21)
    const domainRecord = await this.batchRepository.findDomainByName(dominio);
    if (!domainRecord || !domainRecord.activo) {
      throw new Error(
        `El dominio '${dominio}' no está registrado o se encuentra inactivo en dominio_institucional (D-21).`,
      );
    }

    const partitionId = `${dominio}:${orgUnitPath}:${tipoProceso}`;
    const lockKey = derivePartitionAdvisoryLockKey(dominio, orgUnitPath, tipoProceso);

    // 2. Intentar adquirir bloqueo consultivo pg_try_advisory_lock(lock_advisory_key)
    const lockAttempt = await this.advisoryLock.tryAcquirePartitionLock(
      dominio,
      orgUnitPath,
      tipoProceso,
    );
    if (!lockAttempt.acquired) {
      const diag = this.diagnosticBuilder.buildPartitionLockConflictDiagnostic({
        dominio,
        orgUnitPath,
        tipoProceso,
        heartbeatEn: new Date().toISOString(),
      });
      throw new PartitionAlreadyActiveConflictError(
        `La partición (${partitionId}) ya se encuentra bloqueada por otro worker activo en AlloyDB (lockKey=${lockAttempt.lockKey}).`,
        diag.mensajeConsolidado,
      );
    }

    try {
      // 3. Cargar o inicializar checkpoint y verificar si era huérfana (heartbeat_en > 15 min)
      const { checkpoint: initialCheckpoint, rescatadaDeHuerfana } =
        await this.batchRepository.findOrCreatePartitionCheckpoint(
          dominio,
          orgUnitPath,
          tipoProceso,
          lockKey,
          forzarReinicio,
        );

      if (rescatadaDeHuerfana) {
        await this.auditWriter.appendEvent({
          tipoEvento: 'CONCILIACION_PARTICION_RECLAMADA',
          actorIdentificacion: actor,
          origenComponente: 'CONCILIADOR_GWS',
          payloadEvento: {
            checkpointId: initialCheckpoint.checkpointId,
            dominio,
            orgUnitPath,
            tipoProceso,
            nextPageTokenRescatado: initialCheckpoint.nextPageToken,
          },
        });
      }

      await this.auditWriter.appendEvent({
        tipoEvento: 'CONCILIACION_PARTICION_INICIADA',
        actorIdentificacion: actor,
        origenComponente: 'CONCILIADOR_GWS',
        payloadEvento: {
          checkpointId: initialCheckpoint.checkpointId,
          dominio,
          orgUnitPath,
          tipoProceso,
          reanudadoDesdeToken: initialCheckpoint.nextPageToken,
          forzarReinicioDesdeCero: forzarReinicio,
        },
      });

      // 4. Activar bandera de lote masivo en Redis (reserva >= 8 req/s para tráfico en tiempo real y limita batch a <= 20 req/s)
      await this.quotaGovernor.setBatchModeActive(true);

      const reanudadoDesdeToken = initialCheckpoint.nextPageToken;
      let currentPageToken: string | undefined = initialCheckpoint.nextPageToken ?? undefined;
      let paginasProcesadas = 0;
      let currentCheckpoint = initialCheckpoint;
      let totalFallosDlq = 0;

      do {
        // Gobernar tasa <= 20 req/s en modo BATCH
        await this.quotaGovernor.acquireQuotaSlot('BATCH');

        const page = await this.gwsDirectory.listUsersReadOnly({
          domain: dominio,
          orgUnitPath: orgUnitPath !== '/' ? orgUnitPath : undefined,
          pageToken: currentPageToken,
          maxResults: pageSize,
        });

        paginasProcesadas += 1;

        const googleSubIds = page.users.map((u) => u.googleSubId || u.id);
        const existingHashes =
          await this.batchRepository.getExistingHashesByGoogleSubIds(googleSubIds);

        const changedProfiles: GwsDirectoryUserProfile[] = [];
        let pageOmitidosSinCambios = 0;

        for (const profile of page.users) {
          const subId = profile.googleSubId || profile.id;
          const calculatedHash = hashPayloadGws(profile);
          const storedHash = existingHashes.get(subId) ?? null;
          if (storedHash !== null && storedHash === calculatedHash) {
            pageOmitidosSinCambios += 1;
          } else {
            changedProfiles.push(profile);
          }
        }

        const pageResult = await this.batchRepository.processPageChangedProfiles(
          changedProfiles,
          dominio,
          tipoProceso,
        );
        totalFallosDlq += pageResult.fallosDlq;

        const isLastPage = !page.nextPageToken;
        const nuevoEstado = isLastPage ? 'COMPLETADO' : 'EN_PROGRESO';
        const completadoEn = isLastPage ? new Date().toISOString() : null;

        currentCheckpoint = await this.batchRepository.savePageCheckpoint({
          checkpointId: currentCheckpoint.checkpointId,
          nextPageToken: page.nextPageToken ?? null,
          estadoEjecucion: nuevoEstado,
          deltaProcesados: page.users.length,
          deltaActualizados: pageResult.actualizados,
          deltaOmitidosSinCambios: pageOmitidosSinCambios + pageResult.omitidosSinCambios,
          deltaAnomaliasAbiertas: pageResult.anomaliasAbiertas,
          deltaFallosDlq: pageResult.fallosDlq,
          ultimoErrorResumen: null,
          completadoEn,
        });

        currentPageToken = page.nextPageToken ?? undefined;
      } while (currentPageToken);

      await this.auditWriter.appendEvent({
        tipoEvento: 'CONCILIACION_PARTICION_COMPLETADA',
        actorIdentificacion: actor,
        origenComponente: 'CONCILIADOR_GWS',
        payloadEvento: {
          checkpointId: currentCheckpoint.checkpointId,
          dominio,
          orgUnitPath,
          tipoProceso,
          paginasProcesadas,
          totalProcesados: currentCheckpoint.cuentasProcesadas,
          totalActualizados: currentCheckpoint.cuentasActualizadas,
          totalOmitidosSinCambios: currentCheckpoint.cuentasOmitidasHash,
          totalAnomaliasAbiertas: currentCheckpoint.anomaliasAbiertas,
          totalFallosDlq,
        },
      });

      return {
        checkpointId: currentCheckpoint.checkpointId,
        dominio,
        orgUnitPath,
        tipoProceso,
        estadoEjecucion: currentCheckpoint.estadoEjecucion,
        paginasProcesadas,
        totalProcesados: currentCheckpoint.cuentasProcesadas,
        totalActualizados: currentCheckpoint.cuentasActualizadas,
        totalOmitidosSinCambios: currentCheckpoint.cuentasOmitidasHash,
        totalAnomaliasAbiertas: currentCheckpoint.anomaliasAbiertas,
        totalFallosDlq,
        rescatadaDeHuerfana,
        reanudadoDesdeToken,
        iniciadoEn: currentCheckpoint.iniciadoEn,
        completadoEn: currentCheckpoint.completadoEn,
        diagnosticoNatural: `Partición (${partitionId}) completada exitosamente: ${currentCheckpoint.cuentasProcesadas} cuentas evaluadas en ${paginasProcesadas} página(s), ${currentCheckpoint.cuentasActualizadas} actualizada(s) y ${currentCheckpoint.cuentasOmitidasHash} omitida(s) por hash SHA-256 idéntico.`,
      };
    } finally {
      await this.quotaGovernor.setBatchModeActive(false);
      await this.advisoryLock.releasePartitionLock(dominio, orgUnitPath, tipoProceso);
    }
  }

  public async runAllActiveDomainPartitions(
    tipoProceso: TipoProcesoConciliacion,
    orgUnitPath = '/',
  ): Promise<ResultadoEjecucionParticion[]> {
    const activeDomains = await this.batchRepository.listActiveDomains();
    const results: ResultadoEjecucionParticion[] = [];
    for (const domain of activeDomains) {
      const res = await this.runPartition({
        dominio: domain.dominio,
        orgUnitPath,
        tipoProceso,
      });
      results.push(res);
    }
    return results;
  }
}
