import { GwsDirectoryUserRecord, SqlQueryExecutor } from '@minedec/shared';
import {
  CheckpointConciliacion,
  EstadoEjecucionCheckpoint,
  TipoProcesoConciliacion,
} from '@minedec/sincronizador';

export type EstadoCheckpointConciliacion = EstadoEjecucionCheckpoint;
export type GwsDirectoryUserProfile = GwsDirectoryUserRecord;

export interface DominioSincronizable {
  dominio: string;
  activo: boolean;
}

export interface ConfiguracionParticionJob {
  dominio: string;
  orgUnitPath: string;
  tipoProceso: TipoProcesoConciliacion;
  forzarReinicioDesdeCero?: boolean;
  pageSize?: number;
  actorIdentificacion?: string;
}

export interface ResultadoEjecucionParticion {
  checkpointId: string;
  dominio: string;
  orgUnitPath: string;
  tipoProceso: TipoProcesoConciliacion;
  estadoEjecucion: EstadoCheckpointConciliacion;
  paginasProcesadas: number;
  totalProcesados: number;
  totalActualizados: number;
  totalOmitidosSinCambios: number;
  totalAnomaliasAbiertas: number;
  totalFallosDlq: number;
  rescatadaDeHuerfana: boolean;
  reanudadoDesdeToken: string | null;
  iniciadoEn: string;
  completadoEn: string | null;
  diagnosticoNatural: string;
}

export class PartitionAlreadyActiveConflictError extends Error {
  public readonly statusCode = 409;
  public readonly code = 'PARTICION_EN_EJECUCION_ACTIVA';
  public readonly diagnosticoNatural: string;

  public constructor(message: string, diagnosticoNatural: string) {
    super(message);
    this.name = 'PartitionAlreadyActiveConflictError';
    this.diagnosticoNatural = diagnosticoNatural;
  }
}

export interface IBatchReconciliationRunnerPort {
  runPartition(config: ConfiguracionParticionJob): Promise<ResultadoEjecucionParticion>;
  runAllActiveDomainPartitions(
    tipoProceso: TipoProcesoConciliacion,
    orgUnitPath?: string,
  ): Promise<ResultadoEjecucionParticion[]>;
}

export interface BatchUpsertPageSummary {
  actualizados: number;
  omitidosSinCambios: number;
  anomaliasAbiertas: number;
  fallosDlq: number;
}

export interface SavePageCheckpointCommand {
  checkpointId: string;
  nextPageToken: string | null;
  estadoEjecucion: EstadoCheckpointConciliacion;
  deltaProcesados: number;
  deltaActualizados: number;
  deltaOmitidosSinCambios: number;
  deltaAnomaliasAbiertas: number;
  deltaFallosDlq: number;
  ultimoErrorResumen?: string | null;
  completadoEn?: string | null;
}

export interface IBatchReconciliationRepositoryPort {
  listActiveDomains(tx?: SqlQueryExecutor): Promise<DominioSincronizable[]>;
  findDomainByName(dominio: string, tx?: SqlQueryExecutor): Promise<DominioSincronizable | null>;
  findOrCreatePartitionCheckpoint(
    dominio: string,
    orgUnitPath: string,
    tipoProceso: TipoProcesoConciliacion,
    lockAdvisoryKey: string,
    forzarReinicioDesdeCero: boolean,
    tx?: SqlQueryExecutor,
  ): Promise<{
    checkpoint: CheckpointConciliacion;
    rescatadaDeHuerfana: boolean;
  }>;
  getExistingHashesByGoogleSubIds(
    googleSubIds: readonly string[],
    tx?: SqlQueryExecutor,
  ): Promise<Map<string, string | null>>;
  processPageChangedProfiles(
    profiles: readonly GwsDirectoryUserProfile[],
    dominio: string,
    tipoProceso: TipoProcesoConciliacion,
  ): Promise<BatchUpsertPageSummary>;
  savePageCheckpoint(
    command: SavePageCheckpointCommand,
    tx?: SqlQueryExecutor,
  ): Promise<CheckpointConciliacion>;
  updateHeartbeat(checkpointId: string, tx?: SqlQueryExecutor): Promise<void>;
}
