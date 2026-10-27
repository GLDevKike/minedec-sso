/**
 * Pruebas de Integración (`Supertest`) — Evaluación en Modo Sombra (`Shadow Mode`) (`T036`).
 *
 * Cubre:
 * - Cuando `aplicacion.modo_sombra = true` o `ruta_catalogo.modo_sombra = true` y la política RBAC/ABAC deniega el acceso (`AUTHZ_DENIED_POLICY`), el PDP devuelve `200 OK` con `autorizado: true`, `codigo_decision: "AUTHZ_PERMITTED_SHADOW_MODE"` y `metadatos_depuracion.decision_proyectada: "AUTHZ_DENIED_POLICY"`.
 * - Registra evento de auditoría de streaming `PDP_EVALUACION_SHADOW_PERMIT`.
 * - Verifica que un usuario suspendido (`AUTHZ_USER_SUSPENDED`) NUNCA sea permitido ni siquiera en Modo Sombra.
 */

import crypto from 'node:crypto';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import {
  ApplicationPolicyBundle,
  IdentityAuthorizationContext,
} from '../../src/domain/entities/pdp-domain.entities';
import { PdpEvaluationAuditRecord } from '../../src/domain/ports/pdp.ports';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val, 'utf8').digest('hex');
}

describe('Shadow Mode Evaluation — Integration Tests (T036)', () => {
  const streamingAuditEvents: PdpEvaluationAuditRecord[] = [];
  let appShadowMode = false;
  let routeShadowMode = true;
  let userSuspended = false;

  const buildBundle = (): ApplicationPolicyBundle => ({
    aplicacion_id: '11111111-1111-4111-8111-111111111111',
    codigo_unico: 'APP_SHADOW_TEST',
    nombre_visible: 'App Shadow Test',
    patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
    nivel_adopcion_pep: 'INTEGRADA',
    host_publico: 'shadow.educacion.gob.ec',
    politica_ruta_defecto: 'PROTEGIDA',
    modo_sombra: appShadowMode,
    estado_ciclo_vida: 'PUBLICADO',
    version_catalogo: 1,
    rutas_ordenadas: [
      {
        ruta_id: 'r-shadow-1',
        aplicacion_id: '11111111-1111-4111-8111-111111111111',
        patron_ruta: '/api/nomina/aprobar',
        metodo_http: 'POST',
        tipo_coincidencia: 'EXACTA',
        nivel_acceso: 'PROTEGIDA',
        modo_evaluacion_permisos: 'ALL',
        orden_especificidad: 100,
        modo_sombra: routeShadowMode,
        activo: true,
        permisos_requeridos: [
          {
            permiso_id: 'p-nomina',
            codigo_permiso: 'NOMINA_APROBAR',
            accion_crud_requerida: 'CREAR',
          },
        ],
      },
    ],
    grupos_logicos: [],
    roles_mapa: {},
    perfiles_mapa: {},
    rol_id_a_codigo: {},
    perfil_id_a_codigo: {},
  });

  const buildIdentity = (): IdentityAuthorizationContext => ({
    id_interno: '22222222-2222-4222-8222-222222222222',
    cuenta_id: '33333333-3333-4333-8333-333333333333',
    google_sub_id: 'sub-shadow-1',
    email_principal: 'analista@educacion.gob.ec',
    dominio: 'educacion.gob.ec',
    org_unit_path: '/Administrativos',
    tipo_identificacion: 'CEDULA',
    numero_identificacion: '1710034065',
    nombre_completo: 'Analista sin rol de nómina',
    estado_persona: 'ACTIVA',
    suspended_en_gws: userSuspended,
    estado_sincronizacion: userSuspended ? 'SUSPENDIDA_GWS' : 'SINCRONIZADA',
    tipo_usuario: 'ADMINISTRATIVO',
    subtipo_usuario: null,
    cargo_funcion: null,
    grado_curso: null,
    nivel_academico_derivado: null,
    docente_multisede: false,
    fecha_inicio_vigencia: '2024-01-01',
    fecha_fin_vigencia: '2099-12-31',
    asignaciones_contexto: [],
    asignaciones_directas_app: [],
    anomalias_activas: [],
  });

  const app = createMotorPdpApp({
    m2mCredentialRepo: {
      findByClientId: async () => ({
        credencial_id: 'c-pep',
        aplicacion_id: null,
        tipo_cliente: 'PEP_PATRON_2',
        client_id: 'pep-client',
        secreto_activo_hash: sha256('pep-secret'),
        secreto_anterior_hash: null,
        gracia_hasta: null,
        expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
        scopes_permitidos: 'pdp:evaluate',
        estado_credencial: 'ACTIVA',
      }),
    },
    policyBundleRepo: {
      findPolicyBundle: async () => buildBundle(),
    },
    identityRepo: {
      findAuthorizationContextByEmail: async () => buildIdentity(),
    },
    auditPort: {
      emitStreamingEvaluationEvent: (rec) => {
        streamingAuditEvents.push(rec);
      },
      recordTransactionalSecurityEvent: async () => {},
    },
  });

  let bearerToken = '';

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'pep-client',
        client_secret: 'pep-secret',
      })
      .expect(200);
    bearerToken = res.body.access_token;
  });

  beforeEach(async () => {
    streamingAuditEvents.length = 0;
    appShadowMode = false;
    routeShadowMode = true;
    userSuspended = false;
    await request(app)
      .post('/internal/v1/pdp/cache/invalidate')
      .send({ tipo_evento: 'PUBSUB_EMERGENCY_FLUSH_ALL' });
  });

  it('permite el paso con AUTHZ_PERMITTED_SHADOW_MODE y proyecta AUTHZ_DENIED_POLICY cuando la ruta tiene modo_sombra = true', async () => {
    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'analista@educacion.gob.ec',
        codigo_aplicacion: 'APP_SHADOW_TEST',
        ruta_solicitada: '/api/nomina/aprobar',
        metodo_http: 'POST',
      })
      .expect(200);

    expect(res.body.autorizado).toBe(true);
    expect(res.body.codigo_decision).toBe('AUTHZ_PERMITTED_SHADOW_MODE');
    expect(res.body.metadatos_depuracion).toEqual({
      modo_sombra_activo: true,
      decision_proyectada: 'AUTHZ_DENIED_POLICY',
      reglas_evaluadas: expect.arrayContaining([
        'SHADOW_MODE_OVERRIDE:AUTHZ_DENIED_POLICY',
      ]),
    });

    expect(streamingAuditEvents).toHaveLength(1);
    expect(streamingAuditEvents[0]?.tipoEvento).toBe(
      'PDP_EVALUACION_SHADOW_PERMIT',
    );
    expect(streamingAuditEvents[0]?.decisionProyectada).toBe(
      'AUTHZ_DENIED_POLICY',
    );
    expect(streamingAuditEvents[0]?.modoSombra).toBe(true);
  });

  it('deniega con AUTHZ_USER_SUSPENDED incluso si modo_sombra = true en la aplicación y en la ruta', async () => {
    appShadowMode = true;
    routeShadowMode = true;
    userSuspended = true;

    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'analista@educacion.gob.ec',
        codigo_aplicacion: 'APP_SHADOW_TEST',
        ruta_solicitada: '/api/nomina/aprobar',
        metodo_http: 'POST',
      })
      .expect(200);

    expect(res.body.autorizado).toBe(false);
    expect(res.body.codigo_decision).toBe('AUTHZ_USER_SUSPENDED');
  });
});
