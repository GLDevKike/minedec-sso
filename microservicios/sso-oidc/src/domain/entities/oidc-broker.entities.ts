/**
 * Entidades puras de dominio del Servicio Intermediario OIDC Central (`sso-oidc`, DA-11).
 * 100% libres de decoradores de Inyección de Dependencias y de SDKs de infraestructura (Constitución IV).
 */

export type PatronIntegracionAplicacion = 'PATRON_1_SP_RP' | 'PATRON_2_PEP_PERIMETRAL';

export type NivelAdopcionPep = 'PROTEGIDA' | 'INTEGRADA' | 'NATIVA';

export type PoliticaRutaDefecto = 'PUBLICA' | 'AUTENTICADA' | 'PROTEGIDA';

export type EstadoCicloVidaAplicacion =
  | 'BORRADOR'
  | 'PUBLICANDO'
  | 'PUBLICADO'
  | 'SUSPENDIDO'
  | 'DESPUBLICADO';

export type MetodoAutenticacionTokenOidc =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'none';

export type EstadoClienteOidc = 'ACTIVO' | 'EN_ROTACION_GRACIA' | 'REVOCADO';

export type TipoRedirectUriOidc = 'LOGIN_CALLBACK' | 'POST_LOGOUT' | 'BACKCHANNEL_LOGOUT';

export type ServicioEmisorJwks = 'SSO_OIDC' | 'MOTOR_PDP';

export type EstadoLlaveJwks =
  | 'ACTIVA_FIRMA'
  | 'GRACIA_VERIFICACION'
  | 'RETIRADA'
  | 'REVOCADA';

export type TipoIdentificacionPersona = 'CEDULA' | 'PASAPORTE' | 'CODIGO_MINEDEC';

export type AlcanceRevocacionOidc = 'CUENTA_INSTITUCIONAL' | 'PERSONA_IDENTIDAD';

export type MotivoRevocacionOidc =
  | 'SUSPENDIDA_GWS'
  | 'ELIMINADA_GWS'
  | 'VIGENCIA_VENCIDA'
  | 'PERSONA_INACTIVA'
  | 'BLOQUEADA_ANOMALIA';

export interface AplicacionOidc {
  aplicacionId: string;
  codigoUnico: string;
  nombreVisible: string;
  descripcion: string | null;
  patronIntegracion: PatronIntegracionAplicacion;
  nivelAdopcionPep: NivelAdopcionPep | null;
  hostPublico: string;
  urlBackendInterno: string | null;
  politicaRutaDefecto: PoliticaRutaDefecto;
  viceministerioDueno: string;
  estadoCicloVida: EstadoCicloVidaAplicacion;
  versionCatalogo: number;
  creadoPor: string;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface ClienteOidcRedirectUri {
  redirectUriId: string;
  clienteOidcId: string;
  tipoUri: TipoRedirectUriOidc;
  uri: string;
  activo: boolean;
  creadoEn: Date;
}

export interface ClienteOidc {
  clienteOidcId: string;
  aplicacionId: string;
  oidcClientId: string;
  secretoActivoHash: string | null;
  secretoAnteriorHash: string | null;
  graciaHasta: Date | null;
  expiraRotacionEn: Date | null;
  metodoAutenticacionToken: MetodoAutenticacionTokenOidc;
  estadoCliente: EstadoClienteOidc;
  creadoEn: Date;
  actualizadoEn: Date;
  aplicacion: Pick<
    AplicacionOidc,
    | 'aplicacionId'
    | 'codigoUnico'
    | 'nombreVisible'
    | 'patronIntegracion'
    | 'hostPublico'
    | 'estadoCicloVida'
  >;
  redirectUris: ReadonlyArray<ClienteOidcRedirectUri>;
}

export interface SesionCentralOidc {
  sessionId: string;
  idInterno: string;
  cuentaId: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  nombreCompleto: string;
  participatingClientIds: string[];
  createdAt: string;
  lastPipValidatedAt: string;
}

export interface CodigoAutorizacionEfimero {
  codeId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  nonce?: string;
  sessionId: string;
  idInterno: string;
  cuentaId: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  nombreCompleto: string;
  authTimeEpochSeconds: number;
  issuedAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
  consumedAt?: string | null;
}

export interface PublicRsaJwk {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}

export interface LlaveJwksRotacion {
  kid: string;
  servicioEmisor: ServicioEmisorJwks;
  algoritmo: 'RS256';
  secretManagerVersion: string;
  publicJwkJson: PublicRsaJwk;
  estadoLlave: EstadoLlaveJwks;
  activadaEn: Date;
  expiraRotacionEn: Date;
  retiradaEn: Date | null;
}

export interface CorrelacionFederacionGoogle {
  googleState: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  clientState: string;
  clientNonce?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  googleNonce: string;
  googleCodeVerifier: string;
  requestedHd?: string;
  traceId: string;
  createdAtIso: string;
}

export interface GoogleVerifiedIdentityClaims {
  googleSubId: string;
  emailPrincipal: string;
  emailVerified: boolean;
  hd: string;
  givenName?: string;
  familyName?: string;
  fullName?: string;
  nonce?: string;
}

export type EstadoResolucionPipOidc =
  | 'CONSOLIDADA_ACTIVA'
  | 'PENDIENTE_IDENTIFICACION_RETENIDA'
  | 'CUENTA_SUSPENDIDA_O_INACTIVA';

export interface ResultadoResolucionPipOidc {
  estadoResolucion: EstadoResolucionPipOidc;
  idInterno?: string;
  cuentaId?: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  tipoIdentificacion?: TipoIdentificacionPersona | null;
  numeroIdentificacion?: string | null;
  nombreCompleto?: string;
  estadoPersona?: string;
  estadoSincronizacion?: string;
  suspendedEnGws?: boolean;
  fueRegistroCaliente?: boolean;
  intentosEsperaRealizados: number;
  motivoDenegacion?: string;
}

export interface MinedecIdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  auth_time?: number;
  nonce?: string;
  sid: string;
  tipo_identificacion: TipoIdentificacionPersona;
  numero_identificacion: string;
  nombre_completo: string;
  email: string;
  email_verified: boolean;
  hd: string;
}

export interface OidcBackchannelLogoutTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  jti: string;
  sid: string;
  events: {
    'http://schemas.openid.net/specs/openid-connect-backchannel-logout-1_0.html': Record<
      string,
      never
    >;
  };
}
