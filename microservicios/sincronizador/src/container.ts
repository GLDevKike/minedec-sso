import 'reflect-metadata';
import { Container } from 'inversify';
import {
  AuditEventWriter,
  DatabaseTransactionManager,
  PartitionAdvisoryLock,
  PostgresDatabaseClient,
  RedisCacheClient,
  SyncQuotaGovernor,
} from '@minedec/shared';
import { DeactivatePersonCascadeUseCase } from './application/use-cases/deactivate-person-cascade.use-case';
import { ExecuteDeltaSweepUseCase } from './application/use-cases/execute-delta-sweep.use-case';
import { ExecuteIncrementalSyncUseCase } from './application/use-cases/execute-incremental-sync.use-case';
import { GetDetailedSyncHealthUseCase } from './application/use-cases/get-detailed-sync-health.use-case';
import { HandleAccountLifecycleChangeUseCase } from './application/use-cases/handle-account-lifecycle-change.use-case';
import {
  ListDlqFailuresUseCase,
  ReplayDlqFailuresUseCase,
} from './application/use-cases/manage-dlq-replay.use-case';
import {
  ListReconciliationCheckpointsUseCase,
  TriggerPartitionReconciliationUseCase,
} from './application/use-cases/manage-reconciliation-partitions.use-case';
import { ProcessPubSubEventUseCase } from './application/use-cases/process-pubsub-event.use-case';
import { ReconcileHotRegistrationUseCase } from './application/use-cases/reconcile-hot-registration.use-case';
import { RecordSyncFailureDlqUseCase } from './application/use-cases/record-sync-failure-dlq.use-case';
import {
  ICheckpointRepositoryPort,
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
  ISyncTaskDispatcherPort,
  IUpsertDirectoryIdentityDelegate,
} from './domain/ports/sync-ports';
import { RedisPubSubCacheInvalidatorAdapter } from './infrastructure/cache/redis-pubsub-cache-invalidator.adapter';
import { SincronizadorGwsDirectoryReadOnlyAdapter } from './infrastructure/gws/gws-directory-readonly.adapter';
import { AdminSyncController } from './infrastructure/http/controllers/admin-sync.controller';
import { InternalSyncController } from './infrastructure/http/controllers/internal-sync.controller';
import { CloudTasksDispatcherAdapter } from './infrastructure/messaging/cloud-tasks-dispatcher.adapter';
import { AlloyDbSyncIdentityRepository } from './infrastructure/persistence/alloydb-sync-identity.repository';
import { AlloyDbSyncStateRepository } from './infrastructure/persistence/alloydb-sync-state.repository';

export const SINCRONIZADOR_TYPES = {
  DatabaseTransactionManager: Symbol.for('Sincronizador.DatabaseTransactionManager'),
  RedisCacheClient: Symbol.for('Sincronizador.RedisCacheClient'),
  SyncQuotaGovernor: Symbol.for('Sincronizador.SyncQuotaGovernor'),
  PartitionAdvisoryLock: Symbol.for('Sincronizador.PartitionAdvisoryLock'),
  AuditEventWriter: Symbol.for('Sincronizador.AuditEventWriter'),
  UpsertDirectoryIdentityUseCase: Symbol.for(
    'Sincronizador.UpsertDirectoryIdentityUseCase',
  ),
  IGoogleDirectoryReadOnlyPort: Symbol.for(
    'Sincronizador.IGoogleDirectoryReadOnlyPort',
  ),
  ISyncIdentityRepositoryPort: Symbol.for('Sincronizador.ISyncIdentityRepositoryPort'),
  IProcessedEventRepositoryPort: Symbol.for(
    'Sincronizador.IProcessedEventRepositoryPort',
  ),
  ICheckpointRepositoryPort: Symbol.for('Sincronizador.ICheckpointRepositoryPort'),
  IDlqRepositoryPort: Symbol.for('Sincronizador.IDlqRepositoryPort'),
  ISyncCacheInvalidatorPort: Symbol.for('Sincronizador.ISyncCacheInvalidatorPort'),
  ISyncTaskDispatcherPort: Symbol.for('Sincronizador.ISyncTaskDispatcherPort'),
  ProcessPubSubEventUseCase: Symbol.for('Sincronizador.ProcessPubSubEventUseCase'),
  ExecuteIncrementalSyncUseCase: Symbol.for(
    'Sincronizador.ExecuteIncrementalSyncUseCase',
  ),
  ExecuteDeltaSweepUseCase: Symbol.for('Sincronizador.ExecuteDeltaSweepUseCase'),
  HandleAccountLifecycleChangeUseCase: Symbol.for(
    'Sincronizador.HandleAccountLifecycleChangeUseCase',
  ),
  DeactivatePersonCascadeUseCase: Symbol.for(
    'Sincronizador.DeactivatePersonCascadeUseCase',
  ),
  ReconcileHotRegistrationUseCase: Symbol.for(
    'Sincronizador.ReconcileHotRegistrationUseCase',
  ),
  ListReconciliationCheckpointsUseCase: Symbol.for(
    'Sincronizador.ListReconciliationCheckpointsUseCase',
  ),
  TriggerPartitionReconciliationUseCase: Symbol.for(
    'Sincronizador.TriggerPartitionReconciliationUseCase',
  ),
  RecordSyncFailureDlqUseCase: Symbol.for(
    'Sincronizador.RecordSyncFailureDlqUseCase',
  ),
  ListDlqFailuresUseCase: Symbol.for('Sincronizador.ListDlqFailuresUseCase'),
  ReplayDlqFailuresUseCase: Symbol.for('Sincronizador.ReplayDlqFailuresUseCase'),
  GetDetailedSyncHealthUseCase: Symbol.for(
    'Sincronizador.GetDetailedSyncHealthUseCase',
  ),
  InternalSyncController: Symbol.for('Sincronizador.InternalSyncController'),
  AdminSyncController: Symbol.for('Sincronizador.AdminSyncController'),
} as const;

