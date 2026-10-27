import {
  ClienteOidc,
  CodigoAutorizacionEfimero,
  CorrelacionFederacionGoogle,
  EstadoLlaveJwks,
  GoogleVerifiedIdentityClaims,
  LlaveJwksRotacion,
  MinedecIdTokenClaims,
  PublicRsaJwk,
  ResultadoResolucionPipOidc,
  SesionCentralOidc,
} from '../entities/oidc-broker.entities';

/**
 * Símbolos únicos de Inyección de Dependencias para el Composition Root (`container.ts`).
 */
export const SSO_OIDC_TYPES = {
  SqlQueryExecutor: Symbol.for('SsoOidc.SqlQueryExecutor'),
  RedisClient: Symbol.for('SsoOidc.RedisClient'),
  StructuredLogger: Symbol.for('SsoOidc.StructuredLogger'),
  AuditEventWriter: Symbol.for('SsoOidc.AuditEventWriter'),

  // Servicios de Dominio
  PkceS256Validator: Symbol.for('SsoOidc.PkceS256Validator'),
  ExactRedirectUriValidator: Symbol.for('SsoOidc.ExactRedirectUriValidator'),
  ConstantTimeClientSecretVerifier: Symbol.for('SsoOidc.ConstantTimeClientSecretVerifier'),
  MinedecIdTokenClaimsBuilder: Symbol.for('SsoOidc.MinedecIdTokenClaimsBuilder'),
  BackchannelLogoutTokenBuilder: Symbol.for('SsoOidc.BackchannelLogoutTokenBuilder'),

  // Puertos de Infraestructura
  OidcClientRepositoryPort: Symbol.for('SsoOidc.OidcClientRepositoryPort'),
  OidcSessionStorePort: Symbol.for('SsoOidc.OidcSessionStorePort'),
  GoogleIdpFederationPort: Symbol.for('SsoOidc.GoogleIdpFederationPort'),
  PipIdentityResolverPort: Symbol.for('SsoOidc.PipIdentityResolverPort'),
  JwksKeyStorePort: Symbol.for('SsoOidc.JwksKeyStorePort'),
  BackchannelLogoutDispatcherPort: Symbol.for('SsoOidc.BackchannelLogoutDispatcherPort'),

  // Casos de Uso de Aplicación
  StartOidcAuthorizationUseCase: Symbol.for('SsoOidc.StartOidcAuthorizationUseCase'),
  HandleGoogleIdpCallbackUseCase: Symbol.for('SsoOidc.HandleGoogleIdpCallbackUseCase'),
  ExchangeAuthorizationCodeUseCase: Symbol.for('SsoOidc.ExchangeAuthorizationCodeUseCase'),
  ExecuteSingleLogoutUseCase: Symbol.for('SsoOidc.ExecuteSingleLogoutUseCase'),
  RevokeIdentitySessionsUseCase: Symbol.for('SsoOidc.RevokeIdentitySessionsUseCase'),
  ManageJwksKeysUseCase: Symbol.for('SsoOidc.ManageJwksKeysUseCase'),

  // Controladores HTTP
  OidcAuthTokenController: Symbol.for('SsoOidc.OidcAuthTokenController'),
  OidcLogoutRevocationController: Symbol.for('SsoOidc.OidcLogoutRevocationController'),
  OidcDiscoveryJwksController: Symbol.for('SsoOidc.OidcDiscoveryJwksController'),
} as const;

export interface IOidcClientRepositoryPort {
  findByOidcClientId(oidcClientId: string): Promise<ClienteOidc | null>;
  findByOidcClientIds(oidcClientIds: ReadonlyArray<string>): Promise<ClienteOidc[]>;
  isInstitutionalDomainActive(domain: string): Promise<boolean>;
  invalidateClientCache(oidcClientId: string): Promise<void>;
}

export interface ConsumeAuthorizationCodeResult {
  status: 'CONSUMED_FIRST_TIME' | 'REPLAY_DETECTED' | 'NOT_FOUND_OR_EXPIRED';
  codeRecord?: CodigoAutorizacionEfimero;
}

