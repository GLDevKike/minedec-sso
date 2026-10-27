import 'reflect-metadata';
import { Container, interfaces } from 'inversify';
import {
  createStructuredLogger,
  DatabaseTransactionManager,
  InMemoryRedisCacheClient,
  KeyValueCacheClient,
  PipMetricsCollector,
  PostgresDatabaseClient,
  RedisCacheClient,
  SqlQueryExecutor,
  TransactionalAuditEventWriter,
} from '@minedec/shared';
import { ManageAnomaliesUseCase } from './application/manage-anomalies.usecase';
import { ManageCatalogsUseCase } from './application/manage-catalogs.usecase';
import { ManageMultisedeContextUseCase } from './application/manage-multisede-context.usecase';
import { ResolveIdentityUseCase } from './application/resolve-identity.usecase';
import { UpsertDirectoryIdentityUseCase } from './application/upsert-directory-identity.usecase';
import { HotRegistrationUseCase } from './application/use-cases/hot-registration.use-case';
import {
  AnomaliaIdentidadRepositoryPort,
  AsignacionContextoRepositoryPort,
  AuditLogPort,
  CacheInvalidationPublisherPort,
  CatalogoAtributoRepositoryPort,
  CatalogoTerritorioSedeRepositoryPort,
  CuentaInstitucionalRepositoryPort,
  DominioInstitucionalRepositoryPort,
  IdentityCachePort,
  PersonaIdentidadRepositoryPort,
  PrioritySyncQueuePort,
} from './domain/ports';
import { AnomalyLifecycleService } from './domain/services/anomaly-lifecycle.service';
import { CatalogDerivationService } from './domain/services/catalog-derivation.service';
import { IdentityUnificationService } from './domain/services/identity-unification.service';
import { MultisedeAndTransitionService } from './domain/services/multisede-and-transition.service';
import { RedisIdentityCacheAdapter } from './infrastructure/cache/redis-identity-cache.adapter';
import { AnomaliesAdminController } from './infrastructure/http/controllers/anomalies-admin.controller';
import { CatalogsAdminController } from './infrastructure/http/controllers/catalogs-admin.controller';
import { ContextAssignmentsAdminController } from './infrastructure/http/controllers/context-assignments-admin.controller';
import { ResolveAndQueryIdentityController } from './infrastructure/http/controllers/resolve-and-query-identity.controller';
import { UpsertIdentityController } from './infrastructure/http/controllers/upsert-identity.controller';
import { CloudTasksPrioritySyncAdapter } from './infrastructure/messaging/cloud-tasks-priority-sync.adapter';
import {
  PubSubCacheInvalidationAdapter,
  TransactionalAuditLogAdapter,
} from './infrastructure/messaging/pubsub-cache-invalidation.adapter';
import { PgAnomaliaIdentidadRepository } from './infrastructure/persistence/pg-anomaly.repository';
import { PgCatalogoAtributoRepository } from './infrastructure/persistence/pg-catalog.repository';
import { PgAsignacionContextoRepository } from './infrastructure/persistence/pg-context-assignment.repository';
import {
  PgCatalogoTerritorioSedeRepository,
  PgCuentaInstitucionalRepository,
  PgDominioInstitucionalRepository,
  PgPersonaIdentidadRepository,
} from './infrastructure/persistence/pg-identity.repository';

