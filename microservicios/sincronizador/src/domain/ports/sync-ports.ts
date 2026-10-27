import {
  GwsDirectoryListPage,
  GwsDirectoryListParams,
  GwsDirectoryUserRecord,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  CheckpointConciliacion,
  EstadoEjecucionCheckpoint,
  EstadoRegistroDlq,
  EventoSincronizacionGws,
  ModoDespachoSincronizacion,
  RegistroFalloSincronizacion,
  ResultadoSincronizacionCuenta,
  TipoEventoDirectorio,
  TipoProcesoConciliacion,
} from '../entities/sync-entities';

export interface IGoogleDirectoryReadOnlyPort {
  getUserReadOnly(userKey: string, traceId?: string): Promise<GwsDirectoryUserRecord | null>;
  listUsersReadOnly(
    params: GwsDirectoryListParams,
    traceId?: string,
  ): Promise<GwsDirectoryListPage>;
}

export interface IUpsertDirectoryIdentityDelegate {
  execute(
    input: Record<string, unknown>,
    traceId?: string,
  ): Promise<{
    idInterno: string;
    cuentaId: string;
    estadoPersona: string;
    estadoSincronizacion: string;
    cacheInvalidated: boolean;
    anomaliasAbiertas: Array<{ anomaliaId: string }>;
  }>;
}

export interface UpsertSyncedIdentityParams {
  idEventoExterno: string;
  gwsUser: GwsDirectoryUserRecord;
  hashPayloadGws: string;
  origenCanal: 'SYNC_INCREMENTAL' | 'SYNC_BATCH_JOB';
  modoDespacho: ModoDespachoSincronizacion;
  traceId: string;
  forceUpsert?: boolean;
  deletedEnGws?: boolean;
}

export interface UpsertSyncedIdentityResult {
  outcome: 'APLICADO' | 'SIN_CAMBIOS_HASH' | 'ANOMALIA_REGISTRADA';
  idInternoPersona: string;
  cuentaId: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  estadoPersona: string;
  estadoCuenta: string;
  otherActiveAccountsCount: number;
  requiresCacheInvalidation: boolean;
  anomaliasGeneradasIds: string[];
}

export interface ReconcileHotIdentityParams {
  idEventoExterno: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  gwsUser: GwsDirectoryUserRecord | null;
  hashPayloadGws: string | null;
  traceId: string;
}

export interface ReconcileHotIdentityResult {
  action: 'PROMOTED_IN_PLACE' | 'MERGED_INTO_EXISTING' | 'KEPT_PENDING_NO_VALID_ID';
  idInternoDefinitivo: string;
  idInternoProvisionalEliminado?: string;
  cuentaId: string;
  estadoPersona: string;
  estadoCuenta: string;
  anomaliaId?: string;
}

export interface DeactivatePersonCascadeParams {
  idInterno: string;
  nuevoEstadoPersona: 'INACTIVA' | 'BLOQUEADA_ANOMALIA';
  adminIdentificacion: string;
  motivoDesactivacion: string;
  traceId: string;
}

export interface DeactivatePersonCascadeResult {
  idInterno: string;
  tipoIdentificacion: string | null;
  numeroIdentificacion: string | null;
  estadoPersona: 'INACTIVA' | 'BLOQUEADA_ANOMALIA';
  cuentasDesactivadas: Array<{
    cuentaId: string;
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
  }>;
  subdominiosAfectados: string[];
}

export interface ISyncIdentityRepositoryPort {
  isDomainActive(dominio: string, tx?: SqlQueryExecutor): Promise<boolean>;
  listActiveDomains(tx?: SqlQueryExecutor): Promise<string[]>;
  findAccountSyncMetadata(
    googleSubId: string,
    emailPrincipal?: string | null,
    tx?: SqlQueryExecutor,
  ): Promise<{
    cuentaId: string;
    idInterno: string;
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    estadoSincronizacion: string;
    hashPayloadGws: string | null;
    ultimaSincronizacionEn: string;
  } | null>;
  countActiveAccountsForPerson(
    idInterno: string,
    excludeCuentaId?: string,
    tx?: SqlQueryExecutor,
  ): Promise<number>;
  upsertSyncedIdentity(
    params: UpsertSyncedIdentityParams,
  ): Promise<UpsertSyncedIdentityResult>;
  applyAccountLifecycleChange(params: {
    googleSubId: string;
    emailPrincipal?: string | null;
    nuevoEstadoCuenta: 'SUSPENDIDA_GWS' | 'ELIMINADA_GWS' | 'SINCRONIZADA';
    motivo: string;
    origenCanal: 'SYNC_INCREMENTAL' | 'SYNC_BATCH_JOB';
    traceId: string;
  }): Promise<{
    found: boolean;
    idInternoPersona?: string;
    cuentaId?: string;
    googleSubId: string;
    emailPrincipal?: string;
    dominio?: string;
    estadoPersonaResultante?: string;
    estadoCuentaResultante?: string;
    remainingActiveAccountsCount: number;
  }>;
  deactivatePersonCascade(
    params: DeactivatePersonCascadeParams,
  ): Promise<DeactivatePersonCascadeResult | null>;
  reconcileOrMergeHotIdentity(
    params: ReconcileHotIdentityParams,
  ): Promise<ReconcileHotIdentityResult>;
}