export interface SincronizadorContainerOverrides {
  txManager?: DatabaseTransactionManager;
  redisClient?: RedisCacheClient;
  quotaGovernor?: SyncQuotaGovernor;
  advisoryLock?: PartitionAdvisoryLock;
  auditWriter?: AuditEventWriter;
  upsertDirectoryIdentityUseCase?: IUpsertDirectoryIdentityDelegate;
  gwsPort?: IGoogleDirectoryReadOnlyPort;
  gwsDirectoryPort?: IGoogleDirectoryReadOnlyPort;
  syncIdentityRepo?: ISyncIdentityRepositoryPort;
  processedEventRepo?: IProcessedEventRepositoryPort;
  checkpointRepo?: ICheckpointRepositoryPort;
  dlqRepo?: IDlqRepositoryPort;
  cacheInvalidator?: ISyncCacheInvalidatorPort;
  taskDispatcher?: ISyncTaskDispatcherPort;
}

/**
 * Composition Root de InversifyJS (`backend/sincronizador/src/container.ts`) (`T020`, `T037`, `T044`, `T054`, `T063`).
 * Cumple estrictamente los Principios III, V y VI de la Constitución v2.8.0:
 * `domain/` y `application/` permanecen 100% libres de decoradores `@injectable()` y `@inject()`,
 * registrando todas las dependencias mediante `toDynamicValue()` en el Composition Root.
 */
