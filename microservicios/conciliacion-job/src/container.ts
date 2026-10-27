import 'reflect-metadata';
import { Container, interfaces } from 'inversify';
import {
  AuditEventWriter,
  DatabaseTransactionManager,
  ExponentialBackoffPolicy,
  KeyValueCacheClient,
  PartitionAdvisoryLock,
  SqlQueryExecutor,
  SyncDiagnosticBuilder,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  createSincronizadorContainer,
  HandleAccountLifecycleChangeUseCase,
  ICheckpointRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncIdentityRepositoryPort,
  RecordSyncFailureDlqUseCase,
  SINCRONIZADOR_TYPES,
  SincronizadorContainerOverrides,
} from '@minedec/sincronizador';
import { RunPartitionReconciliationUseCase } from './application/use-cases/run-partition-reconciliation.use-case';
import {
  IBatchReconciliationRepositoryPort,
  IBatchReconciliationRunnerPort,
} from './domain/batch-reconciliation.types';
import { AlloyDbBatchReconciliationRepository } from './infrastructure/persistence/alloydb-batch-reconciliation.repository';

export const CONCILIACION_JOB_TYPES = {
  SqlQueryExecutor: Symbol.for('CONCILIACION_JOB.SqlQueryExecutor'),
  DatabaseTransactionManager: Symbol.for('CONCILIACION_JOB.DatabaseTransactionManager'),
  KeyValueCacheClient: Symbol.for('CONCILIACION_JOB.KeyValueCacheClient'),
  SyncQuotaGovernor: Symbol.for('CONCILIACION_JOB.SyncQuotaGovernor'),
  PartitionAdvisoryLock: Symbol.for('CONCILIACION_JOB.PartitionAdvisoryLock'),
  SyncDiagnosticBuilder: Symbol.for('CONCILIACION_JOB.SyncDiagnosticBuilder'),
  ExponentialBackoffPolicy: Symbol.for('CONCILIACION_JOB.ExponentialBackoffPolicy'),
  AuditEventWriter: Symbol.for('CONCILIACION_JOB.AuditEventWriter'),

  IGoogleDirectoryReadOnlyPort: Symbol.for('CONCILIACION_JOB.IGoogleDirectoryReadOnlyPort'),
  ICheckpointRepositoryPort: Symbol.for('CONCILIACION_JOB.ICheckpointRepositoryPort'),
  ISyncIdentityRepositoryPort: Symbol.for('CONCILIACION_JOB.ISyncIdentityRepositoryPort'),

  IBatchReconciliationRepositoryPort: Symbol.for(
    'CONCILIACION_JOB.IBatchReconciliationRepositoryPort',
  ),
  AlloyDbBatchReconciliationRepository: Symbol.for(
    'CONCILIACION_JOB.AlloyDbBatchReconciliationRepository',
  ),
  RunPartitionReconciliationUseCase: Symbol.for(
    'CONCILIACION_JOB.RunPartitionReconciliationUseCase',
  ),
  IBatchReconciliationRunnerPort: Symbol.for(
    'CONCILIACION_JOB.IBatchReconciliationRunnerPort',
  ),
} as const;

export interface ConciliacionJobContainerOverrides extends SincronizadorContainerOverrides {
  batchRepository?: IBatchReconciliationRepositoryPort;
  runner?: IBatchReconciliationRunnerPort;
  sincronizadorContainer?: Container;
}

/**
 * Composition Root exclusivo con InversifyJS para el Job de Conciliación Masiva (T053 / Principio IV).
 * Ninguna clase en domain/ o application/ contiene decoradores (@injectable / @inject).
 */
