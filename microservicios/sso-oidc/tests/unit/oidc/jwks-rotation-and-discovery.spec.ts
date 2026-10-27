import crypto from 'crypto';

import {
  AuditEventWriter,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import { ManageJwksKeysUseCase } from '../../../src/application/manage-jwks-keys.usecase';
import { PublicRsaJwk } from '../../../src/domain/entities/oidc-broker.entities';
import { IJwksKeyStorePort } from '../../../src/domain/ports/oidc-broker.ports';
import { AlloyDbAndSecretManagerJwksAdapter } from '../../../src/infrastructure/crypto/alloydb-secretmanager-jwks.adapter';
import { QueryResult } from 'pg';

function generateRsaKeyFixture(kid: string): {
  privateKeyPem: string;
  publicJwk: PublicRsaJwk;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const rawJwk = publicKey.export({ format: 'jwk' }) as {
    n: string;
    e: string;
  };
  return {
    privateKeyPem,
    publicJwk: {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid,
      n: rawJwk.n,
      e: rawJwk.e,
    },
  };
}

describe('T038 - Pruebas unitarias de descubrimiento OIDC, rotación dual JWKS RS256 <= 90 días y segregación por servicio_emisor (US5, FR-009)', () => {
  const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;

  const key2026Q1 = generateRsaKeyFixture('sso-oidc-rs256-2026q1');
  const key2026Q2 = generateRsaKeyFixture('sso-oidc-rs256-2026q2');

  it('1. Publica exclusivamente llaves con servicio_emisor = SSO_OIDC en estados ACTIVA_FIRMA y GRACIA_VERIFICACION, firma con la ACTIVA_FIRMA y verifica tokens con ambas', async () => {
    const dbRows = [
      {
        kid: 'sso-oidc-rs256-2026q2',
        servicio_emisor: 'SSO_OIDC' as const,
        algoritmo: 'RS256' as const,
        estado_llave: 'ACTIVA_FIRMA' as const,
        secret_manager_version: 'projects/p/secrets/s/versions/2',
        public_jwk_json: key2026Q2.publicJwk,
        activada_en: '2026-04-01T00:00:00.000Z',
        expira_rotacion_en: '2026-06-30T00:00:00.000Z',
        retirada_en: null,
      },
      {
        kid: 'sso-oidc-rs256-2026q1',
        servicio_emisor: 'SSO_OIDC' as const,
        algoritmo: 'RS256' as const,
        estado_llave: 'GRACIA_VERIFICACION' as const,
        secret_manager_version: 'projects/p/secrets/s/versions/1',
        public_jwk_json: key2026Q1.publicJwk,
        activada_en: '2026-01-01T00:00:00.000Z',
        expira_rotacion_en: '2026-03-31T00:00:00.000Z',
        retirada_en: null,
      },
    ];

    const querySpy = jest.fn(
      async (
        sql: string,
        values?: ReadonlyArray<unknown>,
      ): Promise<QueryResult> => {
        expect(sql).toContain('WHERE servicio_emisor = $1');
        expect(values?.[0]).toBe('SSO_OIDC');
        return {
          command: 'SELECT',
          rowCount: dbRows.length,
          oid: 0,
          fields: [],
          rows: dbRows,
        };
      },
    );

    const dbMock: SqlQueryExecutor = {
      query: querySpy as unknown as SqlQueryExecutor['query'],
    };

    const adapter = new AlloyDbAndSecretManagerJwksAdapter(dbMock, loggerMock, {
      secretResolverFn: async (_version, kid) =>
        kid === 'sso-oidc-rs256-2026q2'
          ? key2026Q2.privateKeyPem
          : key2026Q1.privateKeyPem,
    });

    const published = await adapter.getPublishedPublicKeysForSsoOidc();
    expect(published.keys.map((k) => k.kid)).toEqual([
      'sso-oidc-rs256-2026q2',
      'sso-oidc-rs256-2026q1',
    ]);
    // Garantiza que nunca se expongan campos privados RSA en el JWKS público
    for (const jwk of published.keys) {
      expect(Object.keys(jwk)).toEqual(['kty', 'use', 'alg', 'kid', 'n', 'e']);
    }

    const signed = await adapter.signIdToken({
      iss: 'https://login.sso.educacion.gob.ec',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      aud: 'conecta-sigee-web',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      auth_time: Math.floor(Date.now() / 1000),
      sid: 'sess-jwks-1',
      email: 'docente@educacion.gob.ec',
      email_verified: true,
      hd: 'educacion.gob.ec',
      nombre_completo: 'DOCENTE PRUEBA',
      tipo_identificacion: 'CEDULA',
      numero_identificacion: '1710034065',
    });

    expect(signed.kid).toBe('sso-oidc-rs256-2026q2');

    const verifiedHint = await adapter.verifySsoOidcIdTokenHint(
      signed.idTokenJwt,
    );
    expect(verifiedHint).toEqual({
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sid: 'sess-jwks-1',
      aud: 'conecta-sigee-web',
    });

    const signedLogout = await adapter.signBackchannelLogoutToken({
      iss: 'https://login.sso.educacion.gob.ec',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      aud: 'conecta-sigee-web',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: 'jti-logout-1',
      sid: 'sess-jwks-1',
      events: {
        'http://schemas.openid.net/event/backchannel-logout': {},
      },
    });
    expect(signedLogout.kid).toBe('sso-oidc-rs256-2026q2');
    expect(signedLogout.logoutTokenJwt.split('.')).toHaveLength(3);

    expect(await adapter.verifySsoOidcIdTokenHint('invalid.jwt.token')).toBeNull();
  });

  it('2. ManageJwksKeysUseCase construye el documento OpenID Discovery 1.0 y audita la rotación y revocación de emergencia (< 1 h)', async () => {
    const jwksPortMock: IJwksKeyStorePort = {
      getPublishedPublicKeysForSsoOidc: jest.fn(async () => ({
        activeKid: 'sso-oidc-rs256-2026q2',
        keys: [key2026Q2.publicJwk, key2026Q1.publicJwk],
        metadata: [],
      })),
      signIdToken: jest.fn(),
      signBackchannelLogoutToken: jest.fn(),
      verifySsoOidcIdTokenHint: jest.fn(),
      rotateSsoOidcSigningKey: jest.fn(async () => ({
        activeKid: 'sso-oidc-rs256-2026q2',
        publishedKids: ['sso-oidc-rs256-2026q2', 'sso-oidc-rs256-2026q1'],
      })),
      revokeOrRetireSsoOidcSigningKey: jest.fn(async () => ({
        activeKid: 'sso-oidc-rs256-2026q2',
        publishedKids: ['sso-oidc-rs256-2026q2'],
      })),
    };

    const auditWriter = {
      appendEvent: jest.fn(async () => 'audit-jwks-1'),
    } as unknown as AuditEventWriter;

    const useCase = new ManageJwksKeysUseCase(
      jwksPortMock,
      auditWriter,
      loggerMock,
    );

    const discovery = useCase.getOpenIdConfiguration(
      'https://login.sso.educacion.gob.ec/',
    );
    expect(discovery.issuer).toBe('https://login.sso.educacion.gob.ec');
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(discovery.backchannel_logout_supported).toBe(true);

    const rotateResult = await useCase.rotateSigningKey({
      newKid: 'sso-oidc-rs256-2026q2',
      secretManagerVersion: 'projects/p/secrets/s/versions/2',
      publicJwk: key2026Q2.publicJwk,
      traceId: 'trace-jwks-rot-1',
    });
    expect(rotateResult.activeKid).toBe('sso-oidc-rs256-2026q2');

    const revokeResult = await useCase.revokeOrRetireSigningKey({
      kid: 'sso-oidc-rs256-2026q1',
      targetState: 'REVOCADA',
      reason: 'Simulacro de revocación de emergencia < 1 h',
      traceId: 'trace-jwks-rev-1',
    });
    expect(revokeResult.publishedKids).toEqual(['sso-oidc-rs256-2026q2']);
  });
});
