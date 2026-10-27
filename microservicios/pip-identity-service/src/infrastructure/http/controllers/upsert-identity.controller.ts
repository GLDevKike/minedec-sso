import { NextFunction, Request, Response, Router } from 'express';
import { UpsertWorkspaceAccountRequestSchema } from '@minedec/shared';
import { UpsertDirectoryIdentityUseCase } from '../../../application/upsert-directory-identity.usecase';

export class UpsertIdentityController {
  public readonly router: Router;

  public constructor(
    private readonly upsertDirectoryIdentityUseCase: UpsertDirectoryIdentityUseCase,
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.put(
      '/internal/v1/pip/identities/upsert',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const parsedBody = UpsertWorkspaceAccountRequestSchema.parse(req.body);
          const result = await this.upsertDirectoryIdentityUseCase.execute(parsedBody);
          res.status(200).json(result);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
