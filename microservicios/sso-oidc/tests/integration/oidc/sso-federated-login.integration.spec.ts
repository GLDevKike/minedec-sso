import crypto from 'crypto';

import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { createSsoOidcApp } from '../../../src';
import {
  ClienteOidc,
  MinedecIdTokenClaims,
} from '../../../src/domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IPipIdentityResolverPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import { PkceS256Validator } from '../../../src/domain/services/oidc-security.services';
import { RedisOidcStoreAdapter } from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';
import request from 'supertest';

const APP_1_CLIENT: ClienteOidc = {
  clienteOidcId: '11111111-1111-4111-8111-111111111111',
  aplicacionId: '22222222-2222-4222-8222-222222222222',
  oidcClientId: 'conecta-sigee-web',
  secretoActivoHash: null,
  secretoAnteriorHash: null,
  graciaHasta: null,
  expiraRotacionEn: null,
  metodoAutenticacionToken: 'none',
  estadoCliente: 'ACTIVO',
  creadoEn: new Date('2026-01-01T00:00:00Z'),
  actualizadoEn: new Date('2026-01-01T00:00:00Z'),
  aplicacion: {
    aplicacionId: '22222222-2222-4222-8222-222222222222',
    codigoUnico: 'SIGEE',
    nombreVisible: 'Sistema SIGEE',
    patronIntegracion: 'PATRON_1_SP_RP',
    hostPublico: 'https://sigee.educacion.gob.ec',
    estadoCicloVida: 'PUBLICADO',
  },
  redirectUris: [
    {
      redirectUriId: '33333333-3333-4333-8333-333333333333',
      clienteOidcId: '11111111-1111-4111-8111-111111111111',
      tipoUri: 'LOGIN_CALLBACK',
      uri: 'https://sigee.educacion.gob.ec/oidc/callback',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

const APP_2_CLIENT: ClienteOidc = {
  clienteOidcId: '55555555-5555-4555-8555-555555555555',
  aplicacionId: '66666666-6666-4666-8666-666666666666',
  oidcClientId: 'conecta-cas-web',
  secretoActivoHash: null,
  secretoAnteriorHash: null,
  graciaHasta: null,
  expiraRotacionEn: null,
  metodoAutenticacionToken: 'none',
  estadoCliente: 'ACTIVO',
  creadoEn: new Date('2026-01-01T00:00:00Z'),
  actualizadoEn: new Date('2026-01-01T00:00:00Z'),
  aplicacion: {
    aplicacionId: '66666666-6666-4666-8666-666666666666',
    codigoUnico: 'CAS',
    nombreVisible: 'Sistema CAS',
    patronIntegracion: 'PATRON_1_SP_RP',
    hostPublico: 'https://cas.educacion.gob.ec',
    estadoCicloVida: 'PUBLICADO',
  },
  redirectUris: [
    {
      redirectUriId: '77777777-7777-4777-8777-777777777777',
      clienteOidcId: '55555555-5555-4555-8555-555555555555',
      tipoUri: 'LOGIN_CALLBACK',
      uri: 'https://cas.educacion.gob.ec/oidc/callback',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

describe('T018 - Pruebas de integración HTTP (Supertest) de inicio de sesión federado y Silent SSO entre aplicaciones (US1)', () => {
  const pkceValidator = new PkceS256Validator();

  it('completa el flujo GET /authorize -> GET /callback -> POST /token, realiza Silent SSO con una segunda aplicación usando la cookie __Host-minedec_sso_sid y bloquea dominios externos @gmail.com', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    let nextGoogleDomain = 'educacion.gob.ec';
    let nextGoogleEmail = 'docente.sso@educacion.gob.ec';

    const clientRepository: IOidcClientRepositoryPort = {
      findByOidcClientId: async (clientId: string) => {
        if (clientId === APP_1_CLIENT.oidcClientId) return APP_1_CLIENT;
        if (clientId === APP_2_CLIENT.oidcClientId) return APP_2_CLIENT;
        return null;
      },
      findByOidcClientIds: async () => [APP_1_CLIENT, APP_2_CLIENT],
      isInstitutionalDomainActive: async (domain: string) =>
        domain === 'educacion.gob.ec',
      invalidateClientCache: async () => undefined,
    };

    const googleIdpPort: IGoogleIdpFederationPort = {
      buildAuthorizationRedirectUrl: async ({ googleState }) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${googleState}`,
      exchangeGoogleCodeAndVerifyIdToken: async () => ({
        googleSubId: 'google-sub-sso-1',
        emailPrincipal: nextGoogleEmail,
        emailVerified: true,
        hd: nextGoogleDomain,
        fullName: 'DOCENTE SSO UNIFICADO',
      }),
    };

    const pipResolverPort: IPipIdentityResolverPort = {
      resolveIdentityForOidcCallback: async () => ({
        estadoResolucion: 'CONSOLIDADA_ACTIVA',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-sso-1',
        emailPrincipal: nextGoogleEmail,
        dominio: nextGoogleDomain,
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'DOCENTE SSO UNIFICADO',
        estadoPersona: 'ACTIVO',
        estadoSincronizacion: 'CONSOLIDADA',
        suspendedEnGws: false,
        fueRegistroCaliente: false,
        intentosEsperaRealizados: 0,
      }),
      verifySessionSubjectStillActive: async () => true,
    };

    const signedPayloads: MinedecIdTokenClaims[] = [];
    const jwksKeyStore: IJwksKeyStorePort = {
      getPublishedPublicKeysForSsoOidc: async () => ({
        activeKid: 'kid-1',
        keys: [],
        metadata: [],
      }),
      signIdToken: async (claims) => {
        signedPayloads.push(claims);
        const encodedPayload = Buffer.from(JSON.stringify(claims)).toString(
          'base64url',
        );
        return {
          idTokenJwt: `eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZC0xIn0.${encodedPayload}.sig`,
          kid: 'kid-1',
        };
      },
      signBackchannelLogoutToken: async () => ({
        logoutTokenJwt: 'logout.jwt',
        kid: 'kid-1',
      }),
      verifySsoOidcIdTokenHint: async () => null,
      rotateSsoOidcSigningKey: async () => ({
        activeKid: 'kid-1',
        publishedKids: ['kid-1'],
      }),
      revokeOrRetireSsoOidcSigningKey: async () => ({
        activeKid: 'kid-1',
        publishedKids: ['kid-1'],
      }),
    };

    const app = createSsoOidcApp({
      issuerUrl: 'https://login.sso.educacion.gob.ec',
      redis,
      clientRepository,
      sessionStore,
      googleIdpPort,
      pipResolverPort,
      jwksKeyStore,
      auditWriter: {
        appendEvent: async () => 'audit-id-1',
      } as unknown as AuditEventWriter,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger,
    });

    // 1. Primera aplicación inicia GET /authorize
    const verifier1 = crypto.randomBytes(32).toString('base64url');
    const challenge1 = pkceValidator.computeS256CodeChallenge(verifier1);

    const authRes1 = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: 'conecta-sigee-web',
      redirect_uri: 'https://sigee.educacion.gob.ec/oidc/callback',
      scope: 'openid profile email',
      state: 'state-app1-12345678',
      nonce: 'nonce-app1-12345678',
      code_challenge: challenge1,
      code_challenge_method: 'S256',
    });

    expect(authRes1.status).toBe(302);
    expect(authRes1.headers['x-frame-options']).toBe('DENY');
    expect(authRes1.headers['x-content-type-options']).toBe('nosniff');

    const googleRedirect = new URL(authRes1.headers.location);
    const googleState = googleRedirect.searchParams.get('state')!;

    // 2. Callback desde Google Cloud Identity
    const cbRes1 = await request(app).get('/callback').query({
      code: 'google-auth-code-001',
      state: googleState,
    });

    expect(cbRes1.status).toBe(302);
    const setCookieHeader = cbRes1.headers['set-cookie'];
    const rawCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : String(setCookieHeader);
    expect(rawCookie).toContain('__Host-minedec_sso_sid=');
    const sessionCookiePair = rawCookie.split(';')[0];

    const app1CallbackUrl = new URL(cbRes1.headers.location);
    const codeApp1 = app1CallbackUrl.searchParams.get('code')!;
    expect(app1CallbackUrl.searchParams.get('state')).toBe(
      'state-app1-12345678',
    );

    // 3. Canje POST /token para la aplicación 1
    const tokenRes1 = await request(app).post('/token').send({
      grant_type: 'authorization_code',
      code: codeApp1,
      redirect_uri: 'https://sigee.educacion.gob.ec/oidc/callback',
      client_id: 'conecta-sigee-web',
      code_verifier: verifier1,
    });

    expect(tokenRes1.status).toBe(200);
    expect(tokenRes1.body.token_type).toBe('Bearer');
    expect(tokenRes1.body.expires_in).toBe(300);
    expect(signedPayloads[0].aud).toBe('conecta-sigee-web');

    // 4. Segunda aplicación realiza Silent SSO con la cookie __Host-minedec_sso_sid sin redirigir a Google
    const verifier2 = crypto.randomBytes(32).toString('base64url');
    const challenge2 = pkceValidator.computeS256CodeChallenge(verifier2);

    const authRes2 = await request(app)
      .get('/authorize')
      .set('Cookie', sessionCookiePair)
      .query({
        response_type: 'code',
        client_id: 'conecta-cas-web',
        redirect_uri: 'https://cas.educacion.gob.ec/oidc/callback',
        scope: 'openid profile email',
        state: 'state-app2-87654321',
        code_challenge: challenge2,
        code_challenge_method: 'S256',
      });

    expect(authRes2.status).toBe(302);
    expect(authRes2.headers.location).toContain(
      'https://cas.educacion.gob.ec/oidc/callback?code=',
    );

    const app2CallbackUrl = new URL(authRes2.headers.location);
    const codeApp2 = app2CallbackUrl.searchParams.get('code')!;

    const tokenRes2 = await request(app).post('/token').send({
      grant_type: 'authorization_code',
      code: codeApp2,
      redirect_uri: 'https://cas.educacion.gob.ec/oidc/callback',
      client_id: 'conecta-cas-web',
      code_verifier: verifier2,
    });

    expect(tokenRes2.status).toBe(200);
    expect(signedPayloads[1].aud).toBe('conecta-cas-web');

    // 5. Intento con cuenta externa @gmail.com es rechazado con HTTP 403 DOMINIO_EXTERNO_RECHAZADO
    nextGoogleDomain = 'gmail.com';
    nextGoogleEmail = 'externo@gmail.com';

    const authResExt = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: 'conecta-sigee-web',
      redirect_uri: 'https://sigee.educacion.gob.ec/oidc/callback',
      scope: 'openid profile email',
      state: 'state-ext-12345678',
      code_challenge: challenge1,
      code_challenge_method: 'S256',
    });
    const extGoogleState = new URL(
      authResExt.headers.location,
    ).searchParams.get('state')!;

    const cbResExt = await request(app).get('/callback').query({
      code: 'google-code-gmail',
      state: extGoogleState,
    });

    expect(cbResExt.status).toBe(403);
    expect(cbResExt.body.codigoError).toBe('DOMINIO_EXTERNO_RECHAZADO');
  });
});
