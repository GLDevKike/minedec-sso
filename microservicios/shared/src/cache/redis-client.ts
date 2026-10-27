import Redis from 'ioredis';

/**
 * Límite duro constitucional para cualquier clave en Memorystore for Redis L2 (RF-AU-09 / Constitución IV).
 */
export const HARD_MAX_REDIS_TTL_SECONDS = 300;

export interface KeyValueCacheClient {
  get(key: string): Promise<string | null>;
  getJson?<T = unknown>(key: string): Promise<T | null>;
  setWithTtl(key: string, value: string, ttlSeconds?: number): Promise<void>;
  setJson?(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  incrWithTtl?(key: string, ttlSeconds?: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hsetWithTtl(
    key: string,
    fields: Record<string, string>,
    ttlSeconds?: number,
  ): Promise<void>;
  unlinkKeys(keys: ReadonlyArray<string>): Promise<number>;
  deleteKeys?(keys: ReadonlyArray<string>): Promise<number>;
  ttl(key: string): Promise<number>;
  close(): Promise<void>;
}

/**
 * Normaliza y valida el TTL asegurando que jamás supere 300 segundos ni sea <= 0.
 * Queda estrictamente prohibido persistir claves sin expiración (PERSIST prohibido).
 */
export function enforceHardMaxTtlSeconds(
  requestedTtlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
): number {
  if (!Number.isFinite(requestedTtlSeconds) || requestedTtlSeconds <= 0) {
    throw new Error(
      `[REDIS_TTL_VIOLATION] El TTL en Redis L2 debe ser un entero positivo (recibido: ${requestedTtlSeconds}).`,
    );
  }
  return Math.min(Math.floor(requestedTtlSeconds), HARD_MAX_REDIS_TTL_SECONDS);
}

/**
 * Cliente Memorystore for Redis L2 con aplicación obligatoria de TTL <= 300 s y borrado asíncrono UNLINK.
 */
export class RedisCacheClient implements KeyValueCacheClient {
  private readonly redis: Redis | null;
  private readonly inMemoryFallback: InMemoryRedisCacheClient | null;

  public static keyBySub(sub: string): string {
    return `pip:profile:sub:${sub.trim()}`;
  }

  public static keyByEmail(email: string): string {
    return `pip:profile:email:${email.trim().toLowerCase()}`;
  }

  public static keyByInternalId(idInterno: string): string {
    return `pip:profile:id:${idInterno.trim()}`;
  }

  public static keyByDoc(tipoIdentificacion: string, numeroIdentificacion: string): string {
    return `pip:profile:doc:${tipoIdentificacion.trim().toUpperCase()}:${numeroIdentificacion.trim()}`;
  }

  public keyBySub(sub: string): string {
    return RedisCacheClient.keyBySub(sub);
  }

  public keyByEmail(email: string): string {
    return RedisCacheClient.keyByEmail(email);
  }

  public keyByInternalId(idInterno: string): string {
    return RedisCacheClient.keyByInternalId(idInterno);
  }

  public keyByDoc(tipoIdentificacion: string, numeroIdentificacion: string): string {
    return RedisCacheClient.keyByDoc(tipoIdentificacion, numeroIdentificacion);
  }

  constructor(redisInstanceOrUrl?: Redis | string) {
    if (redisInstanceOrUrl === undefined && !process.env.REDIS_URL) {
      this.redis = null;
      this.inMemoryFallback = new InMemoryRedisCacheClient();
    } else if (typeof redisInstanceOrUrl === 'string' || redisInstanceOrUrl === undefined) {
      this.redis = new Redis(
        redisInstanceOrUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
        {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
        },
      );
      this.inMemoryFallback = null;
    } else {
      this.redis = redisInstanceOrUrl;
      this.inMemoryFallback = null;
    }
  }

  public async get(key: string): Promise<string | null> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.get(key);
    }
    return this.redis!.get(key);
  }

