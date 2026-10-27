import crypto from 'node:crypto';
import {
  ClienteOidc,
  MinedecIdTokenClaims,
  OidcBackchannelLogoutTokenClaims,
  TipoIdentificacionPersona,
  TipoRedirectUriOidc,
} from '../entities/oidc-broker.entities';

/**
 * Códigos de error diagnósticos en español para el contrato de seguridad OIDC (`OidcSecurityErrorResponse`).
 */
export type CodigoErrorSeguridadOidc =
  | 'CLIENTE_OIDC_NO_AUTORIZADO'
  | 'REDIRECT_URI_NO_REGISTRADA'
  | 'PKCE_S256_OBLIGATORIO'
  | 'DOMINIO_EXTERNO_RECHAZADO'
  | 'IDENTIDAD_PENDIENTE_SINCRONIZACION'
  | 'CUENTA_SUSPENDIDA_O_INACTIVA'
  | 'DEPENDENCIA_CRITICA_NO_DISPONIBLE';

export class OidcSecurityError extends Error {
  public readonly codigoError: CodigoErrorSeguridadOidc;
  public readonly statusCode: number;
  public readonly mensajeUsuario: string;
  public readonly reintentarPermitido: boolean;
  public readonly diagnosticoAdministrador: {
    queOcurrio: string;
    impactoOperativo: string;
    accionRecomendada: string;
  };

  constructor(params: {
    codigoError: CodigoErrorSeguridadOidc;
    statusCode: number;
    mensajeUsuario: string;
    reintentarPermitido: boolean;
    diagnosticoAdministrador: {
      queOcurrio: string;
      impactoOperativo: string;
      accionRecomendada: string;
    };
  }) {
    super(params.mensajeUsuario);
    this.name = 'OidcSecurityError';
    this.codigoError = params.codigoError;
    this.statusCode = params.statusCode;
    this.mensajeUsuario = params.mensajeUsuario;
    this.reintentarPermitido = params.reintentarPermitido;
    this.diagnosticoAdministrador = params.diagnosticoAdministrador;
  }
}

export type OAuthTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type';

export class OAuthTokenProtocolError extends Error {
  public readonly error: OAuthTokenErrorCode;
  public readonly errorDescription: string;
  public readonly statusCode: number;

  constructor(params: {
    error: OAuthTokenErrorCode;
    errorDescription: string;
    statusCode?: number;
  }) {
    super(params.errorDescription);
    this.name = 'OAuthTokenProtocolError';
    this.error = params.error;
    this.errorDescription = params.errorDescription;
    this.statusCode = params.statusCode ?? (params.error === 'invalid_client' ? 401 : 400);
  }
}

/**
 * Reclamos de autorización (roles, permisos, grupos, ámbitos administrativos) estrictamente prohibidos
 * dentro del `id_token` emitido por `sso-oidc` (Constitución V / DA-11 / FR-009 / SC-002).
 */
export const FORBIDDEN_AUTHORIZATION_CLAIMS_IN_ID_TOKEN: ReadonlySet<string> = new Set([
  'roles',
  'rol',
  'role',
  'permisos',
  'permissions',
  'scopes_pdp',
  'perfiles',
  'grupos',
  'groups',
  'entitlements',
  'authorities',
  'privileges',
  'amies_asignados',
  'vinculaciones_laborales',
  'x_minedec_assertion',
]);

/**
 * Lista blanca cerrada de reclamos permitidos en el `id_token` de `sso-oidc` (`MinedecIdTokenClaims`).
 */
export const ALLOWED_MINEDEC_ID_TOKEN_CLAIM_KEYS: ReadonlySet<string> = new Set([
  'iss',
  'sub',
  'aud',
  'iat',
  'exp',
  'auth_time',
  'nonce',
  'sid',
  'tipo_identificacion',
  'numero_identificacion',
  'nombre_completo',
  'email',
  'email_verified',
  'hd',
]);

/**
 * Servicio puro de dominio para validación PKCE (`S256` obligatorio, RFC 7636).
 * 100% libre de decoradores de Inyección de Dependencias (Constitución IV).
 */
export class PkceS256Validator {
  private static readonly PKCE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;
  private static readonly PKCE_CHALLENGE_REGEX = /^[A-Za-z0-9\-_]{43,128}$/;

