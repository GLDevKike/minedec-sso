import crypto from 'crypto';

import {
  AuditEventWriter,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import { createSsoOidcApp } from '../../../src';
import {
  EstadoLlaveJwks,
  PublicRsaJwk,
} from '../../../src/domain/entities/oidc-broker.entities';
import { AlloyDbAndSecretManagerJwksAdapter } from '../../../src/infrastructure/crypto/alloydb-secretmanager-jwks.adapter';
import { QueryResult } from 'pg';
import request from 'supertest';

function createRsaKeyFixture(kid: string): {
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

describe('T039 - Pruebas de integración HTTP de descubrimiento OIDC (/.well-known/openid-configuration), publicación /jwks, rotación dual y revocación de emergencia < 1 h (US5, FR-009)', () => {
  const keyV1 = createRsaKeyFixture('sso-oidc-rs256-v1');
  const keyV2 = createRsaKeyFixture('sso-oidc-rs256-v2');

  it('publica metadatos OpenID Discovery 1.0 y JWKS público, rota llaves RS256 manteniendo la anterior en gracia y retira de inmediato una llave revocada por emergencia', async () => {
    interface InMemoryJwksRow {
      kid: string;
      servicio_emisor: 'SSO_OIDC' | 'MOTOR_PDP';
      algoritmo: 'RS256';
      estado_llave: EstadoLlaveJwks;
      secret_manager_version: string;
      public_jwk_json: PublicRsaJwk;
      activada_en: string;
      expira_rotacion_en: string;
      retirada_en: string | null;
    }

    const jwksTable: InMemoryJwksRow[] = [
      {
        kid: 'sso-oidc-rs256-v1',
        servicio_emisor: 'SSO_OIDC',
        algoritmo: 'RS256',
        estado_llave: 'ACTIVA_FIRMA',
        secret_manager_version:
          'projects/mec-sso/secrets/sso-oidc-jwks/versions/1',
        public_jwk_json: keyV1.publicJwk,
        activada_en: '2026-01-01T00:00:00.000Z',
        expira_rotacion_en: '2026-03-31T00:00:00.000Z',
        retirada_en: null,
      },
      // Llave de MOTOR_PDP que NUNCA debe aparecer en el /jwks de sso-oidc
      {
        kid: 'motor-pdp-rs256-v1',
        servicio_emisor: 'MOTOR_PDP',
        algoritmo: 'RS256',
        estado_llave: 'ACTIVA_FIRMA',
        secret_manager_version:
          'projects/mec-sso/secrets/motor-pdp-jwks/versions/1',
        public_jwk_json: {
          ...keyV1.publicJwk,
          kid: 'motor-pdp-rs256-v1',
        },
        activada_en: '2026-01-01T00:00:00.000Z',
        expira_rotacion_en: '2026-03-31T00:00:00.000Z',
        retirada_en: null,
      },
    ];

    const executeQuery = async (
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<QueryResult> => {
      if (
        sql.includes('SELECT') &&
        sql.includes('llave_jwks_rotacion') &&
        sql.includes('WHERE servicio_emisor = $1')
      ) {
        const emisor = params?.[0] as string;
        const published = jwksTable.filter(
          (r) =>
            r.servicio_emisor === emisor &&
            (r.estado_llave === 'ACTIVA_FIRMA' ||
              r.estado_llave === 'GRACIA_VERIFICACION'),
        );
        return {
          command: 'SELECT',
          rowCount: published.length,
          oid: 0,
          fields: [],
          rows: published,
        };
      }

      if (
        sql.includes("SET estado_llave = 'GRACIA_VERIFICACION'") &&
        sql.includes('WHERE servicio_emisor = $1')
      ) {
        const [emisor, excludedKid] = params as [string, string];
        for (const row of jwksTable) {
          if (
            row.servicio_emisor === emisor &&
            row.estado_llave === 'ACTIVA_FIRMA' &&
            row.kid !== excludedKid
          ) {
            row.estado_llave = 'GRACIA_VERIFICACION';
          }
        }
        return { command: 'UPDATE', rowCount: 1, oid: 0, fields: [], rows: [] };
      }

      if (sql.includes('INSERT INTO') && sql.includes('llave_jwks_rotacion')) {
        const [kid, servicioEmisor, smVersion, jwkJson] = params as [
          string,
          'SSO_OIDC' | 'MOTOR_PDP',
          string,
          string,
        ];
        const parsedJwk = JSON.parse(jwkJson) as PublicRsaJwk;
        const existingIdx = jwksTable.findIndex((r) => r.kid === kid);
        const newRow: InMemoryJwksRow = {
          kid,
          servicio_emisor: servicioEmisor,
          algoritmo: 'RS256',
          estado_llave: 'ACTIVA_FIRMA',
          secret_manager_version: smVersion,
          public_jwk_json: parsedJwk,
          activada_en: new Date().toISOString(),
          expira_rotacion_en: new Date(
            Date.now() + 86_400_000 * 90,
          ).toISOString(),
          retirada_en: null,
        };
        if (existingIdx >= 0) {
          jwksTable[existingIdx] = newRow;
        } else {
          jwksTable.unshift(newRow);
        }
        return { command: 'INSERT', rowCount: 1, oid: 0, fields: [], rows: [] };
      }

      if (
        sql.includes('UPDATE') &&
        sql.includes('llave_jwks_rotacion') &&
        sql.includes('WHERE kid = $2')
      ) {
        const [targetState, kid, emisor] = params as [
          EstadoLlaveJwks,
          string,
          string,
        ];
        const target = jwksTable.find(
          (r) => r.kid === kid && r.servicio_emisor === emisor,
        );
        if (!target) {
          return { command: 'UPDATE', rowCount: 0, oid: 0, fields: [], rows: [] };
        }
        target.estado_llave = targetState;
        target.retirada_en = new Date().toISOString();
        return { command: 'UPDATE', rowCount: 1, oid: 0, fields: [], rows: [] };
      }

      return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
    };

    const dbMock: SqlQueryExecutor = {
      query: executeQuery as unknown as SqlQueryExecutor['query'],
    };

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as StructuredLogger;

    const jwksKeyStore = new AlloyDbAndSecretManagerJwksAdapter(dbMock, logger, {
      secretResolverFn: async (_version, kid) =>
        kid === 'sso-oidc-rs256-v2'
          ? keyV2.privateKeyPem
          : keyV1.privateKeyPem,
    });

    const app = createSsoOidcApp({
      issuerUrl: 'https://login.sso.educacion.gob.ec',
      db: dbMock,
      jwksKeyStore,
      auditWriter: {
        appendEvent: async () => 'audit-jwks-int-1',
      } as unknown as AuditEventWriter,
      logger,
    });

    // 1. Verificar GET /.well-known/openid-configuration
    const discoveryRes = await request(app).get(
      '/.well-known/openid-configuration',
    );
    expect(discoveryRes.status).toBe(200);
    expect(discoveryRes.body.issuer).toBe('https://login.sso.educacion.gob.ec');
    expect(discoveryRes.body.jwks_uri).toBe(
      'https://login.sso.educacion.gob.ec/jwks',
    );
    expect(discoveryRes.body.code_challenge_methods_supported).toEqual([
      'S256',
    ]);

    // 2. Verificar GET /jwks inicial (solo publica sso-oidc-rs256-v1, nunca motor-pdp-rs256-v1)
    const jwksRes1 = await request(app).get('/jwks');
    expect(jwksRes1.status).toBe(200);
    expect(jwksRes1.body.keys.map((k: PublicRsaJwk) => k.kid)).toEqual([
      'sso-oidc-rs256-v1',
    ]);

    // 3. Rotar a sso-oidc-rs256-v2 vía POST /internal/v1/oidc/jwks/rotate
    const rotateRes = await request(app)
      .post('/internal/v1/oidc/jwks/rotate')
      .send({
        newKid: 'sso-oidc-rs256-v2',
        secretManagerVersion:
          'projects/mec-sso/secrets/sso-oidc-jwks/versions/2',
        publicJwk: keyV2.publicJwk,
      });

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.status).toBe('ROTATED');
    expect(rotateRes.body.activeKid).toBe('sso-oidc-rs256-v2');
    expect(rotateRes.body.publishedKids).toEqual([
      'sso-oidc-rs256-v2',
      'sso-oidc-rs256-v1',
    ]);

    // 4. Revocar de emergencia la llave anterior v1 vía POST /internal/v1/oidc/jwks/:kid/revoke
    const revokeRes = await request(app)
      .post('/internal/v1/oidc/jwks/sso-oidc-rs256-v1/revoke')
      .send({
        targetState: 'REVOCADA',
        reason: 'Simulacro de compromiso de llave anterior (< 1 h)',
      });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.status).toBe('REVOCADA');
    expect(revokeRes.body.publishedKids).toEqual(['sso-oidc-rs256-v2']);

    // 5. Confirmar en GET /jwks que la llave revocada ya no se publica
    const jwksResAfterRevoke = await request(app).get('/jwks');
    expect(jwksResAfterRevoke.status).toBe(200);
    expect(
      jwksResAfterRevoke.body.keys.map((k: PublicRsaJwk) => k.kid),
    ).toEqual(['sso-oidc-rs256-v2']);
  });
});
