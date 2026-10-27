import { randomUUID } from 'crypto';
import {
  HARD_MAX_REDIS_TTL_SECONDS,
  KeyValueCacheClient,
  SqlQueryExecutor,
} from '@minedec/shared';
import { CatalogoAtributoRepositoryPort } from '../../domain/ports';
import {
  CategoriaCatalogo,
  CatalogoAtributoMinedec,
} from '../../domain/services/catalog-derivation.service';

export const CATALOG_CACHE_PREFIX = 'minedec:pip:catalogo:v1';

const ALL_CATEGORIES: readonly CategoriaCatalogo[] = [
  'TIPO_IDENTIFICACION',
  'TIPO_USUARIO',
  'SUBTIPO_USUARIO',
  'CARGO_FUNCION',
  'GRADO_CURSO',
  'NIVEL_ACADEMICO',
  'VICEMINISTERIO',
  'NIVEL_ESTRUCTURA',
  'REGIMEN_ESCOLAR',
  'MODALIDAD_EDUCATIVA',
  'JORNADA',
];

interface CatalogRow {
  catalogo_id: string;
  categoria_atributo: CategoriaCatalogo;
  codigo_valor: string;
  codigo_padre: string | null;
  etiqueta_visible: string;
  nivel_academico_derivado: string | null;
  requiere_vigencia_temporal: boolean;
  metadatos_regla: Record<string, unknown> | string | null;
  activo: boolean;
}

function parseMetadatosRegla(raw: Record<string, unknown> | string | null): {
  metadatos: Record<string, unknown>;
  sinonimosOrigen: string[];
} {
  if (!raw) {
    return { metadatos: {}, sinonimosOrigen: [] };
  }
  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else {
    parsed = raw;
  }

  const rawSynonyms = parsed.sinonimosOrigen;
  const sinonimosOrigen = Array.isArray(rawSynonyms)
    ? rawSynonyms.filter((item): item is string => typeof item === 'string')
    : [];

  return { metadatos: parsed, sinonimosOrigen };
}

function mapCatalogRow(row: CatalogRow): CatalogoAtributoMinedec {
  const { metadatos, sinonimosOrigen } = parseMetadatosRegla(row.metadatos_regla);
  return {
    catalogoId: row.catalogo_id,
    categoriaAtributo: row.categoria_atributo,
    codigoValor: row.codigo_valor,
    codigoPadre: row.codigo_padre,
    etiquetaVisible: row.etiqueta_visible,
    nivelAcademicoDerivado: row.nivel_academico_derivado,
    sinonimosOrigen,
    requiereVigenciaTemporal: Boolean(row.requiere_vigencia_temporal),
    metadatosRegla: metadatos,
    activo: Boolean(row.activo),
  };
}

export class PgCatalogoAtributoRepository implements CatalogoAtributoRepositoryPort {
  public constructor(
    private readonly defaultExecutor: SqlQueryExecutor,
    private readonly cacheClient?: KeyValueCacheClient,
  ) {}

  private buildCategoryCacheKey(
    categoriaAtributo: CategoriaCatalogo,
    onlyActive: boolean,
  ): string {
    return `${CATALOG_CACHE_PREFIX}:${categoriaAtributo}:${onlyActive ? 'ACTIVE' : 'ALL'}`;
  }

  private buildAllGroupedCacheKey(): string {
    return `${CATALOG_CACHE_PREFIX}:GROUPED_ACTIVE`;
  }

  public async listByCategory(
    categoriaAtributo: CategoriaCatalogo,
    onlyActive = true,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoAtributoMinedec[]> {
    const cacheKey = this.buildCategoryCacheKey(categoriaAtributo, onlyActive);
    if (!tx && this.cacheClient) {
      const cached = await this.cacheClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as CatalogoAtributoMinedec[];
      }
    }

    const executor = tx ?? this.defaultExecutor;
    const sql = onlyActive
      ? `SELECT
          catalogo_id, categoria_atributo, codigo_valor, codigo_padre,
          etiqueta_visible, nivel_academico_derivado, requiere_vigencia_temporal,
          metadatos_regla, activo
         FROM catalogo_atributo_minedec
         WHERE categoria_atributo = $1 AND activo = true
         ORDER BY codigo_valor ASC`
      : `SELECT
          catalogo_id, categoria_atributo, codigo_valor, codigo_padre,
          etiqueta_visible, nivel_academico_derivado, requiere_vigencia_temporal,
          metadatos_regla, activo
         FROM catalogo_atributo_minedec
         WHERE categoria_atributo = $1
         ORDER BY codigo_valor ASC`;

    const result = await executor.query<CatalogRow>(sql, [categoriaAtributo]);
    const mapped = result.rows.map(mapCatalogRow);

    if (!tx && this.cacheClient) {
      await this.cacheClient.setWithTtl(
        cacheKey,
        JSON.stringify(mapped),
        HARD_MAX_REDIS_TTL_SECONDS,
      );
    }

    return mapped;
  }

