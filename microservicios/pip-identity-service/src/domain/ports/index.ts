import {
  CodigoCausalAnomalia,
  EfectoAccesoAnomalia,
  SqlQueryExecutor,
  TipoIdentificacionPersona,
} from '@minedec/shared';
import {
  CatalogoTerritorioSede,
  CuentaInstitucional,
  DominioInstitucional,
  EstadoPersonaIdentidad,
  NivelAccesoEfectivo,
  PersonaIdentidad,
} from '../entities/identity-entities';
import { AnomaliaIdentidad, EstadoAnomalia } from '../services/anomaly-lifecycle.service';
import {
  CategoriaCatalogo,
  CatalogoAtributoMinedec,
} from '../services/catalog-derivation.service';
import { AsignacionContexto } from '../services/multisede-and-transition.service';

export interface PersonaIdentidadRepositoryPort {
  findByIdInterno(idInterno: string, tx?: SqlQueryExecutor): Promise<PersonaIdentidad | null>;
  findByDocument(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad | null>;
  findByNumeroIdentificacionOnly(
    numeroIdentificacion: string,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad | null>;
  upsert(persona: PersonaIdentidad, tx?: SqlQueryExecutor): Promise<PersonaIdentidad>;
  updateEstadoPersona(
    idInterno: string,
    estadoPersona: EstadoPersonaIdentidad,
    tx?: SqlQueryExecutor,
  ): Promise<void>;
}

export interface CuentaInstitucionalRepositoryPort {
  findByGoogleSubId(
    googleSubId: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional | null>;
  findByEmailPrincipal(
    emailPrincipal: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional | null>;
  findByCuentaId(cuentaId: string, tx?: SqlQueryExecutor): Promise<CuentaInstitucional | null>;
  findAllByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional[]>;
  upsert(
    cuenta: CuentaInstitucional,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional>;
}

export interface DominioInstitucionalRepositoryPort {
  findByDomain(
    dominio: string,
    tx?: SqlQueryExecutor,
  ): Promise<DominioInstitucional | null>;
  upsert(
    dominio: DominioInstitucional,
    tx?: SqlQueryExecutor,
  ): Promise<DominioInstitucional>;
}

export interface CatalogoTerritorioSedeRepositoryPort {
  findByCodigoAmie(
    codigoAmie: string,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoTerritorioSede | null>;
  upsert(
    sede: CatalogoTerritorioSede,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoTerritorioSede>;
}

export interface AsignacionContextoRepositoryPort {
  findActiveByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]>;
  findAllByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]>;
  findPrimaryByCuentaId(
    cuentaId: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto | null>;
  upsertPrimaryAssignment(
    assignment: AsignacionContexto,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto>;
  insertDelegatedAssignment(
    assignment: AsignacionContexto,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto>;
  deactivateDelegatedAssignmentsByIdInterno(
    idInterno: string,
    cuentaId?: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]>;
  relinkAssignmentsToPersona(
    fromIdInterno: string,
    toIdInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<void>;
}

export interface AnomalyFilterQuery {
  estadoAnomalia?: EstadoAnomalia;
  efectoAcceso?: EfectoAccesoAnomalia;
  codigoCausal?: CodigoCausalAnomalia;
  dominio?: string;
  pageSize?: number;
  cursor?: string;
}

export interface AnomalyPaginatedList {
  items: AnomaliaIdentidad[];
  nextCursor: string | null;
}

export interface AnomaliaIdentidadRepositoryPort {
  findById(anomaliaId: string, tx?: SqlQueryExecutor): Promise<AnomaliaIdentidad | null>;
  findActiveByGoogleSubId(
    googleSubId: string,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad[]>;
  findActiveByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad[]>;
  findLatestResolvedByGoogleSubIdAndCausal(
    googleSubId: string,
    codigoCausal: CodigoCausalAnomalia,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad | null>;
  insert(anomalia: AnomaliaIdentidad, tx?: SqlQueryExecutor): Promise<AnomaliaIdentidad>;
  update(anomalia: AnomaliaIdentidad, tx?: SqlQueryExecutor): Promise<AnomaliaIdentidad>;
  listPaginated(query: AnomalyFilterQuery, tx?: SqlQueryExecutor): Promise<AnomalyPaginatedList>;
}

export interface CatalogoAtributoRepositoryPort {
  listByCategory(
    categoriaAtributo: CategoriaCatalogo,
    onlyActive?: boolean,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoAtributoMinedec[]>;
  listAllActiveGrouped(
    tx?: SqlQueryExecutor,
  ): Promise<Record<CategoriaCatalogo, CatalogoAtributoMinedec[]>>;
  upsert(
    entry: CatalogoAtributoMinedec,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoAtributoMinedec>;
  invalidateCatalogCache(categoriaAtributo?: CategoriaCatalogo): Promise<void>;
}

export interface ProjectedUnifiedIdentity {
  persona: PersonaIdentidad;
  cuentas: CuentaInstitucional[];
  contextosActivos: AsignacionContexto[];
  anomaliasActivas: AnomaliaIdentidad[];
  nivelAccesoEfectivo: NivelAccesoEfectivo;
  cachedAt: string;
}

export interface IdentityCacheInvalidationKeys {
  idInterno: string;
  previousIdInterno?: string | null;
  identifiers: Array<{
    tipoIdentificacion: TipoIdentificacionPersona;
    numeroIdentificacion: string;
  }>;
  emails: string[];
  googleSubIds: string[];
}

export interface IdentityCachePort {
  getByIdInterno(idInterno: string): Promise<ProjectedUnifiedIdentity | null>;
  getByDocument(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
  ): Promise<ProjectedUnifiedIdentity | null>;
  getByEmail(emailPrincipal: string): Promise<ProjectedUnifiedIdentity | null>;
  getByGoogleSubId(googleSubId: string): Promise<ProjectedUnifiedIdentity | null>;
  putProjectedIdentity(
    projection: ProjectedUnifiedIdentity,
    ttlSeconds?: number,
  ): Promise<void>;
  invalidateIdentityKeys(keys: IdentityCacheInvalidationKeys): Promise<number>;
  getRemainingTtlSeconds(rawKey: string): Promise<number>;
}

export interface CacheInvalidationEventPayload {
  eventId: string;
  occurredAt: string;
  reason: string;
  idInterno: string;
  keysUnlinkedCount: number;
  identifiers: string[];
  emails: string[];
  googleSubIds: string[];
}

export interface CacheInvalidationPublisherPort {
  publishInvalidationEvent(event: CacheInvalidationEventPayload): Promise<void>;
}

export interface AuditRecordRequest {
  tipoEvento:
    | 'IDENTIDAD_CREADA'
    | 'IDENTIDAD_ACTUALIZADA'
    | 'TRANSICION_CODIGO_A_CEDULA'
    | 'REGISTRO_CALIENTE_PROVISIONAL'
    | 'ANOMALIA_ABIERTA'
    | 'ANOMALIA_AUTO_RESUELTA'
    | 'ANOMALIA_RESUELTA_MANUAL'
    | 'ASIGNACION_CONTEXTO_MODIFICADA'
    | 'CATALOGO_ACTUALIZADO'
    | 'CACHE_INVALIDADA';
  idInterno?: string | null;
  cuentaId?: string | null;
  actorIdentificacion: string;
  origenComponente: 'SINCRONIZADOR_GWS' | 'CONCILIADOR_GWS' | 'PDP_MOTOR' | 'PAP_ADMIN';
  payloadEvento: Record<string, unknown>;
}

export interface AuditLogPort {
  recordEvent(request: AuditRecordRequest, tx?: SqlQueryExecutor): Promise<void>;
}

export interface PrioritySyncRequestPayload {
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  provisionalIdInterno: string;
  requestedAt: string;
  traceId?: string;
  traceparent?: string;
}

export interface PrioritySyncQueuePort {
  enqueuePriorityAccountSync(payload: PrioritySyncRequestPayload): Promise<{
    taskId: string;
    enqueuedAt: string;
  }>;
}