export function createConciliacionJobContainer(
  overrides: ConciliacionJobContainerOverrides = {},
): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  const baseSyncContainer =
    overrides.sincronizadorContainer ?? createSincronizadorContainer(overrides);

  if (overrides.txManager) {
    container
      .bind<SqlQueryExecutor>(CONCILIACION_JOB_TYPES.SqlQueryExecutor)
      .toConstantValue(overrides.txManager);
    container
      .bind<DatabaseTransactionManager>(CONCILIACION_JOB_TYPES.DatabaseTransactionManager)
      .toConstantValue(overrides.txManager);
  }

  container
    .bind<KeyValueCacheClient>(CONCILIACION_JOB_TYPES.KeyValueCacheClient)
    .toDynamicValue(() =>
      baseSyncContainer.get<KeyValueCacheClient>(SINCRONIZADOR_TYPES.RedisCacheClient),
    )
    .inSingletonScope();

  container
    .bind<SyncQuotaGovernor>(CONCILIACION_JOB_TYPES.SyncQuotaGovernor)
    .toDynamicValue(() =>
      baseSyncContainer.get<SyncQuotaGovernor>(SINCRONIZADOR_TYPES.SyncQuotaGovernor),
    )
    .inSingletonScope();

  container
    .bind<PartitionAdvisoryLock>(CONCILIACION_JOB_TYPES.PartitionAdvisoryLock)
    .toDynamicValue(() => {
      if (overrides.advisoryLock) {
        return overrides.advisoryLock;
      }
      if (baseSyncContainer.isBound(SINCRONIZADOR_TYPES.PartitionAdvisoryLock)) {
        return baseSyncContainer.get<PartitionAdvisoryLock>(
          SINCRONIZADOR_TYPES.PartitionAdvisoryLock,
        );
      }
      return new PartitionAdvisoryLock(overrides.txManager!);
    })
    .inSingletonScope();

  container
    .bind<SyncDiagnosticBuilder>(CONCILIACION_JOB_TYPES.SyncDiagnosticBuilder)
    .toDynamicValue(() => new SyncDiagnosticBuilder())
    .inSingletonScope();

  container
    .bind<ExponentialBackoffPolicy>(CONCILIACION_JOB_TYPES.ExponentialBackoffPolicy)
    .toDynamicValue(() => new ExponentialBackoffPolicy())
    .inSingletonScope();

  container
    .bind<AuditEventWriter>(CONCILIACION_JOB_TYPES.AuditEventWriter)
    .toDynamicValue(() =>
      baseSyncContainer.get<AuditEventWriter>(SINCRONIZADOR_TYPES.AuditEventWriter),
    )
    .inSingletonScope();

  if (
    overrides.gwsPort ||
    baseSyncContainer.isBound(SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort)
  ) {
    container
      .bind<IGoogleDirectoryReadOnlyPort>(
        CONCILIACION_JOB_TYPES.IGoogleDirectoryReadOnlyPort,
      )
      .toDynamicValue(() =>
        baseSyncContainer.get<IGoogleDirectoryReadOnlyPort>(
          SINCRONIZADOR_TYPES.IGoogleDirectoryReadOnlyPort,
        ),
      )
      .inSingletonScope();
  }

  if (
    overrides.checkpointRepo ||
    baseSyncContainer.isBound(SINCRONIZADOR_TYPES.ICheckpointRepositoryPort)
  ) {
    container
      .bind<ICheckpointRepositoryPort>(CONCILIACION_JOB_TYPES.ICheckpointRepositoryPort)
      .toDynamicValue(() =>
        baseSyncContainer.get<ICheckpointRepositoryPort>(
          SINCRONIZADOR_TYPES.ICheckpointRepositoryPort,
        ),
      )
      .inSingletonScope();
  }

  container
    .bind<ISyncIdentityRepositoryPort>(CONCILIACION_JOB_TYPES.ISyncIdentityRepositoryPort)
    .toDynamicValue(() =>
      baseSyncContainer.get<ISyncIdentityRepositoryPort>(
        SINCRONIZADOR_TYPES.ISyncIdentityRepositoryPort,
      ),
    )
    .inSingletonScope();

  container
    .bind<AlloyDbBatchReconciliationRepository>(
      CONCILIACION_JOB_TYPES.AlloyDbBatchReconciliationRepository,
    )
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new AlloyDbBatchReconciliationRepository(
          ctx.container.get<SqlQueryExecutor>(CONCILIACION_JOB_TYPES.SqlQueryExecutor),
          ctx.container.get<ICheckpointRepositoryPort>(
            CONCILIACION_JOB_TYPES.ICheckpointRepositoryPort,
          ),
          ctx.container.get<ISyncIdentityRepositoryPort>(
            CONCILIACION_JOB_TYPES.ISyncIdentityRepositoryPort,
          ),
          baseSyncContainer.get<HandleAccountLifecycleChangeUseCase>(
            SINCRONIZADOR_TYPES.HandleAccountLifecycleChangeUseCase,
          ),
          baseSyncContainer.get<RecordSyncFailureDlqUseCase>(
            SINCRONIZADOR_TYPES.RecordSyncFailureDlqUseCase,
          ),
        ),
    )
    .inSingletonScope();

  container
    .bind<IBatchReconciliationRepositoryPort>(
      CONCILIACION_JOB_TYPES.IBatchReconciliationRepositoryPort,
    )
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        overrides.batchRepository ??
        ctx.container.get<AlloyDbBatchReconciliationRepository>(
          CONCILIACION_JOB_TYPES.AlloyDbBatchReconciliationRepository,
        ),
    )
    .inSingletonScope();

  container
    .bind<RunPartitionReconciliationUseCase>(
      CONCILIACION_JOB_TYPES.RunPartitionReconciliationUseCase,
    )
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        new RunPartitionReconciliationUseCase(
          ctx.container.get<IBatchReconciliationRepositoryPort>(
            CONCILIACION_JOB_TYPES.IBatchReconciliationRepositoryPort,
          ),
          ctx.container.get<IGoogleDirectoryReadOnlyPort>(
            CONCILIACION_JOB_TYPES.IGoogleDirectoryReadOnlyPort,
          ),
          ctx.container.get<SyncQuotaGovernor>(CONCILIACION_JOB_TYPES.SyncQuotaGovernor),
          ctx.container.get<PartitionAdvisoryLock>(
            CONCILIACION_JOB_TYPES.PartitionAdvisoryLock,
          ),
          ctx.container.get<AuditEventWriter>(CONCILIACION_JOB_TYPES.AuditEventWriter),
          ctx.container.get<SyncDiagnosticBuilder>(
            CONCILIACION_JOB_TYPES.SyncDiagnosticBuilder,
          ),
        ),
    )
    .inSingletonScope();

  container
    .bind<IBatchReconciliationRunnerPort>(CONCILIACION_JOB_TYPES.IBatchReconciliationRunnerPort)
    .toDynamicValue(
      (ctx: interfaces.Context) =>
        overrides.runner ??
        ctx.container.get<RunPartitionReconciliationUseCase>(
          CONCILIACION_JOB_TYPES.RunPartitionReconciliationUseCase,
        ),
    )
    .inSingletonScope();

  return container;
}
