/**
 * Puertos de Salida e Interfaces del Dominio — Motor de Autorización Central (`motor-pdp`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III y VI):
 * - 100 % interfaces TypeScript puras sin acoplamiento a `pg`, `ioredis`, `jose` ni `inversify`.
 */

import {
  ApplicationPolicyBundle,
  CrudPermissions,
  DecisionCode,
  IdentityAuthorizationContext,
  M2mClientCredential,
  M2mTokenClaims,
  NaturalPersonIdType,
  PdpSigningKeyRecord,
  PrecomputedAuthorizationDecision,
  PublicJwkEntry,
  TerritorialContext,
} from '../entities/pdp-domain.entities';

export interface PolicyBundleLookupInput {
  uuid_aplicacion?: string;
  codigo_unico?: string;
  host_solicitado?: string;
}

export interface PolicyBundleRepositoryPort {
  findPolicyBundle(
    lookup: PolicyBundleLookupInput,
  ): Promise<ApplicationPolicyBundle | null>;
}

export interface IdentityAuthorizationRepositoryPort {
  findAuthorizationContextByEmail(
    emailPrincipal: string,
    aplicacionId: string,
  ): Promise<IdentityAuthorizationContext | null>;
}

export interface M2mCredentialRepositoryPort {
  findByClientId(clientId: string): Promise<M2mClientCredential | null>;
  createCredential?(params: {
    credencialId?: string;
    aplicacionId: string | null;
    tipoCliente: 'APLICACION_PATRON_1' | 'PEP_PATRON_2';
    clientId: string;
    secretoActivoHash: string;
    scopesPermitidos?: string;
    expiresInDays?: number;
  }): Promise<M2mClientCredential>;
  rotateCredentialSecret?(params: {
    clientId: string;
    nuevoSecretoHash: string;
    graceWindowSeconds?: number;
    expiresInDays?: number;
  }): Promise<M2mClientCredential | null>;
  expireGraceWindow?(clientId: string): Promise<M2mClientCredential | null>;
  revokeCredentialEmergency?(
    clientId: string,
  ): Promise<M2mClientCredential | null>;
}

export interface PdpJwksKeyRepositoryPort {
  listActiveAndGraceKeys(): Promise<PdpSigningKeyRecord[]>;
  getActiveSigningKey(): Promise<PdpSigningKeyRecord | null>;
  rotateSigningKey(params: {
    newKid: string;
    secretManagerVersion: string;
    publicJwk: PublicJwkEntry;
    expiresInDays?: number;
  }): Promise<{ kid_activo: string; kid_gracia: string | null }>;
  retireGraceKey?(kid: string): Promise<{
    kid: string;
    estado_llave: 'RETIRADA';
  } | null>;
  revokeKeyEmergency(kid: string): Promise<{
    kid: string;
    estado_llave: 'REVOCADA';
  } | null>;
}

export interface PdpL2CachePort {
  getPolicyBundle(
    aplicacionCodigo: string,
  ): Promise<ApplicationPolicyBundle | null>;
  setPolicyBundle(
    bundle: ApplicationPolicyBundle,
    ttlSeconds?: number,
  ): Promise<void>;
  getPrecomputedDecision(params: {
    aplicacionCodigo: string;
    versionCatalogo: number;
    idInterno?: string;
    cuentaId?: string;
    emailPrincipal?: string;
  }): Promise<PrecomputedAuthorizationDecision | null>;
  setPrecomputedDecision(
    aplicacionCodigo: string,
    versionCatalogo: number,
    decision: PrecomputedAuthorizationDecision,
    ttlSeconds?: number,
  ): Promise<void>;
  invalidateBySubject(params: {
    idInterno?: string;
    emailPrincipal?: string;
  }): Promise<number>;
  invalidateByApplication(aplicacionCodigo: string): Promise<number>;
  markM2mClientRevoked?(clientId: string, ttlSeconds?: number): Promise<void>;
  isM2mClientRevoked?(clientId: string): Promise<boolean>;
  flushAll?(): Promise<number>;
  ping(): Promise<boolean>;
}

export interface AssertionSigningInput {
  idInterno: string;
  emailPrincipal: string;
  tipoIdentificacion: NaturalPersonIdType;
  numeroIdentificacion: string;
  uuidAplicacion: string;
  codigoAplicacion: string;
  roles: string[];
  permisos: string[];
  permisosCrud: CrudPermissions;
  contextoTerritorial: TerritorialContext;
  requestId?: string;
}

export interface PdpAssertionSignerPort {
  signAssertionJwt(input: AssertionSigningInput): Promise<string>;
  buildInjectedHeaders(
    input: AssertionSigningInput,
    assertionJwt: string,
  ): Record<string, string>;
  signM2mAccessToken(params: {
    clientId: string;
    tipoCliente: 'APLICACION_PATRON_1' | 'PEP_PATRON_2';
    aplicacionId: string | null;
    scope: string;
    ttlSeconds?: number;
  }): Promise<{ accessToken: string; expiresIn: number }>;
  verifyM2mAccessToken(token: string): Promise<M2mTokenClaims>;
  generateAndRotateKeyPair(params?: {
    kid?: string;
    secretManagerVersion?: string;
  }): Promise<{ kid_activo: string; kid_gracia: string | null }>;
}

export interface PdpEvaluationAuditRecord {
  tipoEvento:
    | 'PDP_EVALUACION_PERMIT'
    | 'PDP_EVALUACION_DENY'
    | 'PDP_EVALUACION_SHADOW_PERMIT';
  aplicacionId: string;
  codigoAplicacion: string;
  idInterno?: string | null;
  sujetoIdentificacion?: string | null;
  correoAfectado?: string | null;
  rutaNormalizada: string;
  metodoHttp: string;
  autorizado: boolean;
  codigoDecision: DecisionCode;
  decisionProyectada?: DecisionCode;
  modoSombra?: boolean;
  rolesEfectivos: string[];
  permisosEfectivos: string[];
  politicasEvaluadas: string[];
  traceId?: string;
}

export interface PdpTransactionalSecurityAuditRecord {
  tipoEvento:
    | 'PDP_TOKEN_M2M_EMITIDO'
    | 'PDP_TOKEN_M2M_RECHAZADO'
    | 'PDP_CREDENCIAL_M2M_CREADA'
    | 'PDP_CREDENCIAL_M2M_ROTADA'
    | 'PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA'
    | 'PDP_CREDENCIAL_M2M_REVOCADA'
    | 'PDP_CACHE_INVALIDADO_PUBSUB'
    | 'PDP_RECHAZO_SEGURIDAD_RUTA'
    | 'PDP_JWKS_ROTADO'
    | 'PDP_JWKS_RETIRADO'
    | 'PDP_JWKS_REVOCADO_EMERGENCIA';
  actorIdentificacion: string;
  sujetoIdentificacion?: string | null;
  correoAfectado?: string | null;
  entidadAfectada: string;
  registroAfectadoId: string;
  valoresNuevos: Record<string, unknown>;
  traceId?: string;
}

export interface PdpAuditPort {
  emitStreamingEvaluationEvent(record: PdpEvaluationAuditRecord): void;
  recordTransactionalSecurityEvent(
    record: PdpTransactionalSecurityAuditRecord,
  ): Promise<void>;
}
