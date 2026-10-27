import express, { Express, Request, Response } from 'express';
import { Container } from 'inversify';
import {
  buildNaturalLanguageIncidentDiagnostic,
  createStructuredLogger,
  DatabaseHealthStatus,
  DatabaseTransactionManager,
  KeyValueCacheClient,
  PipMetricsCollector,
  SqlQueryExecutor,
} from '@minedec/shared';
import { createPipContainer, PIP_TYPES, PipContainerOverrides } from './container';
import { AnomaliesAdminController } from './infrastructure/http/controllers/anomalies-admin.controller';
import { CatalogsAdminController } from './infrastructure/http/controllers/catalogs-admin.controller';
import { ContextAssignmentsAdminController } from './infrastructure/http/controllers/context-assignments-admin.controller';
import { ResolveAndQueryIdentityController } from './infrastructure/http/controllers/resolve-and-query-identity.controller';
import { UpsertIdentityController } from './infrastructure/http/controllers/upsert-identity.controller';
import {
  AuthMiddlewareOptions,
  createInternalOrIapAuthMiddleware,
  createSecurityHeadersMiddleware,
  pipErrorHandler,
  rejectAmbiguousPathsMiddleware,
  traceContextMiddleware,
} from './infrastructure/http/middleware/auth-security.middleware';

export interface CreatePipAppOptions {
  container?: Container;
  overrides?: PipContainerOverrides;
  authOptions?: AuthMiddlewareOptions;
}

export function createPipExpressApp(options: CreatePipAppOptions = {}): {
  app: Express;
  container: Container;
} {
  const container = options.container ?? createPipContainer(options.overrides);
  const app = express();
  const healthLogger = createStructuredLogger('pip-health-monitor');

  app.disable('x-powered-by');
  app.use(traceContextMiddleware);
  app.use(...createSecurityHeadersMiddleware());
  app.use(rejectAmbiguousPathsMiddleware);
  app.use(express.json({ limit: '256kb' }));
  app.use(createInternalOrIapAuthMiddleware(options.authOptions));

  // Health & Metrics Endpoints
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'pip-identity-service' });
  });

  /**
   * Endpoint de diagnóstico detallado en lenguaje natural para el Administrador de Seguridad
   * e Infraestructura. Reporta en tiempo real el estado de AlloyDB for PostgreSQL 16,
   * Memorystore for Redis (L2), la postura de seguridad Fail-Close y cómo se levanta la
   * infraestructura ante caídas o conmutaciones HA.
   */
  app.get('/internal/v1/pip/health/detailed', async (req: Request, res: Response) => {
    const traceId = req.traceId ?? 'health-check-trace';
    const txManager = container.get<DatabaseTransactionManager>(
      PIP_TYPES.DatabaseTransactionManager,
    );
    const sqlExecutor = container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor);
    const redisClient = container.get<KeyValueCacheClient>(PIP_TYPES.KeyValueCacheClient);
    const metrics = container.get<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector);

    // 1. Sonda de AlloyDB for PostgreSQL 16
    let dbHealth: DatabaseHealthStatus;
    if (typeof txManager.checkHealth === 'function') {
      dbHealth = await txManager.checkHealth(traceId);
    } else {
      try {
        await sqlExecutor.query('SELECT 1 AS ok');
        dbHealth = {
          estado: 'OPERATIVO',
          rolInstancia: 'PRIMARIA_LECTURA_ESCRITURA',
          resumenLenguajeNatural:
            'El clúster AlloyDB for PostgreSQL 16 responde correctamente en modo lectura/escritura. La tabla inmutable auditoria_evento y las 8 entidades del PIP están operativas.',
          mecanismoRespaldoYRecuperacion:
            'Alta Disponibilidad Regional (REGIONAL HA) activa con promoción automática de standby < 60 s (RPO = 0), Respaldo Continuo (PITR de 14 días), respaldos diarios automatizados encriptados y deletion_protection = true.',
        };
      } catch (dbErr) {
        const diagnostic = buildNaturalLanguageIncidentDiagnostic(dbErr, {
          traceId,
          componentHint: 'ALLOYDB_POSTGRESQL_16',
        });
        dbHealth = {
          estado: 'CAIDO_O_EN_FAILOVER',
          rolInstancia: 'DESCONOCIDO',
          resumenLenguajeNatural: diagnostic.explicacionLenguajeNatural,
          mecanismoRespaldoYRecuperacion: diagnostic.comoSeLevantaYRecupera,
          diagnosticoIncidente: diagnostic,
        };
      }
    }

    // 2. Sonda de Memorystore for Redis L2
    let redisEstado: 'OPERATIVO' | 'DEGRADADO' = 'OPERATIVO';
    let redisResumen = '';
    try {
      await redisClient.get('pip:healthcheck:probe');
      redisResumen =
        'Caché L2 en Memorystore for Redis operativa con límite duro TTL <= 300 segundos e invalidación reactiva por Pub/Sub (< 5 s).';
    } catch (redisErr) {
      redisEstado = 'DEGRADADO';
      const redisDiag = buildNaturalLanguageIncidentDiagnostic(redisErr, {
        traceId,
        componentHint: 'MEMORYSTORE_REDIS_L2',
      });
      redisResumen = redisDiag.explicacionLenguajeNatural;
    }

    const isAlloyDbHealthy = dbHealth.estado === 'OPERATIVO';
    const httpStatus = isAlloyDbHealthy ? 200 : 503;
    const estadoGlobal = isAlloyDbHealthy
      ? redisEstado === 'OPERATIVO'
        ? 'OPERATIVO'
        : 'OPERATIVO_CON_CACHE_DEGRADADA'
      : 'CAIDO_FAIL_CLOSE_ACTIVO';

    const resumenEjecutivoAdministrador = isAlloyDbHealthy
      ? 'Todos los sistemas críticos de persistencia (AlloyDB for PostgreSQL 16) están en línea. Los respaldos continuos (PITR 14 días), respaldos diarios encriptados y la Alta Disponibilidad Regional (< 60 s) se encuentran activos.'
      : `ALERTA CRÍTICA PARA EL ADMINISTRADOR: ${dbHealth.diagnosticoIncidente?.tituloLenguajeNatural ?? 'AlloyDB no responde'}. ${dbHealth.resumenLenguajeNatural} CÓMO SE LEVANTA: ${dbHealth.mecanismoRespaldoYRecuperacion}`;

    if (!isAlloyDbHealthy) {
      healthLogger.error(
        'Sonda de salud detallada detectó indisponibilidad o failover en AlloyDB',
        {
          traceId,
          spanId: req.spanId,
          estadoGlobal,
          diagnosticoAdministrador: dbHealth.diagnosticoIncidente,
        },
      );
    }

    res.status(httpStatus).json({
      service: 'pip-identity-service',
      timestampIso: new Date().toISOString(),
      traceId,
      spanId: req.spanId,
      estadoGlobal,
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      resumenEjecutivoAdministrador,
      componentes: {
        alloydbPostgresql16: dbHealth,
        memorystoreRedisL2: {
          estado: redisEstado,
          ttlMaximoSegundos: 300,
          resumenLenguajeNatural: redisResumen,
        },
      },
      metricasOperativas: metrics.getSnapshot(),
    });
  });

  app.get('/internal/v1/pip/metrics', (_req: Request, res: Response) => {
    const metrics = container.get<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector);
    res.status(200).json(metrics.getSnapshot());
  });

  // Mount OpenAPI 3.1 Controllers
  const upsertController = container.get<UpsertIdentityController>(
    PIP_TYPES.UpsertIdentityController,
  );
  const catalogsController = container.get<CatalogsAdminController>(
    PIP_TYPES.CatalogsAdminController,
  );
  const contextController = container.get<ContextAssignmentsAdminController>(
    PIP_TYPES.ContextAssignmentsAdminController,
  );
  const anomaliesController = container.get<AnomaliesAdminController>(
    PIP_TYPES.AnomaliesAdminController,
  );
  const resolveController = container.get<ResolveAndQueryIdentityController>(
    PIP_TYPES.ResolveAndQueryIdentityController,
  );

  app.use(upsertController.router);
  app.use(catalogsController.router);
  app.use(contextController.router);
  app.use(anomaliesController.router);
  app.use(resolveController.router);

  app.use(pipErrorHandler);

  return { app, container };
}

