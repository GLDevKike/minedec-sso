import crypto from 'crypto';

import {
  AuditEventWriter,
  InMemoryRedisCacheClient,
  StructuredLogger,
} from '@minedec/shared';
import { createSsoOidcApp } from '../../../src';
import { ClienteOidc } from '../../../src/domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IPipIdentityResolverPort,
} from '../../../src/domain/ports/oidc-broker.ports';
import {
  ConstantTimeClientSecretVerifier,
  PkceS256Validator,
} from '../../../src/domain/services/oidc-security.services';
import { RedisOidcStoreAdapter } from '../../../src/infrastructure/oidc-provider/redis-oidc-store.adapter';
import request from 'supertest';

describe('T025 - Pruebas de integración HTTP de aislamiento por client_id, bloqueo de Open Redirect y rotación dual de client_secret (US2)', () => {
  const secretVerifier = new ConstantTimeClientSecretVerifier();
  const pkceValidator = new PkceS256Validator();

  it('bloquea Open Redirect en GET /authorize, impide canje cruzado de authorization_code entre clientes distintos y permite canje con secreto activo o anterior en ventana de gracia', async () => {
    const redis = new InMemoryRedisCacheClient();
    const sessionStore = new RedisOidcStoreAdapter(redis);

    const confidentialClientA: ClienteOidc = {
      clienteOidcId: '11111111-1111-4111-8111-111111111111',
      aplicacionId: '22222222-2222-4222-8222-222222222222',
      oidcClientId: 'conecta-pep-apigee',
      secretoActivoHash: secretVerifier.computeSha256Hex('secreto-nuevo-2026'),
      secretoAnteriorHash: secretVerifier.computeSha256Hex(
        'secreto-anterior-gracia',
      ),
      graciaHasta: new Date(Date.now() + 3_600_000),
      expiraRotacionEn: new Date(Date.now() + 86_400_000 * 30),
      metodoAutenticacionToken: 'client_secret_basic',
      estadoCliente: 'EN_ROTACION_GRACIA',
      creadoEn: new Date('2026-01-01T00:00:00Z'),
      actualizadoEn: new Date('2026-01-01T00:00:00Z'),
      aplicacion: {
        aplicacionId: '22222222-2222-4222-8222-222222222222',
        codigoUnico: 'APIGEE_PEP',
        nombreVisible: 'PEP Apigee X',
        patronIntegracion: 'PATRON_2_PEP_PERIMETRAL',
        hostPublico: 'https://portal.educacion.gob.ec',
        estadoCicloVida: 'PUBLICADO',
      },
      redirectUris: [
        {
          redirectUriId: '33333333-3333-4333-8333-333333333333',
          clienteOidcId: '11111111-1111-4111-8111-111111111111',
          tipoUri: 'LOGIN_CALLBACK',
          uri: 'https://portal.educacion.gob.ec/oauth2/callback',
          activo: true,
          creadoEn: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    };

    const confidentialClientB: ClienteOidc = {
      clienteOidcId: '44444444-4444-4444-8444-444444444444',
      aplicacionId: '55555555-5555-4555-8555-555555555555',
      oidcClientId: 'conecta-pep-envoy',
      secretoActivoHash: secretVerifier.computeSha256Hex('secreto-envoy-2026'),
      secretoAnteriorHash: null,
      graciaHasta: null,
      expiraRotacionEn: new Date(Date.now() + 86_400_000 * 30),
      metodoAutenticacionToken: 'client_secret_basic',
      estadoCliente: 'ACTIVO',
      creadoEn: new Date('2026-01-01T00:00:00Z'),
      actualizadoEn: new Date('2026-01-01T00:00:00Z'),
      aplicacion: {
        aplicacionId: '55555555-5555-4555-8555-555555555555',
        codigoUnico: 'ENVOY_PEP',
        nombreVisible: 'PEP GKE Gateway Envoy',
        patronIntegracion: 'PATRON_2_PEP_PERIMETRAL',
        hostPublico: 'https://envoy.educacion.gob.ec',
        estadoCicloVida: 'PUBLICADO',
      },
      redirectUris: [
        {
          redirectUriId: '66666666-6666-4666-8666-666666666666',
          clienteOidcId: '44444444-4444-4444-8444-444444444444',
          tipoUri: 'LOGIN_CALLBACK',
          uri: 'https://envoy.educacion.gob.ec/oauth2/callback',
          activo: true,
          creadoEn: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    };

    const clientRepository: IOidcClientRepositoryPort = {
      findByOidcClientId: async (id) => {
        if (id === confidentialClientA.oidcClientId) return confidentialClientA;
        if (id === confidentialClientB.oidcClientId) return confidentialClientB;
        return null;
      },
      findByOidcClientIds: async () => [
        confidentialClientA,
        confidentialClientB,
      ],
      isInstitutionalDomainActive: async () => true,
      invalidateClientCache: async () => undefined,
    };

    const googleIdpPort: IGoogleIdpFederationPort = {
      buildAuthorizationRedirectUrl: async ({ googleState }) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${googleState}`,
      exchangeGoogleCodeAndVerifyIdToken: async () => ({
        googleSubId: 'google-sub-iso-1',
        emailPrincipal: 'funcionario@educacion.gob.ec',
        emailVerified: true,
        hd: 'educacion.gob.ec',
        fullName: 'FUNCIONARIO PEP',
      }),
    };

    const pipResolverPort: IPipIdentityResolverPort = {
      resolveIdentityForOidcCallback: async () => ({
        estadoResolucion: 'CONSOLIDADA_ACTIVA',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-iso-1',
        emailPrincipal: 'funcionario@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'FUNCIONARIO PEP',
        estadoPersona: 'ACTIVO',
        estadoSincronizacion: 'CONSOLIDADA',
        suspendedEnGws: false,
        fueRegistroCaliente: false,
        intentosEsperaRealizados: 0,
      }),
      verifySessionSubjectStillActive: async () => true,
    };

    const jwksKeyStore: IJwksKeyStorePort = {
      getPublishedPublicKeysForSsoOidc: async () => ({
        activeKid: 'kid-1',
        keys: [],
        metadata: [],
      }),
      signIdToken: async (claims) => ({
        idTokenJwt: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`,
        kid: 'kid-1',
      }),
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
        appendEvent: async () => 'audit-1',
      } as unknown as AuditEventWriter,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger,
    });

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = pkceValidator.computeS256CodeChallenge(verifier);

    // 1. Intento de Open Redirect con redirect_uri no registrada -> HTTP 400 REDIRECT_URI_NO_REGISTRADA
    const openRedirectRes = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: 'conecta-pep-apigee',
      redirect_uri: 'https://attacker.example.com/steal-code',
      scope: 'openid profile email',
      state: 'state-open-redirect-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    expect(openRedirectRes.status).toBe(400);
    expect(openRedirectRes.body.codigoError).toBe('REDIRECT_URI_NO_REGISTRADA');

    // 2. Emitir código legítimo para Cliente A y verificar que el Cliente B NO pueda canjearlo
    await sessionStore.saveSession(
      {
        sessionId: 'sess-iso-1',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-iso-1',
        emailPrincipal: 'funcionario@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'FUNCIONARIO PEP',
        participatingClientIds: ['conecta-pep-apigee'],
        createdAt: new Date().toISOString(),
        lastPipValidatedAt: new Date().toISOString(),
      },
      300,
    );

    await sessionStore.saveAuthorizationCode(
      {
        codeId: 'code-for-client-a-1',
        clientId: 'conecta-pep-apigee',
        redirectUri: 'https://portal.educacion.gob.ec/oauth2/callback',
        scope: 'openid profile email',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        sessionId: 'sess-iso-1',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-iso-1',
        emailPrincipal: 'funcionario@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'FUNCIONARIO PEP',
        authTimeEpochSeconds: Math.floor(Date.now() / 1000),
        issuedAtEpochSeconds: Math.floor(Date.now() / 1000),
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
      },
      60,
    );

    const basicHeaderB = Buffer.from(
      'conecta-pep-envoy:secreto-envoy-2026',
    ).toString('base64');

    const crossClientRes = await request(app)
      .post('/token')
      .set('Authorization', `Basic ${basicHeaderB}`)
      .send({
        grant_type: 'authorization_code',
        code: 'code-for-client-a-1',
        redirect_uri: 'https://portal.educacion.gob.ec/oauth2/callback',
        code_verifier: verifier,
      });

    expect(crossClientRes.status).toBe(400);
    expect(crossClientRes.body.error).toBe('invalid_grant');

    // 3. Emitir otro código para Cliente A y canjearlo usando el secreto anterior en ventana de gracia
    await sessionStore.saveAuthorizationCode(
      {
        codeId: 'code-for-client-a-grace',
        clientId: 'conecta-pep-apigee',
        redirectUri: 'https://portal.educacion.gob.ec/oauth2/callback',
        scope: 'openid profile email',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        sessionId: 'sess-iso-1',
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        googleSubId: 'google-sub-iso-1',
        emailPrincipal: 'funcionario@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        nombreCompleto: 'FUNCIONARIO PEP',
        authTimeEpochSeconds: Math.floor(Date.now() / 1000),
        issuedAtEpochSeconds: Math.floor(Date.now() / 1000),
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
      },
      60,
    );

    const basicHeaderAGrace = Buffer.from(
      'conecta-pep-apigee:secreto-anterior-gracia',
    ).toString('base64');

    const graceTokenRes = await request(app)
      .post('/token')
      .set('Authorization', `Basic ${basicHeaderAGrace}`)
      .send({
        grant_type: 'authorization_code',
        code: 'code-for-client-a-grace',
        redirect_uri: 'https://portal.educacion.gob.ec/oauth2/callback',
        code_verifier: verifier,
      });

    expect(graceTokenRes.status).toBe(200);
    expect(graceTokenRes.body.id_token).toBeDefined();
  });
});