export interface IOidcSessionStorePort {
  saveSession(session: SesionCentralOidc, ttlSeconds?: number): Promise<void>;
  getSession(sessionId: string): Promise<SesionCentralOidc | null>;
  addParticipatingClientToSession(sessionId: string, oidcClientId: string): Promise<void>;
  isSessionRevalidationFresh(sessionId: string): Promise<boolean>;
  refreshSessionRevalidationMark(sessionId: string, ttlSeconds?: number): Promise<void>;
  destroySession(sessionId: string): Promise<SesionCentralOidc | null>;
  purgeSessionsByAccount(cuentaId: string): Promise<SesionCentralOidc[]>;
  purgeSessionsByPerson(idInterno: string): Promise<SesionCentralOidc[]>;

  saveGoogleFederationState(
    correlation: CorrelacionFederacionGoogle,
    ttlSeconds?: number,
  ): Promise<void>;
  consumeGoogleFederationState(
    googleState: string,
  ): Promise<CorrelacionFederacionGoogle | null>;

  saveAuthorizationCode(
    code: CodigoAutorizacionEfimero,
    ttlSeconds?: number,
  ): Promise<void>;
  consumeAuthorizationCodeSingleUse(
    codeId: string,
  ): Promise<ConsumeAuthorizationCodeResult>;
  purgeAuthorizationCodesForSession(sessionId: string): Promise<void>;
}

export interface IGoogleIdpFederationPort {
  buildAuthorizationRedirectUrl(params: {
    googleState: string;
    googleNonce: string;
    googleCodeChallenge: string;
    hdHint?: string;
    prompt?: string;
  }): Promise<string>;

  exchangeGoogleCodeAndVerifyIdToken(params: {
    googleCode: string;
    googleCodeVerifier: string;
    expectedNonce: string;
  }): Promise<GoogleVerifiedIdentityClaims>;
}

export interface IPipIdentityResolverPort {
  resolveIdentityForOidcCallback(params: {
    googleClaims: GoogleVerifiedIdentityClaims;
    traceId: string;
  }): Promise<ResultadoResolucionPipOidc>;

  verifySessionSubjectStillActive(params: {
    idInterno: string;
    cuentaId: string;
    traceId: string;
  }): Promise<boolean>;
}

export interface IJwksKeyStorePort {
  getPublishedPublicKeysForSsoOidc(): Promise<{
    activeKid: string | null;
    keys: PublicRsaJwk[];
    metadata: LlaveJwksRotacion[];
  }>;

  signIdToken(claims: MinedecIdTokenClaims): Promise<{
    idTokenJwt: string;
    kid: string;
  }>;

  signBackchannelLogoutToken(
    claims: Record<string, unknown>,
  ): Promise<{
    logoutTokenJwt: string;
    kid: string;
  }>;

  verifySsoOidcIdTokenHint(idTokenHint: string): Promise<{
    sub: string;
    sid?: string;
    aud: string;
  } | null>;

  rotateSsoOidcSigningKey(params: {
    newKid: string;
    secretManagerVersion: string;
    publicJwk: PublicRsaJwk;
    retireExpiredGraceKeys?: boolean;
  }): Promise<{
    activeKid: string;
    publishedKids: string[];
  }>;

  revokeOrRetireSsoOidcSigningKey(params: {
    kid: string;
    targetState: Extract<EstadoLlaveJwks, 'RETIRADA' | 'REVOCADA'>;
    reason: string;
  }): Promise<{
    activeKid: string | null;
    publishedKids: string[];
  }>;
}

export interface BackchannelLogoutDispatchTarget {
  oidcClientId: string;
  backchannelLogoutUri: string;
  idInterno: string;
  sessionId: string;
}

export interface IBackchannelLogoutDispatcherPort {
  dispatchLogoutTokens(params: {
    issuer: string;
    targets: ReadonlyArray<BackchannelLogoutDispatchTarget>;
    traceId: string;
  }): Promise<{
    dispatchedCount: number;
    succeededCount: number;
    failedClients: string[];
  }>;
}
