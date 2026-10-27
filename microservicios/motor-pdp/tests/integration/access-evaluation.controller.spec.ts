/**
 * Pruebas de Integración (`Supertest`) — `POST /api/v1/access/evaluation` (`T018`).
 *
 * Cubre:
 * - Evaluación de `PATRON_1_SP_RP` (solo `assertion_jwt`) y `PATRON_2_PEP_PERIMETRAL` (`assertion_jwt` + `cabeceras_inyectadas`).
 * - Verificación criptográfica `RS256` del `assertion_jwt` contra `/api/v1/.well-known/jwks.json`, validando `iss`, `aud` exclusivo por aplicación, `sub` (`id_interno`), `roles`, `permisos`, `permisos_crud` y `contexto_territorial`.
 * - Respuestas `200 OK` para `autorizado: true` (`AUTHZ_PERMITTED`, `AUTHZ_PUBLIC_ROUTE`, `AUTHZ_AUTHENTICATED_ROUTE`) y `autorizado: false` (`AUTHZ_DENIED_POLICY`, `AUTHZ_USER_SUSPENDED`, `AUTHZ_OUTSIDE_VALIDITY_WINDOW`).
 * - Respuesta `404 APPLICATION_NOT_FOUND` para aplicaciones inexistentes o en estado `BORRADOR`/`SUSPENDIDO`.
 * - Cumplimiento estricto de Cero Telemetría de Latencia en Node.js (ausencia de campos de duración/latencia).
 */

import * as jose from 'jose';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import {
  ApplicationPolicyBundle,
  IdentityAuthorizationContext,
} from '../../src/domain/entities/pdp-domain.entities';
import {
  IdentityAuthorizationRepositoryPort,
  PdpAuditPort,
  PolicyBundleRepositoryPort,
} from '../../src/domain/ports/pdp.ports';

