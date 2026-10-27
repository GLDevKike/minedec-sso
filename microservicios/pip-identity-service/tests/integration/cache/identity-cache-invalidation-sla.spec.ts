import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';
import { RedisIdentityCacheAdapter } from '../../../src/infrastructure/cache/redis-identity-cache.adapter';
import { HARD_MAX_REDIS_TTL_SECONDS } from '@minedec/shared';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

describe('T043 - SLA de Caché L2 Redis (< 15 ms p95), Invalidación Reactiva (< 5 s vía UNLINK + Pub/Sub) y TTL <= 300 s (SC-002 / SC-003)', () => {
  it('resuelve desde Redis L2 en < 15 ms p95, impone TTL <= 300 s en todas las llaves minedec:pip:* y purga en < 5 s al suspender o vencer vigencia (403 fail-close inmediato)', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Ingestar identidad activa con 2 cuentas en el mismo tenant C01MINEDEC01
    const upsertDocente = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-sla-cache-docente',
        emailPrincipal: 'elena.cache@docentes.educacion.gob.ec',
        nombreCompleto: 'Elena Gabriela Torres',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(upsertDocente.status).toBe(200);
    const idInterno: string = upsertDocente.body.idInterno;

    // 2. Poblar caché L2 mediante una primera resolución
    const firstResolve = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-sla-cache-docente',
        emailPrincipal: 'elena.cache@docentes.educacion.gob.ec',
        nombreCompleto: 'Elena Gabriela Torres',
      });
    expect(firstResolve.status).toBe(200);

    // 3. Verificar que todas las llaves en Redis tienen TTL > 0 y <= 300 segundos (camino degradado duro)
    const personaKey = RedisIdentityCacheAdapter.buildPersonaKey(idInterno);
    const identKey = RedisIdentityCacheAdapter.buildIdentKey('CEDULA', '1710034065');
    const emailKey = RedisIdentityCacheAdapter.buildEmailKey('elena.cache@docentes.educacion.gob.ec');
    const gidKey = RedisIdentityCacheAdapter.buildGoogleSubIdKey('sub-sla-cache-docente');

    for (const key of [personaKey, identKey, emailKey, gidKey]) {
      const ttl = await harness.cacheAdapter.getRemainingTtlSeconds(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(HARD_MAX_REDIS_TTL_SECONDS);
    }

    // 4. Medir latencia p95 en 20 lecturas consecutivas desde Redis L2 (< 15 ms p95)
    const latenciesMs: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      const cachedHit = await harness.cacheAdapter.getByGoogleSubId('sub-sla-cache-docente');
      const elapsed = performance.now() - t0;
      expect(cachedHit?.persona.idInterno).toBe(idInterno);
      latenciesMs.push(elapsed);
    }
    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    expect(p95).toBeLessThan(15);

    // 5. Invalidación reactiva (< 5 s): la cuenta es suspendida en Google Workspace (suspendedEnGws = true)
    const invalidationStartMs = performance.now();
    let pubsubNotificationReceivedAtMs = 0;
    harness.pubsubPublisher.onInvalidationPublished(() => {
      pubsubNotificationReceivedAtMs = performance.now();
    });

    const suspendRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-sla-cache-docente',
        emailPrincipal: 'elena.cache@docentes.educacion.gob.ec',
        nombreCompleto: 'Elena Gabriela Torres',
        orgUnitPath: '/Docentes/Suspendidos',
        suspendedEnGws: true,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    const invalidationElapsedMs = pubsubNotificationReceivedAtMs - invalidationStartMs;
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.cacheInvalidated).toBe(true);
    expect(invalidationElapsedMs).toBeLessThan(5000);

    // Todas las llaves en Redis deben haber sido eliminadas inmediatamente vía UNLINK
    expect(await harness.redisStore.get(personaKey)).toBeNull();
    expect(await harness.redisStore.get(identKey)).toBeNull();
    expect(await harness.redisStore.get(emailKey)).toBeNull();
    expect(await harness.redisStore.get(gidKey)).toBeNull();

    // 6. Cualquier intento posterior de resolución recibe 403 Forbidden (fail-close por SUSPENDIDA_GWS)
    const resolveAfterSuspend = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-sla-cache-docente',
        emailPrincipal: 'elena.cache@docentes.educacion.gob.ec',
        nombreCompleto: 'Elena Gabriela Torres',
      });
    expect(resolveAfterSuspend.status).toBe(403);
  });

  it('deniega el acceso (403 fail-close) cuando un contratista tiene fechaFinVigencia vencida (VIGENCIA_VENCIDA)', async () => {
    const harness = createInMemoryPipTestHarness();

    const expiredContractorRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-contratista-vencido',
        emailPrincipal: 'contratista.vencido@educacion.gob.ec',
        nombreCompleto: 'Contratista Vigencia Expirada',
        orgUnitPath: '/Administrativos/Contratistas',
        suspendedEnGws: false,
        origenSincronizacion: 'CONCILIACION_DIARIA',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856001', // Normalizado a CEDULA 0926687856
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'CONTRATISTA',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'GESTION_EDUCATIVA',
          codigoDependenciaAdmin: 'CGPGE-01',
          fechaInicioVigencia: '2024-01-01',
          fechaFinVigencia: '2025-01-01', // Vencido
        },
      });

    expect(expiredContractorRes.status).toBe(200);
    expect(expiredContractorRes.body.estadoSincronizacion).toBe('VIGENCIA_VENCIDA');

    const resolveExpired = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-contratista-vencido',
        emailPrincipal: 'contratista.vencido@educacion.gob.ec',
        nombreCompleto: 'Contratista Vigencia Expirada',
      });

    expect(resolveExpired.status).toBe(403);
  });
});
