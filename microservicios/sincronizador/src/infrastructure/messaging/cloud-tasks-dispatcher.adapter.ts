import crypto from 'node:crypto';
import { extractOrCreateOtelSpanContext } from '@minedec/shared';
import { ISyncTaskDispatcherPort } from '../../domain/ports/sync-ports';
import { TipoEventoDirectorio } from '../../domain/entities/sync-entities';

export interface CloudTasksClientLike {
  createTask(request: {
    parent: string;
    task: {
      httpRequest: {
        httpMethod: 'POST';
        url: string;
        headers: Record<string, string>;
        body: string;
        oidcToken?: {
          serviceAccountEmail: string;
          audience?: string;
        };
      };
    };
  }): Promise<[{ name?: string | null }]>;
}

export interface CloudTasksDispatcherOptions {
  projectId: string;
  location: string;
  serviceBaseUrl: string;
  priorityHotRegQueueName?: string;
  incrementalQueueName?: string;
  serviceAccountEmail?: string;
  oidcAudience?: string;
  tasksClient?: CloudTasksClientLike;
}

/**
 * Adaptador de despacho hacia las colas de Cloud Tasks (`sync-priority-hot-reg-queue` a `5 dispatches/s`
 * y `sync-incremental-queue` a `23 dispatches/s`) con propagación de `trace_id` (`T019`).
 */
export class CloudTasksDispatcherAdapter implements ISyncTaskDispatcherPort {
  private readonly priorityQueue: string;
  private readonly incrementalQueue: string;

  constructor(private readonly options: CloudTasksDispatcherOptions) {
    this.priorityQueue = options.priorityHotRegQueueName ?? 'sync-priority-hot-reg-queue';
    this.incrementalQueue = options.incrementalQueueName ?? 'sync-incremental-queue';
  }

  public async enqueuePriorityHotRegistration(payload: {
    idEventoExterno: string;
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    solicitadoEn: string;
    traceId: string;
  }): Promise<{ taskId: string; queueName: string }> {
    return this.dispatchHttpTask(
      this.priorityQueue,
      '/internal/v1/sync/tasks/priority-hot-registration',
      payload,
      payload.traceId,
    );
  }

  public async enqueueIncrementalSync(payload: {
    idEventoExterno: string;
    tipoEvento: TipoEventoDirectorio | string;
    googleSubId?: string;
    emailPrincipal?: string;
    dominio?: string;
    orgUnitPath?: string;
    timestampEventoGws: string;
    colaPendientesAlDespachar?: number;
    antiguedadMensajeMasViejoSegundos?: number;
    traceId: string;
  }): Promise<{ taskId: string; queueName: string }> {
    return this.dispatchHttpTask(
      this.incrementalQueue,
      '/internal/v1/sync/tasks/incremental',
      payload,
      payload.traceId,
    );
  }

  private async dispatchHttpTask(
    queueName: string,
    targetPath: string,
    payload: Record<string, unknown>,
    traceId: string,
  ): Promise<{ taskId: string; queueName: string }> {
    if (!this.options.tasksClient) {
      return {
        taskId: `local-task-${crypto.randomUUID()}`,
        queueName,
      };
    }

    const otelContext = extractOrCreateOtelSpanContext({
      'x-trace-id': traceId,
    });
    const parent = `projects/${this.options.projectId}/locations/${this.options.location}/queues/${queueName}`;
    const bodyBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const normalizedBaseUrl = this.options.serviceBaseUrl.replace(/\/$/, '');
    const httpRequest: {
      httpMethod: 'POST';
      url: string;
      headers: Record<string, string>;
      body: string;
      oidcToken?: {
        serviceAccountEmail: string;
        audience?: string;
      };
    } = {
      httpMethod: 'POST',
      url: `${normalizedBaseUrl}${targetPath}`,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        traceparent: otelContext.traceparent,
        'X-Cloud-Trace-Context': otelContext.cloudTraceContext,
      },
      body: bodyBase64,
    };

    if (this.options.serviceAccountEmail) {
      httpRequest.oidcToken = {
        serviceAccountEmail: this.options.serviceAccountEmail,
        audience: this.options.oidcAudience ?? normalizedBaseUrl,
      };
    }

    const [response] = await this.options.tasksClient.createTask({
      parent,
      task: {
        httpRequest,
      },
    });

    return {
      taskId: response.name ?? `task-${crypto.randomUUID()}`,
      queueName,
    };
  }
}
