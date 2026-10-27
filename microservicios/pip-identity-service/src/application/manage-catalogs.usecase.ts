import { randomUUID } from 'crypto';
import { DatabaseTransactionManager } from '@minedec/shared';
import {
  AuditLogPort,
  CacheInvalidationPublisherPort,
  CatalogoAtributoRepositoryPort,
} from '../domain/ports';
import {
  CatalogDerivationService,
  CategoriaCatalogo,
  CatalogoAtributoMinedec,
} from '../domain/services/catalog-derivation.service';

export interface UpsertCatalogValueCommand {
  categoriaAtributo: CategoriaCatalogo;
  codigoValor: string;
  codigoPadre?: string | null;
  etiquetaVisible: string;
  nivelAcademicoDerivado?: string | null;
  sinonimosOrigen?: string[];
  requiereVigenciaTemporal?: boolean;
  activo: boolean;
  actorIdentificacion?: string;
}

export class ManageCatalogsUseCase {
  public constructor(
    private readonly catalogRepo: CatalogoAtributoRepositoryPort,
    private readonly catalogService: CatalogDerivationService,
    private readonly auditLog: AuditLogPort,
    private readonly txManager: DatabaseTransactionManager,
    private readonly cacheInvalidationPublisher?: CacheInvalidationPublisherPort,
  ) {}

  public async listCatalogByCategory(
    categoriaAtributo: CategoriaCatalogo,
    onlyActive = true,
  ): Promise<CatalogoAtributoMinedec[]> {
    return this.catalogRepo.listByCategory(categoriaAtributo, onlyActive);
  }

  public async upsertCatalogEntry(
    command: UpsertCatalogValueCommand,
  ): Promise<CatalogoAtributoMinedec> {
    const entry: CatalogoAtributoMinedec = {
      categoriaAtributo: command.categoriaAtributo,
      codigoValor: command.codigoValor.trim().toUpperCase(),
      codigoPadre: command.codigoPadre ? command.codigoPadre.trim().toUpperCase() : null,
      etiquetaVisible: command.etiquetaVisible.trim(),
      nivelAcademicoDerivado: command.nivelAcademicoDerivado
        ? command.nivelAcademicoDerivado.trim().toUpperCase()
        : null,
      sinonimosOrigen: (command.sinonimosOrigen ?? []).map((s) => s.trim()).filter(Boolean),
      requiereVigenciaTemporal: Boolean(command.requiereVigenciaTemporal),
      activo: command.activo,
    };

    const parentEntries =
      entry.categoriaAtributo === 'SUBTIPO_USUARIO'
        ? await this.catalogRepo.listByCategory('TIPO_USUARIO', true)
        : undefined;

    this.catalogService.validateCatalogUpsertEntry(entry, parentEntries);

    const saved = await this.txManager.withTransaction(async (tx) => {
      const persisted = await this.catalogRepo.upsert(entry, tx);

      await this.auditLog.recordEvent(
        {
          tipoEvento: 'CATALOGO_ACTUALIZADO',
          idInterno: null,
          cuentaId: null,
          actorIdentificacion: command.actorIdentificacion ?? 'SUPERADMIN_PAP',
          origenComponente: 'PAP_ADMIN',
          payloadEvento: {
            categoriaAtributo: persisted.categoriaAtributo,
            codigoValor: persisted.codigoValor,
            codigoPadre: persisted.codigoPadre,
            nivelAcademicoDerivado: persisted.nivelAcademicoDerivado,
            sinonimosOrigen: persisted.sinonimosOrigen,
            requiereVigenciaTemporal: persisted.requiereVigenciaTemporal,
            activo: persisted.activo,
          },
        },
        tx,
      );

      return persisted;
    });

    await this.catalogRepo.invalidateCatalogCache(saved.categoriaAtributo);

    if (this.cacheInvalidationPublisher) {
      await this.cacheInvalidationPublisher.publishInvalidationEvent({
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        reason: `CATALOGO_ACTUALIZADO:${saved.categoriaAtributo}:${saved.codigoValor}`,
        idInterno: 'CATALOG_GLOBAL',
        keysUnlinkedCount: 3,
        identifiers: [`${saved.categoriaAtributo}:${saved.codigoValor}`],
        emails: [],
        googleSubIds: [],
      });
    }

    return saved;
  }
}
