import { randomUUID } from 'crypto';
import { TipoIdentificacionPersona } from '@minedec/shared';

export type TipoPoblacionDominio = 'ESTUDIANTE' | 'DOCENTE' | 'ADMINISTRATIVO' | 'MIXTO';

export type EstadoPersonaIdentidad =
  | 'ACTIVA'
  | 'PENDIENTE_IDENTIFICACION'
  | 'RESTRINGIDA_ANOMALIA'
  | 'BLOQUEADA_ANOMALIA'
  | 'INACTIVA';

export type EstadoSincronizacionCuenta =
  | 'SINCRONIZADA'
  | 'REGISTRO_CALIENTE'
  | 'SUSPENDIDA_GWS'
  | 'VIGENCIA_VENCIDA'
  | 'BLOQUEADA_ANOMALIA';

export type OrigenSincronizacionCuenta =
  | 'EVENTO_AUDIT_LOG'
  | 'BARRIDO_DELTA_2MIN'
  | 'CONCILIACION_BATCH'
  | 'CONCILIACION_DIARIA'
  | 'REGISTRO_CALIENTE_PRIORITARIO';

export type NivelAccesoEfectivo = 'COMPLETO' | 'RESTRINGIDA_SOLO_AUTENTICADA' | 'BLOQUEADO';

export interface DominioInstitucional {
  dominio: string;
  googleCustomerId: string;
  tipoPoblacion: TipoPoblacionDominio;
  esSubdominio: boolean;
  activo: boolean;
}

export interface CatalogoTerritorioSede {
  codigoAmie: string;
  nombreInstitucion: string;
  codigoZona: string;
  codigoDistrito: string | null;
  codigoCircuito: string | null;
  provinciaDpa: string | null;
  cantonDpa: string | null;
  parroquiaDpa: string | null;
  regimenEscolar: 'COSTA_GALAPAGOS' | 'SIERRA_AMAZONIA' | 'NO_APLICA';
  sostenimiento: 'FISCAL' | 'FISCOMISIONAL' | 'MUNICIPAL' | 'PARTICULAR' | null;
  modalidadEducativa: 'PRESENCIAL' | 'SEMIPRESENCIAL' | 'A_DISTANCIA' | 'VIRTUAL' | 'NO_APLICA' | null;
  jornada: 'MATUTINA' | 'VESPERTINA' | 'NOCTURNA' | 'INTENSIVA' | 'NO_APLICA' | null;
  activo: boolean;
}

export interface PersonaIdentidad {
  idInterno: string;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  codigoMinedecAnterior: string | null;
  nombreCompleto: string;
  fechaNacimiento: string | null;
  representanteLegalCedula: string | null;
  estadoPersona: EstadoPersonaIdentidad;
  creadoEn: string;
  actualizadoEn: string;
}

export interface CuentaInstitucional {
  cuentaId: string;
  idInterno: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  orgUnitPath: string;
  givenName: string | null;
  familyName: string | null;
  tipoUsuario: 'ESTUDIANTE' | 'DOCENTE' | 'ADMINISTRATIVO' | 'EXTERNO' | null;
  subtipoUsuario: string | null;
  cargoFuncion: string | null;
  gradoCurso: string | null;
  nivelAcademicoDerivado: string | null;
  docenteMultisede: boolean;
  fechaInicioVigencia: string | null;
  fechaFinVigencia: string | null;
  suspendedEnGws: boolean;
  estadoSincronizacion: EstadoSincronizacionCuenta;
  origenUltimaSincronizacion: OrigenSincronizacionCuenta | null;
  ultimaSincronizacionEn: string;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Genera o preserva el identificador técnico UUID v4 de PersonaIdentidad (T019 / FR-005).
 */
export function resolveOrGenerateIdInterno(existingOrIncomingIdInterno?: string | null): string {
  if (
    typeof existingOrIncomingIdInterno === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      existingOrIncomingIdInterno.trim(),
    )
  ) {
    return existingOrIncomingIdInterno.trim().toLowerCase();
  }
  return randomUUID();
}

export function extractDomainFromEmail(emailPrincipal: string): string {
  const parts = emailPrincipal.trim().toLowerCase().split('@');
  return parts[1] ?? '';
}

export class DomainRuleError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  public constructor(message: string, errorCode: string, statusCode: number) {
    super(message);
    this.name = 'DomainRuleError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}

export class CedulaImmutabilityConflictError extends DomainRuleError {
  public constructor(idInterno: string, currentCedula: string, attemptedDocument: string) {
    super(
      `Violación del Principio X.2 (Constitución v2.7.0): la CEDULA consolidada '${currentCedula}' de la persona '${idInterno}' es estrictamente inmutable y no puede mutar a '${attemptedDocument}'.`,
      'CEDULA_IMMUTABLE_CONFLICT',
      409,
    );
    this.name = 'CedulaImmutabilityConflictError';
  }
}

export class IdentifierCollisionConflictError extends DomainRuleError {
  public constructor(numeroIdentificacion: string, existingIdInterno: string, targetIdInterno: string) {
    super(
      `Colisión de identificador detectada (COLISION_IDENTIFICADOR): el documento '${numeroIdentificacion}' ya pertenece al idInterno '${existingIdInterno}' y no puede reasignarse a '${targetIdInterno}'.`,
      'COLISION_IDENTIFICADOR',
      409,
    );
    this.name = 'IdentifierCollisionConflictError';
  }
}

export class FailCloseForbiddenAccessError extends DomainRuleError {
  public constructor(message: string, errorCode = 'ACCESS_DENIED_FAIL_CLOSE') {
    super(message, errorCode, 403);
    this.name = 'FailCloseForbiddenAccessError';
  }
}

export class EntityNotFoundDomainError extends DomainRuleError {
  public constructor(message: string, errorCode = 'ENTITY_NOT_FOUND') {
    super(message, errorCode, 404);
    this.name = 'EntityNotFoundDomainError';
  }
}
