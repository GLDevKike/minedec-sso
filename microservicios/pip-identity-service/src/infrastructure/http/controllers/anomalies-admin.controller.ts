import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { CODIGOS_CAUSAL_ANOMALIA } from '@minedec/shared';
import { ManageAnomaliesUseCase } from '../../../application/manage-anomalies.usecase';

const AnomalyFilterQuerySchema = z.object({
  estadoAnomalia: z
    .enum(['ABIERTA', 'EN_REVISION', 'LISTA_PARA_CERRAR', 'RESUELTA', 'DESCARTADA'])
    .optional(),
  efectoAcceso: z.enum(['BLOQUEANTE', 'RESTRINGIDA']).optional(),
  codigoCausal: z.enum(CODIGOS_CAUSAL_ANOMALIA).optional(),
  dominio: z.string().trim().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().trim().min(1).optional(),
});

const AnomalyIdParamSchema = z.object({
  anomaliaId: z.string().uuid('anomaliaId debe ser un UUID v4 válido'),
});

const ManualResolveAnomalyBodySchema = z.object({
  motivoResolucion: z.string().trim().min(10, 'motivoResolucion requiere mínimo 10 caracteres'),
});

export class AnomaliesAdminController {
  public readonly router: Router;

  public constructor(private readonly manageAnomaliesUseCase: ManageAnomaliesUseCase) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get(
      '/api/v1/admin/anomalies',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const query = AnomalyFilterQuerySchema.parse(req.query);
          const result = await this.manageAnomaliesUseCase.listIdentityAnomalies(query);
          res.status(200).json(result);
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      '/api/v1/admin/anomalies/:anomaliaId/resolve',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { anomaliaId } = AnomalyIdParamSchema.parse(req.params);
          const { motivoResolucion } = ManualResolveAnomalyBodySchema.parse(req.body);
          const resolved =
            await this.manageAnomaliesUseCase.resolveIdentityAnomalyManually({
              anomaliaId,
              motivoResolucion,
              actorIdentificacion: req.actorIdentificacion,
            });
          res.status(200).json(resolved);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
