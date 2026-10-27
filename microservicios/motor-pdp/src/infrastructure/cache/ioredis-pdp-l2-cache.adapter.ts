/**
 * Adaptador de Caché L2 en Memorystore for Redis (`ioredis`) — `motor-pdp` (`T033`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V y X):
 * - Namespaces determinísticos:
 *   - `minedec:pdp:bundle:{aplicacion_codigo}`
 *   - `minedec:pdp:decision:{aplicacion_codigo}:{id_interno}:{cuenta_id}:{version_catalogo}`
 *   - `minedec:pdp:subject_decisions:{id_interno}` (índice invertido de decisiones por persona)
 *   - `minedec:pdp:email_to_subject:{email_principal}` (índice email -> id_interno)
 * - Límite duro de TTL `<= 300 s` (`Math.min(ttl, 300)`).
 * - Degradación `Fail-Close`: cualquier caída de Redis lanza `PdpFailCloseUnavailableError`.
 */

import Redis from 'ioredis';
import { StructuredLogger } from '@minedec/shared';
import {
  ApplicationPolicyBundle,
  PrecomputedAuthorizationDecision,
} from '../../domain/entities/pdp-domain.entities';
import { PdpFailCloseUnavailableError } from '../../domain/errors/pdp-domain.errors';
import { PdpL2CachePort } from '../../domain/ports/pdp.ports';

export interface PdpRedisStoreDriver {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  ping(): Promise<string>;
  flushAll?(): Promise<number>;
}

/**
 * Implementación en memoria compatible con semántica de expiración TTL (`<= 300s`)
 * e índice invertido `SET`, utilizada en pruebas e integración local cuando no se provee `REDIS_URL`.
 */
export class InMemoryPdpRedisStoreDriver implements PdpRedisStoreDriver {
  private readonly kv = new Map<
    string,
    { value: string; expiresAtMs: number }
  >();
  private readonly sets = new Map<
    string,
    { members: Set<string>; expiresAtMs: number }
  >();
  private simulatedFailure = false;

  public setSimulatedFailure(unavailable: boolean): void {
    this.simulatedFailure = unavailable;
  }

  public getTtlRemainingSeconds(key: string): number {
    const entry = this.kv.get(key) ?? this.sets.get(key);
    if (!entry) {
      return -2;
    }
    const diffMs = entry.expiresAtMs - Date.now();
    if (diffMs <= 0) {
      this.kv.delete(key);
      this.sets.delete(key);
      return -2;
    }
    return Math.ceil(diffMs / 1000);
  }

  private assertHealthy(): void {
    if (this.simulatedFailure) {
      throw new Error('Redis connection refused / timeout (simulated failure)');
    }
  }

  public async get(key: string): Promise<string | null> {
    this.assertHealthy();
    const entry = this.kv.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAtMs) {
      this.kv.delete(key);
      return null;
    }
    return entry.value;
  }

  public async setex(
    key: string,
    ttlSeconds: number,
    value: string,
  ): Promise<void> {
    this.assertHealthy();
    this.kv.set(key, {
      value,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }

  public async del(...keys: string[]): Promise<number> {
    this.assertHealthy();
    let removed = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) {
        removed += 1;
      }
      if (this.sets.delete(k)) {
        removed += 1;
      }
    }
    return removed;
  }

  public async sadd(key: string, ...members: string[]): Promise<number> {
    this.assertHealthy();
    const now = Date.now();
    let entry = this.sets.get(key);
    if (!entry || now >= entry.expiresAtMs) {
      entry = {
        members: new Set<string>(),
        expiresAtMs: now + 300 * 1000,
      };
      this.sets.set(key, entry);
    }
    let added = 0;
    for (const m of members) {
      if (!entry.members.has(m)) {
        entry.members.add(m);
        added += 1;
      }
    }
    return added;
  }

  public async smembers(key: string): Promise<string[]> {
    this.assertHealthy();
    const entry = this.sets.get(key);
    if (!entry) {
      return [];
    }
    if (Date.now() >= entry.expiresAtMs) {
      this.sets.delete(key);
      return [];
    }
    return Array.from(entry.members);
  }

  public async expire(key: string, ttlSeconds: number): Promise<number> {
    this.assertHealthy();
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    const kvEntry = this.kv.get(key);
    if (kvEntry) {
      kvEntry.expiresAtMs = expiresAtMs;
      return 1;
    }
    const setEntry = this.sets.get(key);
    if (setEntry) {
      setEntry.expiresAtMs = expiresAtMs;
      return 1;
    }
    return 0;
  }

  public async ping(): Promise<string> {
    this.assertHealthy();
    return 'PONG';
  }

  public async flushAll(): Promise<number> {
    this.assertHealthy();
    const count = this.kv.size + this.sets.size;
    this.kv.clear();
    this.sets.clear();
    return count;
  }
}