  public async getJson<T = unknown>(key: string): Promise<T | null> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.getJson<T>(key);
    }
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.setWithTtl(key, value, ttlSeconds);
    }
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    await this.redis!.set(key, value, 'EX', effectiveTtl);
  }

  public async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.setJson(key, value, ttlSeconds);
    }
    await this.setWithTtl(key, JSON.stringify(value), ttlSeconds);
  }

  public async incrWithTtl(
    key: string,
    ttlSeconds: number = 5,
  ): Promise<number> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.incrWithTtl(key, ttlSeconds);
    }
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    const count = await this.redis!.incr(key);
    if (count === 1) {
      await this.redis!.expire(key, effectiveTtl);
    }
    return count;
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.hgetall(key);
    }
    return this.redis!.hgetall(key);
  }

  public async hsetWithTtl(
    key: string,
    fields: Record<string, string>,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.hsetWithTtl(key, fields, ttlSeconds);
    }
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      return;
    }
    const pipeline = this.redis!.pipeline();
    pipeline.del(key);
    pipeline.hset(key, fields);
    pipeline.expire(key, effectiveTtl);
    await pipeline.exec();
  }

  public async unlinkKeys(keys: ReadonlyArray<string>): Promise<number> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.unlinkKeys(keys);
    }
    const uniqueKeys = Array.from(
      new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0)),
    );
    if (uniqueKeys.length === 0) {
      return 0;
    }
    return this.redis!.unlink(...uniqueKeys);
  }

  public async deleteKeys(keys: ReadonlyArray<string>): Promise<number> {
    return this.unlinkKeys(keys);
  }

  public async ttl(key: string): Promise<number> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.ttl(key);
    }
    return this.redis!.ttl(key);
  }

  public async close(): Promise<void> {
    if (this.inMemoryFallback) {
      return this.inMemoryFallback.close();
    }
    await this.redis!.quit();
  }
}

/**
 * Implementación en memoria compatible con KeyValueCacheClient para pruebas rápidas y entornos aislados,
 * respetando exactamente las mismas garantías de TTL <= 300 s y UNLINK atómico.
 */
export class InMemoryRedisCacheClient implements KeyValueCacheClient {
  private readonly strings = new Map<
    string,
    { value: string; expiresAtMs: number }
  >();
  private readonly hashes = new Map<
    string,
    { fields: Record<string, string>; expiresAtMs: number }
  >();

  public async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAtMs) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  public async getJson<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    this.strings.set(key, {
      value,
      expiresAtMs: Date.now() + effectiveTtl * 1000,
    });
  }

  public async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    await this.setWithTtl(key, JSON.stringify(value), ttlSeconds);
  }

  public async incrWithTtl(
    key: string,
    ttlSeconds: number = 5,
  ): Promise<number> {
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    const now = Date.now();
    const existing = this.strings.get(key);
    if (!existing || now >= existing.expiresAtMs) {
      this.strings.set(key, {
        value: '1',
        expiresAtMs: now + effectiveTtl * 1000,
      });
      return 1;
    }
    const nextVal = (Number(existing.value) || 0) + 1;
    this.strings.set(key, {
      value: String(nextVal),
      expiresAtMs: existing.expiresAtMs,
    });
    return nextVal;
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    const entry = this.hashes.get(key);
    if (!entry) {
      return {};
    }
    if (Date.now() >= entry.expiresAtMs) {
      this.hashes.delete(key);
      return {};
    }
    return { ...entry.fields };
  }

  public async hsetWithTtl(
    key: string,
    fields: Record<string, string>,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    const effectiveTtl = enforceHardMaxTtlSeconds(ttlSeconds);
    this.hashes.set(key, {
      fields: { ...fields },
      expiresAtMs: Date.now() + effectiveTtl * 1000,
    });
  }

  public async unlinkKeys(keys: ReadonlyArray<string>): Promise<number> {
    let removed = 0;
    for (const rawKey of new Set(keys)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (this.strings.delete(key)) removed += 1;
      if (this.hashes.delete(key)) removed += 1;
    }
    return removed;
  }

  public async deleteKeys(keys: ReadonlyArray<string>): Promise<number> {
    return this.unlinkKeys(keys);
  }

  public async ttl(key: string): Promise<number> {
    const strEntry = this.strings.get(key);
    if (strEntry) {
      const remaining = Math.ceil((strEntry.expiresAtMs - Date.now()) / 1000);
      if (remaining <= 0) {
        this.strings.delete(key);
        return -2;
      }
      return remaining;
    }
    const hashEntry = this.hashes.get(key);
    if (hashEntry) {
      const remaining = Math.ceil((hashEntry.expiresAtMs - Date.now()) / 1000);
      if (remaining <= 0) {
        this.hashes.delete(key);
        return -2;
      }
      return remaining;
    }
    return -2;
  }

  public async close(): Promise<void> {
    this.strings.clear();
    this.hashes.clear();
  }
}
