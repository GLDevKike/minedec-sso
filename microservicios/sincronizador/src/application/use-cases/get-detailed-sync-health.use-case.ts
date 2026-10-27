import { SyncDiagnosticBuilder, SyncQuotaGovernor } from '@minedec/shared';
import { ModoDespachoSincronizacion } from '../../domain/entities/sync-entities';
import {
  ICheckpointRepositoryPort,
  IDlqRepositoryPort,
} from '../../domain/ports/sync-ports';

export interface DetailedSyncHealthResponse {
  status: 'HEALTHY' | 'DEGRADED_BATCH_MODE' | 'CRITICAL_FAIL_CLOSE';
  quotaBudget: {
    googleOfficialLimitRps: number;
    minedecHardCeilingRps: number;
    batchJobActive: boolean;
    priorityHotRegReservedRps: number;
    incrementalAllocatedRps: number;
    batchJobAllocatedRps: number;
    currentGlobalUsedRps: number;
  };
  batchSwitchHysteresis: {
    currentMode: ModoDespachoSincronizacion;
    highWatermarkPendingEvents: number;
    highWatermarkMaxAgeSeconds: number;
    lowWatermarkRestoreEvents: number;
  };
  diagnosticoAdministrador: {
    tituloLenguajeNatural: string;
    explicacionLenguajeNatural: string;
    posturaSeguridad: 'FAIL_CLOSE_ACTIVO' | 'OPERACION_NOMINAL';
    pasosRecomendados: string[];
    diagnosticoCuatroPartes: {
      componenteAfectado: string;
      impactoOperativo: string;
      mitigacionActiva: string;
      accionRecomendada: string;
    };
  };
}

/**
 * Caso de uso `GetDetailedSyncHealthUseCase` (`T060` / US5):
 * Devuelve el estado detallado del Sincronizador, presupuesto de cuota `<= 28 req/s`,
 * modo `INDIVIDUAL_GET` / `LOTE_LIST_500`, conteo `DLQ`, particiones activas/huérfanas
 * y diagnóstico ejecutivo en español.
 */
export class GetDetailedSyncHealthUseCase {
  constructor(
    private readonly quotaGovernor: SyncQuotaGovernor,
    private readonly dlqRepo: IDlqRepositoryPort,
    private readonly checkpointRepo?: ICheckpointRepositoryPort,
  ) {}

  public async execute(): Promise<DetailedSyncHealthResponse> {
    const snapshot = await this.quotaGovernor.getStatusSnapshot();
    const pendingDlq = await this.dlqRepo.countPendingDlq();
    let orphanPartitions = 0;

    if (this.checkpointRepo) {
      const checkpoints = await this.checkpointRepo.listCheckpoints();
      orphanPartitions = checkpoints.filter((c) => c.esParticionHuerfana).length;
    }

    const diag = SyncDiagnosticBuilder.build({
      escenario: 'HEALTH_SUMMARY',
      modoIngesta: snapshot.currentDispatchMode,
      reqPorSegundoActual: snapshot.currentGlobalUsedRps,
      pendientesDlq: pendingDlq,
    });

    const isBatchMode =
      snapshot.currentDispatchMode === 'LOTE_LIST_500' || snapshot.batchJobActive;

    return {
      status: isBatchMode ? 'DEGRADED_BATCH_MODE' : 'HEALTHY',
      quotaBudget: {
        googleOfficialLimitRps: snapshot.googleOfficialLimitRps,
        minedecHardCeilingRps: snapshot.minedecHardCeilingRps,
        batchJobActive: snapshot.batchJobActive,
        priorityHotRegReservedRps: snapshot.priorityHotRegReservedRps,
        incrementalAllocatedRps: snapshot.incrementalAllocatedRps,
        batchJobAllocatedRps: snapshot.batchJobAllocatedRps,
        currentGlobalUsedRps: snapshot.currentGlobalUsedRps,
      },
      batchSwitchHysteresis: {
        currentMode: snapshot.currentDispatchMode,
        highWatermarkPendingEvents: snapshot.highWatermarkPendingEvents,
        highWatermarkMaxAgeSeconds: snapshot.highWatermarkMaxAgeSeconds,
        lowWatermarkRestoreEvents: snapshot.lowWatermarkRestoreEvents,
      },
      diagnosticoAdministrador: {
        tituloLenguajeNatural: isBatchMode
          ? 'Sincronizador operando en modo lote regulado por histéresis o conciliación activa'
          : 'Sincronizador de Identidades operando en estado nominal (<= 28 req/s)',
        explicacionLenguajeNatural: `${diag.resumenEjecutivo} Particiones huérfanas detectadas: ${orphanPartitions}.`,
        posturaSeguridad: 'OPERACION_NOMINAL',
        pasosRecomendados: [
          diag.accionRecomendada,
          ...(orphanPartitions > 0
            ? [
                `Ejecutar POST /api/v1/admin/sync/partitions/trigger para reanudar las ${orphanPartitions} particiones huérfanas desde su último nextPageToken.`,
              ]
            : []),
        ],
        diagnosticoCuatroPartes: {
          componenteAfectado: diag.componenteAfectado,
          impactoOperativo: diag.impactoOperativo,
          mitigacionActiva: diag.mitigacionActiva,
          accionRecomendada: diag.accionRecomendada,
        },
      },
    };
  }
}
