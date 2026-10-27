import {
  enforceHardMaxTtlSeconds,
  HARD_MAX_REDIS_TTL_SECONDS,
  KeyValueCacheClient,
  PipObservabilityMetricsCollector,
  TipoIdentificacionPersona,
} from '@minedec/shared';
import {
  IdentityCacheInvalidationKeys,
  IdentityCachePort,
  ProjectedUnifiedIdentity,
} from '../../domain/ports';

export class RedisIdentityCacheAdapter implements IdentityCachePort {
  public constructor(
    private readonly cacheClient: KeyValueCacheClient,
    private readonly metrics?: PipObservabilityMetricsCollector,
  ) {}

  public static buildPersonaKey(idInterno: string): string {
    return `minedec:pip:persona:${idInterno.trim().toLowerCase()}`;
  }

  public static buildIdentKey(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
  ): string {
    return `minedec:pip:ident:${tipoIdentificacion.trim().toUpperCase()}:${numeroIdentificacion.trim()}`;
  }

  public static buildEmailKey(emailPrincipal: string): string {
    return `minedec:pip:email:${emailPrincipal.trim().toLowerCase()}`;
  }

  public static buildGoogleSubIdKey(googleSubId: string): string {
    return `minedec:pip:gid:${googleSubId.trim()}`;
  }

  public async getByIdInterno(idInterno: string): Promise<ProjectedUnifiedIdentity | null> {
    const raw = await this.cacheClient.get(RedisIdentityCacheAdapter.buildPersonaKey(idInterno));
    if (!raw) {
      this.metrics?.recordCacheMiss();
      return null;
    }
    this.metrics?.recordCacheHit();
    return JSON.parse(raw) as ProjectedUnifiedIdentity;
  }

  public async getByDocument(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
  ): Promise<ProjectedUnifiedIdentity | null> {
    const idInterno = await this.cacheClient.get(
      RedisIdentityCacheAdapter.buildIdentKey(tipoIdentificacion, numeroIdentificacion),
    );
    if (!idInterno) {
      this.metrics?.recordCacheMiss();
      return null;
    }
    return this.getByIdInterno(idInterno);
  }

  public async getByEmail(emailPrincipal: string): Promise<ProjectedUnifiedIdentity | null> {
    const idInterno = await this.cacheClient.get(
      RedisIdentityCacheAdapter.buildEmailKey(emailPrincipal),
    );
    if (!idInterno) {
      this.metrics?.recordCacheMiss();
      return null;
    }
    return this.getByIdInterno(idInterno);
  }

  public async getByGoogleSubId(googleSubId: string): Promise<ProjectedUnifiedIdentity | null> {
    const idInterno = await this.cacheClient.get(
      RedisIdentityCacheAdapter.buildGoogleSubIdKey(googleSubId),
    );
    if (!idInterno) {
      this.metrics?.recordCacheMiss();
      return null;
    }
    return this.getByIdInterno(idInterno);
  }

  public async putProjectedIdentity(
    projection: ProjectedUnifiedIdentity,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    const boundedTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    const idInterno = projection.persona.idInterno;
    const personaKey = RedisIdentityCacheAdapter.buildPersonaKey(idInterno);

    await this.cacheClient.setWithTtl(personaKey, JSON.stringify(projection), boundedTtl);

    const identKey = RedisIdentityCacheAdapter.buildIdentKey(
      projection.persona.tipoIdentificacion,
      projection.persona.numeroIdentificacion,
    );
    await this.cacheClient.setWithTtl(identKey, idInterno, boundedTtl);

    if (projection.persona.codigoMinedecAnterior) {
      const prevCodeKey = RedisIdentityCacheAdapter.buildIdentKey(
        'CODIGO_MINEDEC',
        projection.persona.codigoMinedecAnterior,
      );
      await this.cacheClient.setWithTtl(prevCodeKey, idInterno, boundedTtl);
    }

    for (const cuenta of projection.cuentas) {
      await this.cacheClient.setWithTtl(
        RedisIdentityCacheAdapter.buildEmailKey(cuenta.emailPrincipal),
        idInterno,
        boundedTtl,
      );
      await this.cacheClient.setWithTtl(
        RedisIdentityCacheAdapter.buildGoogleSubIdKey(cuenta.googleSubId),
        idInterno,
        boundedTtl,
      );
    }
  }

  public async invalidateIdentityKeys(keys: IdentityCacheInvalidationKeys): Promise<number> {
    const allKeys: string[] = [RedisIdentityCacheAdapter.buildPersonaKey(keys.idInterno)];

    if (keys.previousIdInterno) {
      allKeys.push(RedisIdentityCacheAdapter.buildPersonaKey(keys.previousIdInterno));
    }

    for (const ident of keys.identifiers) {
      if (ident.numeroIdentificacion) {
        allKeys.push(
          RedisIdentityCacheAdapter.buildIdentKey(
            ident.tipoIdentificacion,
            ident.numeroIdentificacion,
          ),
        );
      }
    }

    for (const email of keys.emails) {
      if (email) {
        allKeys.push(RedisIdentityCacheAdapter.buildEmailKey(email));
      }
    }

    for (const gid of keys.googleSubIds) {
      if (gid) {
        allKeys.push(RedisIdentityCacheAdapter.buildGoogleSubIdKey(gid));
      }
    }

    return this.cacheClient.unlinkKeys(allKeys);
  }

  public async getRemainingTtlSeconds(rawKey: string): Promise<number> {
    return this.cacheClient.ttl(rawKey);
  }
}
