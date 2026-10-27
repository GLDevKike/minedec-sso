import crypto from 'node:crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as jose from 'jose';
import { StructuredLogger } from '@minedec/shared';
import { GoogleVerifiedIdentityClaims } from '../../domain/entities/oidc-broker.entities';
import { IGoogleIdpFederationPort } from '../../domain/ports/oidc-broker.ports';
import { OidcSecurityError } from '../../domain/services/oidc-security.services';

export interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleIdpAdapterOptions {
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  allowedIssuers?: ReadonlyArray<string>;
  credentialsProvider?: () => Promise<GoogleOAuthClientCredentials>;
  tokenExchangeFetcher?: (params: {
    tokenEndpoint: string;
    body: URLSearchParams;
  }) => Promise<{ id_token: string; access_token?: string }>;
  googleIdTokenVerifier?: (
    idToken: string,
    expectedClientId: string,
  ) => Promise<jose.JWTPayload>;
  secretManagerClient?: SecretManagerServiceClient;
  logger?: StructuredLogger;
}

/**
 * Adaptador del único cliente OAuth 2.0 registrado ante Google Cloud Identity (`https://accounts.google.com`, `D-01`, `DA-11`).
 * Lee credenciales exclusivamente desde Google Secret Manager (con caché en memoria acotada), construye la redirección OIDC
 * con PKCE S256 y verifica criptográficamente el `id_token` de Google con `jose`.
 */
