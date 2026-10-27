import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  ResolveIdentityRequestSchema,
  TIPOS_IDENTIFICACION_PERSONA,
} from '@minedec/shared';
import { ResolveIdentityUseCase } from '../../../application/resolve-identity.usecase';

const GetIdentityPathSchema = z.object({
  numeroIdentificacion: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{5,20}$/i, 'Formato de numeroIdentificacion inválido'),
});

const GetIdentityQuerySchema = z.object({
  tipoIdentificacion: z.enum(TIPOS_IDENTIFICACION_PERSONA).optional(),
});

export class ResolveAndQueryIdentityController {
  public readonly router: Router;

  public constructor(private readonly resolveIdentityUseCase: ResolveIdentityUseCase) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.post(
      '/internal/v1/pip/identities/resolve',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const parsedBody = ResolveIdentityRequestSchema.parse(req.body);
          const outcome =
            await this.resolveIdentityUseCase.resolveOrHotRegisterIdentity(parsedBody);
          res.status(outcome.statusCode).json(outcome.response);
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.get(
      '/api/v1/admin/identities/:numeroIdentificacion',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { numeroIdentificacion } = GetIdentityPathSchema.parse(req.params);
          const { tipoIdentificacion } = GetIdentityQuerySchema.parse(req.query);
          const view =
            await this.resolveIdentityUseCase.getUnifiedIdentityByIdentification(
              numeroIdentificacion,
              tipoIdentificacion,
            );
          res.status(200).json(view);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