export class IoRedisDriverWrapper implements PdpRedisStoreDriver {
  constructor(private readonly client: Redis) {}

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async setex(
    key: string,
    ttlSeconds: number,
    value: string,
  ): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  public async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return this.client.del(...keys);
  }

  public async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return 0;
    }
    return this.client.sadd(key, ...members);
  }

  public async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  public async expire(key: string, ttlSeconds: number): Promise<number> {
    return this.client.expire(key, ttlSeconds);
  }

  public async ping(): Promise<string> {
    return this.client.ping();
  }

  public async flushAll(): Promise<number> {
    await this.client.flushdb();
    return 1;
  }
}

const HARD_MAX_TTL_SECONDS = 300;

export class IoRedisPdpL2CacheAdapter implements PdpL2CachePort {
  private readonly maxTtlSeconds: number;

  constructor(
    private readonly store: PdpRedisStoreDriver,
    private readonly logger: StructuredLogger,
    maxTtlSeconds = HARD_MAX_TTL_SECONDS,
  ) {
    this.maxTtlSeconds = Math.min(
      Math.max(1, maxTtlSeconds),
      HARD_MAX_TTL_SECONDS,
    );
  }

  public static buildBundleKey(aplicacionCodigo: string): string {
    return `minedec:pdp:bundle:${aplicacionCodigo.trim().toUpperCase()}`;
  }

  public static buildDecisionKey(params: {
    aplicacionCodigo: string;
    idInterno: string;
    cuentaId: string;
    versionCatalogo: number;
  }): string {
    return `minedec:pdp:decision:${params.aplicacionCodigo.trim().toUpperCase()}:${params.idInterno}:${params.cuentaId}:${params.versionCatalogo}`;
  }

  public static buildSubjectDecisionsKey(idInterno: string): string {
    return `minedec:pdp:subject_decisions:${idInterno}`;
  }

  public static buildEmailLookupKey(emailPrincipal: string): string {
    return `minedec:pdp:email_to_subject:${emailPrincipal.trim().toLowerCase()}`;
  }

  public static buildM2mRevokedKey(clientId: string): string {
    return `minedec:pdp:m2m_revoked:${clientId.trim()}`;
  }

  private clampTtl(ttlSeconds?: number): number {
    const requested = ttlSeconds ?? this.maxTtlSeconds;
    return Math.min(
      Math.max(1, Math.floor(requested)),
      this.maxTtlSeconds,
      HARD_MAX_TTL_SECONDS,
    );
  }