export interface IProcessedEventRepositoryPort {
  findByIdEventoExterno(
    idEventoExterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<EventoSincronizacionGws | null>;
  findLatestTimestampForUser(
    googleSubId: string,
    tx?: SqlQueryExecutor,
  ): Promise<string | null>;
  recordProcessedEvent(
    event: EventoSincronizacionGws,
    tx?: SqlQueryExecutor,
  ): Promise<{ inserted: boolean; record: EventoSincronizacionGws }>;
}

export interface ICheckpointRepositoryPort {
  findByPartition(
    dominio: string,
    orgUnitPath: string,
    tipoProceso: TipoProcesoConciliacion,
    tx?: SqlQueryExecutor,
  ): Promise<CheckpointConciliacion | null>;
  listCheckpoints(
    filters?: {
      dominio?: string;
      tipoProceso?: TipoProcesoConciliacion;
      estadoEjecucion?: EstadoEjecucionCheckpoint;
    },
    tx?: SqlQueryExecutor,
  ): Promise<CheckpointConciliacion[]>;
  upsertCheckpoint(
    checkpoint: CheckpointConciliacion,
    tx?: SqlQueryExecutor,
  ): Promise<CheckpointConciliacion>;
}

export interface IDlqRepositoryPort {
  findById(
    dlqId: string,
    tx?: SqlQueryExecutor,
  ): Promise<RegistroFalloSincronizacion | null>;
  findByExternalEventId(
    idEventoExterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<RegistroFalloSincronizacion | null>;
  upsertDlqFailure(
    record: RegistroFalloSincronizacion,
    tx?: SqlQueryExecutor,
  ): Promise<RegistroFalloSincronizacion>;
  listDlqRecords(
    filters?: {
      estadoDlq?: EstadoRegistroDlq;
      dominio?: string;
      limit?: number;
      dlqIds?: string[];
    },
    tx?: SqlQueryExecutor,
  ): Promise<{ items: RegistroFalloSincronizacion[]; totalPendientes: number }>;
  countPendingDlq(tx?: SqlQueryExecutor): Promise<number>;
}

export interface ISyncCacheInvalidatorPort {
  invalidateAccountScope(params: {
    idInternoPersona: string;
    cuentaId: string;
    googleSubId: string;
    emailPrincipal: string;
    motivo: string;
    traceId: string;
  }): Promise<{ invalidatedKeysCount: number; pubSubPublished: boolean }>;

  invalidatePersonCascadeScope(params: {
    idInternoPersona: string;
    tipoIdentificacion?: string | null;
    numeroIdentificacion?: string | null;
    cuentas: Array<{
      cuentaId: string;
      googleSubId: string;
      emailPrincipal: string;
      dominio: string;
    }>;
    motivo: string;
    traceId: string;
  }): Promise<{ invalidatedKeysCount: number; pubSubPublished: boolean }>;
}

export interface ISyncTaskDispatcherPort {
  enqueuePriorityHotRegistration(payload: {
    idEventoExterno: string;
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    solicitadoEn: string;
    traceId: string;
  }): Promise<{ taskId: string; queueName: string }>;

  enqueueIncrementalSync(payload: {
    idEventoExterno: string;
    tipoEvento: TipoEventoDirectorio | string;
    googleSubId?: string;
    emailPrincipal?: string;
    dominio?: string;
    orgUnitPath?: string;
    timestampEventoGws: string;
    colaPendientesAlDespachar?: number;
    antiguedadMensajeMasViejoSegundos?: number;
    traceId: string;
  }): Promise<{ taskId: string; queueName: string }>;
}

export type { ResultadoSincronizacionCuenta };