export const PIP_TYPES = {
  // Core Infrastructure Primitives
  SqlQueryExecutor: Symbol.for('PIP.SqlQueryExecutor'),
  DatabaseTransactionManager: Symbol.for('PIP.DatabaseTransactionManager'),
  KeyValueCacheClient: Symbol.for('PIP.KeyValueCacheClient'),
  PipMetricsCollector: Symbol.for('PIP.PipMetricsCollector'),
  TransactionalAuditEventWriter: Symbol.for('PIP.TransactionalAuditEventWriter'),

  // Domain Services (100% pure, decorator-free)
  IdentityUnificationService: Symbol.for('PIP.IdentityUnificationService'),
  CatalogDerivationService: Symbol.for('PIP.CatalogDerivationService'),
  MultisedeAndTransitionService: Symbol.for('PIP.MultisedeAndTransitionService'),
  AnomalyLifecycleService: Symbol.for('PIP.AnomalyLifecycleService'),

  // Domain Ports (Repositories & Adapters)
  PersonaIdentidadRepositoryPort: Symbol.for('PIP.PersonaIdentidadRepositoryPort'),
  CuentaInstitucionalRepositoryPort: Symbol.for('PIP.CuentaInstitucionalRepositoryPort'),
  DominioInstitucionalRepositoryPort: Symbol.for('PIP.DominioInstitucionalRepositoryPort'),
  CatalogoTerritorioSedeRepositoryPort: Symbol.for('PIP.CatalogoTerritorioSedeRepositoryPort'),
  AsignacionContextoRepositoryPort: Symbol.for('PIP.AsignacionContextoRepositoryPort'),
  AnomaliaIdentidadRepositoryPort: Symbol.for('PIP.AnomaliaIdentidadRepositoryPort'),
  CatalogoAtributoRepositoryPort: Symbol.for('PIP.CatalogoAtributoRepositoryPort'),
  IdentityCachePort: Symbol.for('PIP.IdentityCachePort'),
  CacheInvalidationPublisherPort: Symbol.for('PIP.CacheInvalidationPublisherPort'),
  PrioritySyncQueuePort: Symbol.for('PIP.PrioritySyncQueuePort'),
  AuditLogPort: Symbol.for('PIP.AuditLogPort'),

  // Application Use Cases (100% decorator-free)
  UpsertDirectoryIdentityUseCase: Symbol.for('PIP.UpsertDirectoryIdentityUseCase'),
  ManageCatalogsUseCase: Symbol.for('PIP.ManageCatalogsUseCase'),
  ManageMultisedeContextUseCase: Symbol.for('PIP.ManageMultisedeContextUseCase'),
  ResolveIdentityUseCase: Symbol.for('PIP.ResolveIdentityUseCase'),
  HotRegistrationUseCase: Symbol.for('PIP.HotRegistrationUseCase'),
  ManageAnomaliesUseCase: Symbol.for('PIP.ManageAnomaliesUseCase'),

  // HTTP Controllers
  UpsertIdentityController: Symbol.for('PIP.UpsertIdentityController'),
  CatalogsAdminController: Symbol.for('PIP.CatalogsAdminController'),
  ContextAssignmentsAdminController: Symbol.for('PIP.ContextAssignmentsAdminController'),
  AnomaliesAdminController: Symbol.for('PIP.AnomaliesAdminController'),
  ResolveAndQueryIdentityController: Symbol.for('PIP.ResolveAndQueryIdentityController'),
} as const;

export interface PipContainerOverrides {
  sqlExecutor?: SqlQueryExecutor;
  txManager?: DatabaseTransactionManager;
  redisStore?: KeyValueCacheClient;
  metrics?: PipMetricsCollector;
  personaRepository?: PersonaIdentidadRepositoryPort;
  cuentaRepository?: CuentaInstitucionalRepositoryPort;
  dominioRepository?: DominioInstitucionalRepositoryPort;
  sedeRepository?: CatalogoTerritorioSedeRepositoryPort;
  contextRepository?: AsignacionContextoRepositoryPort;
  anomalyRepository?: AnomaliaIdentidadRepositoryPort;
  catalogRepository?: CatalogoAtributoRepositoryPort;
  cachePort?: IdentityCachePort;
  cacheInvalidationPublisher?: CacheInvalidationPublisherPort;
  prioritySyncQueuePort?: PrioritySyncQueuePort;
  auditLogPort?: AuditLogPort;
}

/**
 * Composition Root exclusivo con InversifyJS (Principio IV de la Constitución v2.7.0).
 * Todas las clases de domain/ y application/ permanecen 100% libres de decoradores
 * (@injectable / @inject) y se ensamblan mediante toDynamicValue().
 */
