/**
 * Pruebas de Integración (`Supertest`) — Caché L2 (`TTL <= 300 s`), Invalidación Pub/Sub y Postura `Fail-Close` (`T031`).
 *
 * Cubre:
 * - Hit/Miss en caché L2 (`pdp:bundle:*` y `pdp:decision:*`) evitando consultas repetitivas a AlloyDB.
 * - Purga inmediata vía `/internal/v1/pdp/cache/invalidate` (`PUBSUB_USER_REVOKED`, `PUBSUB_POLICY_PUBLISHED`, `PUBSUB_EMERGENCY_FLUSH_ALL`) garantizando SLA de revocación `<= 300 s`.
 * - Rechazo `400 SECURITY_PATH_TRAVERSAL_REJECTED` ante rutas con `%2F` o `..` con auditoría transaccional `PDP_RECHAZO_SEGURIDAD_RUTA`.
 * - Postura `Fail-Close` (`503 AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE`) cuando la base de datos o dependencias fallan.
 */

import crypto from 'node:crypto';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import {
  ApplicationPolicyBundle,
  IdentityAuthorizationContext,
} from '../../src/domain/entities/pdp-domain.entities';
import { PdpTransactionalSecurityAuditRecord } from '../../src/domain/ports/pdp.ports';
import { InMemoryPdpRedisStoreDriver } from '../../src/infrastructure/cache/ioredis-pdp-l2-cache.adapter';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val, 'utf8').digest('hex');
}

describe('Cache Invalidation (SLA <= 300s) & Fail-Close — Integration Tests (T031)', () => {
  let dbBundleQueryCount = 0;
  let dbIdentityQueryCount = 0;
  let simulateDbOutage = false;
  let userSuspendedInDb = false;
  const securityEvents: PdpTransactionalSecurityAuditRecord[] = [];
  const redisDriver = new InMemoryPdpRedisStoreDriver();

  const sampleBundle: ApplicationPolicyBundle = {
    aplicacion_id: '11111111-1111-4111-8111-111111111111',
    codigo_unico: 'GESTION_ESCOLAR',
    nombre_visible: 'Gestión Escolar',
    patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
    nivel_adopcion_pep: 'INTEGRADA',
    host_publico: 'gestion.educacion.gob.ec',
    politica_ruta_defecto: 'AUTENTICADA',
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

  const buildIdentity = (): IdentityAuthorizationContext => ({
    id_interno: '22222222-2222-4222-8222-222222222222',
    cuenta_id: '33333333-3333-4333-8333-333333333333',
    google_sub_id: 'sub-1',
    email_principal: 'docente.cache@educacion.gob.ec',
    dominio: 'educacion.gob.ec',
    org_unit_path: '/Docentes',
    tipo_identificacion: 'CEDULA',
    numero_identificacion: '1710034065',
    nombre_completo: 'Docente Caché',
    estado_persona: 'ACTIVA',
    suspended_en_gws: userSuspendedInDb,
    estado_sincronizacion: userSuspendedInDb ? 'SUSPENDIDA_GWS' : 'SINCRONIZADA',
    tipo_usuario: 'DOCENTE',
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
    redisStoreDriver: redisDriver,
    m2mCredentialRepo: {
      findByClientId: async (clientId) =>
        clientId === 'pep-client'
          ? {
              credencial_id: 'c-1',
              aplicacion_id: null,
              tipo_cliente: 'PEP_PATRON_2',
              client_id: 'pep-client',
              secreto_activo_hash: sha256('pep-secret'),
              secreto_anterior_hash: null,
              gracia_hasta: null,
              expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
              scopes_permitidos: 'pdp:evaluate',
              estado_credencial: 'ACTIVA',
            }
          : null,
    },
    policyBundleRepo: {
      findPolicyBundle: async () => {
        if (simulateDbOutage) {
          throw new Error('AlloyDB connection timeout');
        }
        dbBundleQueryCount += 1;
        return sampleBundle;
      },
    },
    identityRepo: {
      findAuthorizationContextByEmail: async () => {
        if (simulateDbOutage) {
          throw new Error('AlloyDB connection timeout');
        }
        dbIdentityQueryCount += 1;
        return buildIdentity();
      },
    },
    auditPort: {
      emitStreamingEvaluationEvent: () => {},
      recordTransactionalSecurityEvent: async (rec) => {
        securityEvents.push(rec);
      },
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
    dbBundleQueryCount = 0;
    dbIdentityQueryCount = 0;
    simulateDbOutage = false;
    userSuspendedInDb = false;
    securityEvents.length = 0;
    await request(app)
      .post('/internal/v1/pdp/cache/invalidate')
      .send({ tipo_evento: 'PUBSUB_EMERGENCY_FLUSH_ALL' });
    securityEvents.length = 0;
  });

  it('sirve evaluaciones repetidas desde caché L2 (TTL <= 300 s) e invalida de inmediato al recibir PUBSUB_USER_REVOKED', async () => {
    // Primera evaluación -> Miss en caché L2 -> consulta AlloyDB (1 vez)
    const firstRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'docente.cache@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/panel',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(firstRes.body.autorizado).toBe(true);
    expect(firstRes.body.cache_ttl_segundos).toBeLessThanOrEqual(300);
    expect(dbBundleQueryCount).toBe(1);
    expect(dbIdentityQueryCount).toBe(1);

    // Segunda evaluación idéntica -> Hit en caché L2 -> 0 consultas nuevas a AlloyDB
    const secondRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'docente.cache@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/panel',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(secondRes.body.autorizado).toBe(true);
    expect(dbBundleQueryCount).toBe(1);
    expect(dbIdentityQueryCount).toBe(1);

    // Ahora el usuario es suspendido en GWS y llega evento Pub/Sub PUBSUB_USER_REVOKED
    userSuspendedInDb = true;
    const invRes = await request(app)
      .post('/internal/v1/pdp/cache/invalidate')
      .send({
        tipo_evento: 'PUBSUB_USER_REVOKED',
        email_principal: 'docente.cache@educacion.gob.ec',
      })
      .expect(200);

    expect(invRes.body.invalidatedKeys).toBeGreaterThanOrEqual(1);

    // Siguiente evaluación refleja la revocación de forma inmediata (AUTHZ_USER_SUSPENDED)
    const thirdRes = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'docente.cache@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/panel',
        metodo_http: 'GET',
      })
      .expect(200);

    expect(thirdRes.body.autorizado).toBe(false);
    expect(thirdRes.body.codigo_decision).toBe('AUTHZ_USER_SUSPENDED');
    expect(dbIdentityQueryCount).toBe(2);
  });

  it('rechaza path traversal (%2F / ..) con 400 SECURITY_PATH_TRAVERSAL_REJECTED y audita PDP_RECHAZO_SEGURIDAD_RUTA', async () => {
    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'docente.cache@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/api/v1/%2F../admin',
        metodo_http: 'GET',
      })
      .expect(400);

    expect(res.body.error).toBe('SECURITY_PATH_TRAVERSAL_REJECTED');
    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]?.tipoEvento).toBe('PDP_RECHAZO_SEGURIDAD_RUTA');
  });

  it('aplica postura Fail-Close (503 AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE) cuando AlloyDB falla y no hay caché', async () => {
    simulateDbOutage = true;

    const res = await request(app)
      .post('/api/v1/access/evaluation')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        email_autenticado: 'docente.cache@educacion.gob.ec',
        codigo_aplicacion: 'GESTION_ESCOLAR',
        ruta_solicitada: '/panel',
        metodo_http: 'GET',
      })
      .expect(503);

    expect(res.body.error).toBe('AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE');
  });
});
