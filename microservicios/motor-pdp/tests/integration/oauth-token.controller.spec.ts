/**
 * Pruebas de Integración (`Supertest`) — `POST /api/v1/oauth/token` y Aislamiento de Alcance M2M (`T026`).
 *
 * Cubre:
 * - Autenticación vía `Authorization: Basic` y `application/x-www-form-urlencoded` / JSON.
 * - Cabeceras RFC 6749 (`Cache-Control: no-store`, `Pragma: no-cache`).
 * - Aislamiento de alcance: credencial `APLICACION_PATRON_1` de App A solo puede evaluar App A (`200 OK`) y recibe `403 FORBIDDEN_M2M_SCOPE` al intentar evaluar App B.
 * - Credencial `PEP_PATRON_2` puede evaluar tanto App A como App B.
 */

import crypto from 'node:crypto';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import {
  ApplicationPolicyBundle,
  M2mClientCredential,
} from '../../src/domain/entities/pdp-domain.entities';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function buildBundle(
  aplicacionId: string,
  codigoUnico: string,
): ApplicationPolicyBundle {
  return {
    aplicacion_id: aplicacionId,
    codigo_unico: codigoUnico,
    nombre_visible: `App ${codigoUnico}`,
    patron_integracion: 'PATRON_1_SP_RP',
    nivel_adopcion_pep: null,
    host_publico: `${codigoUnico.toLowerCase()}.educacion.gob.ec`,
    politica_ruta_defecto: 'PUBLICA',
    modo_sombra: false,
    estado_ciclo_vida: 'PUBLICADO',
    version_catalogo: 1,
    rutas_ordenadas: [],
    grupos_logicos: [],
    roles_mapa: {},
    perfiles_mapa: {},
    rol_id_a_codigo: {},
    perfil_id_a_codigo: {},
  };
}

describe('OAuthTokenController & M2M Scope Isolation — Integration Tests (T026)', () => {
  const APP_A_ID = 'aaaa1111-1111-4111-8111-111111111111';
  const APP_B_ID = 'bbbb2222-2222-4222-8222-222222222222';

  const credentials = new Map<string, M2mClientCredential>([
    [
      'client-app-a',
      {
        credencial_id: 'c-a',
        aplicacion_id: APP_A_ID,
        tipo_cliente: 'APLICACION_PATRON_1',
        client_id: 'client-app-a',
        secreto_activo_hash: sha256('secret-app-a-123456'),
        secreto_anterior_hash: null,
        gracia_hasta: null,
        expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
        scopes_permitidos: 'pdp:evaluate',
        estado_credencial: 'ACTIVA',
      },
    ],
    [
      'client-pep-global',
      {
        credencial_id: 'c-pep',
        aplicacion_id: null,
        tipo_cliente: 'PEP_PATRON_2',
        client_id: 'client-pep-global',
        secreto_activo_hash: sha256('secret-pep-global-123456'),
        secreto_anterior_hash: null,
        gracia_hasta: null,
        expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
        scopes_permitidos: 'pdp:evaluate',
        estado_credencial: 'ACTIVA',
      },
    ],
  ]);

  const bundles = new Map<string, ApplicationPolicyBundle>([
    ['APP_A', buildBundle(APP_A_ID, 'APP_A')],
    ['APP_B', buildBundle(APP_B_ID, 'APP_B')],
  ]);

  const app = createMotorPdpApp({
    m2mCredentialRepo: {
      findByClientId: async (clientId) => credentials.get(clientId) ?? null,
    },
    policyBundleRepo: {
      findPolicyBundle: async (lookup) => {
        if (lookup.codigo_unico) {
          return bundles.get(lookup.codigo_unico) ?? null;
        }
        return null;
      },
    },
    identityRepo: {
      findAuthorizationContextByEmail: async () => null,
    },
  });

  it('emite token M2M usando Authorization Basic + x-www-form-urlencoded con cabeceras RFC 6749', async () => {
    const basicHeader = Buffer.from(
      'client-app-a:secret-app-a-123456',
      'utf8',
    ).toString('base64');

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .set('Authorization', `Basic ${basicHeader}`)
      .type('form')
      .send({
        grant_type: 'client_credentials',
        scope: 'pdp:evaluate',
      })
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.access_token).toBeTruthy();
  });

  it('impide que un cliente APLICACION_PATRON_1 de APP_A evalúe políticas de APP_B (403 FORBIDDEN_M2M_SCOPE), mientras PEP_PATRON_2 puede evaluar ambas', async () => {
    const tokenAppARes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'client-app-a',
        client_secret: 'secret-app-a-123456',
      })
      .expect(200);

    const tokenPepRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'client-pep-global',
        client_secret: 'secret-pep-global-123456',
      })
      .expect(200);

    // 1. Cliente APP_A evaluando APP_A -> 200 OK
    await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${tokenAppARes.body.access_token}`)
      .send({
        codigo_aplicacion: 'APP_A',
        ruta_solicitada: '/inicio',
        metodo_http: 'GET',
      })
      .expect(200);

    // 2. Cliente APP_A intentando evaluar APP_B -> 403 FORBIDDEN_M2M_SCOPE
    const forbiddenRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${tokenAppARes.body.access_token}`)
      .send({
        codigo_aplicacion: 'APP_B',
        ruta_solicitada: '/inicio',
        metodo_http: 'GET',
      })
      .expect(403);

    expect(forbiddenRes.body.error).toBe('FORBIDDEN_M2M_SCOPE');

    // 3. Cliente PEP_PATRON_2 evaluando APP_B -> 200 OK
    await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${tokenPepRes.body.access_token}`)
      .send({
        codigo_aplicacion: 'APP_B',
        ruta_solicitada: '/inicio',
        metodo_http: 'GET',
      })
      .expect(200);
  });

  it('rechaza peticiones a /api/v1/access/evaluation sin token Bearer o con token adulterado (401)', async () => {
    await request(app)
      .post('/api/v1/access/evaluation')
      .send({
        codigo_aplicacion: 'APP_A',
        ruta_solicitada: '/inicio',
        metodo_http: 'GET',
      })
      .expect(401);

    await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', 'Bearer token.invalido.adulterado')
      .send({
        codigo_aplicacion: 'APP_A',
        ruta_solicitada: '/inicio',
        metodo_http: 'GET',
      })
      .expect(401);
  });
});
