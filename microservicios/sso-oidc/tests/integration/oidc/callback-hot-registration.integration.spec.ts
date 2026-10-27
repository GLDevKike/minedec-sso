import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { createSsoOidcApp } from '../../../src';
import {
  ClienteOidc,
  ResultadoResolucionPipOidc,
} from '../../../src/domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IOidcClientRepositoryPort,
  IPipIdentityResolverPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import { RedisOidcStoreAdapter } from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';
import request from 'supertest';

const TEST_CLIENT: ClienteOidc = {
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

describe('T029 - Pruebas de integración HTTP de GET /callback con registro en caliente en el PIP (<= 3.000 ms) y retención PENDIENTE_IDENTIFICACION (US3, FR-006)', () => {
  it('emite código OIDC tras consolidación en caliente exitosa y bloquea con HTTP 403 IDENTIDAD_PENDIENTE_SINCRONIZACION o CUENTA_SUSPENDIDA_O_INACTIVA cuando aplica', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    let nextPipResult: ResultadoResolucionPipOidc = {
      estadoResolucion: 'CONSOLIDADA_ACTIVA',
      idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      googleSubId: 'google-sub-hot-1',
      emailPrincipal: 'recien.creado@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipoIdentificacion: 'CEDULA',
      numeroIdentificacion: '1710034065',
      nombreCompleto: 'RECIEN CREADO CONSOLIDADO',
      estadoPersona: 'ACTIVO',
      estadoSincronizacion: 'CONSOLIDADA',
      suspendedEnGws: false,
      fueRegistroCaliente: true,
      intentosEsperaRealizados: 2,
    };

    const clientRepository: IOidcClientRepositoryPort = {
      findByOidcClientId: async () => TEST_CLIENT,
      findByOidcClientIds: async () => [TEST_CLIENT],
      isInstitutionalDomainActive: async () => true,
      invalidateClientCache: async () => undefined,
    };

    const googleIdpPort: IGoogleIdpFederationPort = {
      buildAuthorizationRedirectUrl: async ({ googleState }) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${googleState}`,
      exchangeGoogleCodeAndVerifyIdToken: async () => ({
        googleSubId: 'google-sub-hot-1',
        emailPrincipal: 'recien.creado@educacion.gob.ec',
        emailVerified: true,
        hd: 'educacion.gob.ec',
        fullName: 'RECIEN CREADO',
      }),
    };

    const pipResolverPort: IPipIdentityResolverPort = {
      resolveIdentityForOidcCallback: async () => nextPipResult,
      verifySessionSubjectStillActive: async () => true,
    };

    const app = createSsoOidcApp({
      issuerUrl: 'https://login.sso.educacion.gob.ec',
      redis,
      clientRepository,
      sessionStore,
      googleIdpPort,
      pipResolverPort,
      auditWriter: {
        appendEvent: async () => 'audit-hot-1',
      } as unknown as AuditEventWriter,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger,
    });

    // Caso 1: Registro en caliente que se consolida dentro de la ventana <= 3.000 ms -> 302 al RP con code
    await sessionStore.saveGoogleFederationState(
      {
        googleState: 'gstate-hot-consolidated',
        clientId: 'conecta-sigee-web',
        redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
        scope: 'openid profile email',
        clientState: 'cstate-1',
        codeChallenge: 'challenge-1234567890123456789012345678901234567890123',
        codeChallengeMethod: 'S256',
        googleNonce: 'gnonce-1',
        googleCodeVerifier: 'gverifier-1',
        traceId: 'trace-hot-1',
        createdAtIso: new Date().toISOString(),
      },
      300,
    );

    const resConsolidated = await request(app).get('/callback').query({
      code: 'google-code-1',
      state: 'gstate-hot-consolidated',
    });

    expect(resConsolidated.status).toBe(302);
    expect(resConsolidated.headers.location).toContain(
      'https://sigee.educacion.gob.ec/oidc/callback?code=',
    );

    // Caso 2: Registro en caliente que permanece en PENDIENTE_IDENTIFICACION -> 403 IDENTIDAD_PENDIENTE_SINCRONIZACION
    nextPipResult = {
      estadoResolucion: 'PENDIENTE_IDENTIFICACION_RETENIDA',
      idInterno: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      cuentaId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      googleSubId: 'google-sub-hot-2',
      emailPrincipal: 'pendiente@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoPersona: 'ACTIVO',
      estadoSincronizacion: 'PENDIENTE_IDENTIFICACION',
      suspendedEnGws: false,
      fueRegistroCaliente: true,
      intentosEsperaRealizados: 6,
    };

    await sessionStore.saveGoogleFederationState(
      {
        googleState: 'gstate-hot-pending',
        clientId: 'conecta-sigee-web',
        redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
        scope: 'openid profile email',
        clientState: 'cstate-2',
        codeChallenge: 'challenge-1234567890123456789012345678901234567890123',
        codeChallengeMethod: 'S256',
        googleNonce: 'gnonce-2',
        googleCodeVerifier: 'gverifier-2',
        traceId: 'trace-hot-2',
        createdAtIso: new Date().toISOString(),
      },
      300,
    );

    const resPending = await request(app).get('/callback').query({
      code: 'google-code-2',
      state: 'gstate-hot-pending',
    });

    expect(resPending.status).toBe(403);
    expect(resPending.body.codigoError).toBe(
      'IDENTIDAD_PENDIENTE_SINCRONIZACION',
    );
    expect(resPending.body.reintentarPermitido).toBe(true);

    // Caso 3: Cuenta suspendida o persona inactiva -> 403 CUENTA_SUSPENDIDA_O_INACTIVA
    nextPipResult = {
      estadoResolucion: 'CUENTA_SUSPENDIDA_O_INACTIVA',
      idInterno: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      cuentaId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      googleSubId: 'google-sub-suspended',
      emailPrincipal: 'suspendido@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoPersona: 'INACTIVO',
      estadoSincronizacion: 'SUSPENDIDA_GWS',
      suspendedEnGws: true,
      fueRegistroCaliente: false,
      intentosEsperaRealizados: 0,
      motivoDenegacion: 'Cuenta institucional suspendida en Google Workspace.',
    };

    await sessionStore.saveGoogleFederationState(
      {
        googleState: 'gstate-suspended',
        clientId: 'conecta-sigee-web',
        redirectUri: 'https://sigee.educacion.gob.ec/oidc/callback',
        scope: 'openid profile email',
        clientState: 'cstate-3',
        codeChallenge: 'challenge-1234567890123456789012345678901234567890123',
        codeChallengeMethod: 'S256',
        googleNonce: 'gnonce-3',
        googleCodeVerifier: 'gverifier-3',
        traceId: 'trace-hot-3',
        createdAtIso: new Date().toISOString(),
      },
      300,
    );

    const resSuspended = await request(app).get('/callback').query({
      code: 'google-code-3',
      state: 'gstate-suspended',
    });

    expect(resSuspended.status).toBe(403);
    expect(resSuspended.body.codigoError).toBe('CUENTA_SUSPENDIDA_O_INACTIVA');
    expect(resSuspended.body.reintentarPermitido).toBe(false);
  });
});
