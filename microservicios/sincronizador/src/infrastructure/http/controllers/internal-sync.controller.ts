import crypto from 'node:crypto';
import { Request, Response } from 'express';
import {
  buildNaturalLanguageIncidentDiagnostic,
  createStructuredLogger,
  StructuredLogger,
  SyncDiagnosticBuilder,
} from '@minedec/shared';
import { ExecuteDeltaSweepUseCase } from '../../../application/use-cases/execute-delta-sweep.use-case';
import { ExecuteIncrementalSyncUseCase } from '../../../application/use-cases/execute-incremental-sync.use-case';
import { GetDetailedSyncHealthUseCase } from '../../../application/use-cases/get-detailed-sync-health.use-case';
import { ProcessPubSubEventUseCase } from '../../../application/use-cases/process-pubsub-event.use-case';
import { ReconcileHotRegistrationUseCase } from '../../../application/use-cases/reconcile-hot-registration.use-case';
import {
  DecodedGwsAuditEventSchema,
  DeltaSweepRequestSchema,
  IncrementalSyncTaskSchema,
  PriorityHotRegistrationTaskSchema,
  PubSubPushEnvelopeSchema,
} from '../schemas/sync-api.schemas';

/**
 * Controlador Express 5 para los endpoints internos del Sincronizador (`T028`, `T042`, `T062`, `T085`):
 * - `POST /internal/v1/sync/events/pubsub-push`
 * - `POST /internal/v1/sync/tasks/incremental`
 * - `POST /internal/v1/sync/tasks/delta-sweep`
 * - `POST /internal/v1/sync/tasks/priority-hot-registration`
 * - `GET /internal/v1/sync/health/detailed`
 */
export class InternalSyncController {
  private readonly logger: StructuredLogger;

  constructor(
    private readonly processPubSubEventUseCase: ProcessPubSubEventUseCase,
    private readonly executeIncrementalSyncUseCase: ExecuteIncrementalSyncUseCase,
    private readonly executeDeltaSweepUseCase: ExecuteDeltaSweepUseCase,
    private readonly reconcileHotRegistrationUseCase: ReconcileHotRegistrationUseCase,
    private readonly getDetailedSyncHealthUseCase: GetDetailedSyncHealthUseCase,
    logger?: StructuredLogger,
  ) {
    this.logger = logger ?? createStructuredLogger('conecta-sincronizador');
  }

  public handlePubSubPush = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsedEnvelope = PubSubPushEnvelopeSchema.safeParse(req.body);

    if (!parsedEnvelope.success) {
      const diag = SyncDiagnosticBuilder.build({
        escenario: 'INVALID_GWS_PAYLOAD',
        detalleError: parsedEnvelope.error.message,
      });
      res.status(400).json({
        code: 'INVALID_PUBSUB_ENVELOPE',
        message: 'El sobre de Cloud Pub/Sub recibido no cumple el esquema esperado.',
        diagnosticoLenguajeNatural: diag.resumenEjecutivo,
        accionRecomendada: diag.accionRecomendada,
      });
      return;
    }

    let decodedJson: Record<string, unknown>;
    try {
      const jsonText = Buffer.from(
        parsedEnvelope.data.message.data,
        'base64',
      ).toString('utf8');
      decodedJson = JSON.parse(jsonText) as Record<string, unknown>;
    } catch (error) {
      const diag = SyncDiagnosticBuilder.build({
        escenario: 'INVALID_GWS_PAYLOAD',
        detalleError: error instanceof Error ? error.message : 'Base64/JSON inválido',
      });
      res.status(400).json({
        code: 'INVALID_PUBSUB_BASE64_JSON',
        message: 'El campo message.data no contiene un JSON válido codificado en Base64.',
        diagnosticoLenguajeNatural: diag.resumenEjecutivo,
        accionRecomendada: diag.accionRecomendada,
      });
      return;
    }

    const parsedEvent = DecodedGwsAuditEventSchema.safeParse(decodedJson);
    if (!parsedEvent.success) {
      const diag = SyncDiagnosticBuilder.build({
        escenario: 'INVALID_GWS_PAYLOAD',
        detalleError: parsedEvent.error.message,
      });
      res.status(400).json({
        code: 'INVALID_GWS_EVENT_PAYLOAD',
        message: 'El payload del evento de directorio es inválido.',
        diagnosticoLenguajeNatural: diag.resumenEjecutivo,
        accionRecomendada: diag.accionRecomendada,
      });
      return;
    }

    const eventData = parsedEvent.data;
    const idEventoExterno =
      eventData.idEventoExterno ??
      eventData.eventId ??
      parsedEnvelope.data.message.messageId;
    const tipoEvento = eventData.tipoEvento ?? eventData.eventType ?? 'CHANGE_USER';
    const timestampEventoGws =
      eventData.timestampEventoGws ??
      parsedEnvelope.data.message.publishTime ??
      new Date().toISOString();

    const ack = await this.processPubSubEventUseCase.execute({
      messageId: parsedEnvelope.data.message.messageId,
      publishTime: parsedEnvelope.data.message.publishTime,
      idEventoExterno,
      tipoEvento,
      googleSubId: eventData.googleSubId,
      emailPrincipal: eventData.emailPrincipal,
      dominio: eventData.dominio,
      orgUnitPath: eventData.orgUnitPath,
      timestampEventoGws,
      esRegistroCaliente: eventData.esRegistroCaliente,
      colaPendientesEstimada: eventData.colaPendientesEstimada,
      antiguedadMensajeMasViejoSegundos: eventData.antiguedadMensajeMasViejoSegundos,
      traceId,
    });

