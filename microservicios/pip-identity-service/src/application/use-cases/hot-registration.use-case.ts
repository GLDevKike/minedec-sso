import {
  PrioritySyncQueuePort,
  PrioritySyncRequestPayload,
} from '../../domain/ports';
import {
  ResolveIdentityCommand,
  ResolveIdentityOutcome,
  ResolveIdentityUseCase,
} from '../resolve-identity.usecase';

export const PRIORITY_HOT_REG_QUEUE_NAME = 'sync-priority-hot-reg-queue' as const;

export interface HotRegistrationPriorityTaskPayload extends PrioritySyncRequestPayload {
  cuentaId: string;
  queueName: typeof PRIORITY_HOT_REG_QUEUE_NAME;
}

export interface HotRegistrationExecutionResult extends ResolveIdentityOutcome {
  priorityTask?: {
    queueName: typeof PRIORITY_HOT_REG_QUEUE_NAME;
    taskId: string;
    enqueuedAt: string;
    cuentaId: string;
    idInternoProvisional: string;
  };
}

/**
 * Caso de uso de Aprovisionamiento en Caliente (REGISTRO_CALIENTE) e integración
 * de disparo asíncrono inmediato hacia la cola prioritaria `sync-priority-hot-reg-queue` (US3 / T043).
 * 100% libre de decoradores de framework (Principio IV).
 */
export class HotRegistrationUseCase {
  public constructor(
    private readonly resolveIdentityUseCase: ResolveIdentityUseCase,
    private readonly prioritySyncQueuePort: PrioritySyncQueuePort,
  ) {}

  public async execute(
    command: ResolveIdentityCommand,
  ): Promise<HotRegistrationExecutionResult> {
    const outcome = await this.resolveIdentityUseCase.resolveOrHotRegisterIdentity(command);

    if (
      outcome.statusCode === 202 &&
      outcome.response.cuentaActiva.estadoSincronizacion === 'REGISTRO_CALIENTE'
    ) {
      const requestedAt = new Date().toISOString();
      const enqueueResult = await this.prioritySyncQueuePort.enqueuePriorityAccountSync({
        googleSubId: command.googleSubId.trim(),
        emailPrincipal: outcome.response.cuentaActiva.emailPrincipal,
        dominio: outcome.response.cuentaActiva.dominio,
        provisionalIdInterno: outcome.response.idInterno,
        requestedAt,
        traceId: command.traceId,
      });

      return {
        ...outcome,
        priorityTask: {
          queueName: PRIORITY_HOT_REG_QUEUE_NAME,
          taskId: enqueueResult.taskId,
          enqueuedAt: enqueueResult.enqueuedAt,
          cuentaId: outcome.response.cuentaActiva.cuentaId,
          idInternoProvisional: outcome.response.idInterno,
        },
      };
    }

    return outcome;
  }
}
