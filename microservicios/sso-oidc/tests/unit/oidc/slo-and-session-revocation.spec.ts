import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { ExecuteSingleLogoutUseCase } from '../../../src/application/execute-single-logout.usecase';
import { RevokeIdentitySessionsUseCase } from '../../../src/application/revoke-identity-sessions.usecase';
import { ClienteOidc } from '../../../src/domain/entities/oidc-broker.entities';
import {
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import {
  BackchannelLogoutTokenBuilder,
  ExactRedirectUriValidator,
  OidcSecurityError,
} from '../../../src/domain/services/oidc-security.services';
import { HttpBackchannelLogoutDispatcherAdapter } from '../../../src/infrastructure/crypto/http-backchannel-logout.adapter';
import { RedisOidcStoreAdapter } from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';

const PARTICIPATING_CLIENT: ClienteOidc = {
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
      tipoUri: 'POST_LOGOUT',
      uri: 'https://sigee.educacion.gob.ec/logged-out',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
    {
      redirectUriId: '44444444-4444-4444-8444-444444444444',
      clienteOidcId: '11111111-1111-4111-8111-111111111111',
      tipoUri: 'BACKCHANNEL_LOGOUT',
      uri: 'https://sigee.educacion.gob.ec/oidc/backchannel-logout',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

describe('T032 - Pruebas unitarias de Single Logout (SLO), Back-Channel Logout y revocación inmediata vía Pub/Sub <= 300 s (US4, FR-008)', () => {
  const logoutTokenBuilder = new BackchannelLogoutTokenBuilder();
  const redirectValidator = new ExactRedirectUriValidator();
  const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;

  it('1. BackchannelLogoutTokenBuilder genera claims OIDC Back-Channel Logout 1.0 sin el claim nonce prohibido', () => {
    const claims = logoutTokenBuilder.buildLogoutTokenClaims({
      issuer: 'https://login.sso.educacion.gob.ec',
      idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      oidcClientId: 'conecta-sigee-web',
      sessionId: 'sess-slo-001',
      nowEpochSeconds: 1_700_000_000,
    });

    expect(claims.iss).toBe('https://login.sso.educacion.gob.ec');
    expect(claims.sub).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(claims.aud).toBe('conecta-sigee-web');
    expect(claims.sid).toBe('sess-slo-001');
    expect(
      claims.events[
        'http://schemas.openid.net/specs/openid-connect-backchannel-logout-1_0.html'
      ],
    ).toEqual({});
    expect('nonce' in claims).toBe(false);
  });

  it('2. ExecuteSingleLogoutUseCase destruye la sesión central en Redis, despacha Back-Channel Logout y valida post_logout_redirect_uri exacto', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    await sessionStore.saveSession(
      {
        sessionId: 'sess-slo-100',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-100',
        emailPrincipal: 'usuario@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'USUARIO PRUEBA',
        participatingClientIds: ['conecta-sigee-web'],
        createdAt: new Date().toISOString(),
        lastPipValidatedAt: new Date().toISOString(),
      },
      300,
    );

    const jwksKeyStore: IJwksKeyStorePort = {
      getPublishedPublicKeysForSsoOidc: jest.fn(async () => ({
        activeKid: 'kid-slo-1',
        keys: [],
        metadata: [],
      })),
      signIdToken: jest.fn(),
      signBackchannelLogoutToken: jest.fn(async () => ({
        logoutTokenJwt: 'signed.logout.jwt',
        kid: 'kid-slo-1',
      })),
      verifySsoOidcIdTokenHint: jest.fn(async () => ({
        sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sid: 'sess-slo-100',
        aud: 'conecta-sigee-web',
      })),
      rotateSsoOidcSigningKey: jest.fn(),
      revokeOrRetireSsoOidcSigningKey: jest.fn(),
    };

    const httpPostFn = jest.fn(async () => ({ status: 200 }));
    const backchannelDispatcher = new HttpBackchannelLogoutDispatcherAdapter(
      jwksKeyStore,
      logoutTokenBuilder,
      loggerMock,
      { httpPostFn },
    );

    const clientRepo: IOidcClientRepositoryPort = {
      findByOidcClientId: jest.fn(async () => PARTICIPATING_CLIENT),
      findByOidcClientIds: jest.fn(async () => [PARTICIPATING_CLIENT]),
      isInstitutionalDomainActive: jest.fn(async () => true),
      invalidateClientCache: jest.fn(async () => undefined),
    };

    const auditWriter = {
      appendEvent: jest.fn(async () => 'audit-slo-1'),
    } as unknown as AuditEventWriter;

    const sloUseCase = new ExecuteSingleLogoutUseCase(
      clientRepo,
      sessionStore,
      jwksKeyStore,
      backchannelDispatcher,
      redirectValidator,
      auditWriter,
      loggerMock,
    );

    const result = await sloUseCase.execute({
      idTokenHint: 'valid.id.token.hint',
      postLogoutRedirectUri: 'https://sigee.educacion.gob.ec/logged-out',
      state: 'logout-state-99',
      currentSessionId: 'sess-slo-100',
      issuer: 'https://login.sso.educacion.gob.ec',
      traceId: 'trace-slo-001',
    });

    expect(result.destroyedSessionIds).toEqual(['sess-slo-100']);
    expect(result.backchannelDispatchedCount).toBe(1);
    expect(result.postLogoutRedirectUrl).toBe(
      'https://sigee.educacion.gob.ec/logged-out?state=logout-state-99',
    );
    expect(httpPostFn).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://sigee.educacion.gob.ec/oidc/backchannel-logout',
        logoutTokenJwt: 'signed.logout.jwt',
      }),
    );
    expect(await sessionStore.getSession('sess-slo-100')).toBeNull();

    // URI de post_logout no registrada debe lanzar OidcSecurityError
    await expect(
      sloUseCase.execute({
        idTokenHint: 'valid.id.token.hint',
        postLogoutRedirectUri: 'https://evil.example.com/phishing',
        issuer: 'https://login.sso.educacion.gob.ec',
        traceId: 'trace-slo-002',
      }),
    ).rejects.toThrow(OidcSecurityError);

    // Ramas de HttpBackchannelLogoutDispatcherAdapter con lista vacía, error HTTP 500 y excepción de red
    const emptyDispatch = await backchannelDispatcher.dispatchLogoutTokens({
      issuer: 'https://login.sso.educacion.gob.ec',
      targets: [],
      traceId: 'trace-empty',
    });
    expect(emptyDispatch.dispatchedCount).toBe(0);

    const failingDispatcher = new HttpBackchannelLogoutDispatcherAdapter(
      jwksKeyStore,
      logoutTokenBuilder,
      loggerMock,
      {
        httpPostFn: async ({ url }) => {
          if (url.includes('throw')) {
            throw new Error('Network timeout');
          }
          return { status: 500 };
        },
      },
    );
    const failedDispatch = await failingDispatcher.dispatchLogoutTokens({
      issuer: 'https://login.sso.educacion.gob.ec',
      targets: [
        {
          oidcClientId: 'rp-500',
          backchannelLogoutUri: 'https://rp500.educacion.gob.ec/bcl',
          idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionId: 'sess-1',
        },
        {
          oidcClientId: 'rp-throw',
          backchannelLogoutUri: 'https://rpthrow.educacion.gob.ec/throw',
          idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionId: 'sess-1',
        },
      ],
      traceId: 'trace-fail',
    });
    expect(failedDispatch.failedClients).toHaveLength(2);
  });

  it('3. RevokeIdentitySessionsUseCase purga inmediatamente todas las sesiones en Redis por cuentaId e idInterno ante baja administrativa Pub/Sub', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    await sessionStore.saveSession(
      {
        sessionId: 'sess-revoke-200',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-200',
        emailPrincipal: 'suspendido@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'FUNCIONARIO SUSPENDIDO',
        participatingClientIds: ['conecta-sigee-web'],
        createdAt: new Date().toISOString(),
        lastPipValidatedAt: new Date().toISOString(),
      },
      300,
    );

    const clientRepo: IOidcClientRepositoryPort = {
      findByOidcClientId: jest.fn(async () => PARTICIPATING_CLIENT),
      findByOidcClientIds: jest.fn(async () => [PARTICIPATING_CLIENT]),
      isInstitutionalDomainActive: jest.fn(async () => true),
      invalidateClientCache: jest.fn(async () => undefined),
    };

    const backchannelDispatcher = {
      dispatchLogoutTokens: jest.fn(async () => ({
        dispatchedCount: 1,
        succeededCount: 1,
        failedClients: [],
      })),
    };

    const auditWriter = {
      appendEvent: jest.fn(async () => 'audit-rev-1'),
    } as unknown as AuditEventWriter;

    const revokeUseCase = new RevokeIdentitySessionsUseCase(
      clientRepo,
      sessionStore,
      backchannelDispatcher,
      auditWriter,
      loggerMock,
    );

    const result = await revokeUseCase.execute({
      cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      motivoRevocacion: 'SUSPENDIDA_GWS',
      issuer: 'https://login.sso.educacion.gob.ec',
      traceId: 'trace-rev-001',
    });

    expect(result.purgedSessionIds).toEqual(['sess-revoke-200']);
    expect(result.backchannelDispatchedCount).toBe(1);
    expect(await sessionStore.getSession('sess-revoke-200')).toBeNull();
  });
});