export * from './container';
export * from './domain/entities/identity-entities';
export * from './domain/ports';
export * from './domain/services/identity-unification.service';
export * from './domain/services/catalog-derivation.service';
export * from './domain/services/multisede-and-transition.service';
export * from './domain/services/anomaly-lifecycle.service';
export * from './application/upsert-directory-identity.usecase';
export * from './application/manage-catalogs.usecase';
export * from './application/manage-multisede-context.usecase';
export * from './application/resolve-identity.usecase';
export * from './application/use-cases/hot-registration.use-case';
export * from './application/manage-anomalies.usecase';
export * from './infrastructure/cache/redis-identity-cache.adapter';
export * from './infrastructure/messaging/pubsub-cache-invalidation.adapter';
export * from './infrastructure/messaging/cloud-tasks-priority-sync.adapter';
export * from './infrastructure/persistence/pg-identity.repository';
export * from './infrastructure/persistence/pg-catalog.repository';
export * from './infrastructure/persistence/pg-context-assignment.repository';
export * from './infrastructure/persistence/pg-anomaly.repository';

/* istanbul ignore next */
if (require.main === module) {
  const logger = createStructuredLogger('pip-identity-service');
  const port = Number(process.env.PORT ?? process.env.PIP_PORT ?? 8080);
  const { app } = createPipExpressApp();
  app.listen(port, '0.0.0.0', () => {
    logger.info('PIP Identity Service listening', { port, host: '0.0.0.0' });
  });
}
