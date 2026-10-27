import {
  createStructuredLogger,
  OtelSpanTelemetry,
  PartitionAdvisoryLock,
  SyncQuotaGovernor,
  withOtelSpan,
} from '@minedec/shared';
import { TipoProcesoConciliacion } from '@minedec/sincronizador';
import {
  ConciliacionJobContainerOverrides,
  CONCILIACION_JOB_TYPES,
  createConciliacionJobContainer,
} from './container';
import {
  IBatchReconciliationRunnerPort,
  ResultadoEjecucionParticion,
} from './domain/batch-reconciliation.types';

export interface CliPartitionEnvironment {
  SYNC_DOMINIO?: string;
  SYNC_ORG_UNIT_PATH?: string;
  SYNC_TIPO_PROCESO?: string;
  SYNC_FORZAR_REINICIO?: string;
  TRACE_ID?: string;
}

export async function executeConciliacionJobFromEnv(
  env: CliPartitionEnvironment = process.env,
  overrides: ConciliacionJobContainerOverrides & {
    onSpanEnd?: (span: OtelSpanTelemetry) => void;
  } = {},
): Promise<ResultadoEjecucionParticion[]> {
  const logger = createStructuredLogger('sso-conciliacion-job');
  const container = createConciliacionJobContainer(overrides);
  const runner = container.get<IBatchReconciliationRunnerPort>(
    CONCILIACION_JOB_TYPES.IBatchReconciliationRunnerPort,
  );
  const advisoryLock = container.get<PartitionAdvisoryLock>(
    CONCILIACION_JOB_TYPES.PartitionAdvisoryLock,
  );
  const quotaGovernor = container.get<SyncQuotaGovernor>(
    CONCILIACION_JOB_TYPES.SyncQuotaGovernor,
  );

  const dominio = env.SYNC_DOMINIO?.trim().toLowerCase();
  const orgUnitPath = env.SYNC_ORG_UNIT_PATH?.trim() || '/';
  const tipoProceso: TipoProcesoConciliacion =
    env.SYNC_TIPO_PROCESO === 'CARGA_INICIAL' ? 'CARGA_INICIAL' : 'CONCILIACION_NOCTURNA';
  const forzarReinicio =
    env.SYNC_FORZAR_REINICIO === 'true' || env.SYNC_FORZAR_REINICIO === '1';

  const gracefulCleanup = async (signal: string): Promise<void> => {
    logger.warn('Señal de terminación recibida en conciliacion-job; liberando locks y bandera Redis', {
      signal,
      dominio,
      orgUnitPath,
      tipoProceso,
    });
    await quotaGovernor.setBatchModeActive(false);
    if (dominio) {
      await advisoryLock.releasePartitionLock(dominio, orgUnitPath, tipoProceso);
    }
  };

  const onSigTerm = (): void => {
    void gracefulCleanup('SIGTERM');
  };
  const onSigInt = (): void => {
    void gracefulCleanup('SIGINT');
  };

  process.once('SIGTERM', onSigTerm);
  process.once('SIGINT', onSigInt);

  try {
    return await withOtelSpan(
      'conciliacion-job.run',
      {
        kind: 'INTERNAL',
        parentContext: env.TRACE_ID ? { traceId: env.TRACE_ID } : undefined,
        logger,
        onSpanEnd: overrides.onSpanEnd,
        attributes: {
          dominio: dominio ?? 'ALL_ACTIVE_DOMAINS',
          orgUnitPath,
          tipoProceso,
          forzarReinicio,
          cloudRunJob: process.env.CLOUD_RUN_JOB ?? 'sso-conciliacion-job',
          cloudRunExecution: process.env.CLOUD_RUN_EXECUTION ?? 'local',
        },
      },
      async (spanContext) => {
        const tracedLogger = logger.withTraceId(spanContext.traceId, spanContext.spanId);
        if (dominio) {
          const singleResult = await runner.runPartition({
            dominio,
            orgUnitPath,
            tipoProceso,
            forzarReinicioDesdeCero: forzarReinicio,
          });
          tracedLogger.info('Ejecución de partición completada en Cloud Run Job', {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            checkpointId: singleResult.checkpointId,
            dominio: singleResult.dominio,
            orgUnitPath: singleResult.orgUnitPath,
            tipoProceso: singleResult.tipoProceso,
            totalProcesados: singleResult.totalProcesados,
            totalActualizados: singleResult.totalActualizados,
            totalOmitidosSinCambios: singleResult.totalOmitidosSinCambios,
          });
          return [singleResult];
        }

        const allResults = await runner.runAllActiveDomainPartitions(tipoProceso, orgUnitPath);
        tracedLogger.info('Ejecución de todas las particiones de dominios activos completada', {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          tipoProceso,
          orgUnitPath,
          particionesEjecutadas: allResults.length,
        });
        return allResults;
      },
    );
  } finally {
    process.removeListener('SIGTERM', onSigTerm);
    process.removeListener('SIGINT', onSigInt);
  }
}

/* istanbul ignore next */
if (require.main === module) {
  executeConciliacionJobFromEnv().catch((err) => {
    const logger = createStructuredLogger('sso-conciliacion-job');
    logger.error('Fallo fatal en Cloud Run Job de conciliación masiva', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