  public validateChallengeParameters(
    codeChallenge?: string | null,
    codeChallengeMethod?: string | null,
  ): void {
    if (!codeChallenge || !codeChallengeMethod || codeChallengeMethod !== 'S256') {
      throw new OidcSecurityError({
        codigoError: 'PKCE_S256_OBLIGATORIO',
        statusCode: 400,
        mensajeUsuario:
          'La solicitud de inicio de sesión exige obligatoriamente PKCE con método de transformación S256.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio:
            'Se recibió una petición en GET /authorize sin code_challenge o con un code_challenge_method distinto de S256 (ej. plain).',
          impactoOperativo:
            'La solicitud fue bloqueada preventivamente para impedir ataques de interceptación de códigos de autorización.',
          accionRecomendada:
            'Configure el cliente OIDC o PEP para generar un code_verifier criptográfico (43-128 caracteres) y enviar code_challenge_method=S256.',
        },
      });
    }

    if (!PkceS256Validator.PKCE_CHALLENGE_REGEX.test(codeChallenge)) {
      throw new OidcSecurityError({
        codigoError: 'PKCE_S256_OBLIGATORIO',
        statusCode: 400,
        mensajeUsuario:
          'El parámetro code_challenge no cumple el formato BASE64URL requerido para PKCE S256.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio:
            'El valor de code_challenge no tiene entre 43 y 128 caracteres BASE64URL sin relleno.',
          impactoOperativo: 'La solicitud OIDC fue rechazada antes de iniciar la federación.',
          accionRecomendada:
            'Verifique el cálculo BASE64URL(SHA256(ASCII(code_verifier))) en la aplicación cliente.',
        },
      });
    }
  }

  public computeS256CodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  }

  public verifyCodeVerifier(codeVerifier: string, expectedCodeChallenge: string): boolean {
    if (!PkceS256Validator.PKCE_VERIFIER_REGEX.test(codeVerifier)) {
      return false;
    }
    const computedChallenge = this.computeS256CodeChallenge(codeVerifier);
    const computedBuf = Buffer.from(computedChallenge, 'utf8');
    const expectedBuf = Buffer.from(expectedCodeChallenge, 'utf8');
    if (computedBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(computedBuf, expectedBuf);
  }
}

/**
 * Servicio puro de dominio para validar coincidencia exacta carácter por carácter de URIs en 1FN/3FN
 * (`LOGIN_CALLBACK`, `POST_LOGOUT`, `BACKCHANNEL_LOGOUT`), sin comodines ni redirecciones abiertas (`FR-002`, `FR-003`).
 */
export class ExactRedirectUriValidator {
  public validateClientLifecycle(cliente: ClienteOidc | null, oidcClientId: string): ClienteOidc {
    if (!cliente) {
      throw new OidcSecurityError({
        codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
        statusCode: 400,
        mensajeUsuario: `El cliente OIDC "${oidcClientId}" no se encuentra registrado en Conecta MINEDEC.`,
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `Se solicitó autenticación para un client_id inexistente (${oidcClientId}).`,
          impactoOperativo: 'El broker OIDC bloqueó la petición sin realizar ninguna redirección.',
          accionRecomendada:
            'Registre la aplicación y su cliente OIDC en la Consola de Administración PAP antes de iniciar flujos de autenticación.',
        },
      });
    }

    if (
      cliente.estadoCliente === 'REVOCADO' ||
      cliente.aplicacion.estadoCicloVida !== 'PUBLICADO'
    ) {
      throw new OidcSecurityError({
        codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
        statusCode: 400,
        mensajeUsuario: `La aplicación "${cliente.aplicacion.nombreVisible}" o su cliente OIDC no se encuentra habilitado para iniciar sesión.`,
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `El cliente ${cliente.oidcClientId} está en estado ${cliente.estadoCliente} o la aplicación está en estado ${cliente.aplicacion.estadoCicloVida}.`,
          impactoOperativo:
            'Se aplicó bloqueo fail-close inmediato sobre /authorize y /token para este cliente.',
          accionRecomendada:
            'Verifique el estado operativo del activo tecnológico y del cliente OIDC en el catálogo central.',
        },
      });
    }

    return cliente;
  }

  public assertExactRedirectUriRegistered(
    cliente: ClienteOidc,
    candidateUri: string,
    tipoUri: TipoRedirectUriOidc = 'LOGIN_CALLBACK',
  ): string {
    if (!candidateUri || candidateUri.includes('*') || candidateUri.includes('..')) {
      throw new OidcSecurityError({
        codigoError: 'REDIRECT_URI_NO_REGISTRADA',
        statusCode: 400,
        mensajeUsuario:
          'La dirección de retorno (redirect_uri) solicitada es inválida o no está autorizada para esta aplicación.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `La URI "${candidateUri}" contiene comodines o secuencias no permitidas para el cliente ${cliente.oidcClientId}.`,
          impactoOperativo:
            'Bloqueo inmediato en el servidor sin redirigir al navegador hacia la URI no confiable (prevención de Open Redirect).',
          accionRecomendada:
            'Utilice únicamente URLs HTTPS exactas previamente dadas de alta en cliente_oidc_redirect_uri.',
        },
      });
    }

    const exactMatch = cliente.redirectUris.find(
      (entry) => entry.activo && entry.tipoUri === tipoUri && entry.uri === candidateUri,
    );

    if (!exactMatch) {
      throw new OidcSecurityError({
        codigoError: 'REDIRECT_URI_NO_REGISTRADA',
        statusCode: 400,
        mensajeUsuario:
          'La dirección de retorno (redirect_uri) no coincide exactamente con ninguna dirección autorizada para esta aplicación.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `No existe coincidencia exacta carácter por carácter en cliente_oidc_redirect_uri (${tipoUri}) para "${candidateUri}" en el cliente ${cliente.oidcClientId}.`,
          impactoOperativo:
            'La solicitud fue detenida con HTTP 400 sin redirigir al cliente para evitar robo de códigos OIDC.',
          accionRecomendada:
            'Registre la URI exacta en el catálogo 1FN de direcciones de retorno del cliente OIDC.',
        },
      });
    }

    return exactMatch.uri;
  }
}

