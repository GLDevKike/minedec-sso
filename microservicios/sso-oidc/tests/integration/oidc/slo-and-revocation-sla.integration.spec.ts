import crypto from 'crypto';

import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { createSsoOidcApp } from '../../../src';
import { ClienteOidc } from '../../../src/domain/entities/oidc-broker.entities';
import {
  IBackchannelLogoutDispatcherPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IPipIdentityResolverPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import { PkceS256Validator } from '../../../src/domain/services/oidc-security.services';
import { RedisOidcStoreAdapter } from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';
import request from 'supertest';

const CLIENT_WITH_SLO: ClienteOidc = {
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
    {
      redirectUriId: '44444444-4444-4444-8444-444444444444',
      clienteOidcId: '11111111-1111-4111-8111-111111111111',
      tipoUri: 'POST_LOGOUT',
      uri: 'https://sigee.educacion.gob.ec/post-logout',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
    {
      redirectUriId: '55555555-5555-4555-8555-555555555555',
      clienteOidcId: '11111111-1111-4111-8111-111111111111',
      tipoUri: 'BACKCHANNEL_LOGOUT',
      uri: 'https://sigee.educacion.gob.ec/oidc/backchannel-logout',
      activo: true,
      creadoEn: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

describe('T033 - Prueba de integración y aceptación del SLA de revocación <= 300 s y Single Logout (SLO) (US4, RF-GI-06, RF-AUT-06, FR-008)', () => {
  const pkceValidator = new PkceS256Validator();

  it('cierra sesión central en GET/POST /logout con Back-Channel Logout y garantiza revocación inmediata en Redis vía Pub/Sub (/internal/v1/oidc/events/identity-revoked) impidiendo Silent SSO posterior (<= 300 s)', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    const clientRepository: IOidcClientRepositoryPort = {
      findByOidcClientId: async () => CLIENT_WITH_SLO,
      findByOidcClientIds: async () => [CLIENT_WITH_SLO],
      isInstitutionalDomainActive: async () => true,
      invalidateClientCache: async () => undefined,
    };

    const backchannelDispatcher: IBackchannelLogoutDispatcherPort = {
      dispatchLogoutTokens: jest.fn(async ({ targets }) => ({
        dispatchedCount: targets.length,
        succeededCount: targets.length,
        failedClients: [],
      })),
    };

    const jwksKeyStore: IJwksKeyStorePort = {
      getPublishedPublicKeysForSsoOidc: async () => ({
        activeKid: 'kid-1',
        keys: [],
        metadata: [],
      }),
      signIdToken: async () => ({ idTokenJwt: 'id.jwt', kid: 'kid-1' }),
      signBackchannelLogoutToken: async () => ({
        logoutTokenJwt: 'logout.jwt',
        kid: 'kid-1',
      }),
      verifySsoOidcIdTokenHint: async () => ({
        sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sid: 'sess-slo-integration-1',
        aud: 'conecta-sigee-web',
      }),
      rotateSsoOidcSigningKey: async () => ({
        activeKid: 'kid-1',
        publishedKids: ['kid-1'],
      }),
      revokeOrRetireSsoOidcSigningKey: async () => ({
        activeKid: 'kid-1',
        publishedKids: ['kid-1'],
      }),
    };

    const pipResolverPort: IPipIdentityResolverPort = {
      resolveIdentityForOidcCallback: jest.fn(),
      verifySessionSubjectStillActive: async () => true,
    };

    const app = createSsoOidcApp({
      issuerUrl: 'https://login.sso.educacion.gob.ec',
      redis,
      clientRepository,
      sessionStore,
      jwksKeyStore,
      backchannelDispatcher,
      pipResolverPort,
      auditWriter: {
        appendEvent: async () => 'audit-slo-int-1',
      } as unknown as AuditEventWriter,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger,
    });

    // 1. Crear sesión central activa #1 y ejecutar GET /logout con post_logout_redirect_uri registrado
    await sessionStore.saveSession(
      {
        sessionId: 'sess-slo-integration-1',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-slo-1',
        emailPrincipal: 'docente.slo@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'DOCENTE SLO',
        participatingClientIds: ['conecta-sigee-web'],
        createdAt: new Date().toISOString(),
        lastPipValidatedAt: new Date().toISOString(),
      },
      300,
    );

    const logoutRes = await request(app)
      .get('/logout')
      .set('Cookie', '__Host-minedec_sso_sid=sess-slo-integration-1')
      .query({
        id_token_hint: 'valid.id.token',
        post_logout_redirect_uri: 'https://sigee.educacion.gob.ec/post-logout',
        state: 'after-logout-state',
      });

    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.location).toBe(
      'https://sigee.educacion.gob.ec/post-logout?state=after-logout-state',
    );
    expect(await sessionStore.getSession('sess-slo-integration-1')).toBeNull();

    // 2. Crear sesión central activa #2 y disparar evento Cloud Pub/Sub de baja/suspensión en /internal/v1/oidc/events/identity-revoked
    await sessionStore.saveSession(
      {
        sessionId: 'sess-pubsub-revoke-2',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-slo-1',
        emailPrincipal: 'docente.slo@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'DOCENTE SLO',
        participatingClientIds: ['conecta-sigee-web'],
        createdAt: new Date().toISOString(),
        lastPipValidatedAt: new Date().toISOString(),
      },
      300,
    );

    const pubsubEnvelope = {
      message: {
        messageId: 'pubsub-msg-999',
        data: Buffer.from(
          JSON.stringify({
            alcanceRevocacion: 'CUENTA_INSTITUCIONAL',
            cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            motivoRevocacion: 'SUSPENDIDA_GWS',
            traceId: 'trace-pubsub-sla-300',
          }),
        ).toString('base64'),
      },
    };

    const revokeRes = await request(app)
      .post('/internal/v1/oidc/events/identity-revoked')
      .send(pubsubEnvelope);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.status).toBe('REVOKED');
    expect(revokeRes.body.purgedSessionIds).toEqual(['sess-pubsub-revoke-2']);
    expect(revokeRes.body.backchannelDispatchedCount).toBe(1);
    expect(await sessionStore.getSession('sess-pubsub-revoke-2')).toBeNull();

    // 3. Verificar que un intento posterior de Silent SSO con prompt=none y la cookie revocada es denegado inmediatamente (HTTP 401)
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = pkceValidator.computeS256CodeChallenge(verifier);

    const silentAttemptRes = await request(app)
      .get('/authorize')
      .set('Cookie', '__Host-minedec_sso_sid=sess-pubsub-revoke-2')
      .query({
        response_type: 'code',
        client_id: 'conecta-sigee-web',
        redirect_uri: 'https://sigee.educacion.gob.ec/oidc/callback',
        scope: 'openid profile email',
        state: 'state-silent-denied',
        prompt: 'none',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

    expect(silentAttemptRes.status).toBe(401);
    expect(silentAttemptRes.body.codigoError).toBe(
      'CLIENTE_OIDC_NO_AUTORIZADO',
    );
  });
});