    if (
      req.path === '/internal/v1/sync/events/pubsub' &&
      ack.status.startsWith('ENQUEUED')
    ) {
      res.status(202).json({
        ...ack,
        status: 'ENQUEUED',
      });
      return;
    }

    res.status(200).json(ack);
  };

  public handleIncrementalTask = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsed = IncrementalSyncTaskSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_INCREMENTAL_TASK_PAYLOAD',
        message: parsed.error.message,
      });
      return;
    }

    try {
      const result = await this.executeIncrementalSyncUseCase.execute({
        ...parsed.data,
        traceId,
      });
      res.status(200).json(result);
    } catch (error) {
      this.handleTaskError(error, req, res);
    }
  };

  public handleDeltaSweepTask = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsed = DeltaSweepRequestSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_DELTA_SWEEP_REQUEST',
        message: parsed.error.message,
      });
      return;
    }

    const result = await this.executeDeltaSweepUseCase.execute({
      ...parsed.data,
      traceId,
    });
    res.status(200).json(result);
  };

  public handlePriorityHotRegistrationTask = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsed = PriorityHotRegistrationTaskSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_HOT_REGISTRATION_TASK',
        message: parsed.error.message,
      });
      return;
    }

    try {
      const result = await this.reconcileHotRegistrationUseCase.execute({
        ...parsed.data,
        traceId,
      });
      res.status(200).json(result);
    } catch (error) {
      this.handleTaskError(error, req, res);
    }
  };

  public handleDetailedHealth = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const spanId = (req as unknown as { spanId?: string }).spanId;
    try {
      const health = await this.getDetailedSyncHealthUseCase.execute();
      res.status(200).json(health);
    } catch (error) {
      const diag = SyncDiagnosticBuilder.build({
        escenario: 'GWS_QUOTA_THROTTLED',
        detalleError: error instanceof Error ? error.message : String(error),
      });
      const adminDiag = buildNaturalLanguageIncidentDiagnostic(error, { traceId });
      this.logger.error('Degradación crítica detectada en sonda de salud del Sincronizador (FAIL_CLOSE_ACTIVO)', {
        traceId,
        spanId,
        httpMethod: req.method,
        httpPath: req.originalUrl || req.url,
        error,
        diagnosticoAdministrador: adminDiag,
      });
      res.status(503).json({
        status: 'CRITICAL_FAIL_CLOSE',
        quotaBudget: {
          googleOfficialLimitRps: 40,
          minedecHardCeilingRps: 28,
          batchJobActive: false,
          priorityHotRegReservedRps: 5,
          incrementalAllocatedRps: 23,
          batchJobAllocatedRps: 20,
          currentGlobalUsedRps: 0,
        },
        batchSwitchHysteresis: {
          currentMode: 'INDIVIDUAL_GET',
          highWatermarkPendingEvents: 100,
          highWatermarkMaxAgeSeconds: 10,
          lowWatermarkRestoreEvents: 20,
        },
        diagnosticoAdministrador: {
          tituloLenguajeNatural: 'Degradación crítica detectada en el Sincronizador (FAIL_CLOSE_ACTIVO)',
          explicacionLenguajeNatural: diag.resumenEjecutivo,
          posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
          pasosRecomendados: [diag.accionRecomendada],
        },
      });
    }
  };

  private handleTaskError(error: unknown, req: Request, res: Response): void {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const spanId = (req as unknown as { spanId?: string }).spanId;
    const status =
      error && typeof error === 'object' && 'httpStatus' in error
        ? Number((error as Record<string, unknown>).httpStatus)
        : 500;
    const retryAfter =
      error && typeof error === 'object' && 'retryAfterSeconds' in error
        ? Number((error as Record<string, unknown>).retryAfterSeconds)
        : 2;

    if (status === 429) {
      res.setHeader('Retry-After', String(retryAfter));
    }

    const diag = SyncDiagnosticBuilder.build({
      escenario: 'GWS_QUOTA_THROTTLED',
      httpStatusGws: status,
      detalleError: error instanceof Error ? error.message : String(error),
    });
    const adminDiag = buildNaturalLanguageIncidentDiagnostic(error, {
      traceId,
      componentHint: status === 429 ? 'GOOGLE_WORKSPACE_ADMIN_SDK' : undefined,
    });

    this.logger.error(
      status === 429
        ? 'Tarea de sincronización diferida por gobernador de cuota GWS (HTTP 429)'
        : 'Excepción controlada durante la ejecución de tarea interna de sincronización',
      {
        traceId,
        spanId,
        httpMethod: req.method,
        httpPath: req.originalUrl || req.url,
        httpStatus: status,
        error,
        diagnosticoLenguajeNatural: diag.resumenEjecutivo,
        diagnosticoAdministrador: adminDiag,
      },
    );

    res.status(status).json({
      code: status === 429 ? 'QUOTA_GOVERNOR_THROTTLED' : 'INTERNAL_SYNC_TASK_ERROR',
      message: error instanceof Error ? error.message : 'Error interno de sincronización',
      diagnosticoLenguajeNatural: diag.resumenEjecutivo,
      accionRecomendada: diag.accionRecomendada,
      traceId,
    });
  }
}
