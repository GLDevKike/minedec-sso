import {
  HARD_MAX_REDIS_TTL_SECONDS,
  KeyValueCacheClient,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  ClienteOidc,
  ClienteOidcRedirectUri,
  EstadoCicloVidaAplicacion,
  EstadoClienteOidc,
  MetodoAutenticacionTokenOidc,
  NivelAdopcionPep,
  PatronIntegracionAplicacion,
  TipoRedirectUriOidc,
} from '../../domain/entities/oidc-broker.entities';
import { IOidcClientRepositoryPort } from '../../domain/ports/oidc-broker.ports';

interface ClienteOidcRow {
  cliente_oidc_id: string;
  aplicacion_id: string;
  oidc_client_id: string;
  secreto_activo_hash: string | null;
  secreto_anterior_hash: string | null;
  gracia_hasta: Date | string | null;
  expira_rotacion_en: Date | string | null;
  metodo_autenticacion_token: MetodoAutenticacionTokenOidc;
  estado_cliente: EstadoClienteOidc;
  creado_en: Date | string;
  actualizado_en: Date | string;
  codigo_unico: string;
  nombre_visible: string;
  patron_integracion: PatronIntegracionAplicacion;
  nivel_adopcion_pep: NivelAdopcionPep | null;
  host_publico: string;
  estado_ciclo_vida: EstadoCicloVidaAplicacion;
}

interface RedirectUriRow {
  redirect_uri_id: string;
  cliente_oidc_id: string;
  tipo_uri: TipoRedirectUriOidc;
  uri: string;
  activo: boolean;
  creado_en: Date | string;
}

/**
 * Repositorio AlloyDB for PostgreSQL 16 (100% parametrizado `$1, $2` + caché L2 en Redis `TTL <= 300 s`)
 * para consultar `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` (1FN/3FN sin límite de 100 URIs)
 * y subdominios institucionales activos (`dominio_institucional`).
 */
export class AlloyDbOidcClientRepository implements IOidcClientRepositoryPort {
  constructor(
    private readonly db: SqlQueryExecutor,
    private readonly redis?: KeyValueCacheClient,
  ) {}

  public static clientCacheKey(oidcClientId: string): string {
    return `minedec:oidc:client:${oidcClientId.trim()}`;
  }

  public static domainCacheKey(domain: string): string {
    return `minedec:oidc:domain:${domain.trim().toLowerCase()}`;
  }