export function createSincronizadorContainer(
  overrides: SincronizadorContainerOverrides = {},
): Container {
  const container = new Container({ defaultScope: 'Singleton' });

  const hasRealDbEnv = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
  const defaultTxManager =
    overrides.txManager ??
    (hasRealDbEnv
      ? new PostgresDatabaseClient()
      : ({
          query: async () => ({
            rows: [],
            rowCount: 0,
            command: 'SELECT',
            oid: 0,
            fields: [],
          }),
          withTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
            fn({
              query: async () => ({
                rows: [],
                rowCount: 0,
                command: 'SELECT',
                oid: 0,
                fields: [],
              }),
            }),
        } as unknown as DatabaseTransactionManager));

  container
    .bind<DatabaseTransactionManager>(SINCRONIZADOR_TYPES.DatabaseTransactionManager)
    .toConstantValue(defaultTxManager);

  container
    .bind<RedisCacheClient>(SINCRONIZADOR_TYPES.RedisCacheClient)
    .toDynamicValue(() => overrides.redisClient ?? new RedisCacheClient());

  container
    .bind<SyncQuotaGovernor>(SINCRONIZADOR_TYPES.SyncQuotaGovernor)
    .toDynamicValue(
      (ctx) =>
        overrides.quotaGovernor ??
        new SyncQuotaGovernor(ctx.container.get(SINCRONIZADOR_TYPES.RedisCacheClient)),
    );

  container
    .bind<AuditEventWriter>(SINCRONIZADOR_TYPES.AuditEventWriter)
    .toDynamicValue(() => overrides.auditWriter ?? new AuditEventWriter());

  if (overrides.advisoryLock) {
    container
      .bind<PartitionAdvisoryLock>(SINCRONIZADOR_TYPES.PartitionAdvisoryLock)
      .toConstantValue(overrides.advisoryLock);
  }

  if (overrides.upsertDirectoryIdentityUseCase) {
    container
      .bind<IUpsertDirectoryIdentityDelegate>(
        SINCRONIZADOR_TYPES.UpsertDirectoryIdentityUseCase,
      )
      .toConstantValue(overrides.upsertDirectoryIdentityUseCase);
  }

  const effectiveGwsPort =
    overrides.gwsPort ??
    overrides.gwsDirectoryPort ??
    new SincronizadorGwsDirectoryReadOnlyAdapter({});

  container
    .bind<IGoogleDirectoryReadOnlyPort>(
      SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort,
    )
    .toConstantValue(effectiveGwsPort);

  if (overrides.syncIdentityRepo) {
    container
      .bind<ISyncIdentityRepositoryPort>(
        SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort,
      )
      .toConstantValue(overrides.syncIdentityRepo);
  } else {
    container
      .bind<ISyncIdentityRepositoryPort>(
        SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort,
      )
      .toDynamicValue(
        (ctx) =>
          new AlloyDbSyncIdentityRepository(
            ctx.container.get(SINCRONIZADOR_TYPES.DatabaseTransactionManager),
            ctx.container.get(SINCRONIZADOR_TYPES.AuditEventWriter),
            ctx.container.isBound(SINCRONIZADOR_TYPES.UpsertDirectoryIdentityUseCase)
              ? ctx.container.get(SINCRONIZADOR_TYPES.UpsertDirectoryIdentityUseCase)
              : undefined,
          ),
      );
  }

  if (overrides.processedEventRepo) {
    container
      .bind<IProcessedEventRepositoryPort>(
        SINCRONIZADOR_TYPES.IProcessedEventRepositoryPort,
      )
      .toConstantValue(overrides.processedEventRepo);
  } else {
    container
      .bind<IProcessedEventRepositoryPort>(
        SINCRONIZADOR_TYPES.IProcessedEventRepositoryPort,
      )
      .toDynamicValue(() => new AlloyDbSyncStateRepository(defaultTxManager));
  }

  if (overrides.checkpointRepo) {
    container
      .bind<ICheckpointRepositoryPort>(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort)
      .toConstantValue(overrides.checkpointRepo);
  } else {
    container
      .bind<ICheckpointRepositoryPort>(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort)
      .toDynamicValue(() => new AlloyDbSyncStateRepository(defaultTxManager));
  }

  if (overrides.dlqRepo) {
    container
      .bind<IDlqRepositoryPort>(SINCRONIZADOR_TYPES.IDlqRepositoryPort)
      .toConstantValue(overrides.dlqRepo);
  } else {
    container
      .bind<IDlqRepositoryPort>(SINCRONIZADOR_TYPES.IDlqRepositoryPort)
      .toDynamicValue(() => new AlloyDbSyncStateRepository(defaultTxManager));
  }

  container
    .bind<ISyncCacheInvalidatorPort>(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort)
    .toDynamicValue(
      (ctx) =>
        overrides.cacheInvalidator ??
        new RedisPubSubCacheInvalidatorAdapter(
          ctx.container.get(SINCRONIZADOR_TYPES.RedisCacheClient),
        ),
    );

  container
    .bind<ISyncTaskDispatcherPort>(SINCRONIZADOR_TYPES.ISyncTaskDispatcherPort)
    .toDynamicValue(
      () =>
        overrides.taskDispatcher ??
        new CloudTasksDispatcherAdapter({
          projectId: process.env.GCP_PROJECT_ID ?? 'minedec-sso-dev',
          location: process.env.GCP_REGION ?? 'us-central1',
          serviceBaseUrl:
            process.env.SYNC_SERVICE_BASE_URL ??
            'https://sync-internal.conecta.educacion.gob.ec',
          serviceAccountEmail: process.env.SA_SYNC_EMAIL,
        }),
    );

  // Casos de Uso de Aplicación (100% libres de decoradores)
  container
    .bind<RecordSyncFailureDlqUseCase>(
      SINCRONIZADOR_TYPES.RecordSyncFailureDlqUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new RecordSyncFailureDlqUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IDlqRepositoryPort),
          ctx.container.isBound(SINCRONIZADOR_TYPES.DatabaseTransactionManager)
            ? ctx.container.get(SINCRONIZADOR_TYPES.DatabaseTransactionManager)
            : undefined,
          ctx.container.get(SINCRONIZADOR_TYPES.AuditEventWriter),
        ),
    );

  container
    .bind<HandleAccountLifecycleChangeUseCase>(
      SINCRONIZADOR_TYPES.HandleAccountLifecycleChangeUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new HandleAccountLifecycleChangeUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
        ),
    );

  container
    .bind<DeactivatePersonCascadeUseCase>(
      SINCRONIZADOR_TYPES.DeactivatePersonCascadeUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new DeactivatePersonCascadeUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
        ),
    );

  container
    .bind<ProcessPubSubEventUseCase>(SINCRONIZADOR_TYPES.ProcessPubSubEventUseCase)
    .toDynamicValue(
      (ctx) =>
        new ProcessPubSubEventUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.IProcessedEventRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncTaskDispatcherPort),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
          ctx.container.get(SINCRONIZADOR_TYPES.RedisCacheClient),
        ),
    );

  container
    .bind<ExecuteIncrementalSyncUseCase>(
      SINCRONIZADOR_TYPES.ExecuteIncrementalSyncUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new ExecuteIncrementalSyncUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.IProcessedEventRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
          ctx.container.get(SINCRONIZADOR_TYPES.HandleAccountLifecycleChangeUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
          ctx.container.get(SINCRONIZADOR_TYPES.RecordSyncFailureDlqUseCase),
        ),
    );

  container
    .bind<ExecuteDeltaSweepUseCase>(SINCRONIZADOR_TYPES.ExecuteDeltaSweepUseCase)
    .toDynamicValue(
      (ctx) =>
        new ExecuteDeltaSweepUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
        ),
    );

  container
    .bind<ReconcileHotRegistrationUseCase>(
      SINCRONIZADOR_TYPES.ReconcileHotRegistrationUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new ReconcileHotRegistrationUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.IProcessedEventRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
        ),
    );

  container
    .bind<ListReconciliationCheckpointsUseCase>(
      SINCRONIZADOR_TYPES.ListReconciliationCheckpointsUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new ListReconciliationCheckpointsUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort),
        ),
    );

  container
    .bind<TriggerPartitionReconciliationUseCase>(
      SINCRONIZADOR_TYPES.TriggerPartitionReconciliationUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new TriggerPartitionReconciliationUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
          ctx.container.isBound(SINCRONIZADOR_TYPES.PartitionAdvisoryLock)
            ? ctx.container.get(SINCRONIZADOR_TYPES.PartitionAdvisoryLock)
            : undefined,
        ),
    );

  container
    .bind<ListDlqFailuresUseCase>(SINCRONIZADOR_TYPES.ListDlqFailuresUseCase)
    .toDynamicValue(
      (ctx) =>
        new ListDlqFailuresUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IDlqRepositoryPort),
        ),
    );

  container
    .bind<ReplayDlqFailuresUseCase>(SINCRONIZADOR_TYPES.ReplayDlqFailuresUseCase)
    .toDynamicValue(
      (ctx) =>
        new ReplayDlqFailuresUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.IDlqRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ISyncCacheInvalidatorPort),
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
          ctx.container.isBound(SINCRONIZADOR_TYPES.DatabaseTransactionManager)
            ? ctx.container.get(SINCRONIZADOR_TYPES.DatabaseTransactionManager)
            : undefined,
          ctx.container.get(SINCRONIZADOR_TYPES.AuditEventWriter),
        ),
    );

  container
    .bind<GetDetailedSyncHealthUseCase>(
      SINCRONIZADOR_TYPES.GetDetailedSyncHealthUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new GetDetailedSyncHealthUseCase(
          ctx.container.get(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
          ctx.container.get(SINCRONIZADOR_TYPES.IDlqRepositoryPort),
          ctx.container.get(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort),
        ),
    );

  // Controladores HTTP Express 5
  container
    .bind<InternalSyncController>(SINCRONIZADOR_TYPES.InternalSyncController)
    .toDynamicValue(
      (ctx) =>
        new InternalSyncController(
          ctx.container.get(SINCRONIZADOR_TYPES.ProcessPubSubEventUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.ExecuteIncrementalSyncUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.ExecuteDeltaSweepUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.ReconcileHotRegistrationUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.GetDetailedSyncHealthUseCase),
        ),
    );

  container
    .bind<AdminSyncController>(SINCRONIZADOR_TYPES.AdminSyncController)
    .toDynamicValue(
      (ctx) =>
        new AdminSyncController(
          ctx.container.get(SINCRONIZADOR_TYPES.DeactivatePersonCascadeUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.ListReconciliationCheckpointsUseCase),
          ctx.container.get(
            SINCRONIZADOR_TYPES.TriggerPartitionReconciliationUseCase,
          ),
          ctx.container.get(SINCRONIZADOR_TYPES.ListDlqFailuresUseCase),
          ctx.container.get(SINCRONIZADOR_TYPES.ReplayDlqFailuresUseCase),
        ),
    );

  return container;
}