  public async getPolicyBundle(
    aplicacionCodigo: string,
  ): Promise<ApplicationPolicyBundle | null> {
    try {
      const key = IoRedisPdpL2CacheAdapter.buildBundleKey(aplicacionCodigo);
      const raw = await this.store.get(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as ApplicationPolicyBundle;
    } catch (error) {
      this.logger.error('Fallo en lectura de bundle L2 Redis (Fail-Close)', {
        aplicacionCodigo,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PdpFailCloseUnavailableError(
        'Indisponibilidad de caché L2 Memorystore for Redis al consultar bundle de políticas (Fail-Close)',
      );
    }
  }

  public async setPolicyBundle(
    bundle: ApplicationPolicyBundle,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const effectiveTtl = this.clampTtl(ttlSeconds);
      const key = IoRedisPdpL2CacheAdapter.buildBundleKey(bundle.codigo_unico);
      await this.store.setex(key, effectiveTtl, JSON.stringify(bundle));
    } catch (error) {
      this.logger.error('Fallo en escritura de bundle L2 Redis (Fail-Close)', {
        codigoAplicacion: bundle.codigo_unico,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PdpFailCloseUnavailableError(
        'Indisponibilidad de caché L2 Memorystore for Redis al almacenar bundle de políticas (Fail-Close)',
      );
    }
  }

  public async getPrecomputedDecision(params: {
    aplicacionCodigo: string;
    versionCatalogo: number;
    idInterno?: string;
    cuentaId?: string;
    emailPrincipal?: string;
  }): Promise<PrecomputedAuthorizationDecision | null> {
    try {
      let idInterno = params.idInterno;
      let cuentaId = params.cuentaId;

      if ((!idInterno || !cuentaId) && params.emailPrincipal) {
        const emailKey = IoRedisPdpL2CacheAdapter.buildEmailLookupKey(
          params.emailPrincipal,
        );
        const mapped = await this.store.get(emailKey);
        if (!mapped) {
          return null;
        }
        const [mappedIdInterno, mappedCuentaId] = mapped.split('|');
        idInterno = mappedIdInterno;
        cuentaId = mappedCuentaId || mappedIdInterno;
      }

      if (!idInterno || !cuentaId) {
        return null;
      }

      const key = IoRedisPdpL2CacheAdapter.buildDecisionKey({
        aplicacionCodigo: params.aplicacionCodigo,
        idInterno,
        cuentaId,
        versionCatalogo: params.versionCatalogo,
      });
      const raw = await this.store.get(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as PrecomputedAuthorizationDecision;
    } catch (error) {
      this.logger.error('Fallo en lectura de decisión L2 Redis (Fail-Close)', {
        aplicacionCodigo: params.aplicacionCodigo,
        idInterno: params.idInterno,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PdpFailCloseUnavailableError(
        'Indisponibilidad de caché L2 Memorystore for Redis al consultar decisión precalculada (Fail-Close)',
      );
    }
  }

  public async setPrecomputedDecision(
    aplicacionCodigo: string,
    versionCatalogo: number,
    decision: PrecomputedAuthorizationDecision,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const effectiveTtl = this.clampTtl(ttlSeconds ?? decision.ttl_segundos);
      const normalizedDecision: PrecomputedAuthorizationDecision = {
        ...decision,
        ttl_segundos: effectiveTtl,
      };
      const decisionKey = IoRedisPdpL2CacheAdapter.buildDecisionKey({
        aplicacionCodigo,
        idInterno: decision.id_interno,
        cuentaId: decision.cuenta_id,
        versionCatalogo,
      });
      const subjectSetKey = IoRedisPdpL2CacheAdapter.buildSubjectDecisionsKey(
        decision.id_interno,
      );
      const emailKey = IoRedisPdpL2CacheAdapter.buildEmailLookupKey(
        decision.email_principal,
      );

      await this.store.setex(
        decisionKey,
        effectiveTtl,
        JSON.stringify(normalizedDecision),
      );
      await this.store.sadd(subjectSetKey, decisionKey);
      await this.store.expire(subjectSetKey, effectiveTtl);
      await this.store.setex(
        emailKey,
        effectiveTtl,
        `${decision.id_interno}|${decision.cuenta_id}`,
      );
    } catch (error) {
      this.logger.error(
        'Fallo en escritura de decisión L2 Redis (Fail-Close)',
        {
          aplicacionCodigo,
          idInterno: decision.id_interno,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new PdpFailCloseUnavailableError(
        'Indisponibilidad de caché L2 Memorystore for Redis al almacenar decisión precalculada (Fail-Close)',
      );
    }
  }

  public async invalidateBySubject(params: {
    idInterno?: string;
    emailPrincipal?: string;
  }): Promise<number> {
    try {
      let resolvedIdInterno = params.idInterno?.trim() || undefined;
      let keysDeleted = 0;

      if (params.emailPrincipal) {
        const emailKey = IoRedisPdpL2CacheAdapter.buildEmailLookupKey(
          params.emailPrincipal,
        );
        if (!resolvedIdInterno) {
          const mapped = await this.store.get(emailKey);
          if (mapped) {
            resolvedIdInterno = mapped.split('|')[0];
          }
        }
        keysDeleted += await this.store.del(emailKey);
      }

      if (!resolvedIdInterno) {
        return keysDeleted;
      }

      const subjectSetKey =
        IoRedisPdpL2CacheAdapter.buildSubjectDecisionsKey(resolvedIdInterno);
      const decisionKeys = await this.store.smembers(subjectSetKey);
      const toDelete = [...decisionKeys, subjectSetKey];
      keysDeleted += await this.store.del(...toDelete);
      return keysDeleted;
    } catch (error) {
      this.logger.error('Fallo al invalidar caché L2 por sujeto en Redis', {
        idInterno: params.idInterno,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PdpFailCloseUnavailableError(
        'Fallo al invalidar caché L2 por sujeto en Memorystore for Redis',
      );
    }
  }

  public async invalidateByApplication(
    aplicacionCodigo: string,
  ): Promise<number> {
    try {
      const bundleKey =
        IoRedisPdpL2CacheAdapter.buildBundleKey(aplicacionCodigo);
      return await this.store.del(bundleKey);
    } catch (error) {
      this.logger.error(
        'Fallo al invalidar bundle de aplicación en caché L2 Redis',
        {
          aplicacionCodigo,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new PdpFailCloseUnavailableError(
        'Fallo al invalidar bundle de aplicación en Memorystore for Redis',
      );
    }
  }

  public async markM2mClientRevoked(
    clientId: string,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const effectiveTtl = this.clampTtl(ttlSeconds);
      const key = IoRedisPdpL2CacheAdapter.buildM2mRevokedKey(clientId);
      await this.store.setex(key, effectiveTtl, '1');
    } catch (error) {
      this.logger.error(
        'Fallo al registrar revocación de cliente M2M en caché L2 Redis (Fail-Close)',
        {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new PdpFailCloseUnavailableError(
        'Fallo al registrar revocación de cliente M2M en Memorystore for Redis (Fail-Close)',
      );
    }
  }

  public async isM2mClientRevoked(clientId: string): Promise<boolean> {
    try {
      const key = IoRedisPdpL2CacheAdapter.buildM2mRevokedKey(clientId);
      const raw = await this.store.get(key);
      return raw === '1';
    } catch (error) {
      this.logger.error(
        'Fallo al consultar estado de revocación M2M en caché L2 Redis (Fail-Close)',
        {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new PdpFailCloseUnavailableError(
        'Fallo al consultar estado de revocación M2M en Memorystore for Redis (Fail-Close)',
      );
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const pong = await this.store.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  public async flushAll(): Promise<number> {
    try {
      if (this.store.flushAll) {
        return await this.store.flushAll();
      }
      return 0;
    } catch (error) {
      this.logger.error('Fallo al vaciar caché L2 completa en Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PdpFailCloseUnavailableError(
        'Fallo al vaciar caché L2 completa en Memorystore for Redis',
      );
    }
  }
}