function buildPublishedBundle(
  overrides: Partial<ApplicationPolicyBundle> = {},
): ApplicationPolicyBundle {
  return {
    aplicacion_id: '11111111-1111-4111-8111-111111111111',
    codigo_unico: 'GESTION_ESCOLAR',
    nombre_visible: 'Gestión Escolar MINEDEC',
    patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
    nivel_adopcion_pep: 'INTEGRADA',
    host_publico: 'gestion.educacion.gob.ec',
    politica_ruta_defecto: 'PROTEGIDA',
    modo_sombra: false,
    estado_ciclo_vida: 'PUBLICADO',
    version_catalogo: 5,
    rutas_ordenadas: [
      {
        ruta_id: 'r-pub',
        aplicacion_id: '11111111-1111-4111-8111-111111111111',
        patron_ruta: '/public/estado',
        metodo_http: 'GET',
        tipo_coincidencia: 'EXACTA',
        nivel_acceso: 'PUBLICA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 10,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
      {
        ruta_id: 'r-auth',
        aplicacion_id: '11111111-1111-4111-8111-111111111111',
        patron_ruta: '/mi-perfil',
        metodo_http: 'GET',
        tipo_coincidencia: 'EXACTA',
        nivel_acceso: 'AUTENTICADA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 20,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
      {
        ruta_id: 'r-prot',
        aplicacion_id: '11111111-1111-4111-8111-111111111111',
        patron_ruta: '/api/calificaciones/*',
        metodo_http: 'POST',
        tipo_coincidencia: 'PREFIJO',
        nivel_acceso: 'PROTEGIDA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 30,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [
          {
            permiso_id: 'perm-1',
            codigo_permiso: 'CALIFICACIONES_REGISTRAR',
            accion_crud_requerida: 'CREAR',
          },
        ],
      },
    ],
    grupos_logicos: [
      {
        grupo_logico_id: 'grp-1',
        codigo_grupo: 'GRP_DOCENTES_ACTIVOS',
        nombre_visible: 'Docentes Activos',
        prioridad_evaluacion: 10,
        activo: true,
        regla_cruce_abac_rbac: {
          op: 'EQ',
          field: 'tipo_usuario',
          value: 'DOCENTE',
        },
        roles_otorgados: ['ROL_DOCENTE'],
        perfiles_otorgados: [],
      },
    ],
    roles_mapa: {
      ROL_DOCENTE: [
        {
          permiso_id: 'perm-1',
          codigo_permiso: 'CALIFICACIONES_REGISTRAR',
          puede_crear: true,
          puede_leer: true,
          puede_editar: true,
          puede_eliminar: false,
        },
      ],
    },
    perfiles_mapa: {},
    rol_id_a_codigo: { 'rol-doc-1': 'ROL_DOCENTE' },
    perfil_id_a_codigo: {},
    ...overrides,
  };
}

function buildIdentityContext(
  overrides: Partial<IdentityAuthorizationContext> = {},
): IdentityAuthorizationContext {
  return {
    id_interno: '22222222-2222-4222-8222-222222222222',
    cuenta_id: '33333333-3333-4333-8333-333333333333',
    google_sub_id: 'sub-docente-1',
    email_principal: 'docente@educacion.gob.ec',
    dominio: 'educacion.gob.ec',
    org_unit_path: '/Docentes',
    tipo_identificacion: 'CEDULA',
    numero_identificacion: '1710034065',
    nombre_completo: 'Carlos Andrés Andrade',
    estado_persona: 'ACTIVA',
    suspended_en_gws: false,
    estado_sincronizacion: 'SINCRONIZADA',
    tipo_usuario: 'DOCENTE',
    subtipo_usuario: 'NOMBRAMIENTO',
    cargo_funcion: 'DOCENTE_AULA',
    grado_curso: '8VO_EGB',
    nivel_academico_derivado: 'EGB',
    docente_multisede: true,
    fecha_inicio_vigencia: '2024-01-01',
    fecha_fin_vigencia: '2099-12-31',
    asignaciones_contexto: [
      {
        asignacion_id: 'ctx-1',
        es_sede_primaria: true,
        nivel_estructura: 'INSTITUCION_EDUCATIVA',
        viceministerio: 'EDUCACION',
        codigo_zona: 'Z09',
        codigo_distrito: '17D05',
        codigo_circuito: '17D05C01',
        codigo_amie: '17H00123',
        codigo_dependencia_admin: null,
        regimen_escolar: 'SIERRA',
        modalidad_educativa: 'PRESENCIAL',
        jornada: 'MATUTINA',
        activo: true,
      },
      {
        asignacion_id: 'ctx-2',
        es_sede_primaria: false,
        nivel_estructura: 'INSTITUCION_EDUCATIVA',
        viceministerio: 'EDUCACION',
        codigo_zona: 'Z09',
        codigo_distrito: '17D05',
        codigo_circuito: '17D05C02',
        codigo_amie: '17H00456',
        codigo_dependencia_admin: null,
        regimen_escolar: 'SIERRA',
        modalidad_educativa: 'PRESENCIAL',
        jornada: 'VESPERTINA',
        activo: true,
      },
    ],
    asignaciones_directas_app: [],
    anomalias_activas: [],
    ...overrides,
  };
}

describe('AccessEvaluationController — Integration Tests (T018)', () => {
  const bundlesByCode = new Map<string, ApplicationPolicyBundle>();
  const identitiesByEmail = new Map<string, IdentityAuthorizationContext>();
  const streamingAuditRecords: unknown[] = [];

  const mockPolicyBundleRepo: PolicyBundleRepositoryPort = {
    findPolicyBundle: async (lookup) => {
      if (lookup.codigo_unico) {
        return bundlesByCode.get(lookup.codigo_unico) ?? null;
      }
      for (const b of bundlesByCode.values()) {
        if (
          (lookup.uuid_aplicacion &&
            b.aplicacion_id === lookup.uuid_aplicacion) ||
          (lookup.host_solicitado && b.host_publico === lookup.host_solicitado)
        ) {
          return b;
        }
      }
      return null;
    },
  };

  const mockIdentityRepo: IdentityAuthorizationRepositoryPort = {
    findAuthorizationContextByEmail: async (email) =>
      identitiesByEmail.get(email.toLowerCase()) ?? null,
  };

  const mockAuditPort: PdpAuditPort = {
    emitStreamingEvaluationEvent: (record) => {
      streamingAuditRecords.push(record);
    },
    recordTransactionalSecurityEvent: async () => {},
  };

  const app = createMotorPdpApp({
    policyBundleRepo: mockPolicyBundleRepo,
    identityRepo: mockIdentityRepo,
    auditPort: mockAuditPort,
    m2mCredentialRepo: {
      findByClientId: async (clientId) => {
        if (clientId === 'pep-apigee-gateway') {
          const crypto = await import('node:crypto');
          return {
            credencial_id: 'cred-pep-1',
            aplicacion_id: null,
            tipo_cliente: 'PEP_PATRON_2',
            client_id: 'pep-apigee-gateway',
            secreto_activo_hash: crypto
              .createHash('sha256')
              .update('pep-secret-value-123456')
              .digest('hex'),
            secreto_anterior_hash: null,
            gracia_hasta: null,
            expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
            scopes_permitidos: 'pdp:evaluate',
            estado_credencial: 'ACTIVA',
          };
        }
        return null;
      },
    },
  });

  let pepBearerToken = '';

  beforeAll(async () => {
    const tokenRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'pep-apigee-gateway',
        client_secret: 'pep-secret-value-123456',
        scope: 'pdp:evaluate',
      })
      .expect(200);

    pepBearerToken = tokenRes.body.access_token;
  });

  beforeEach(() => {
    bundlesByCode.clear();
    identitiesByEmail.clear();
    streamingAuditRecords.length = 0;

    bundlesByCode.set('GESTION_ESCOLAR', buildPublishedBundle());
    bundlesByCode.set(
      'PORTAL_DOCENTE_SP',
      buildPublishedBundle({
        aplicacion_id: '99999999-9999-4999-8999-999999999999',
        codigo_unico: 'PORTAL_DOCENTE_SP',
        patron_integracion: 'PATRON_1_SP_RP',
        nivel_adopcion_pep: null,
      }),
    );
    identitiesByEmail.set('docente@educacion.gob.ec', buildIdentityContext());
  });

  it('autoriza petición en aplicación PATRON_2_PEP_PERIMETRAL, firma assertion_jwt RS256 verificable contra JWKS e inyecta cabeceras X-Minedec-*', async () => {
    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .set('X-Minedec-Request-Id', 'req-test-patron2-001')
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/api/calificaciones/parcial-1',
        metodo_http: 'POST',
      })
      .expect(200);

    expect(res.body.autorizado).toBe(true);
    expect(res.body.codigo_decision).toBe('AUTHZ_PERMITTED');
    expect(res.body.tipo_identificacion).toBe('CEDULA');
    expect(res.body.numero_identificacion).toBe('1710034065');
    expect(res.body.roles).toEqual(['ROL_DOCENTE']);
    expect(res.body.permisos).toEqual(['CALIFICACIONES_REGISTRAR']);
    expect(res.body.permisos_crud).toEqual({
      puede_crear: true,
      puede_leer: true,
      puede_editar: true,
      puede_eliminar: false,
    });
    expect(res.body.contexto_territorial.amie_titular).toBe('17H00123');
    expect(res.body.contexto_territorial.amies_asignados).toEqual([
      '17H00123',
      '17H00456',
    ]);

    // Verificar cabeceras inyectadas para Patrón 2
    expect(res.body.cabeceras_inyectadas).toBeDefined();
    expect(res.body.cabeceras_inyectadas['X-Minedec-User-Id']).toBe(
      '1710034065',
    );
    expect(res.body.cabeceras_inyectadas['X-Minedec-Identification-Type']).toBe(
      'CEDULA',
    );
    expect(res.body.cabeceras_inyectadas['X-Minedec-Roles']).toBe(
      'ROL_DOCENTE',
    );
    expect(res.body.cabeceras_inyectadas['X-Minedec-Amie-Titular']).toBe(
      '17H00123',
    );
    expect(res.body.cabeceras_inyectadas['X-Minedec-Amies-Asignados']).toBe(
      '17H00123,17H00456',
    );
    expect(res.body.cabeceras_inyectadas['X-Minedec-Request-Id']).toBe(
      'req-test-patron2-001',
    );

    // Verificar criptográficamente el assertion_jwt contra el endpoint JWKS del PDP
    const jwksRes = await request(app)
      .get('/api/v1/.well-known/jwks.json')
      .expect(200);

    const localJwks = jose.createLocalJWKSet(jwksRes.body);
    const { payload } = await jose.jwtVerify(res.body.assertion_jwt, localJwks, {
      issuer: 'https://pdp.sso.educacion.gob.ec',
      audience: 'GESTION_ESCOLAR',
    });

    expect(payload.sub).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.numero_identificacion).toBe('1710034065');
    expect(payload.roles).toEqual(['ROL_DOCENTE']);

    // Verificar cero telemetría de latencia en el cuerpo HTTP
    const bodyKeys = Object.keys(res.body);
    for (const forbidden of [
      'latency',
      'latencyMs',
      'duration',
      'durationMs',
      'elapsed',
      'responseTime',
      'tiempo_respuesta',
    ]) {
      expect(bodyKeys).not.toContain(forbidden);
    }
  });

  it('omite cabeceras_inyectadas cuando la aplicación es PATRON_1_SP_RP', async () => {
    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'PORTAL_DOCENTE_SP',
        ruta_solicitada: '/api/calificaciones/parcial-1',
        metodo_http: 'POST',
      })
      .expect(200);

    expect(res.body.autorizado).toBe(true);
    expect(res.body.assertion_jwt).toBeTruthy();
    expect(res.body.cabeceras_inyectadas).toBeUndefined();
  });

  it('autoriza rutas PUBLICA sin email_autenticado con AUTHZ_PUBLIC_ROUTE y rutas AUTENTICADA con AUTHZ_AUTHENTICATED_ROUTE', async () => {
    const pubRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/public/estado',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(pubRes.body.autorizado).toBe(true);
    expect(pubRes.body.codigo_decision).toBe('AUTHZ_PUBLIC_ROUTE');

    const authRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/mi-perfil',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(authRes.body.autorizado).toBe(true);
    expect(authRes.body.codigo_decision).toBe('AUTHZ_AUTHENTICATED_ROUTE');
  });

  it('devuelve 200 OK con autorizado: false y cache_ttl_segundos: 0 para AUTHZ_DENIED_POLICY, AUTHZ_USER_SUSPENDED y AUTHZ_OUTSIDE_VALIDITY_WINDOW', async () => {
    // 1. Petición DELETE sobre ruta protegida que solo está catalogada para POST -> cae en politica_ruta_defecto PROTEGIDA -> DENY
    const denyRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/api/administracion/usuarios',
        metodo_http: 'DELETE',
      })
      .expect(200);

    expect(denyRes.body.autorizado).toBe(false);
    expect(denyRes.body.codigo_decision).toBe('AUTHZ_DENIED_POLICY');
    expect(denyRes.body.cache_ttl_segundos).toBe(0);

    // 2. Cuenta suspendida en Google Workspace
    identitiesByEmail.set(
      'suspendido@educacion.gob.ec',
      buildIdentityContext({
        email_principal: 'suspendido@educacion.gob.ec',
        suspended_en_gws: true,
      }),
    );

    const suspRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'suspendido@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/mi-perfil',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(suspRes.body.autorizado).toBe(false);
    expect(suspRes.body.codigo_decision).toBe('AUTHZ_USER_SUSPENDED');

    // 3. Cuenta con vigencia expirada
    identitiesByEmail.set(
      'vencido@educacion.gob.ec',
      buildIdentityContext({
        email_principal: 'vencido@educacion.gob.ec',
        fecha_fin_vigencia: '2020-01-01',
      }),
    );

    const expRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'vencido@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/mi-perfil',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(expRes.body.autorizado).toBe(false);
    expect(expRes.body.codigo_decision).toBe('AUTHZ_OUTSIDE_VALIDITY_WINDOW');
  });

  it('devuelve 404 APPLICATION_NOT_FOUND cuando la aplicación no existe o no está en estado PUBLICADO', async () => {
    bundlesByCode.set(
      'APP_BORRADOR',
      buildPublishedBundle({
        codigo_unico: 'APP_BORRADOR',
        estado_ciclo_vida: 'BORRADOR',
      }),
    );

    const resNotFound = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'APP_INEXISTENTE',
        ruta_solicitada: '/mi-perfil',
        metodo_http: 'GET',
      })
      .expect(404);

    expect(resNotFound.body.error).toBe('APPLICATION_NOT_FOUND');

    const resDraft = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${pepBearerToken}`)
      .send({
        email_autenticado: 'docente@educacion.gob.ec',
        codigo_aplicacion: 'APP_BORRADOR',
        ruta_solicitada: '/mi-perfil',
        metodo_http: 'GET',
      })
      .expect(404);

    expect(resDraft.body.error).toBe('APPLICATION_NOT_FOUND');
  });
});