  public async listAllActiveGrouped(
    tx?: SqlQueryExecutor,
  ): Promise<Record<CategoriaCatalogo, CatalogoAtributoMinedec[]>> {
    const groupedKey = this.buildAllGroupedCacheKey();
    if (!tx && this.cacheClient) {
      const cached = await this.cacheClient.get(groupedKey);
      if (cached) {
        return JSON.parse(cached) as Record<CategoriaCatalogo, CatalogoAtributoMinedec[]>;
      }
    }

    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CatalogRow>(
      `SELECT
        catalogo_id, categoria_atributo, codigo_valor, codigo_padre,
        etiqueta_visible, nivel_academico_derivado, requiere_vigencia_temporal,
        metadatos_regla, activo
       FROM catalogo_atributo_minedec
       WHERE activo = true
       ORDER BY categoria_atributo ASC, codigo_valor ASC`,
    );

    const grouped = {} as Record<CategoriaCatalogo, CatalogoAtributoMinedec[]>;
    for (const cat of ALL_CATEGORIES) {
      grouped[cat] = [];
    }

    for (const row of result.rows) {
      const entry = mapCatalogRow(row);
      if (!grouped[entry.categoriaAtributo]) {
        grouped[entry.categoriaAtributo] = [];
      }
      grouped[entry.categoriaAtributo].push(entry);
    }

    if (!tx && this.cacheClient) {
      await this.cacheClient.setWithTtl(
        groupedKey,
        JSON.stringify(grouped),
        HARD_MAX_REDIS_TTL_SECONDS,
      );
    }

    return grouped;
  }

  public async upsert(
    entry: CatalogoAtributoMinedec,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoAtributoMinedec> {
    const executor = tx ?? this.defaultExecutor;
    const catalogoId = entry.catalogoId ?? randomUUID();
    const metadatos = {
      ...(entry.metadatosRegla ?? {}),
      sinonimosOrigen: entry.sinonimosOrigen ?? [],
    };

    const result = await executor.query<CatalogRow>(
      `INSERT INTO catalogo_atributo_minedec (
        catalogo_id, categoria_atributo, codigo_valor, codigo_padre,
        etiqueta_visible, nivel_academico_derivado, requiere_vigencia_temporal,
        metadatos_regla, activo, creado_en, actualizado_en
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW(), NOW())
      ON CONFLICT (categoria_atributo, codigo_valor) DO UPDATE SET
        codigo_padre = EXCLUDED.codigo_padre,
        etiqueta_visible = EXCLUDED.etiqueta_visible,
        nivel_academico_derivado = EXCLUDED.nivel_academico_derivado,
        requiere_vigencia_temporal = EXCLUDED.requiere_vigencia_temporal,
        metadatos_regla = EXCLUDED.metadatos_regla,
        activo = EXCLUDED.activo,
        actualizado_en = NOW()
      RETURNING
        catalogo_id, categoria_atributo, codigo_valor, codigo_padre,
        etiqueta_visible, nivel_academico_derivado, requiere_vigencia_temporal,
        metadatos_regla, activo`,
      [
        catalogoId,
        entry.categoriaAtributo,
        entry.codigoValor.trim().toUpperCase(),
        entry.codigoPadre ? entry.codigoPadre.trim().toUpperCase() : null,
        entry.etiquetaVisible.trim(),
        entry.nivelAcademicoDerivado ? entry.nivelAcademicoDerivado.trim().toUpperCase() : null,
        entry.requiereVigenciaTemporal,
        JSON.stringify(metadatos),
        entry.activo,
      ],
    );

    await this.invalidateCatalogCache(entry.categoriaAtributo);
    const row = result.rows[0];
    return row ? mapCatalogRow(row) : { ...entry, catalogoId };
  }

  public async invalidateCatalogCache(categoriaAtributo?: CategoriaCatalogo): Promise<void> {
    if (!this.cacheClient) {
      return;
    }

    const keysToUnlink: string[] = [this.buildAllGroupedCacheKey()];
    if (categoriaAtributo) {
      keysToUnlink.push(
        this.buildCategoryCacheKey(categoriaAtributo, true),
        this.buildCategoryCacheKey(categoriaAtributo, false),
      );
    } else {
      for (const cat of ALL_CATEGORIES) {
        keysToUnlink.push(
          this.buildCategoryCacheKey(cat, true),
          this.buildCategoryCacheKey(cat, false),
        );
      }
    }

    await this.cacheClient.unlinkKeys(keysToUnlink);
  }
}