export function createPipContainer(overrides: PipContainerOverrides = {}): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  const logger = createStructuredLogger('pip-identity-service');

  // 1. Primitivas de Infraestructura
  container
    .bind<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector)
    .toDynamicValue(() => overrides.metrics ?? new PipMetricsCollector())
    .inSingletonScope();

  container
    .bind<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor)
    .toDynamicValue(() => {
      if (overrides.sqlExecutor) {
        return overrides.sqlExecutor;
      }
      if (overrides.txManager) {
        return overrides.txManager;
      }
      return new PostgresDatabaseClient();
    })
    .inSingletonScope();

  container
    .bind<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager)
    .toDynamicValue((ctx: interfaces.Context) => {
      if (overrides.txManager) {
        return overrides.txManager;
      }
      const executor = ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor);
      if ('withTransaction' in executor && typeof executor.withTransaction === 'function') {
        return executor as DatabaseTransactionManager;
      }
      return {
        query: executor.query.bind(executor),
        withTransaction: async <T>(fn: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> =>
          fn(executor),
        close: async (): Promise<void> => {},
      };
    })
    .inSingletonScope();

  container
    .bind<TransactionalAuditEventWriter>(PIP_TYPES.TransactionalAuditEventWriter)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new TransactionalAuditEventWriter(
          ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
        ),
    )
    .inSingletonScope();

  container
    .bind<KeyValueCacheClient>(PIP_TYPES.KeyValueCacheClient)
    .toDynamicValue(() => {
      if (overrides.redisStore) {
        return overrides.redisStore;
      }
      if (process.env.NODE_ENV === 'test' && !process.env.REDIS_URL) {
        return new InMemoryRedisCacheClient();
      }
      return new RedisCacheClient();
    })
    .inSingletonScope();

  // 2. Servicios de Dominio Puros (sin decoradores)
  container
    .bind<IdentityUnificationService>(PIP_TYPES.IdentityUnificationService)
    .toDynamicValue(() => new IdentityUnificationService())
    .inSingletonScope();

  container
    .bind<CatalogDerivationService>(PIP_TYPES.CatalogDerivationService)
    .toDynamicValue(() => new CatalogDerivationService())
    .inSingletonScope();

  container
    .bind<MultisedeAndTransitionService>(PIP_TYPES.MultisedeAndTransitionService)
    .toDynamicValue(() => new MultisedeAndTransitionService())
    .inSingletonScope();

  container
    .bind<AnomalyLifecycleService>(PIP_TYPES.AnomalyLifecycleService)
    .toDynamicValue(() => new AnomalyLifecycleService())
    .inSingletonScope();

  // 3. Adaptadores de Infraestructura y Repositorios
  container
    .bind<PersonaIdentidadRepositoryPort>(PIP_TYPES.PersonaIdentidadRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.personaRepository ??
      new PgPersonaIdentidadRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<CuentaInstitucionalRepositoryPort>(PIP_TYPES.CuentaInstitucionalRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.cuentaRepository ??
      new PgCuentaInstitucionalRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<DominioInstitucionalRepositoryPort>(PIP_TYPES.DominioInstitucionalRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.dominioRepository ??
      new PgDominioInstitucionalRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<CatalogoTerritorioSedeRepositoryPort>(
      PIP_TYPES.CatalogoTerritorioSedeRepositoryPort,
    )
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.sedeRepository ??
      new PgCatalogoTerritorioSedeRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<AsignacionContextoRepositoryPort>(PIP_TYPES.AsignacionContextoRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.contextRepository ??
      new PgAsignacionContextoRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<AnomaliaIdentidadRepositoryPort>(PIP_TYPES.AnomaliaIdentidadRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.anomalyRepository ??
      new PgAnomaliaIdentidadRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
      ),
    )
    .inSingletonScope();

  container
    .bind<CatalogoAtributoRepositoryPort>(PIP_TYPES.CatalogoAtributoRepositoryPort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.catalogRepository ??
      new PgCatalogoAtributoRepository(
        ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
        ctx.container.get<KeyValueCacheClient>(PIP_TYPES.KeyValueCacheClient),
      ),
    )
    .inSingletonScope();

  container
    .bind<IdentityCachePort>(PIP_TYPES.IdentityCachePort)
    .toDynamicValue((ctx: interfaces.Context) =>
      overrides.cachePort ??
      new RedisIdentityCacheAdapter(
        ctx.container.get<KeyValueCacheClient>(PIP_TYPES.KeyValueCacheClient),
      ),
    )
    .inSingletonScope();

  container
    .bind<CacheInvalidationPublisherPort>(PIP_TYPES.CacheInvalidationPublisherPort)
    .toDynamicValue(
      () =>
        overrides.cacheInvalidationPublisher ??
        new PubSubCacheInvalidationAdapter({ logger }),
    )
    .inSingletonScope();

  container
    .bind<PrioritySyncQueuePort>(PIP_TYPES.PrioritySyncQueuePort)
    .toDynamicValue(
      () => overrides.prioritySyncQueuePort ?? new CloudTasksPrioritySyncAdapter({ logger }),
    )
    .inSingletonScope();

  container
    .bind<AuditLogPort>(PIP_TYPES.AuditLogPort)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        overrides.auditLogPort ??
        new TransactionalAuditLogAdapter(
          ctx.container.get<TransactionalAuditEventWriter>(
            PIP_TYPES.TransactionalAuditEventWriter,
          ),
          ctx.container.get<SqlQueryExecutor>(PIP_TYPES.SqlQueryExecutor),
        ),
    )
    .inSingletonScope();

  // 4. Casos de Uso de Aplicación (100% libres de decoradores)
  container
    .bind<UpsertDirectoryIdentityUseCase>(PIP_TYPES.UpsertDirectoryIdentityUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new UpsertDirectoryIdentityUseCase(
          ctx.container.get<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager),
          ctx.container.get<PersonaIdentidadRepositoryPort>(
            PIP_TYPES.PersonaIdentidadRepositoryPort,
          ),
          ctx.container.get<CuentaInstitucionalRepositoryPort>(
            PIP_TYPES.CuentaInstitucionalRepositoryPort,
          ),
          ctx.container.get<DominioInstitucionalRepositoryPort>(
            PIP_TYPES.DominioInstitucionalRepositoryPort,
          ),
          ctx.container.get<CatalogoTerritorioSedeRepositoryPort>(
            PIP_TYPES.CatalogoTerritorioSedeRepositoryPort,
          ),
          ctx.container.get<AsignacionContextoRepositoryPort>(
            PIP_TYPES.AsignacionContextoRepositoryPort,
          ),
          ctx.container.get<AnomaliaIdentidadRepositoryPort>(
            PIP_TYPES.AnomaliaIdentidadRepositoryPort,
          ),
          ctx.container.get<CatalogoAtributoRepositoryPort>(
            PIP_TYPES.CatalogoAtributoRepositoryPort,
          ),
          ctx.container.get<IdentityCachePort>(PIP_TYPES.IdentityCachePort),
          ctx.container.get<CacheInvalidationPublisherPort>(
            PIP_TYPES.CacheInvalidationPublisherPort,
          ),
          ctx.container.get<AuditLogPort>(PIP_TYPES.AuditLogPort),
          ctx.container.get<IdentityUnificationService>(
            PIP_TYPES.IdentityUnificationService,
          ),
          ctx.container.get<CatalogDerivationService>(PIP_TYPES.CatalogDerivationService),
          ctx.container.get<MultisedeAndTransitionService>(
            PIP_TYPES.MultisedeAndTransitionService,
          ),
          ctx.container.get<AnomalyLifecycleService>(PIP_TYPES.AnomalyLifecycleService),
          ctx.container.get<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector),
        ),
    )
    .inSingletonScope();

  container
    .bind<ManageCatalogsUseCase>(PIP_TYPES.ManageCatalogsUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ManageCatalogsUseCase(
          ctx.container.get<CatalogoAtributoRepositoryPort>(
            PIP_TYPES.CatalogoAtributoRepositoryPort,
          ),
          ctx.container.get<CatalogDerivationService>(PIP_TYPES.CatalogDerivationService),
          ctx.container.get<AuditLogPort>(PIP_TYPES.AuditLogPort),
          ctx.container.get<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager),
          ctx.container.get<CacheInvalidationPublisherPort>(
            PIP_TYPES.CacheInvalidationPublisherPort,
          ),
        ),
    )
    .inSingletonScope();

  container
    .bind<ManageMultisedeContextUseCase>(PIP_TYPES.ManageMultisedeContextUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ManageMultisedeContextUseCase(
          ctx.container.get<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager),
          ctx.container.get<PersonaIdentidadRepositoryPort>(
            PIP_TYPES.PersonaIdentidadRepositoryPort,
          ),
          ctx.container.get<CuentaInstitucionalRepositoryPort>(
            PIP_TYPES.CuentaInstitucionalRepositoryPort,
          ),
          ctx.container.get<CatalogoTerritorioSedeRepositoryPort>(
            PIP_TYPES.CatalogoTerritorioSedeRepositoryPort,
          ),
          ctx.container.get<AsignacionContextoRepositoryPort>(
            PIP_TYPES.AsignacionContextoRepositoryPort,
          ),
          ctx.container.get<IdentityCachePort>(PIP_TYPES.IdentityCachePort),
          ctx.container.get<CacheInvalidationPublisherPort>(
            PIP_TYPES.CacheInvalidationPublisherPort,
          ),
          ctx.container.get<AuditLogPort>(PIP_TYPES.AuditLogPort),
        ),
    )
    .inSingletonScope();

  container
    .bind<ResolveIdentityUseCase>(PIP_TYPES.ResolveIdentityUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ResolveIdentityUseCase(
          ctx.container.get<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager),
          ctx.container.get<PersonaIdentidadRepositoryPort>(
            PIP_TYPES.PersonaIdentidadRepositoryPort,
          ),
          ctx.container.get<CuentaInstitucionalRepositoryPort>(
            PIP_TYPES.CuentaInstitucionalRepositoryPort,
          ),
          ctx.container.get<DominioInstitucionalRepositoryPort>(
            PIP_TYPES.DominioInstitucionalRepositoryPort,
          ),
          ctx.container.get<AsignacionContextoRepositoryPort>(
            PIP_TYPES.AsignacionContextoRepositoryPort,
          ),
          ctx.container.get<AnomaliaIdentidadRepositoryPort>(
            PIP_TYPES.AnomaliaIdentidadRepositoryPort,
          ),
          ctx.container.get<IdentityCachePort>(PIP_TYPES.IdentityCachePort),
          ctx.container.get<PrioritySyncQueuePort>(PIP_TYPES.PrioritySyncQueuePort),
          ctx.container.get<AuditLogPort>(PIP_TYPES.AuditLogPort),
          ctx.container.get<IdentityUnificationService>(
            PIP_TYPES.IdentityUnificationService,
          ),
          ctx.container.get<AnomalyLifecycleService>(PIP_TYPES.AnomalyLifecycleService),
          ctx.container.get<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector),
        ),
    )
    .inSingletonScope();

  container
    .bind<HotRegistrationUseCase>(PIP_TYPES.HotRegistrationUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new HotRegistrationUseCase(
          ctx.container.get<ResolveIdentityUseCase>(PIP_TYPES.ResolveIdentityUseCase),
          ctx.container.get<PrioritySyncQueuePort>(PIP_TYPES.PrioritySyncQueuePort),
        ),
    )
    .inSingletonScope();

  container
    .bind<ManageAnomaliesUseCase>(PIP_TYPES.ManageAnomaliesUseCase)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ManageAnomaliesUseCase(
          ctx.container.get<DatabaseTransactionManager>(PIP_TYPES.DatabaseTransactionManager),
          ctx.container.get<AnomaliaIdentidadRepositoryPort>(
            PIP_TYPES.AnomaliaIdentidadRepositoryPort,
          ),
          ctx.container.get<PersonaIdentidadRepositoryPort>(
            PIP_TYPES.PersonaIdentidadRepositoryPort,
          ),
          ctx.container.get<CuentaInstitucionalRepositoryPort>(
            PIP_TYPES.CuentaInstitucionalRepositoryPort,
          ),
          ctx.container.get<IdentityCachePort>(PIP_TYPES.IdentityCachePort),
          ctx.container.get<CacheInvalidationPublisherPort>(
            PIP_TYPES.CacheInvalidationPublisherPort,
          ),
          ctx.container.get<AuditLogPort>(PIP_TYPES.AuditLogPort),
          ctx.container.get<AnomalyLifecycleService>(PIP_TYPES.AnomalyLifecycleService),
          ctx.container.get<PipMetricsCollector>(PIP_TYPES.PipMetricsCollector),
        ),
    )
    .inSingletonScope();

  // 5. Controladores HTTP
  container
    .bind<UpsertIdentityController>(PIP_TYPES.UpsertIdentityController)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new UpsertIdentityController(
          ctx.container.get<UpsertDirectoryIdentityUseCase>(
            PIP_TYPES.UpsertDirectoryIdentityUseCase,
          ),
        ),
    )
    .inSingletonScope();

  container
    .bind<CatalogsAdminController>(PIP_TYPES.CatalogsAdminController)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new CatalogsAdminController(
          ctx.container.get<ManageCatalogsUseCase>(PIP_TYPES.ManageCatalogsUseCase),
        ),
    )
    .inSingletonScope();

  container
    .bind<ContextAssignmentsAdminController>(
      PIP_TYPES.ContextAssignmentsAdminController,
    )
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ContextAssignmentsAdminController(
          ctx.container.get<ManageMultisedeContextUseCase>(
            PIP_TYPES.ManageMultisedeContextUseCase,
          ),
        ),
    )
    .inSingletonScope();

  container
    .bind<AnomaliesAdminController>(PIP_TYPES.AnomaliesAdminController)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new AnomaliesAdminController(
          ctx.container.get<ManageAnomaliesUseCase>(PIP_TYPES.ManageAnomaliesUseCase),
        ),
    )
    .inSingletonScope();

  container
    .bind<ResolveAndQueryIdentityController>(
      PIP_TYPES.ResolveAndQueryIdentityController,
    )
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new ResolveAndQueryIdentityController(
          ctx.container.get<ResolveIdentityUseCase>(PIP_TYPES.ResolveIdentityUseCase),
        ),
    )
    .inSingletonScope();

  return container;
}
