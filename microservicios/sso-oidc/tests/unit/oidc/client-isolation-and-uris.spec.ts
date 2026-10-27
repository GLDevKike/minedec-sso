import {
  InMemoryRedisCacheClient,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import { ClienteOidc } from '../../../src/domain/entities/oidc-broker.entities';
import {
  ConstantTimeClientSecretVerifier,
  ExactRedirectUriValidator,
  OAuthTokenProtocolError,
  OidcSecurityError,
} from '../../../src/domain/services/oidc-security.services';
import {
  createOidcErrorHandlerMiddleware,
  oidcPathNormalizationGuard,
} from '../../../src/infrastructure/http/middlewares/oidc-error-handler.middleware';
import { AlloyDbOidcClientRepository } from '../../../src/infrastructure/persistence/alloydb-oidc-client.repository';
import { Request, Response } from 'express';
import { QueryResult } from 'pg';
import { z } from 'zod';

function buildConfidentialClient(overrides?: Partial<ClienteOidc>): ClienteOidc {
  const verifier = new ConstantTimeClientSecretVerifier();
  return {
    clienteOidcId: '11111111-1111-4111-8111-111111111111',
    aplicacionId: '22222222-2222-4222-8222-222222222222',
    oidcClientId: 'conecta-pep-apigee',
    secretoActivoHash: verifier.computeSha256Hex('secreto-activo-2026-vigente'),
    secretoAnteriorHash: verifier.computeSha256Hex('secreto-anterior-en-gracia'),
    graciaHasta: new Date(Date.now() + 3_600_000),
    expiraRotacionEn: new Date(Date.now() + 86_400_000 * 30),
    metodoAutenticacionToken: 'client_secret_basic',
    estadoCliente: 'EN_ROTACION_GRACIA',
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    actualizadoEn: new Date('2026-01-01T00:00:00Z'),
    aplicacion: {
      aplicacionId: '22222222-2222-4222-8222-222222222222',
      codigoUnico: 'APIGEE_PEP',
      nombreVisible: 'PEP Perimetral Apigee X',
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
      {
        redirectUriId: '44444444-4444-4444-8444-444444444444',
        clienteOidcId: '11111111-1111-4111-8111-111111111111',
        tipoUri: 'POST_LOGOUT',
        uri: 'https://portal.educacion.gob.ec/logout-complete',
        activo: true,
        creadoEn: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    ...overrides,
  };
}

describe('T024 - Pruebas unitarias de aislamiento por client_id, redirect_uris exactos y ventana de gracia de secretos (US2)', () => {
  const redirectValidator = new ExactRedirectUriValidator();
  const secretVerifier = new ConstantTimeClientSecretVerifier();

  describe('1. ExactRedirectUriValidator (FR-002, Prevención de Open Redirect)', () => {
    it('acepta únicamente coincidencia exacta de esquema, host, puerto y ruta y rechaza variaciones o comodines', () => {
      const client = buildConfidentialClient();

      expect(
        redirectValidator.assertExactRedirectUriRegistered(
          client,
          'https://portal.educacion.gob.ec/oauth2/callback',
          'LOGIN_CALLBACK',
        ),
      ).toBe('https://portal.educacion.gob.ec/oauth2/callback');

      // Subruta no registrada
      expect(() =>
        redirectValidator.assertExactRedirectUriRegistered(
          client,
          'https://portal.educacion.gob.ec/oauth2/callback/extra',
          'LOGIN_CALLBACK',
        ),
      ).toThrow(OidcSecurityError);

      // Query string inyectado no registrado
      expect(() =>
        redirectValidator.assertExactRedirectUriRegistered(
          client,
          'https://portal.educacion.gob.ec/oauth2/callback?evil=1',
          'LOGIN_CALLBACK',
        ),
      ).toThrow(OidcSecurityError);

      // Esquema HTTP inseguro en host no local
      expect(() =>
        redirectValidator.assertExactRedirectUriRegistered(
          client,
          'http://portal.educacion.gob.ec/oauth2/callback',
          'LOGIN_CALLBACK',
        ),
      ).toThrow(OidcSecurityError);
    });

    it('rechaza clientes OIDC revocados o aplicaciones suspendidas/despublicadas', () => {
      const revokedClient = buildConfidentialClient({
        estadoCliente: 'REVOCADO',
      });
      expect(() =>
        redirectValidator.validateClientLifecycle(
          revokedClient,
          'conecta-pep-apigee',
        ),
      ).toThrow(OidcSecurityError);

      const suspendedAppClient = buildConfidentialClient({
        aplicacion: {
          aplicacionId: '22222222-2222-4222-8222-222222222222',
          codigoUnico: 'APIGEE_PEP',
          nombreVisible: 'PEP Perimetral Apigee X',
          patronIntegracion: 'PATRON_2_PEP_PERIMETRAL',
          hostPublico: 'https://portal.educacion.gob.ec',
          estadoCicloVida: 'SUSPENDIDO',
        },
      });
      expect(() =>
        redirectValidator.validateClientLifecycle(
          suspendedAppClient,
          'conecta-pep-apigee',
        ),
      ).toThrow(OidcSecurityError);
    });
  });

  describe('2. ConstantTimeClientSecretVerifier (FR-007, Rotación dual <= 90 días con timingSafeEqual)', () => {
    it('acepta tanto el secreto activo como el secreto anterior dentro de gracia_hasta y rechaza el secreto anterior cuando expira la ventana', () => {
      const client = buildConfidentialClient();

      expect(() =>
        secretVerifier.verifyClientAuthentication({
          cliente: client,
          providedClientSecret: 'secreto-activo-2026-vigente',
          authMethodUsed: 'client_secret_basic',
        }),
      ).not.toThrow();

      expect(() =>
        secretVerifier.verifyClientAuthentication({
          cliente: client,
          providedClientSecret: 'secreto-anterior-en-gracia',
          authMethodUsed: 'client_secret_basic',
        }),
      ).not.toThrow();

      // Fuera de la ventana de gracia
      const expiredGraceClient = buildConfidentialClient({
        graciaHasta: new Date(Date.now() - 60_000),
      });
      expect(() =>
        secretVerifier.verifyClientAuthentication({
          cliente: expiredGraceClient,
          providedClientSecret: 'secreto-anterior-en-gracia',
          authMethodUsed: 'client_secret_basic',
        }),
      ).toThrow(OAuthTokenProtocolError);

      // Secreto incorrecto
      expect(() =>
        secretVerifier.verifyClientAuthentication({
          cliente: client,
          providedClientSecret: 'secreto-invalido',
          authMethodUsed: 'client_secret_basic',
        }),
      ).toThrow(OAuthTokenProtocolError);
    });
  });

  describe('3. AlloyDbOidcClientRepository (Consultas parametrizadas + caché L2 Redis <= 300 s)', () => {
    it('hidrata el cliente OIDC y sus redirect_uris desde AlloyDB y utiliza la caché L2 en lecturas subsecuentes', async () => {
      const redis = new InMemoryRedisCacheClient();

      const querySpy = jest.fn(async (sql: string): Promise<QueryResult> => {
        if (sql.includes('FROM cliente_oidc c')) {
          return {
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
            rows: [
              {
                cliente_oidc_id: '11111111-1111-4111-8111-111111111111',
                aplicacion_id: '22222222-2222-4222-8222-222222222222',
                oidc_client_id: 'conecta-pep-apigee',
                secreto_activo_hash: secretVerifier.computeSha256Hex('sec-1'),
                secreto_anterior_hash: null,
                gracia_hasta: null,
                expira_rotacion_en: '2026-12-31T00:00:00.000Z',
                metodo_autenticacion_token: 'client_secret_basic',
                estado_cliente: 'ACTIVO',
                creado_en: '2026-01-01T00:00:00.000Z',
                actualizado_en: '2026-01-01T00:00:00.000Z',
                codigo_unico: 'APIGEE_PEP',
                nombre_visible: 'PEP Apigee',
                patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
                nivel_adopcion_pep: 'NIVEL_1_PERIMETRAL',
                host_publico: 'https://portal.educacion.gob.ec',
                estado_ciclo_vida: 'PUBLICADO',
              },
            ],
          };
        }
        if (sql.includes('FROM cliente_oidc_redirect_uri')) {
          return {
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
            rows: [
              {
                redirect_uri_id: '33333333-3333-4333-8333-333333333333',
                cliente_oidc_id: '11111111-1111-4111-8111-111111111111',
                tipo_uri: 'LOGIN_CALLBACK',
                uri: 'https://portal.educacion.gob.ec/oauth2/callback',
                activo: true,
                creado_en: '2026-01-01T00:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM dominio_institucional')) {
          return {
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
            rows: [{ activo: sql.includes('SELECT') }],
          };
        }
        return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
      });

      const dbMock: SqlQueryExecutor = {
        query: querySpy as unknown as SqlQueryExecutor['query'],
      };

      const repo = new AlloyDbOidcClientRepository(dbMock, redis);
      const firstRead = await repo.findByOidcClientId('conecta-pep-apigee');
      expect(firstRead?.oidcClientId).toBe('conecta-pep-apigee');
      expect(firstRead?.redirectUris).toHaveLength(1);
      expect(dbMock.query).toHaveBeenCalledTimes(2);

      // Segunda lectura debe venir desde Redis sin consultar AlloyDB
      const secondRead = await repo.findByOidcClientId('conecta-pep-apigee');
      expect(secondRead?.oidcClientId).toBe('conecta-pep-apigee');
      expect(dbMock.query).toHaveBeenCalledTimes(2);

      // Búsqueda múltiple, validación de dominio institucional e invalidación de caché
      const batchRead = await repo.findByOidcClientIds([
        'conecta-pep-apigee',
        'conecta-pep-apigee',
      ]);
      expect(batchRead).toHaveLength(1);

      expect(await repo.isInstitutionalDomainActive('')).toBe(false);
      expect(await repo.isInstitutionalDomainActive('EDUCACION.GOB.EC')).toBe(
        true,
      );
      expect(await repo.isInstitutionalDomainActive('educacion.gob.ec')).toBe(
        true,
      );

      await repo.invalidateClientCache('conecta-pep-apigee');
    });

    it('verifica oidcPathNormalizationGuard y createOidcErrorHandlerMiddleware (postura fail-close)', () => {
      const makeRes = () => {
        const headers: Record<string, string> = {};
        const res = {
          statusCode: 200,
          body: undefined as unknown,
          setHeader: jest.fn((k: string, v: string) => {
            headers[k] = v;
          }),
          status: jest.fn(function (this: { statusCode: number }, code: number) {
            this.statusCode = code;
            return this;
          }),
          json: jest.fn(function (this: { body: unknown }, payload: unknown) {
            this.body = payload;
            return this;
          }),
        };
        return res as unknown as Response & {
          statusCode: number;
          body: Record<string, unknown>;
        };
      };

      // Path normalization guard rechaza %2F y ..
      const blockedRes = makeRes();
      const nextSpy = jest.fn();
      oidcPathNormalizationGuard(
        {
          originalUrl: '/authorize%2f..',
          headers: { 'x-trace-id': 'trace-guard-1' },
        } as unknown as Request,
        blockedRes,
        nextSpy,
      );
      expect(blockedRes.statusCode).toBe(400);
      expect(nextSpy).not.toHaveBeenCalled();

      const errorMiddleware = createOidcErrorHandlerMiddleware({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as StructuredLogger);

      // 1. OAuthTokenProtocolError
      const oauthRes = makeRes();
      errorMiddleware(
        new OAuthTokenProtocolError({
          error: 'invalid_grant',
          errorDescription: 'Code expirado',
          statusCode: 400,
        }),
        { path: '/token', headers: {} } as unknown as Request,
        oauthRes,
        nextSpy,
      );
      expect(oauthRes.statusCode).toBe(400);
      expect(oauthRes.body.error).toBe('invalid_grant');

      // 1b. OidcSecurityError
      const secRes = makeRes();
      errorMiddleware(
        new OidcSecurityError({
          codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
          statusCode: 401,
          mensajeUsuario: 'Cliente no autorizado',
          reintentarPermitido: false,
          diagnosticoAdministrador: {
            queOcurrio: 'Cliente inválido',
            impactoOperativo: 'Bloqueo',
            accionRecomendada: 'Revise client_id',
          },
        }),
        { path: '/authorize', headers: {} } as unknown as Request,
        secRes,
        nextSpy,
      );
      expect(secRes.statusCode).toBe(401);
      expect(secRes.body.codigoError).toBe('CLIENTE_OIDC_NO_AUTORIZADO');

      // 2. ZodError en /token y en /authorize
      const schema = z.object({ code_challenge: z.string().min(43) });
      const zodResult = schema.safeParse({ code_challenge: 'short' });
      expect(zodResult.success).toBe(false);
      if (!zodResult.success) {
        const zodTokenRes = makeRes();
        errorMiddleware(
          zodResult.error,
          { path: '/token', method: 'POST', headers: {} } as unknown as Request,
          zodTokenRes,
          nextSpy,
        );
        expect(zodTokenRes.statusCode).toBe(400);
        expect(zodTokenRes.body.error).toBe('invalid_request');

        const zodAuthRes = makeRes();
        errorMiddleware(
          zodResult.error,
          {
            path: '/authorize',
            method: 'GET',
            headers: {},
          } as unknown as Request,
          zodAuthRes,
          nextSpy,
        );
        expect(zodAuthRes.statusCode).toBe(400);
        expect(zodAuthRes.body.codigoError).toBe('PKCE_S256_OBLIGATORIO');
      }

      // 3. Error inesperado -> HTTP 503 DEPENDENCIA_CRITICA_NO_DISPONIBLE (fail-close)
      const failCloseRes = makeRes();
      errorMiddleware(
        new Error('ECONNREFUSED AlloyDB 5432'),
        { path: '/authorize', method: 'GET', headers: {} } as unknown as Request,
        failCloseRes,
        nextSpy,
      );
      expect(failCloseRes.statusCode).toBe(503);
      expect(failCloseRes.body.codigoError).toBe(
        'DEPENDENCIA_CRITICA_NO_DISPONIBLE',
      );
    });
  });
});
