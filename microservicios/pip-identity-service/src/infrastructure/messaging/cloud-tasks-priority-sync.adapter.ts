import { randomUUID } from 'crypto';
import {
  extractOrCreateOtelSpanContext,
  StructuredLogger,
} from '@minedec/shared';
import {
  PrioritySyncQueuePort,
  PrioritySyncRequestPayload,
} from '../../domain/ports';

export interface CloudTasksQueueConfig {
  projectId: string;
  location: string;
  queueName: string;
  targetSyncUrl: string;
}

export interface RecordedPrioritySyncTask {
  taskId: string;
  queuePath: string;
  enqueuedAt: string;
  headers: Record<string, string>;
  payload: PrioritySyncRequestPayload;
}

export class CloudTasksPrioritySyncAdapter implements PrioritySyncQueuePort {
  private readonly recordedTasks: RecordedPrioritySyncTask[] = [];
  private readonly config: CloudTasksQueueConfig;
  private readonly logger?: StructuredLogger;

  public constructor(
    config?: Partial<CloudTasksQueueConfig> & { logger?: StructuredLogger },
    logger?: StructuredLogger,
  ) {
    this.config = {
      projectId: config?.projectId ?? process.env.GCP_PROJECT_ID ?? 'minedec-sso-dev',
      location: config?.location ?? process.env.GCP_REGION ?? 'us-central1',
      queueName:
        config?.queueName ??
        process.env.CLOUD_TASKS_PRIORITY_SYNC_QUEUE ??
        'pip-priority-sync-queue',
      targetSyncUrl:
        config?.targetSyncUrl ??
        process.env.PRIORITY_SYNC_TARGET_URL ??
        'http://localhost:8082/internal/v1/sync/priority',
    };
    this.logger = config?.logger ?? logger;
  }

  public async enqueuePriorityAccountSync(
    payload: PrioritySyncRequestPayload,
  ): Promise<{ taskId: string; enqueuedAt: string }> {
    const taskId = `sync-jit-${payload.googleSubId}-${randomUUID().slice(0, 8)}`;
    const enqueuedAt = new Date().toISOString();
    const queuePath = `projects/${this.config.projectId}/locations/${this.config.location}/queues/${this.config.queueName}`;

    const otelContext = extractOrCreateOtelSpanContext({
      traceparent: payload.traceparent,
      'x-trace-id': payload.traceId,
    });
    const traceId = payload.traceId ?? otelContext.traceId;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Trace-Id': traceId,
      traceparent: otelContext.traceparent,
      'X-Cloud-Trace-Context': otelContext.cloudTraceContext,
    };

    const enrichedPayload: PrioritySyncRequestPayload = {
      ...payload,
      traceId,
      traceparent: otelContext.traceparent,
    };

    const taskRecord: RecordedPrioritySyncTask = {
      taskId,
      queuePath,
      enqueuedAt,
      headers,
      payload: enrichedPayload,
    };

    this.recordedTasks.push(taskRecord);

    this.logger?.info('Enqueued priority identity sync task for REGISTRO_CALIENTE (0 GWS calls)', {
      taskId,
      queuePath,
      traceId,
      spanId: otelContext.spanId,
      traceparent: otelContext.traceparent,
      googleSubId: payload.googleSubId,
      emailPrincipal: payload.emailPrincipal,
      dominio: payload.dominio,
      provisionalIdInterno: payload.provisionalIdInterno,
    });

    return {
      taskId,
      enqueuedAt,
    };
  }

  public getRecordedTasks(): readonly RecordedPrioritySyncTask[] {
    return this.recordedTasks;
  }

  public clearRecordedTasks(): void {
    this.recordedTasks.length = 0;
  }
}