  public async findByOidcClientId(oidcClientId: string): Promise<ClienteOidc | null> {
    const normalizedId = oidcClientId.trim();
    if (!normalizedId) {
      return null;
    }

    const cacheKey = AlloyDbOidcClientRepository.clientCacheKey(normalizedId);
    if (this.redis) {
      const cachedRaw = await this.redis.get(cacheKey);
      if (cachedRaw) {
        try {
          return this.reviveDates(JSON.parse(cachedRaw) as ClienteOidc);
        } catch {
          // Si falla la deserialización, se consulta AlloyDB
        }
      }
    }

    const clientResult = await this.db.query<ClienteOidcRow>(
      `SELECT
         c.cliente_oidc_id,
         c.aplicacion_id,
         c.oidc_client_id,
         c.secreto_activo_hash,
         c.secreto_anterior_hash,
         c.gracia_hasta,
         c.expira_rotacion_en,
         c.metodo_autenticacion_token,
         c.estado_cliente,
         c.creado_en,
         c.actualizado_en,
         a.codigo_unico,
         a.nombre_visible,
         a.patron_integracion,
         a.nivel_adopcion_pep,
         a.host_publico,
         a.estado_ciclo_vida
       FROM cliente_oidc c
       INNER JOIN aplicacion a ON a.aplicacion_id = c.aplicacion_id
       WHERE c.oidc_client_id = $1
       LIMIT 1`,
      [normalizedId],
    );

    const row = clientResult.rows[0];
    if (!row) {
      return null;
    }

    const urisResult = await this.db.query<RedirectUriRow>(
      `SELECT
         redirect_uri_id,
         cliente_oidc_id,
         tipo_uri,
         uri,
         activo,
         creado_en
       FROM cliente_oidc_redirect_uri
       WHERE cliente_oidc_id = $1
       ORDER BY creado_en ASC, redirect_uri_id ASC`,
      [row.cliente_oidc_id],
    );

    const redirectUris: ClienteOidcRedirectUri[] = urisResult.rows.map((u) => ({
      redirectUriId: u.redirect_uri_id,
      clienteOidcId: u.cliente_oidc_id,
      tipoUri: u.tipo_uri,
      uri: u.uri,
      activo: Boolean(u.activo),
      creadoEn: new Date(u.creado_en),
    }));

    const entity: ClienteOidc = {
      clienteOidcId: row.cliente_oidc_id,
      aplicacionId: row.aplicacion_id,
      oidcClientId: row.oidc_client_id,
      secretoActivoHash: row.secreto_activo_hash ? row.secreto_activo_hash.trim() : null,
      secretoAnteriorHash: row.secreto_anterior_hash ? row.secreto_anterior_hash.trim() : null,
      graciaHasta: row.gracia_hasta ? new Date(row.gracia_hasta) : null,
      expiraRotacionEn: row.expira_rotacion_en ? new Date(row.expira_rotacion_en) : null,
      metodoAutenticacionToken: row.metodo_autenticacion_token,
      estadoCliente: row.estado_cliente,
      creadoEn: new Date(row.creado_en),
      actualizadoEn: new Date(row.actualizado_en),
      aplicacion: {
        aplicacionId: row.aplicacion_id,
        codigoUnico: row.codigo_unico,
        nombreVisible: row.nombre_visible,
        patronIntegracion: row.patron_integracion,
        hostPublico: row.host_publico,
        estadoCicloVida: row.estado_ciclo_vida,
      },
      redirectUris,
    };

    if (this.redis) {
      await this.redis.setWithTtl(
        cacheKey,
        JSON.stringify(entity),
        HARD_MAX_REDIS_TTL_SECONDS,
      );
    }

    return entity;
  }

  public async findByOidcClientIds(
    oidcClientIds: ReadonlyArray<string>,
  ): Promise<ClienteOidc[]> {
    const uniqueIds = Array.from(
      new Set(oidcClientIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    );
    const results: ClienteOidc[] = [];
    for (const id of uniqueIds) {
      const found = await this.findByOidcClientId(id);
      if (found) {
        results.push(found);
      }
    }
    return results;
  }

  public async isInstitutionalDomainActive(domain: string): Promise<boolean> {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain) {
      return false;
    }

    const cacheKey = AlloyDbOidcClientRepository.domainCacheKey(normalizedDomain);
    if (this.redis) {
      const cached = await this.redis.get(cacheKey);
      if (cached === '1') {
        return true;
      }
      if (cached === '0') {
        return false;
      }
    }

    const result = await this.db.query<{ activo: boolean }>(
      `SELECT activo
       FROM dominio_institucional
       WHERE LOWER(dominio) = $1
       LIMIT 1`,
      [normalizedDomain],
    );

    const isActive = Boolean(result.rows[0]?.activo);
    if (this.redis) {
      await this.redis.setWithTtl(
        cacheKey,
        isActive ? '1' : '0',
        HARD_MAX_REDIS_TTL_SECONDS,
      );
    }

    return isActive;
  }

  public async invalidateClientCache(oidcClientId: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    await this.redis.unlinkKeys([AlloyDbOidcClientRepository.clientCacheKey(oidcClientId)]);
  }

  private reviveDates(raw: ClienteOidc): ClienteOidc {
    return {
      ...raw,
      graciaHasta: raw.graciaHasta ? new Date(raw.graciaHasta) : null,
      expiraRotacionEn: raw.expiraRotacionEn ? new Date(raw.expiraRotacionEn) : null,
      creadoEn: new Date(raw.creadoEn),
      actualizadoEn: new Date(raw.actualizadoEn),
      redirectUris: (raw.redirectUris ?? []).map((u) => ({
        ...u,
        creadoEn: new Date(u.creadoEn),
      })),
    };
  }
}
