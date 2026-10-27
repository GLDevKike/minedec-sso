import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { ManageCatalogsUseCase } from '../../../application/manage-catalogs.usecase';
import { CATEGORIAS_CATALOGO } from '../../../domain/services/catalog-derivation.service';

const CategoriaAtributoParamSchema = z.object({
  categoriaAtributo: z.enum(CATEGORIAS_CATALOGO),
});

const CatalogEntryUpsertBodySchema = z.object({
  codigoValor: z.string().trim().min(1).max(60),
  codigoPadre: z.string().trim().min(1).max(60).nullable().optional(),
  etiquetaVisible: z.string().trim().min(1).max(150),
  nivelAcademicoDerivado: z.string().trim().min(1).max(60).nullable().optional(),
  sinonimosOrigen: z.array(z.string().trim().min(1)).optional(),
  requiereVigenciaTemporal: z.boolean().optional().default(false),
  activo: z.boolean(),
});

export class CatalogsAdminController {
  public readonly router: Router;

  public constructor(private readonly manageCatalogsUseCase: ManageCatalogsUseCase) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get(
      '/api/v1/admin/catalogs/:categoriaAtributo',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { categoriaAtributo } = CategoriaAtributoParamSchema.parse(req.params);
          const onlyActive = req.query.onlyActive !== 'false';
          const items = await this.manageCatalogsUseCase.listCatalogByCategory(
            categoriaAtributo,
            onlyActive,
          );
          res.status(200).json(items);
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.put(
      '/api/v1/admin/catalogs/:categoriaAtributo',
      async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { categoriaAtributo } = CategoriaAtributoParamSchema.parse(req.params);
          const body = CatalogEntryUpsertBodySchema.parse(req.body);
          const updated = await this.manageCatalogsUseCase.upsertCatalogEntry({
            categoriaAtributo,
            ...body,
            actorIdentificacion: req.actorIdentificacion,
          });
          res.status(200).json(updated);
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
