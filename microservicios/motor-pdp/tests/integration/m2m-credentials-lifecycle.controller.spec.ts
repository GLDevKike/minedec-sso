/**
 * Pruebas de Integración (`Supertest`) — Ciclo de Vida Completo de Credenciales M2M (`005-autenticacion-m2m-rotacion`).
 *
 * Cubre:
 * - `POST /internal/v1/pdp/m2m/credentials` (aprovisionamiento Zero-Secret con hash SHA-256).
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/rotate` (rotación `<= 90 días` con ventana de gracia dual).
 * - `POST /api/v1/oauth/token` autenticando tanto con el secreto anterior (en ventana de gracia) como con el nuevo secreto activo.
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/expire-grace` (cierre de ventana de gracia: el secreto anterior es rechazado inmediatamente con `401 invalid_client`).
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/revoke` (revocación de emergencia `< 1 h`: invalida tanto `/api/v1/oauth/token` como cualquier Bearer token activo en `/api/v1/access/evaluation`).
 */

import crypto from 'node:crypto';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import {
  ApplicationPolicyBundle,
  M2mClientCredential,
} from '../../src/domain/entities/pdp-domain.entities';
import { PdpTransactionalSecurityAuditRecord } from '../../src/domain/ports/pdp.ports';

function buildAppBundle(
  aplicacionId: string,
  codigoUnico: string,
): ApplicationPolicyBundle {
  return {
    aplicacion_id: aplicacionId,
    codigo_unico: codigoUnico,
    nombre_visible: `Aplicación ${codigoUnico}`,
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

describe('M2mCredentialsController & Dual-Secret Grace Window — Integration Tests (005)', () => {
  const APP_SIGA_ID = 'aaaa1111-2222-4333-8444-555555555555';
  const credentials = new Map<string, M2mClientCredential>();
  const securityAudits: PdpTransactionalSecurityAuditRecord[] = [];

  const app = createMotorPdpApp({
    m2mCredentialRepo: {
      findByClientId: async (clientId: string) =>
        credentials.get(clientId) ?? null,
      createCredential: async (input) => {
        if (credentials.has(input.clientId)) {
          throw new Error('duplicate key value violates unique constraint');
        }
        const expDays = input.expiresInDays ?? 90;
        const record: M2mClientCredential = {
          credencial_id: input.credencialId ?? crypto.randomUUID(),
          aplicacion_id: input.aplicacionId,
          tipo_cliente: input.tipoCliente,
          client_id: input.clientId,
          secreto_activo_hash: input.secretoActivoHash,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          expira_rotacion_en: new Date(
            Date.now() + expDays * 24 * 60 * 60 * 1000,
          ),
          scopes_permitidos: input.scopesPermitidos ?? 'pdp:evaluate',
          estado_credencial: 'ACTIVA',
        };
        credentials.set(input.clientId, record);
        return record;
      },
      rotateCredentialSecret: async (input) => {
        const current = credentials.get(input.clientId);
        if (!current || current.estado_credencial === 'REVOCADA') {
          return null;
        }
        const graceSeconds = input.graceWindowSeconds ?? 86400;
        const expDays = input.expiresInDays ?? 90;
        const updated: M2mClientCredential = {
          ...current,
          secreto_anterior_hash: current.secreto_activo_hash,
          secreto_activo_hash: input.nuevoSecretoHash,
          gracia_hasta: new Date(Date.now() + graceSeconds * 1000),
          expira_rotacion_en: new Date(
            Date.now() + expDays * 24 * 60 * 60 * 1000,
          ),
          estado_credencial: 'EN_ROTACION_GRACIA',
        };
        credentials.set(input.clientId, updated);
        return updated;
      },
      expireGraceWindow: async (clientId: string) => {
        const current = credentials.get(clientId);
        if (!current || current.estado_credencial === 'REVOCADA') {
          return null;
        }
        const updated: M2mClientCredential = {
          ...current,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          estado_credencial: 'ACTIVA',
        };
        credentials.set(clientId, updated);
        return updated;
      },
      revokeCredentialEmergency: async (clientId: string) => {
        const current = credentials.get(clientId);
        if (!current) {
          return null;
        }
        const updated: M2mClientCredential = {
          ...current,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          estado_credencial: 'REVOCADA',
        };
        credentials.set(clientId, updated);
        return updated;
      },
    },
    policyBundleRepo: {
      findPolicyBundle: async (lookup) => {
        if (lookup.codigo_unico === 'SIGA_WEB') {
          return buildAppBundle(APP_SIGA_ID, 'SIGA_WEB');
        }
        return null;
      },
    },
    identityRepo: {
      findAuthorizationContextByEmail: async () => null,
    },
    auditPort: {
      emitStreamingEvaluationEvent: () => undefined,
      recordTransactionalSecurityEvent: async (event) => {
        securityAudits.push(event);
      },
    },
  });

  it('ejecuta el flujo extremo a extremo: aprovisionamiento -> rotación dual -> uso en gracia -> cierre de gracia -> revocación de emergencia', async () => {
    // 1. Aprovisionar credencial M2M inicial para SIGA_WEB
    const provisionRes = await request(app)
      .post('/internal/v1/pdp/m2m/credentials')
      .send({
        client_id: 'siga-web-m2m',
        tipo_cliente: 'APLICACION_PATRON_1',
        aplicacion_id: APP_SIGA_ID,
        scopes_permitidos: 'pdp:evaluate',
        expires_in_days: 90,
      })
      .expect(201);

    const initialSecret: string = provisionRes.body.client_secret_unica_vez;
    expect(initialSecret).toMatch(/^m2m_sec_/);
    expect(provisionRes.body.estado_credencial).toBe('ACTIVA');

    // 2. Emitir token con el secreto inicial
    const tokenInitialRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: initialSecret,
      })
      .expect(200);

    expect(tokenInitialRes.body.access_token).toBeTruthy();

    // 3. Rotar el secreto con ventana de gracia de 24 horas (86400 s)
    const rotateRes = await request(app)
      .post('/internal/v1/pdp/m2m/credentials/siga-web-m2m/rotate')
      .send({
        grace_window_seconds: 86400,
        expires_in_days: 90,
      })
      .expect(200);

    const rotatedSecret: string = rotateRes.body.client_secret_unica_vez;
    expect(rotatedSecret).toMatch(/^m2m_sec_/);
    expect(rotatedSecret).not.toBe(initialSecret);
    expect(rotateRes.body.estado_credencial).toBe('EN_ROTACION_GRACIA');

    // 4. Durante la ventana de gracia, TANTO el secreto anterior COMO el nuevo secreto emiten token M2M
    const tokenWithOldSecretInGrace = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: initialSecret,
      })
      .expect(200);

    expect(tokenWithOldSecretInGrace.body.access_token).toBeTruthy();
    expect(
      securityAudits.some(
        (e) =>
          e.tipoEvento === 'PDP_TOKEN_M2M_EMITIDO' &&
          e.valoresNuevos?.used_grace_secret === true,
      ),
    ).toBe(true);

    const tokenWithNewSecret = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: rotatedSecret,
      })
      .expect(200);

    const activeAccessToken: string = tokenWithNewSecret.body.access_token;
    expect(activeAccessToken).toBeTruthy();

    // 5. Expirar la ventana de gracia -> el secreto anterior falla con 401 y el nuevo sigue funcionando
    const expireGraceRes = await request(app)
      .post('/internal/v1/pdp/m2m/credentials/siga-web-m2m/expire-grace')
      .expect(200);

    expect(expireGraceRes.body.estado_credencial).toBe('ACTIVA');

    await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: initialSecret,
      })
      .expect(401);

    await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: rotatedSecret,
      })
      .expect(200);

    // 6. Verificar que el Bearer token actual puede evaluar SIGA_WEB antes de la revocación
    await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${activeAccessToken}`)
      .send({
        codigo_aplicacion: 'SIGA_WEB',
        ruta_solicitada: '/salud',
        metodo_http: 'GET',
      })
      .expect(200);

    // 7. Revocar de emergencia la credencial M2M (< 1 h)
    const revokeRes = await request(app)
      .post('/internal/v1/pdp/m2m/credentials/siga-web-m2m/revoke')
      .send({})
      .expect(200);

    expect(revokeRes.body).toMatchObject({
      revoked: true,
      client_id: 'siga-web-m2m',
      estado_credencial: 'REVOCADA',
    });

    // 8. Ni /api/v1/oauth/token ni el Bearer token ya emitido pueden volver a operar (401 inmediato)
    await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'siga-web-m2m',
        client_secret: rotatedSecret,
      })
      .expect(401);

    const rejectedEvalRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${activeAccessToken}`)
      .send({
        codigo_aplicacion: 'SIGA_WEB',
        ruta_solicitada: '/salud',
        metodo_http: 'GET',
      })
      .expect(401);

    expect(rejectedEvalRes.body.error).toBe('invalid_client');
  });
});
