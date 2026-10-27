import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { NIVELES_ESTRUCTURA_ORGANIZACIONAL } from '@minedec/shared';
import { ManageMultisedeContextUseCase } from '../../../application/manage-multisede-context.usecase';

const NumeroIdentificacionParamSchema = z.object({
  numeroIdentificacion: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{5,20}$/i, 'Formato de numeroIdentificacion inválido'),
});

const CreateContextAssignmentBodySchema = z.object({
  nivelEstructura: z.enum(NIVELES_ESTRUCTURA_ORGANIZACIONAL),
  viceministerio: z
    .enum(['EDUCACION', 'DEPORTE', 'CULTURA', 'GESTION_EDUCATIVA', 'NO_APLICA'])
    .optional(),
  codigoZona: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-9]|2[0-4]|90)$/, 'Formato de codigoZona inválido'),
  codigoDistrito: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}$/, 'Formato de codigoDistrito inválido')
    .nullable()
    .optional(),
  codigoCircuito: z
    .string()
    .trim()
    .regex(
      /^(0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}C[0-9]{2}(_[0-9]{2})?$/,
      'Formato de codigoCircuito inválido',
    )
    .nullable()
    .optional(),
  codigoAmie: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-9]|2[0-4]|90)[A-Z][0-9]{5}$/, 'Formato de codigoAmie inválido')
    .nullable()
    .optional(),
  codigoDependenciaAdmin: z.string().trim().max(40).nullable().optional(),
  cargoFuncion: z.string().trim().max(60).nullable().optional(),
  motivoAsignacion: z.string().trim().min(5).max(500),
});

export class ContextAssignmentsAdminController {
  public readonly router: Router;

  public constructor(
    private readonly manageMultisedeContextUseCase: ManageMultisedeContextUseCase,
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post(
      '/api/v1/admin/identities/:numeroIdentificacion/context-assignments',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { numeroIdentificacion } = NumeroIdentificacionParamSchema.parse(
            req.params,
          );
          const body = CreateContextAssignmentBodySchema.parse(req.body);
          const created =
            await this.manageMultisedeContextUseCase.assignComplementaryContext({
              numeroIdentificacion,
              ...body,
              actorIdentificacion: req.actorIdentificacion,
            });
          res.status(201).json(created);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