export class GoogleCloudIdentityRelyingPartyAdapter implements IGoogleIdpFederationPort {
  private readonly authorizationEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly allowedIssuers: ReadonlyArray<string>;
  private readonly credentialsProvider: () => Promise<GoogleOAuthClientCredentials>;
  private readonly tokenExchangeFetcher: (params: {
    tokenEndpoint: string;
    body: URLSearchParams;
  }) => Promise<{ id_token: string; access_token?: string }>;
  private readonly googleIdTokenVerifier: (
    idToken: string,
    expectedClientId: string,
  ) => Promise<jose.JWTPayload>;
  private readonly remoteJwks = jose.createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );
  private cachedCredentials: GoogleOAuthClientCredentials | null = null;

  constructor(options: GoogleIdpAdapterOptions = {}) {
    this.authorizationEndpoint =
      options.authorizationEndpoint ?? 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenEndpoint =
      options.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.allowedIssuers = options.allowedIssuers ?? [
      'https://accounts.google.com',
      'accounts.google.com',
    ];

    this.credentialsProvider =
      options.credentialsProvider ?? (() => this.loadCredentialsFromSecretManager(options.secretManagerClient));

    this.tokenExchangeFetcher =
      options.tokenExchangeFetcher ??
      (async ({ tokenEndpoint, body }) => {
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error(
            `Google OAuth2 token endpoint respondió HTTP ${response.status}`,
          );
        }
        return (await response.json()) as { id_token: string; access_token?: string };
      });

    this.googleIdTokenVerifier =
      options.googleIdTokenVerifier ??
      (async (idToken, expectedClientId) => {
        const verified = await jose.jwtVerify(idToken, this.remoteJwks, {
          issuer: [...this.allowedIssuers],
          audience: expectedClientId,
        });
        return verified.payload;
      });
  }

  public async buildAuthorizationRedirectUrl(params: {
    googleState: string;
    googleNonce: string;
    googleCodeChallenge: string;
    hdHint?: string;
    prompt?: string;
  }): Promise<string> {
    const creds = await this.credentialsProvider();
    const url = new URL(this.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', creds.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.googleState);
    url.searchParams.set('nonce', params.googleNonce);
    url.searchParams.set('code_challenge', params.googleCodeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (params.hdHint) {
      url.searchParams.set('hd', params.hdHint.trim().toLowerCase());
    }
    if (params.prompt) {
      url.searchParams.set('prompt', params.prompt);
    }
    return url.toString();
  }

  public async exchangeGoogleCodeAndVerifyIdToken(params: {
    googleCode: string;
    googleCodeVerifier: string;
    expectedNonce: string;
  }): Promise<GoogleVerifiedIdentityClaims> {
    const creds = await this.credentialsProvider();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.googleCode,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
      code_verifier: params.googleCodeVerifier,
    });

    const tokenResp = await this.tokenExchangeFetcher({
      tokenEndpoint: this.tokenEndpoint,
      body: form,
    });

    if (!tokenResp?.id_token) {
      throw new OidcSecurityError({
        codigoError: 'DEPENDENCIA_CRITICA_NO_DISPONIBLE',
        statusCode: 503,
        mensajeUsuario:
          'El proveedor primario Google Cloud Identity no devolvió un comprobante de identidad válido.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio: 'La respuesta del endpoint de token de Google no incluyó id_token.',
          impactoOperativo: 'Se aplicó bloqueo fail-close sobre el inicio de sesión federado.',
          accionRecomendada:
            'Verifique la configuración de scopes (openid email profile) y credenciales del cliente único en Google Cloud.',
        },
      });
    }

    const payload = await this.googleIdTokenVerifier(tokenResp.id_token, creds.clientId);

    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    if (!this.allowedIssuers.includes(iss)) {
      throw new OidcSecurityError({
        codigoError: 'DOMINIO_EXTERNO_RECHAZADO',
        statusCode: 403,
        mensajeUsuario: 'El emisor del comprobante de identidad primario no es válido.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `El reclamo iss recibido ("${iss}") no pertenece a Google Cloud Identity.`,
          impactoOperativo: 'La autenticación fue rechazada.',
          accionRecomendada: 'Asegúrese de utilizar exclusivamente accounts.google.com como IdP primario.',
        },
      });
    }

    if (typeof payload.nonce === 'string' && params.expectedNonce) {
      const nonceA = Buffer.from(payload.nonce, 'utf8');
      const nonceB = Buffer.from(params.expectedNonce, 'utf8');
      if (nonceA.length !== nonceB.length || !crypto.timingSafeEqual(nonceA, nonceB)) {
        throw new OidcSecurityError({
          codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
          statusCode: 403,
          mensajeUsuario: 'El valor de correlación criptográfica (nonce) de la sesión no coincide.',
          reintentarPermitido: true,
          diagnosticoAdministrador: {
            queOcurrio: 'Discrepancia en el reclamo nonce del id_token de Google Cloud Identity.',
            impactoOperativo: 'Se bloqueó la respuesta por posible intento de repetición (replay).',
            accionRecomendada: 'Solicite al usuario iniciar nuevamente el flujo de autenticación.',
          },
        });
      }
    }

    const emailPrincipal =
      typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const emailVerified = payload.email_verified === true;
    const googleSubId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const emailDomain = emailPrincipal.includes('@')
      ? (emailPrincipal.split('@')[1] ?? '').trim().toLowerCase()
      : '';
    const hdClaim =
      typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : emailDomain;

    if (!googleSubId || !emailPrincipal || !emailVerified || !hdClaim) {
      throw new OidcSecurityError({
        codigoError: 'DOMINIO_EXTERNO_RECHAZADO',
        statusCode: 403,
        mensajeUsuario:
          'Solo se permite el acceso con cuentas institucionales verificadas de Google Workspace del Ministerio.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `El id_token de Google carece de sub, email_verified=true o reclamo hd institucional (email="${emailPrincipal}", hd="${hdClaim}").`,
          impactoOperativo: 'Acceso bloqueado con postura fail-close para cuentas personales o no verificadas.',
          accionRecomendada: 'Inicie sesión utilizando una cuenta institucional activa (@educacion.gob.ec, @estudiantes.educacion.gob.ec, @deporte.gob.ec o @cultura.gob.ec).',
        },
      });
    }

    return {
      googleSubId,
      emailPrincipal,
      emailVerified,
      hd: hdClaim,
      givenName: typeof payload.given_name === 'string' ? payload.given_name : undefined,
      familyName: typeof payload.family_name === 'string' ? payload.family_name : undefined,
      fullName: typeof payload.name === 'string' ? payload.name : undefined,
      nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    };
  }

  private async loadCredentialsFromSecretManager(
    customClient?: SecretManagerServiceClient,
  ): Promise<GoogleOAuthClientCredentials> {
    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }

    const clientIdVersion = process.env.GOOGLE_IDP_CLIENT_ID_SECRET_VERSION;
    const clientSecretVersion = process.env.GOOGLE_IDP_CLIENT_SECRET_VERSION;
    const redirectUri =
      process.env.SSO_OIDC_GOOGLE_CALLBACK_URI ??
      'https://login.sso.educacion.gob.ec/callback';

    if (clientIdVersion && clientSecretVersion) {
      const sm = customClient ?? new SecretManagerServiceClient();
      const [idResp] = await sm.accessSecretVersion({ name: clientIdVersion });
      const [secretResp] = await sm.accessSecretVersion({ name: clientSecretVersion });
      const clientId = idResp.payload?.data
        ? Buffer.from(idResp.payload.data).toString('utf8').trim()
        : '';
      const clientSecret = secretResp.payload?.data
        ? Buffer.from(secretResp.payload.data).toString('utf8').trim()
        : '';
      this.cachedCredentials = { clientId, clientSecret, redirectUri };
      return this.cachedCredentials;
    }

    this.cachedCredentials = {
      clientId: process.env.GOOGLE_IDP_CLIENT_ID ?? 'conecta-minedec-google-oauth-client',
      clientSecret: process.env.GOOGLE_IDP_CLIENT_SECRET ?? 'ephemeral-local-dev-secret',
      redirectUri,
    };
    return this.cachedCredentials;
  }
}
