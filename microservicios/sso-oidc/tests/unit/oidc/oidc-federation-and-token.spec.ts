import crypto from 'crypto';

import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { ExchangeAuthorizationCodeUseCase } from '../../../src/application/exchange-authorization-code.usecase';
import { HandleGoogleIdpCallbackUseCase } from '../../../src/application/handle-google-idp-callback.usecase';
import { StartOidcAuthorizationUseCase } from '../../../src/application/start-oidc-authorization.usecase';
import {
  ClienteOidc,
  ResultadoResolucionPipOidc,
} from '../../../src/domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IPipIdentityResolverPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import {
  ConstantTimeClientSecretVerifier,
  ExactRedirectUriValidator,
  MinedecIdTokenClaimsBuilder,
  OAuthTokenProtocolError,
  OidcSecurityError,
  PkceS256Validator,
} from '../../../src/domain/services/oidc-security.services';
import { GoogleCloudIdentityRelyingPartyAdapter } from '../../../src/infrastructure/google-idp/google-cloud-identity-rp.adapter';
import {
  RedisOidcProviderModelAdapter,
  RedisOidcStoreAdapter,
} from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';

const ACTIVE_CLIENT: ClienteOidc = {
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

describe('T017 - Pruebas unitarias de federación OIDC, PKCE S256, dominio hd y claims RS256 (US1)', () => {
  const pkceValidator = new PkceS256Validator();
  const redirectUriValidator = new ExactRedirectUriValidator();
  const secretVerifier = new ConstantTimeClientSecretVerifier();
  const claimsBuilder = new MinedecIdTokenClaimsBuilder();

  describe('1. PkceS256Validator (RFC 7636)', () => {
    it('calcula y verifica S256 correctamente y rechaza code_challenge_method != S256 o longitudes fuera de 43..128', () => {
      const codeVerifier =
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-minedec-pkce-verifier';
      const challenge = pkceValidator.computeS256CodeChallenge(codeVerifier);

      expect(() =>
        pkceValidator.validateChallengeParameters(challenge, 'S256'),
      ).not.toThrow();

      expect(pkceValidator.verifyCodeVerifier(codeVerifier, challenge)).toBe(
        true,
      );
      expect(
        pkceValidator.verifyCodeVerifier(
          'wrong-verifier-with-at-least-43-characters-long-123456',
          challenge,
        ),
      ).toBe(false);

      expect(() =>
        pkceValidator.validateChallengeParameters(challenge, 'plain'),
      ).toThrow(OidcSecurityError);

      expect(() =>
        pkceValidator.validateChallengeParameters('short', 'S256'),
      ).toThrow(OidcSecurityError);
    });
  });

  describe('2. MinedecIdTokenClaimsBuilder (FR-004, Cero RBAC/ABAC y TTL <= 300 s)', () => {
    it('construye claims limpios de identidad con TTL <= 300 s y bloquea contaminación RBAC/ABAC', () => {
      const claims = claimsBuilder.buildClaims({
        issuer: 'https://login.sso.educacion.gob.ec',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        oidcClientId: 'conecta-sigee-web',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'MARIA FERNANDA LOPEZ PEREZ',
        emailPrincipal: 'maria.lopez@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        nonce: 'nonce-12345678',
        nowEpochSeconds: 1_700_000_000,
      });

      expect(claims.iss).toBe('https://login.sso.educacion.gob.ec');
      expect(claims.sub).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(claims.aud).toBe('conecta-sigee-web');
      expect(claims.exp - claims.iat).toBe(300);
      expect(claims.tipo_identificacion).toBe('CEDULA');
      expect(claims.numero_identificacion).toBe('1710034065');
      expect(Object.keys(claims)).not.toEqual(
        expect.arrayContaining(['roles', 'permisos', 'groups', 'amie']),
      );

      expect(() =>
        claimsBuilder.buildClaims({
          issuer: 'https://login.sso.educacion.gob.ec',
          idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          oidcClientId: 'conecta-sigee-web',
          sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          nombreCompleto: 'MARIA FERNANDA LOPEZ PEREZ',
          emailPrincipal: 'maria.lopez@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          extraClaimsToInspect: { roles: ['ADMIN'] },
        }),
      ).toThrow(/OIDC_CLAIM_POLICY_VIOLATION/);
    });
  });

  describe('3. RedisOidcStoreAdapter y RedisOidcProviderModelAdapter (Uso único de code y revocación)', () => {
    it('garantiza consumo único del authorization_code y detecta replay', async () => {
      const redis = new InMemoryRedisCacheClient();
      const store = new RedisOidcStoreAdapter(redis);

      const nowEpochSeconds = Math.floor(Date.now() / 1000);
      await store.saveAuthorizationCode(
        {
          codeId: 'code-single-use-1',
          clientId: 'conecta-sigee-web',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          scope: 'openid profile email',
          codeChallenge: 'challenge-1234567890123456789012345678901234567890123',
          codeChallengeMethod: 'S256',
          sessionId: 'sess-001',
          idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          googleSubId: 'google-sub-001',
          emailPrincipal: 'maria.lopez@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          nombreCompleto: 'MARIA LOPEZ',
          authTimeEpochSeconds: nowEpochSeconds,
          issuedAtEpochSeconds: nowEpochSeconds,
          expiresAtEpochSeconds: nowEpochSeconds + 60,
        },
        60,
      );

      const firstConsume =
        await store.consumeAuthorizationCodeSingleUse('code-single-use-1');
      expect(firstConsume.status).toBe('CONSUMED_FIRST_TIME');
      expect(firstConsume.codeRecord?.codeId).toBe('code-single-use-1');

      const secondConsume =
        await store.consumeAuthorizationCodeSingleUse('code-single-use-1');
      expect(secondConsume.status).toBe('REPLAY_DETECTED');
    });

    it('soporta el ciclo de vida del modelo de oidc-provider en Redis', async () => {
      const redis = new InMemoryRedisCacheClient();
      const modelAdapter = new RedisOidcProviderModelAdapter('Session', redis);

      await modelAdapter.upsert(
        'oidcp-1',
        { uid: 'uid-1', grantId: 'grant-1', accountId: 'sub-1' },
        300,
      );
      const found = await modelAdapter.find('oidcp-1');
      expect(found?.accountId).toBe('sub-1');

      const byUid = await modelAdapter.findByUid('uid-1');
      expect(byUid?.grantId).toBe('grant-1');

      await modelAdapter.consume('oidcp-1');
      const consumed = await modelAdapter.find('oidcp-1');
      expect(consumed?.consumed).toBeDefined();

      await modelAdapter.revokeByGrantId('grant-1');
      expect(await modelAdapter.find('oidcp-1')).toBeUndefined();
    });
  });

  describe('4. GoogleCloudIdentityRelyingPartyAdapter (DA-11, D-01)', () => {
    it('construye la URL hacia Google OAuth2 con PKCE S256 y verifica el id_token devuelto por Google', async () => {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger;

      const adapter = new GoogleCloudIdentityRelyingPartyAdapter({
        credentialsProvider: async () => ({
          clientId: 'google-client-id.apps.googleusercontent.com',
          clientSecret: 'google-secret-xyz',
          redirectUri: 'https://login.sso.educacion.gob.ec/callback',
        }),
        tokenExchangeFetcher: async () => ({
          id_token: 'mock.google.jwt',
          access_token: 'google-access-token',
          token_type: 'Bearer',
          expires_in: 3599,
        }),
        googleIdTokenVerifier: async () => ({
          iss: 'https://accounts.google.com',
          sub: '109876543210987654321',
          aud: 'google-client-id.apps.googleusercontent.com',
          email: 'DOCENTE.PRUEBA@EDUCACION.GOB.EC',
          email_verified: true,
          hd: 'EDUCACION.GOB.EC',
          name: 'DOCENTE PRUEBA',
          nonce: 'google-nonce-123',
        }),
        logger,
      });

      const redirectUrl = await adapter.buildAuthorizationRedirectUrl({
        googleState: 'state-123',
        googleNonce: 'google-nonce-123',
        googleCodeChallenge: 'challenge-xyz',
        hdHint: 'educacion.gob.ec',
      });
      expect(redirectUrl).toContain(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(redirectUrl).toContain('code_challenge_method=S256');

      const claims = await adapter.exchangeGoogleCodeAndVerifyIdToken({
        googleCode: '4/0AfJohX...',
        googleCodeVerifier: 'verifier-xyz',
        expectedNonce: 'google-nonce-123',
      });

      expect(claims.googleSubId).toBe('109876543210987654321');
      expect(claims.emailPrincipal).toBe('docente.prueba@educacion.gob.ec');
      expect(claims.hd).toBe('educacion.gob.ec');

      await expect(
        adapter.exchangeGoogleCodeAndVerifyIdToken({
          googleCode: '4/0AfJohX...',
          googleCodeVerifier: 'verifier-xyz',
          expectedNonce: 'wrong-nonce',
        }),
      ).rejects.toThrow(OidcSecurityError);
    });

    it('carga credenciales desde Secret Manager (con caché), soporta fallback local y bloquea id_token sin id_token, iss inválido o email no verificado', async () => {
      const prevIdVer = process.env.GOOGLE_IDP_CLIENT_ID_SECRET_VERSION;
      const prevSecVer = process.env.GOOGLE_IDP_CLIENT_SECRET_VERSION;
      process.env.GOOGLE_IDP_CLIENT_ID_SECRET_VERSION =
        'projects/p/secrets/id/versions/latest';
      process.env.GOOGLE_IDP_CLIENT_SECRET_VERSION =
        'projects/p/secrets/sec/versions/latest';

      const smMock = {
        accessSecretVersion: jest
          .fn()
          .mockResolvedValueOnce([
            { payload: { data: Buffer.from('sm-client-id', 'utf8') } },
          ])
          .mockResolvedValueOnce([
            { payload: { data: Buffer.from('sm-client-secret', 'utf8') } },
          ]),
      };

      try {
        const smAdapter = new GoogleCloudIdentityRelyingPartyAdapter({
          secretManagerClient: smMock as never,
          tokenExchangeFetcher: async () => ({ id_token: '' }),
        });

        const url1 = await smAdapter.buildAuthorizationRedirectUrl({
          googleState: 'st-1',
          googleNonce: 'nn-1',
          googleCodeChallenge: 'cc-1',
          prompt: 'select_account',
        });
        expect(url1).toContain('client_id=sm-client-id');
        expect(url1).toContain('prompt=select_account');

        // Segunda llamada usa cachedCredentials
        await smAdapter.buildAuthorizationRedirectUrl({
          googleState: 'st-2',
          googleNonce: 'nn-2',
          googleCodeChallenge: 'cc-2',
        });
        expect(smMock.accessSecretVersion).toHaveBeenCalledTimes(2);

        // Respuesta sin id_token lanza 503 DEPENDENCIA_CRITICA_NO_DISPONIBLE
        await expect(
          smAdapter.exchangeGoogleCodeAndVerifyIdToken({
            googleCode: 'c',
            googleCodeVerifier: 'v',
            expectedNonce: 'nn-1',
          }),
        ).rejects.toThrow(OidcSecurityError);
      } finally {
        if (prevIdVer === undefined) {
          delete process.env.GOOGLE_IDP_CLIENT_ID_SECRET_VERSION;
        } else {
          process.env.GOOGLE_IDP_CLIENT_ID_SECRET_VERSION = prevIdVer;
        }
        if (prevSecVer === undefined) {
          delete process.env.GOOGLE_IDP_CLIENT_SECRET_VERSION;
        } else {
          process.env.GOOGLE_IDP_CLIENT_SECRET_VERSION = prevSecVer;
        }
      }

      // Fallback local sin variables de Secret Manager y validaciones de iss / email_verified
      const fallbackAdapter = new GoogleCloudIdentityRelyingPartyAdapter({
        tokenExchangeFetcher: async () => ({ id_token: 'tok' }),
        googleIdTokenVerifier: async (idToken) => {
          if (idToken === 'bad-iss') {
            return { iss: 'https://evil.idp.example' };
          }
          return {
            iss: 'https://accounts.google.com',
            sub: 'sub-1',
            email: 'personal@gmail.com',
            email_verified: false,
          };
        },
      });

      const fbUrl = await fallbackAdapter.buildAuthorizationRedirectUrl({
        googleState: 's',
        googleNonce: 'n',
        googleCodeChallenge: 'c',
      });
      expect(fbUrl).toContain('response_type=code');

      await expect(
        fallbackAdapter.exchangeGoogleCodeAndVerifyIdToken({
          googleCode: 'c',
          googleCodeVerifier: 'v',
          expectedNonce: '',
        }),
      ).rejects.toThrow(OidcSecurityError);

      const badIssAdapter = new GoogleCloudIdentityRelyingPartyAdapter({
        credentialsProvider: async () => ({
          clientId: 'cid',
          clientSecret: 'sec',
          redirectUri: 'https://login.sso.educacion.gob.ec/callback',
        }),
        tokenExchangeFetcher: async () => ({ id_token: 'bad-iss' }),
        googleIdTokenVerifier: async () => ({ iss: 'https://evil.example' }),
      });

      await expect(
        badIssAdapter.exchangeGoogleCodeAndVerifyIdToken({
          googleCode: 'c',
          googleCodeVerifier: 'v',
          expectedNonce: '',
        }),
      ).rejects.toThrow(OidcSecurityError);
    });
  });

  describe('5. Flujo completo de casos de uso: StartOidcAuthorization -> HandleGoogleIdpCallback -> ExchangeAuthorizationCode', () => {
    it('ejecuta el flujo OIDC completo y revoca la sesión si se intenta reutilizar (replay) el authorization_code', async () => {
      const redis = new InMemoryRedisCacheClient();
      const sessionStore = new RedisOidcStoreAdapter(redis);

      const clientRepository: IOidcClientRepositoryPort = {
        findByOidcClientId: jest.fn(async (clientId: string) =>
          clientId === ACTIVE_CLIENT.oidcClientId ? ACTIVE_CLIENT : null,
        ),
        findByOidcClientIds: jest.fn(async () => [ACTIVE_CLIENT]),
        isInstitutionalDomainActive: jest.fn(
          async (domain: string) => domain === 'educacion.gob.ec',
        ),
        invalidateClientCache: jest.fn(async () => undefined),
      };

      const googleIdp: IGoogleIdpFederationPort = {
        buildAuthorizationRedirectUrl: jest.fn(
          async ({ googleState }) =>
            `https://accounts.google.com/o/oauth2/v2/auth?state=${googleState}`,
        ),
        exchangeGoogleCodeAndVerifyIdToken: jest.fn(async () => ({
          googleSubId: 'google-sub-777',
          emailPrincipal: 'docente@educacion.gob.ec',
          emailVerified: true,
          hd: 'educacion.gob.ec',
          fullName: 'CARLOS ANDRES MENDOZA',
        })),
      };

      const resolvedPip: ResultadoResolucionPipOidc = {
        estadoResolucion: 'CONSOLIDADA_ACTIVA',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-777',
        emailPrincipal: 'docente@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'CARLOS ANDRES MENDOZA',
        estadoPersona: 'ACTIVO',
        estadoSincronizacion: 'CONSOLIDADA',
        suspendedEnGws: false,
        fueRegistroCaliente: false,
        intentosEsperaRealizados: 0,
      };

      const pipResolver: IPipIdentityResolverPort = {
        resolveIdentityForOidcCallback: jest.fn(async () => resolvedPip),
        verifySessionSubjectStillActive: jest.fn(async () => true),
      };

      const jwksKeyStore: IJwksKeyStorePort = {
        getPublishedPublicKeysForSsoOidc: jest.fn(async () => ({
          activeKid: 'kid-1',
          keys: [],
          metadata: [],
        })),
        signIdToken: jest.fn(async () => ({
          idTokenJwt: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZC0xIn0.payload.sig',
          kid: 'kid-1',
        })),
        signBackchannelLogoutToken: jest.fn(async () => ({
          logoutTokenJwt: 'logout.jwt',
          kid: 'kid-1',
        })),
        verifySsoOidcIdTokenHint: jest.fn(async () => null),
        rotateSsoOidcSigningKey: jest.fn(),
        revokeOrRetireSsoOidcSigningKey: jest.fn(),
      };

      const auditWriter = {
        appendEvent: jest.fn(async () => 'audit-1'),
      } as unknown as AuditEventWriter;

      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger;

      const startUseCase = new StartOidcAuthorizationUseCase(
        clientRepository,
        sessionStore,
        googleIdp,
        pipResolver,
        pkceValidator,
        redirectUriValidator,
        auditWriter,
        logger,
      );

      const callbackUseCase = new HandleGoogleIdpCallbackUseCase(
        clientRepository,
        sessionStore,
        googleIdp,
        pipResolver,
        auditWriter,
        logger,
      );

      const exchangeUseCase = new ExchangeAuthorizationCodeUseCase(
        clientRepository,
        sessionStore,
        jwksKeyStore,
        pkceValidator,
        secretVerifier,
        claimsBuilder,
        auditWriter,
        logger,
      );

      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge =
        pkceValidator.computeS256CodeChallenge(codeVerifier);

      const authStart = await startUseCase.execute({
        clientId: 'conecta-sigee-web',
        redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
        responseType: 'code',
        scope: 'openid profile email',
        state: 'client-state-12345678',
        nonce: 'client-nonce-12345678',
        codeChallenge,
        codeChallengeMethod: 'S256',
        traceId: 'trace-unit-001',
      });

      expect(authStart.outcome).toBe('REDIRECT_TO_GOOGLE_IDP');
      const googleRedirectUrl = new URL(authStart.redirectUrl);
      const googleState = googleRedirectUrl.searchParams.get('state')!;

      const callbackResult = await callbackUseCase.execute({
        googleCode: 'google-code-abc',
        googleState,
        traceId: 'trace-unit-001',
      });

      const clientRedirect = new URL(callbackResult.clientRedirectUrl);
      const issuedCode = clientRedirect.searchParams.get('code')!;
      expect(clientRedirect.searchParams.get('state')).toBe(
        'client-state-12345678',
      );

      const tokenResult = await exchangeUseCase.execute({
        grantType: 'authorization_code',
        code: issuedCode,
        redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
        clientId: 'conecta-sigee-web',
        codeVerifier,
        authMethodUsed: 'none',
        issuer: 'https://login.sso.educacion.gob.ec',
        traceId: 'trace-unit-001',
      });

      expect(tokenResult.token_type).toBe('Bearer');
      expect(tokenResult.expires_in).toBe(300);
      expect(tokenResult.id_token).toContain('eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZC0xIn0');

      // Reutilización (replay) del mismo código revoca la sesión central inmediatamente
      await expect(
        exchangeUseCase.execute({
          grantType: 'authorization_code',
          code: issuedCode,
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          clientId: 'conecta-sigee-web',
          codeVerifier,
          authMethodUsed: 'none',
          issuer: 'https://login.sso.educacion.gob.ec',
          traceId: 'trace-unit-002',
        }),
      ).rejects.toThrow(OAuthTokenProtocolError);

      const revokedSession = await sessionStore.getSession(
        callbackResult.sessionId,
      );
      expect(revokedSession).toBeNull();

      // Ramas de validación defensiva en StartOidcAuthorization, HandleGoogleIdpCallback y ExchangeAuthorizationCode
      await expect(
        startUseCase.execute({
          clientId: 'conecta-sigee-web',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          responseType: 'token',
          scope: 'openid profile email',
          state: 'client-state-12345678',
          codeChallenge,
          codeChallengeMethod: 'S256',
          traceId: 'trace-err-1',
        }),
      ).rejects.toThrow(OidcSecurityError);

      await expect(
        startUseCase.execute({
          clientId: 'conecta-sigee-web',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          responseType: 'code',
          scope: 'profile email',
          state: 'client-state-12345678',
          codeChallenge,
          codeChallengeMethod: 'S256',
          traceId: 'trace-err-2',
        }),
      ).rejects.toThrow(OidcSecurityError);

      await expect(
        callbackUseCase.execute({
          googleCode: 'code-x',
          googleState: '',
          traceId: 'trace-err-3',
        }),
      ).rejects.toThrow(OidcSecurityError);

      await expect(
        callbackUseCase.execute({
          googleCode: 'code-x',
          googleState: 'expired-or-unknown-state',
          traceId: 'trace-err-4',
        }),
      ).rejects.toThrow(OidcSecurityError);

      await expect(
        exchangeUseCase.execute({
          grantType: 'refresh_token',
          code: 'any',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          clientId: 'conecta-sigee-web',
          codeVerifier,
          authMethodUsed: 'none',
          issuer: 'https://login.sso.educacion.gob.ec',
          traceId: 'trace-err-5',
        }),
      ).rejects.toThrow(OAuthTokenProtocolError);

      await expect(
        exchangeUseCase.execute({
          grantType: 'authorization_code',
          code: 'any',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          clientId: 'cliente-inexistente',
          codeVerifier,
          authMethodUsed: 'none',
          issuer: 'https://login.sso.educacion.gob.ec',
          traceId: 'trace-err-6',
        }),
      ).rejects.toThrow(OAuthTokenProtocolError);

      await expect(
        exchangeUseCase.execute({
          grantType: 'authorization_code',
          code: 'non-existent-code',
          redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
          clientId: 'conecta-sigee-web',
          codeVerifier,
          authMethodUsed: 'none',
          issuer: 'https://login.sso.educacion.gob.ec',
          traceId: 'trace-err-7',
        }),
      ).rejects.toThrow(OAuthTokenProtocolError);
    });
  });
});
