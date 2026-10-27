/**
 * Pruebas Unitarias de Arquitectura Hexagonal, InversifyJS Composition Root y Repositorios AlloyDB (`T046`).
 *
 * Verifica:
 * - Resolución completa de símbolos en `createMotorPdpContainer` (`container.ts`).
 * - Pureza arquitectónica: `domain/` y `application/` 100 % libres de `@injectable`, `@inject` e imports de infraestructura (`inversify`, `express`, `pg`, `ioredis`, `jose`, `@google-cloud/*`).
 * - Prohibición constitucional de `RUC` (exclusivo Personas Naturales) y prohibición de cálculo de latencia en Node.js (`Date.now() - startedAt`).
 * - Ejecución de consultas 100 % parametrizadas (`$1`, `$2`) en los 4 repositorios AlloyDB de `motor-pdp`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SqlQueryExecutor } from '@minedec/shared';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import { EvaluateAccessUseCase } from '../../src/application/use-cases/evaluate-access.use-case';
import { IssueM2mTokenUseCase } from '../../src/application/use-cases/issue-m2m-token.use-case';
import {
  GetPdpJwksUseCase,
  RevokePdpJwksKeyUseCase,
  RotatePdpJwksKeyUseCase,
} from '../../src/application/use-cases/manage-pdp-jwks.use-case';
import { createMotorPdpContainer } from '../../src/container';
import { RbacAbacEvaluatorService } from '../../src/domain/services/rbac-abac-evaluator.service';
import { RouteNormalizerAndMatcherService } from '../../src/domain/services/route-normalizer-matcher.service';
import {
  InMemoryPdpRedisStoreDriver,
  IoRedisPdpL2CacheAdapter,
} from '../../src/infrastructure/cache/ioredis-pdp-l2-cache.adapter';
import { AlloyDbIdentityAuthorizationRepository } from '../../src/infrastructure/database/repositories/alloydb-identity-authorization.repository';
import { AlloyDbM2mCredentialRepository } from '../../src/infrastructure/database/repositories/alloydb-m2m-credential.repository';
import { AlloyDbPdpJwksKeyRepository } from '../../src/infrastructure/database/repositories/alloydb-pdp-jwks-key.repository';
import { AlloyDbPolicyBundleRepository } from '../../src/infrastructure/database/repositories/alloydb-policy-bundle.repository';
import { PubSubPdpCacheInvalidationSubscriber } from '../../src/infrastructure/messaging/pubsub-pdp-cache-invalidation.subscriber';
import { TYPES } from '../../src/types';

function collectTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('Composition Root, Pureza Hexagonal y Repositorios AlloyDB — Unit Tests (T046)', () => {
  const srcRoot = path.resolve(__dirname, '../../src');

  it('resuelve todos los servicios, casos de uso, repositorios y controladores desde el Composition Root (container.ts)', () => {
    const container = createMotorPdpContainer();

    expect(
      container.get<RouteNormalizerAndMatcherService>(
        TYPES.RouteNormalizerAndMatcherService,
      ),
    ).toBeInstanceOf(RouteNormalizerAndMatcherService);
    expect(
      container.get<RbacAbacEvaluatorService>(TYPES.RbacAbacEvaluatorService),
    ).toBeInstanceOf(RbacAbacEvaluatorService);
    expect(
      container.get<EvaluateAccessUseCase>(TYPES.EvaluateAccessUseCase),
    ).toBeInstanceOf(EvaluateAccessUseCase);
    expect(
      container.get<IssueM2mTokenUseCase>(TYPES.IssueM2mTokenUseCase),
    ).toBeInstanceOf(IssueM2mTokenUseCase);
    expect(
      container.get<GetPdpJwksUseCase>(TYPES.GetPdpJwksUseCase),
    ).toBeInstanceOf(GetPdpJwksUseCase);
    expect(
      container.get<RotatePdpJwksKeyUseCase>(TYPES.RotatePdpJwksKeyUseCase),
    ).toBeInstanceOf(RotatePdpJwksKeyUseCase);
    expect(
      container.get<RevokePdpJwksKeyUseCase>(TYPES.RevokePdpJwksKeyUseCase),
    ).toBeInstanceOf(RevokePdpJwksKeyUseCase);
  });

  it('garantiza que domain/ y application/ estén 100 % libres de decoradores (@injectable/@inject) e imports de infraestructura', () => {
    const pureFiles = [
      ...collectTsFiles(path.join(srcRoot, 'domain')),
      ...collectTsFiles(path.join(srcRoot, 'application')),
    ];
    expect(pureFiles.length).toBeGreaterThan(0);

    for (const file of pureFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/@injectable\s*\(/);
      expect(content).not.toMatch(/@inject\s*\(/);
      expect(content).not.toMatch(
        /from\s+['"](?:inversify|express|pg|ioredis|jose|@google-cloud\/)/,
      );
    }
  });

  it('garantiza cero referencias a RUC y cero telemetría de latencia en Node.js en todo backend/motor-pdp/src/', () => {
    const allSrcFiles = collectTsFiles(srcRoot);
    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\bRUC\b/);
      expect(content).not.toMatch(/Date\.now\(\)\s*-/);
      expect(content).not.toMatch(/process\.hrtime/);
      expect(content).not.toMatch(/performance\.now\(\)/);
    }
  });

  it('ejecuta consultas SQL 100 % parametrizadas ($1, $2) en los 4 repositorios AlloyDB', async () => {
    const executedQueries: Array<{ sql: string; values?: readonly unknown[] }> =
      [];

    const mockDb: SqlQueryExecutor = {
      query: (async (sql: string, values?: readonly unknown[]) => {
        executedQueries.push({ sql, values });
        if (sql.includes('FROM aplicacion')) {
          return {
            rows: [
              {
                aplicacion_id: '11111111-1111-4111-8111-111111111111',
                codigo_unico: 'GESTION_ESCOLAR',
                nombre_visible: 'Gestión Escolar',
                patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
                nivel_adopcion_pep: 'INTEGRADA',
                host_publico: 'gestion.educacion.gob.ec',
                politica_ruta_defecto: 'PROTEGIDA',
                modo_sombra: false,
                estado_ciclo_vida: 'PUBLICADO',
                version_catalogo: 2,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM ruta_catalogo')) {
          return {
            rows: [
              {
                ruta_id: 'r-1',
                aplicacion_id: '11111111-1111-4111-8111-111111111111',
                patron_ruta: '/api/v1/calificaciones',
                metodo_http: 'GET',
                tipo_coincidencia: 'EXACTA',
                nivel_acceso: 'PROTEGIDA',
                modo_evaluacion_permisos: 'ALL',
                orden_especificidad: 100,
                modo_sombra: false,
                activo: true,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM ruta_permiso_requerido')) {
          return {
            rows: [
              {
                ruta_id: 'r-1',
                permiso_id: 'p-1',
                codigo_permiso: 'NOTAS_VER',
                accion_crud_requerida: 'LEER',
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (/FROM\s+rol\b/.test(sql) && !sql.includes('rol_permiso') && !sql.includes('perfil_rol') && !sql.includes('grupo_logico_rol')) {
          return {
            rows: [{ rol_id: 'rol-1', codigo_rol: 'ROL_DOCENTE', activo: true }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM rol_permiso')) {
          return {
            rows: [
              {
                codigo_rol: 'ROL_DOCENTE',
                permiso_id: 'p-1',
                codigo_permiso: 'NOTAS_VER',
                puede_crear: false,
                puede_leer: true,
                puede_editar: false,
                puede_eliminar: false,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (/FROM\s+perfil\b/.test(sql) && !sql.includes('perfil_rol') && !sql.includes('grupo_logico_perfil')) {
          return {
            rows: [
              {
                perfil_id: 'pf-1',
                codigo_perfil: 'PERFIL_DOCENTE',
                activo: true,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM perfil_rol')) {
          return {
            rows: [{ codigo_perfil: 'PERFIL_DOCENTE', codigo_rol: 'ROL_DOCENTE' }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (
          /FROM\s+grupo_logico\b/.test(sql) &&
          !sql.includes('grupo_logico_rol') &&
          !sql.includes('grupo_logico_perfil')
        ) {
          return {
            rows: [
              {
                grupo_logico_id: 'gl-1',
                codigo_grupo: 'GRUPO_DOCENTES',
                nombre_visible: 'Docentes',
                prioridad_evaluacion: 10,
                activo: true,
                regla_cruce_abac_rbac: {
                  field: 'tipo_usuario',
                  op: 'EQ',
                  value: 'DOCENTE',
                },
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM grupo_logico_rol')) {
          return {
            rows: [{ grupo_logico_id: 'gl-1', codigo_rol: 'ROL_DOCENTE' }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM grupo_logico_perfil')) {
          return {
            rows: [{ grupo_logico_id: 'gl-1', codigo_perfil: 'PERFIL_DOCENTE' }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM cuenta_institucional')) {
          return {
            rows: [
              {
                id_interno: '22222222-2222-4222-8222-222222222222',
                cuenta_id: '33333333-3333-4333-8333-333333333333',
                google_sub_id: 'sub-123',
                email_principal: 'docente@educacion.gob.ec',
                dominio: 'educacion.gob.ec',
                org_unit_path: '/Docentes',
                tipo_identificacion: 'CEDULA',
                numero_identificacion: '1710034065',
                nombre_completo: 'Docente Prueba',
                estado_persona: 'ACTIVA',
                suspended_en_gws: false,
                estado_sincronizacion: 'SINCRONIZADA',
                tipo_usuario: 'DOCENTE',
                subtipo_usuario: null,
                cargo_funcion: null,
                grado_curso: null,
                nivel_academico_derivado: null,
                docente_multisede: false,
                fecha_inicio_vigencia: new Date('2025-01-01T00:00:00.000Z'),
                fecha_fin_vigencia: '2029-12-31',
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM asignacion_contexto')) {
          return {
            rows: [
              {
                asignacion_id: 'ctx-1',
                es_sede_primaria: true,
                nivel_estructura: 'ESTABLECIMIENTO',
                viceministerio: 'VGE',
                codigo_zona: 'Z09',
                codigo_distrito: '09D01',
                codigo_circuito: '09D01C01',
                codigo_amie: '09H00123',
                codigo_dependencia_admin: null,
                regimen_escolar: 'COSTA',
                modalidad_educativa: 'PRESENCIAL',
                jornada: 'MATUTINA',
                activo: true,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM usuario_rol_aplicacion')) {
          return {
            rows: [
              {
                asignacion_rol_id: 'ura-1',
                aplicacion_id: '11111111-1111-4111-8111-111111111111',
                cuenta_id: null,
                rol_id: 'rol-1',
                codigo_rol: 'ROL_DOCENTE',
                perfil_id: null,
                codigo_perfil: null,
                codigo_zona_acotado: 'Z09',
                codigo_distrito_acotado: null,
                codigo_circuito_acotado: null,
                codigo_amie_acotado: null,
                fecha_inicio_vigencia: '2024-01-01',
                fecha_fin_vigencia: null,
                activo: true,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM anomalia_identidad')) {
          return {
            rows: [
              {
                anomalia_id: 'anom-1',
                codigo_causal: 'ANOM_DATOS',
                efecto_acceso: 'RESTRINGIDA',
                estado_anomalia: 'ABIERTA',
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM credencial_m2m')) {
          return {
            rows: [
              {
                credencial_id: 'cred-1',
                aplicacion_id: null,
                tipo_cliente: 'PEP_PATRON_2',
                client_id: 'pep-client',
                secreto_activo_hash: 'a'.repeat(64),
                secreto_anterior_hash: 'b'.repeat(64),
                gracia_hasta: '2026-12-31T00:00:00.000Z',
                expira_rotacion_en: '2026-12-31T00:00:00.000Z',
                scopes_permitidos: 'pdp:evaluate',
                estado_credencial: 'ACTIVA',
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('FROM llave_jwks_rotacion')) {
          return {
            rows: [
              {
                kid: 'pdp-k1',
                servicio_emisor: 'MOTOR_PDP',
                algoritmo: 'RS256',
                secret_manager_version: 'v1',
                public_jwk_json: JSON.stringify({
                  kty: 'RSA',
                  use: 'sig',
                  alg: 'RS256',
                  kid: 'pdp-k1',
                  n: 'abc',
                  e: 'AQAB',
                }),
                estado_llave: 'ACTIVA_FIRMA',
                activada_en: '2026-01-01T00:00:00.000Z',
                expira_rotacion_en: '2026-04-01T00:00:00.000Z',
                retirada_en: null,
              },
            ],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (sql.includes('UPDATE llave_jwks_rotacion')) {
          return {
            rows: [{ kid: 'pdp-k1' }],
            rowCount: 1,
            command: 'UPDATE',
            oid: 0,
            fields: [],
          };
        }
        return {
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        };
      }) as SqlQueryExecutor['query'],
    };

    const bundleRepo = new AlloyDbPolicyBundleRepository(mockDb);
    const bundleByCode = await bundleRepo.findPolicyBundle({
      codigo_unico: 'GESTION_ESCOLAR',
    });
    expect(bundleByCode?.codigo_unico).toBe('GESTION_ESCOLAR');
    expect(bundleByCode?.rutas_ordenadas).toHaveLength(1);
    expect(bundleByCode?.grupos_logicos).toHaveLength(1);

    const bundleByUuid = await bundleRepo.findPolicyBundle({
      uuid_aplicacion: '11111111-1111-4111-8111-111111111111',
    });
    expect(bundleByUuid?.aplicacion_id).toBe(
      '11111111-1111-4111-8111-111111111111',
    );

    const bundleByHost = await bundleRepo.findPolicyBundle({
      host_solicitado: 'https://gestion.educacion.gob.ec:443/inicio',
    });
    expect(bundleByHost?.host_publico).toBe('gestion.educacion.gob.ec');

    const identityRepo = new AlloyDbIdentityAuthorizationRepository(mockDb);
    const identity = await identityRepo.findAuthorizationContextByEmail(
      'docente@educacion.gob.ec',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(identity?.numero_identificacion).toBe('1710034065');
    expect(identity?.asignaciones_contexto).toHaveLength(1);
    expect(identity?.asignaciones_directas_app).toHaveLength(1);
    expect(identity?.anomalias_activas).toHaveLength(1);

    const m2mRepo = new AlloyDbM2mCredentialRepository(mockDb);
    const cred = await m2mRepo.findByClientId('pep-client');
    expect(cred?.client_id).toBe('pep-client');

    const jwksRepo = new AlloyDbPdpJwksKeyRepository(mockDb);
    const keys = await jwksRepo.listActiveAndGraceKeys();
    expect(keys).toHaveLength(1);
    const rotated = await jwksRepo.rotateSigningKey({
      newKid: 'pdp-k2',
      secretManagerVersion: 'v2',
      publicJwk: {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: 'pdp-k2',
        n: 'xyz',
        e: 'AQAB',
      },
    });
    expect(rotated.kid_activo).toBe('pdp-k2');
    expect(rotated.kid_gracia).toBe('pdp-k1');

    const revoked = await jwksRepo.revokeKeyEmergency('pdp-k1');
    expect(revoked?.estado_llave).toBe('REVOCADA');

    expect(executedQueries.length).toBeGreaterThanOrEqual(12);
    for (const q of executedQueries) {
      if (q.values && q.values.length > 0) {
        expect(q.sql).toContain('$1');
      }
    }

    // Verificar casos de retorno vacío / no encontrado y registros en memoria en los 4 repositorios
    const emptyDb: SqlQueryExecutor = {
      query: (async () => ({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      })) as SqlQueryExecutor['query'],
    };

    const emptyBundleRepo = new AlloyDbPolicyBundleRepository(emptyDb);
    expect(await emptyBundleRepo.findPolicyBundle({})).toBeNull();
    expect(
      await emptyBundleRepo.findPolicyBundle({ codigo_unico: 'INEXISTENTE' }),
    ).toBeNull();
    expect(
      await emptyBundleRepo.findPolicyBundle({ host_solicitado: '   ' }),
    ).toBeNull();

    const emptyIdentityRepo = new AlloyDbIdentityAuthorizationRepository(
      emptyDb,
    );
    expect(
      await emptyIdentityRepo.findAuthorizationContextByEmail('   ', 'app-1'),
    ).toBeNull();
    expect(
      await emptyIdentityRepo.findAuthorizationContextByEmail(
        'noexiste@educacion.gob.ec',
        'app-1',
      ),
    ).toBeNull();

    const emptyM2mRepo = new AlloyDbM2mCredentialRepository(emptyDb);
    expect(await emptyM2mRepo.findByClientId('   ')).toBeNull();
    expect(await emptyM2mRepo.findByClientId('no-existe')).toBeNull();
    emptyM2mRepo.registerInMemoryCredential({
      credencial_id: 'mem-1',
      aplicacion_id: null,
      tipo_cliente: 'PEP_PATRON_2',
      client_id: 'mem-client',
      secreto_activo_hash: 'a'.repeat(64),
      secreto_anterior_hash: null,
      gracia_hasta: null,
      expira_rotacion_en: new Date('2029-01-01T00:00:00.000Z'),
      scopes_permitidos: 'pdp:evaluate',
      estado_credencial: 'ACTIVA',
    });
    expect((await emptyM2mRepo.findByClientId('mem-client'))?.client_id).toBe(
      'mem-client',
    );
    emptyM2mRepo.clearInMemoryCredentials();

    const emptyJwksRepo = new AlloyDbPdpJwksKeyRepository(emptyDb);
    expect(await emptyJwksRepo.getActiveSigningKey()).toBeNull();
    expect(await emptyJwksRepo.revokeKeyEmergency('inexistente')).toBeNull();
  });

  it('verifica endpoints /healthz, /ready y procesamiento de mensajes Pub/Sub (ack/nack)', async () => {
    const redisDriver = new InMemoryPdpRedisStoreDriver();
    const container = createMotorPdpContainer({
      redisStoreDriver: redisDriver,
    });
    const app = createMotorPdpApp({
      redisStoreDriver: redisDriver,
    });

    await request(app).get('/healthz').expect(200);
    await request(app).get('/ready').expect(200);

    // Simular caída de Redis -> /ready devuelve 503
    redisDriver.setSimulatedFailure(true);
    await request(app).get('/ready').expect(503);
    redisDriver.setSimulatedFailure(false);

    const subscriber = container.get<PubSubPdpCacheInvalidationSubscriber>(
      TYPES.PubSubPdpCacheInvalidationSubscriber,
    );
    let acked = false;
    let nacked = false;

    await subscriber.handlePubSubMessage({
      id: 'msg-1',
      data: Buffer.from(
        JSON.stringify({
          event_type: 'REVOKE_SUBJECT',
          email_principal: 'docente@educacion.gob.ec',
          id_interno: '22222222-2222-4222-8222-222222222222',
        }),
        'utf8',
      ),
      ack: () => {
        acked = true;
      },
      nack: () => {
        nacked = true;
      },
    });
    expect(acked).toBe(true);
    expect(nacked).toBe(false);

    await subscriber.handlePubSubMessage({
      id: 'msg-2',
      data: Buffer.from(
        JSON.stringify({
          event_type: 'POLICY_CATALOG_UPDATED',
          aplicacion_id: '11111111-1111-4111-8111-111111111111',
          codigo_aplicacion: 'GESTION_ESCOLAR',
          host_publico: 'gestion.educacion.gob.ec',
        }),
        'utf8',
      ),
      ack: () => {},
      nack: () => {},
    });

    await subscriber.handlePubSubMessage({
      id: 'msg-3',
      data: Buffer.from(
        JSON.stringify({
          event_type: 'REVOKE_ALL',
        }),
        'utf8',
      ),
      ack: () => {},
      nack: () => {},
    });

    // Payload inválido -> nack()
    await subscriber.handlePubSubMessage({
      id: 'msg-bad',
      data: Buffer.from('not-json', 'utf8'),
      ack: () => {},
      nack: () => {
        nacked = true;
      },
    });
    expect(nacked).toBe(true);

    // Ejercitar métodos de decisiones precalculadas y rutas Fail-Close en IoRedisPdpL2CacheAdapter
    const cacheAdapter = container.get<IoRedisPdpL2CacheAdapter>(
      TYPES.PdpL2CachePort,
    );
    expect(
      await cacheAdapter.getPrecomputedDecision({
        aplicacionCodigo: 'GESTION_ESCOLAR',
        versionCatalogo: 1,
      }),
    ).toBeNull();
    expect(
      await cacheAdapter.getPrecomputedDecision({
        aplicacionCodigo: 'GESTION_ESCOLAR',
        versionCatalogo: 1,
        emailPrincipal: 'noexiste@educacion.gob.ec',
      }),
    ).toBeNull();

    await cacheAdapter.setPrecomputedDecision('GESTION_ESCOLAR', 1, {
      id_interno: '22222222-2222-4222-8222-222222222222',
      cuenta_id: '33333333-3333-4333-8333-333333333333',
      email_principal: 'docente@educacion.gob.ec',
      tipo_identificacion: 'CEDULA',
      numero_identificacion: '1710034065',
      estado_persona: 'ACTIVA',
      suspended_en_gws: false,
      estado_sincronizacion: 'SINCRONIZADA',
      fuera_ventana_vigencia: false,
      tiene_anomalia_bloqueante: false,
      roles_efectivos: ['ROL_DOCENTE'],
      permisos_efectivos: ['NOTAS_VER'],
      permisos_por_codigo: {
        NOTAS_VER: {
          puede_crear: false,
          puede_leer: true,
          puede_editar: false,
          puede_eliminar: false,
        },
      },
      permisos_crud_agregado: {
        puede_crear: false,
        puede_leer: true,
        puede_editar: false,
        puede_eliminar: false,
      },
      contexto_territorial: {
        amie_titular: '09H00123',
        amies_asignados: ['09H00123'],
        nivel_jurisdiccion: 'ESTABLECIMIENTO',
        codigo_jurisdiccion: '09H00123',
        zona: 'Z09',
        distrito: '09D01',
        circuito: '09D01C01',
        viceministerio: 'VGE',
      },
      politicas_base_evaluadas: ['GRUPO_DOCENTES'],
      ttl_segundos: 300,
    });

    const cachedDecByEmail = await cacheAdapter.getPrecomputedDecision({
      aplicacionCodigo: 'GESTION_ESCOLAR',
      versionCatalogo: 1,
      emailPrincipal: 'docente@educacion.gob.ec',
    });
    expect(cachedDecByEmail?.roles_efectivos).toEqual(['ROL_DOCENTE']);

    const deletedByEmailOnly = await cacheAdapter.invalidateBySubject({
      emailPrincipal: 'docente@educacion.gob.ec',
    });
    expect(deletedByEmailOnly).toBeGreaterThanOrEqual(1);
    expect(await cacheAdapter.invalidateBySubject({})).toBe(0);

    // Simular fallos de Redis en operaciones de lectura/escritura/invalidación (Fail-Close)
    redisDriver.setSimulatedFailure(true);
    await expect(
      cacheAdapter.getPolicyBundle('GESTION_ESCOLAR'),
    ).rejects.toThrow(/Fail-Close/);
    await expect(
      cacheAdapter.getPrecomputedDecision({
        aplicacionCodigo: 'GESTION_ESCOLAR',
        versionCatalogo: 1,
        idInterno: 'id-1',
        cuentaId: 'c-1',
      }),
    ).rejects.toThrow(/Fail-Close/);
    await expect(
      cacheAdapter.invalidateBySubject({ idInterno: 'id-1' }),
    ).rejects.toThrow(/Memorystore for Redis/);
    await expect(
      cacheAdapter.invalidateByApplication('GESTION_ESCOLAR'),
    ).rejects.toThrow(/Memorystore for Redis/);
    await expect(cacheAdapter.flushAll()).rejects.toThrow(
      /Memorystore for Redis/,
    );
    redisDriver.setSimulatedFailure(false);
  });
});
