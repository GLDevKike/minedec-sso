import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { DeactivatePersonCascadeUseCase } from '../../../application/use-cases/deactivate-person-cascade.use-case';
import {
  ListDlqFailuresUseCase,
  ReplayDlqFailuresUseCase,
} from '../../../application/use-cases/manage-dlq-replay.use-case';
import {
  ListReconciliationCheckpointsUseCase,
  PartitionActiveConflictError,
  TriggerPartitionReconciliationUseCase,
} from '../../../application/use-cases/manage-reconciliation-partitions.use-case';
import {
  EstadoEjecucionCheckpoint,
  EstadoRegistroDlq,
  TipoProcesoConciliacion,
} from '../../../domain/entities/sync-entities';
import {
  DeactivatePersonRequestSchema,
  ReplayDlqRequestSchema,
  TriggerPartitionRequestSchema,
} from '../schemas/sync-api.schemas';

const UuidParamSchema = z.string().uuid();

/**
 * Controlador Express 5 para los endpoints administrativos del Sincronizador (`T036`, `T052`, `T061`):
 * - `POST /api/v1/admin/sync/persons/:idInterno/deactivate`
 * - `GET /api/v1/admin/sync/checkpoints`
 * - `POST /api/v1/admin/sync/partitions/trigger`
 * - `GET /api/v1/admin/sync/dlq`
 * - `POST /api/v1/admin/sync/dlq/replay`
 */
export class AdminSyncController {
  constructor(
    private readonly deactivatePersonCascadeUseCase: DeactivatePersonCascadeUseCase,
    private readonly listCheckpointsUseCase: ListReconciliationCheckpointsUseCase,
    private readonly triggerPartitionUseCase: TriggerPartitionReconciliationUseCase,
    private readonly listDlqUseCase: ListDlqFailuresUseCase,
    private readonly replayDlqUseCase: ReplayDlqFailuresUseCase,
  ) {}

  public handleDeactivatePerson = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const idParsed = UuidParamSchema.safeParse(req.params.idInterno);
    if (!idParsed.success) {
      res.status(400).json({
        code: 'INVALID_PERSON_UUID',
        message: 'El identificador idInterno debe ser un UUID v4 válido.',
      });
      return;
    }

    const bodyParsed = DeactivatePersonRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({
        code: 'INVALID_DEACTIVATE_REQUEST',
        message: bodyParsed.error.message,
      });
      return;
    }

    const adminIdentificacion =
      bodyParsed.data.adminIdentificacion ??
      String(
        req.headers['x-minedec-admin-identificacion'] ??
          req.headers['x-goog-authenticated-user-email'] ??
          'admin-pap',
      );

    const result = await this.deactivatePersonCascadeUseCase.execute({
      idInterno: idParsed.data,
      nuevoEstadoPersona: bodyParsed.data.nuevoEstadoPersona,
      adminIdentificacion,
      motivoDesactivacion: bodyParsed.data.motivoDesactivacion,
      traceId,
    });

    if (!result) {
      res.status(404).json({
        code: 'PERSON_NOT_FOUND',
        message: `No existe una PersonaIdentidad con idInterno ${idParsed.data}.`,
      });
      return;
    }

    res.status(200).json(result);
  };

  public handleListCheckpoints = async (req: Request, res: Response): Promise<void> => {
    const dominio =
      typeof req.query.dominio === 'string' ? req.query.dominio : undefined;
    const tipoProceso =
      typeof req.query.tipoProceso === 'string'
        ? (req.query.tipoProceso as TipoProcesoConciliacion)
        : undefined;
    const estadoEjecucion =
      typeof req.query.estadoEjecucion === 'string'
        ? (req.query.estadoEjecucion as EstadoEjecucionCheckpoint)
        : undefined;

    const result = await this.listCheckpointsUseCase.execute({
      dominio,
      tipoProceso,
      estadoEjecucion,
    });
    res.status(200).json(result);
  };

  public handleTriggerPartition = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsed = TriggerPartitionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_TRIGGER_PARTITION_REQUEST',
        message: parsed.error.message,
      });
      return;
    }

    try {
      const summary = await this.triggerPartitionUseCase.execute({
        ...parsed.data,
        traceId,
      });
      res.status(200).json(summary);
    } catch (error) {
      if (error instanceof PartitionActiveConflictError) {
        res.status(409).json({
          code: error.code,
          message: error.message,
          diagnosticoLenguajeNatural: error.diagnosticoLenguajeNatural,
          accionRecomendada: error.accionRecomendada,
        });
        return;
      }
      res.status(400).json({
        code: 'PARTITION_TRIGGER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  public handleListDlq = async (req: Request, res: Response): Promise<void> => {
    const estadoDlq =
      typeof req.query.estadoDlq === 'string'
        ? (req.query.estadoDlq as EstadoRegistroDlq)
        : undefined;
    const dominio =
      typeof req.query.dominio === 'string' ? req.query.dominio : undefined;
    const limit =
      typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

    const result = await this.listDlqUseCase.execute({
      estadoDlq,
      dominio,
      limit,
    });
    res.status(200).json(result);
  };

  public handleReplayDlq = async (req: Request, res: Response): Promise<void> => {
    const traceId = String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const parsed = ReplayDlqRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_DLQ_REPLAY_REQUEST',
        message: parsed.error.message,
      });
      return;
    }

    const result = await this.replayDlqUseCase.execute({
      ...parsed.data,
      traceId,
    });
    res.status(200).json(result);
  };
}