/**
 * Servicio puro de dominio para verificar secretos de clientes confidenciales (`SHA-256` en tiempo constante)
 * soportando la rotación periódica (`<= 90 días`) con ventana de gracia dual (`secreto_activo_hash` y `secreto_anterior_hash`).
 */
export class ConstantTimeClientSecretVerifier {
  public computeSha256Hex(rawSecret: string): string {
    return crypto.createHash('sha256').update(rawSecret, 'utf8').digest('hex');
  }

  public verifyClientAuthentication(params: {
    cliente: ClienteOidc;
    providedClientSecret?: string | null;
    authMethodUsed: 'client_secret_basic' | 'client_secret_post' | 'none';
    now?: Date;
  }): void {
    const { cliente, providedClientSecret, authMethodUsed } = params;
    const now = params.now ?? new Date();

    if (
      cliente.estadoCliente === 'REVOCADO' ||
      cliente.aplicacion.estadoCicloVida !== 'PUBLICADO'
    ) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_client',
        errorDescription:
          'El cliente OIDC o su aplicación asociada se encuentra revocado o fuera de servicio.',
        statusCode: 401,
      });
    }

    if (cliente.metodoAutenticacionToken === 'none') {
      if (authMethodUsed !== 'none' || providedClientSecret) {
        throw new OAuthTokenProtocolError({
          error: 'invalid_client',
          errorDescription:
            'El cliente público PKCE no debe enviar client_secret en el punto de enlace de token.',
          statusCode: 401,
        });
      }
      return;
    }

    if (authMethodUsed !== cliente.metodoAutenticacionToken) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_client',
        errorDescription: `Método de autenticación de cliente inválido; se esperaba ${cliente.metodoAutenticacionToken}.`,
        statusCode: 401,
      });
    }

    if (!providedClientSecret || !cliente.secretoActivoHash) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_client',
        errorDescription: 'Falta la credencial client_secret para el cliente confidencial OIDC.',
        statusCode: 401,
      });
    }

    if (cliente.expiraRotacionEn && now.getTime() > cliente.expiraRotacionEn.getTime()) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_client',
        errorDescription:
          'El secreto del cliente confidencial ha superado el ciclo máximo de rotación obligatoria (<= 90 días).',
        statusCode: 401,
      });
    }

    const candidateHashHex = this.computeSha256Hex(providedClientSecret);
    if (this.constantTimeHexEquals(candidateHashHex, cliente.secretoActivoHash)) {
      return;
    }

    if (
      cliente.estadoCliente === 'EN_ROTACION_GRACIA' &&
      cliente.secretoAnteriorHash &&
      cliente.graciaHasta &&
      now.getTime() <= cliente.graciaHasta.getTime() &&
      this.constantTimeHexEquals(candidateHashHex, cliente.secretoAnteriorHash)
    ) {
      return;
    }

    throw new OAuthTokenProtocolError({
      error: 'invalid_client',
      errorDescription:
        'Credenciales de cliente OIDC inválidas o ventana de gracia de rotación expirada.',
      statusCode: 401,
    });
  }

  private constantTimeHexEquals(hexA: string, hexB: string): boolean {
    const normalizedA = hexA.trim().toLowerCase();
    const normalizedB = hexB.trim().toLowerCase();
    if (normalizedA.length !== 64 || normalizedB.length !== 64) {
      return false;
    }
    const bufA = Buffer.from(normalizedA, 'hex');
    const bufB = Buffer.from(normalizedB, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}

/**
 * Constructor y guardia de reclamos del `id_token` institucional (`MinedecIdTokenClaimsBuilder`).
 * Garantiza audiencia exclusiva (`aud = oidc_client_id`), TTL `<= 300 s`, inclusión de
 * `(tipo_identificacion, numero_identificacion)` y prohibición absoluta de roles o permisos (`FR-009`, `SC-002`).
 */
export class MinedecIdTokenClaimsBuilder {
  public static readonly MAX_ID_TOKEN_TTL_SECONDS = 300;

  public buildClaims(params: {
    issuer: string;
    idInterno: string;
    oidcClientId: string;
    sessionId: string;
    tipoIdentificacion: TipoIdentificacionPersona;
    numeroIdentificacion: string;
    nombreCompleto: string;
    emailPrincipal: string;
    dominio: string;
    nonce?: string;
    authTimeEpochSeconds?: number;
    nowEpochSeconds?: number;
    ttlSeconds?: number;
    extraClaimsToInspect?: Record<string, unknown>;
  }): MinedecIdTokenClaims {
    if (params.extraClaimsToInspect) {
      for (const key of Object.keys(params.extraClaimsToInspect)) {
        if (
          FORBIDDEN_AUTHORIZATION_CLAIMS_IN_ID_TOKEN.has(key.toLowerCase()) ||
          !ALLOWED_MINEDEC_ID_TOKEN_CLAIM_KEYS.has(key)
        ) {
          throw new Error(
            `[OIDC_CLAIM_POLICY_VIOLATION] Se bloqueó el intento de inyectar el reclamo no permitido "${key}" en el id_token de sso-oidc (FR-009).`,
          );
        }
      }
    }

    if (!params.oidcClientId || Array.isArray(params.oidcClientId)) {
      throw new Error(
        '[OIDC_CLAIM_POLICY_VIOLATION] El reclamo aud del id_token debe ser exclusivamente el client_id de la aplicación solicitante.',
      );
    }

    if (!params.tipoIdentificacion || !params.numeroIdentificacion) {
      throw new Error(
        '[OIDC_CLAIM_POLICY_VIOLATION] No se puede emitir un id_token sin (tipo_identificacion, numero_identificacion) consolidados.',
      );
    }

    const iat = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
    const requestedTtl = params.ttlSeconds ?? MinedecIdTokenClaimsBuilder.MAX_ID_TOKEN_TTL_SECONDS;
    const boundedTtl = Math.min(
      Math.max(1, requestedTtl),
      MinedecIdTokenClaimsBuilder.MAX_ID_TOKEN_TTL_SECONDS,
    );

    const claims: MinedecIdTokenClaims = {
      iss: params.issuer,
      sub: params.idInterno,
      aud: params.oidcClientId,
      iat,
      exp: iat + boundedTtl,
      auth_time: params.authTimeEpochSeconds ?? iat,
      ...(params.nonce ? { nonce: params.nonce } : {}),
      sid: params.sessionId,
      tipo_identificacion: params.tipoIdentificacion,
      numero_identificacion: params.numeroIdentificacion,
      nombre_completo: params.nombreCompleto,
      email: params.emailPrincipal,
      email_verified: true,
      hd: params.dominio,
    };

    return claims;
  }
}

/**
 * Constructor puro de reclamos para el `logout_token` según *OpenID Connect Back-Channel Logout 1.0* (`FR-011`, `Clarificación Q2`).
 * Prohibido incluir el reclamo `nonce` según la sección 2.4 de la especificación OIDC Back-Channel Logout 1.0.
 */
export class BackchannelLogoutTokenBuilder {
  public buildLogoutTokenClaims(params: {
    issuer: string;
    idInterno: string;
    oidcClientId: string;
    sessionId: string;
    nowEpochSeconds?: number;
    jti?: string;
  }): OidcBackchannelLogoutTokenClaims {
    const iat = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
    return {
      iss: params.issuer,
      sub: params.idInterno,
      aud: params.oidcClientId,
      iat,
      jti: params.jti ?? crypto.randomUUID(),
      sid: params.sessionId,
      events: {
        'http://schemas.openid.net/specs/openid-connect-backchannel-logout-1_0.html': {},
      },
    };
  }
}
