import { HARD_MAX_REDIS_TTL_SECONDS, KeyValueCacheClient } from '@minedec/shared';
import {
  CodigoAutorizacionEfimero,
  CorrelacionFederacionGoogle,
  SesionCentralOidc,
} from '../../domain/entities/oidc-broker.entities';
import {
  ConsumeAuthorizationCodeResult,
  IOidcSessionStorePort,
} from '../../domain/ports/oidc-broker.ports';

export const MAX_AUTH_CODE_TTL_SECONDS = 60;
export const MAX_REVALIDATION_TTL_SECONDS = 300;

/**
 * Adaptador distribuido en Memorystore for Redis para `sso-oidc` (`DA-11`).
 * Gestiona:
 * - Sesiones centrales (`minedec:oidc:session:{sessionId}`)
 * - Llave testigo de revalidación obligatoria contra el PIP cada `<= 300 s` (`minedec:oidc:reval:{sessionId}`)
 * - Índices por cuenta (`minedec:oidc:account_sessions:{cuentaId}`) y por persona (`minedec:oidc:person_sessions:{idInterno}`)
 * - Estado de correlación OAuth 2.0 hacia Google Cloud Identity (`minedec:oidc:google_state:{state}`)
 * - Códigos de autorización de un solo uso con `TTL <= 60 s` (`minedec:oidc:adapter:AuthorizationCode:{codeId}`)
 */
export class RedisOidcStoreAdapter implements IOidcSessionStorePort {
  constructor(private readonly redis: KeyValueCacheClient) {}

  public static sessionKey(sessionId: string): string {
    return `minedec:oidc:session:${sessionId.trim()}`;
  }

  public static revalidationKey(sessionId: string): string {
    return `minedec:oidc:reval:${sessionId.trim()}`;
  }

  public static accountSessionsKey(cuentaId: string): string {
    return `minedec:oidc:account_sessions:${cuentaId.trim()}`;
  }

  public static personSessionsKey(idInterno: string): string {
    return `minedec:oidc:person_sessions:${idInterno.trim()}`;
  }

  public static googleStateKey(state: string): string {
    return `minedec:oidc:google_state:${state.trim()}`;
  }

  public static authorizationCodeKey(codeId: string): string {
    return `minedec:oidc:adapter:AuthorizationCode:${codeId.trim()}`;
  }

  public static sessionCodesIndexKey(sessionId: string): string {
    return `minedec:oidc:session_codes:${sessionId.trim()}`;
  }

  public async saveSession(
    session: SesionCentralOidc,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    const boundedTtl = Math.min(
      Math.max(1, Math.floor(ttlSeconds)),
      HARD_MAX_REDIS_TTL_SECONDS,
    );
    const sessionKey = RedisOidcStoreAdapter.sessionKey(session.sessionId);
    await this.redis.setWithTtl(sessionKey, JSON.stringify(session), boundedTtl);

    await this.refreshSessionRevalidationMark(
      session.sessionId,
      Math.min(boundedTtl, MAX_REVALIDATION_TTL_SECONDS),
    );

    await this.addSessionToIndex(
      RedisOidcStoreAdapter.accountSessionsKey(session.cuentaId),
      session.sessionId,
      boundedTtl,
    );
    await this.addSessionToIndex(
      RedisOidcStoreAdapter.personSessionsKey(session.idInterno),
      session.sessionId,
      boundedTtl,
    );
  }

  public async getSession(sessionId: string): Promise<SesionCentralOidc | null> {
    const raw = await this.redis.get(RedisOidcStoreAdapter.sessionKey(sessionId));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SesionCentralOidc;
    } catch {
      return null;
    }
  }

  public async addParticipatingClientToSession(
    sessionId: string,
    oidcClientId: string,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return;
    }
    if (!session.participatingClientIds.includes(oidcClientId)) {
      session.participatingClientIds.push(oidcClientId);
    }
    session.lastPipValidatedAt = new Date().toISOString();
    await this.saveSession(session, HARD_MAX_REDIS_TTL_SECONDS);
  }

  public async isSessionRevalidationFresh(sessionId: string): Promise<boolean> {
    const raw = await this.redis.get(RedisOidcStoreAdapter.revalidationKey(sessionId));
    return raw !== null;
  }

  public async refreshSessionRevalidationMark(
    sessionId: string,
    ttlSeconds: number = MAX_REVALIDATION_TTL_SECONDS,
  ): Promise<void> {
    const boundedTtl = Math.min(
      Math.max(1, Math.floor(ttlSeconds)),
      MAX_REVALIDATION_TTL_SECONDS,
    );
    await this.redis.setWithTtl(
      RedisOidcStoreAdapter.revalidationKey(sessionId),
      new Date().toISOString(),
      boundedTtl,
    );
  }

  public async destroySession(sessionId: string): Promise<SesionCentralOidc | null> {
    const session = await this.getSession(sessionId);
    await this.purgeAuthorizationCodesForSession(sessionId);
    await this.redis.unlinkKeys([
      RedisOidcStoreAdapter.sessionKey(sessionId),
      RedisOidcStoreAdapter.revalidationKey(sessionId),
      RedisOidcStoreAdapter.sessionCodesIndexKey(sessionId),
    ]);

    if (session) {
      await this.removeSessionFromIndex(
        RedisOidcStoreAdapter.accountSessionsKey(session.cuentaId),
        sessionId,
      );
      await this.removeSessionFromIndex(
        RedisOidcStoreAdapter.personSessionsKey(session.idInterno),
        sessionId,
      );
    }

    return session;
  }

  public async purgeSessionsByAccount(cuentaId: string): Promise<SesionCentralOidc[]> {
    const indexKey = RedisOidcStoreAdapter.accountSessionsKey(cuentaId);
    const sessionIds = await this.getIndexedIds(indexKey);
    const purged: SesionCentralOidc[] = [];

    for (const sessionId of sessionIds) {
      const destroyed = await this.destroySession(sessionId);
      if (destroyed) {
        purged.push(destroyed);
      }
    }

    await this.redis.unlinkKeys([indexKey]);
    return purged;
  }

  public async purgeSessionsByPerson(idInterno: string): Promise<SesionCentralOidc[]> {
    const indexKey = RedisOidcStoreAdapter.personSessionsKey(idInterno);
    const sessionIds = await this.getIndexedIds(indexKey);
    const purged: SesionCentralOidc[] = [];

    for (const sessionId of sessionIds) {
      const destroyed = await this.destroySession(sessionId);
      if (destroyed) {
        purged.push(destroyed);
      }
    }

    await this.redis.unlinkKeys([indexKey]);
    return purged;
  }

  public async saveGoogleFederationState(
    correlation: CorrelacionFederacionGoogle,
    ttlSeconds: number = HARD_MAX_REDIS_TTL_SECONDS,
  ): Promise<void> {
    const boundedTtl = Math.min(
      Math.max(1, Math.floor(ttlSeconds)),
      HARD_MAX_REDIS_TTL_SECONDS,
    );
    await this.redis.setWithTtl(
      RedisOidcStoreAdapter.googleStateKey(correlation.googleState),
      JSON.stringify(correlation),
      boundedTtl,
    );
  }

  public async consumeGoogleFederationState(
    googleState: string,
  ): Promise<CorrelacionFederacionGoogle | null> {
    const key = RedisOidcStoreAdapter.googleStateKey(googleState);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    await this.redis.unlinkKeys([key]);
    try {
      return JSON.parse(raw) as CorrelacionFederacionGoogle;
    } catch {
      return null;
    }
  }

  public async saveAuthorizationCode(
    code: CodigoAutorizacionEfimero,
    ttlSeconds: number = MAX_AUTH_CODE_TTL_SECONDS,
  ): Promise<void> {
    const boundedTtl = Math.min(
      Math.max(1, Math.floor(ttlSeconds)),
      MAX_AUTH_CODE_TTL_SECONDS,
    );
    const key = RedisOidcStoreAdapter.authorizationCodeKey(code.codeId);
    await this.redis.hsetWithTtl(
      key,
      {
        payload: JSON.stringify(code),
        consumedAt: code.consumedAt ?? '',
      },
      boundedTtl,
    );

    await this.addSessionToIndex(
      RedisOidcStoreAdapter.sessionCodesIndexKey(code.sessionId),
      code.codeId,
      HARD_MAX_REDIS_TTL_SECONDS,
    );
  }

  public async consumeAuthorizationCodeSingleUse(
    codeId: string,
  ): Promise<ConsumeAuthorizationCodeResult> {
    const key = RedisOidcStoreAdapter.authorizationCodeKey(codeId);
    const fields = await this.redis.hgetall(key);
    if (!fields || !fields.payload) {
      return { status: 'NOT_FOUND_OR_EXPIRED' };
    }

    let codeRecord: CodigoAutorizacionEfimero;
    try {
      codeRecord = JSON.parse(fields.payload) as CodigoAutorizacionEfimero;
    } catch {
      return { status: 'NOT_FOUND_OR_EXPIRED' };
    }

    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    if (nowEpochSeconds > codeRecord.expiresAtEpochSeconds) {
      await this.redis.unlinkKeys([key]);
      return { status: 'NOT_FOUND_OR_EXPIRED' };
    }

    if (fields.consumedAt && fields.consumedAt.trim().length > 0) {
      await this.redis.unlinkKeys([key]);
      return {
        status: 'REPLAY_DETECTED',
        codeRecord: {
          ...codeRecord,
          consumedAt: fields.consumedAt,
        },
      };
    }

    const consumedAtIso = new Date().toISOString();
    const updatedRecord: CodigoAutorizacionEfimero = {
      ...codeRecord,
      consumedAt: consumedAtIso,
    };

    const remainingTtl = Math.max(
      1,
      Math.min(MAX_AUTH_CODE_TTL_SECONDS, codeRecord.expiresAtEpochSeconds - nowEpochSeconds),
    );
    await this.redis.hsetWithTtl(
      key,
      {
        payload: JSON.stringify(updatedRecord),
        consumedAt: consumedAtIso,
      },
      remainingTtl,
    );

    return {
      status: 'CONSUMED_FIRST_TIME',
      codeRecord: updatedRecord,
    };
  }

  public async purgeAuthorizationCodesForSession(sessionId: string): Promise<void> {
    const indexKey = RedisOidcStoreAdapter.sessionCodesIndexKey(sessionId);
    const codeIds = await this.getIndexedIds(indexKey);
    if (codeIds.length > 0) {
      const codeKeys = codeIds.map((id) => RedisOidcStoreAdapter.authorizationCodeKey(id));
      await this.redis.unlinkKeys(codeKeys);
    }
    await this.redis.unlinkKeys([indexKey]);
  }

  private async getIndexedIds(indexKey: string): Promise<string[]> {
    const raw = await this.redis.get(indexKey);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async addSessionToIndex(
    indexKey: string,
    id: string,
    ttlSeconds: number,
  ): Promise<void> {
    const existing = await this.getIndexedIds(indexKey);
    if (!existing.includes(id)) {
      existing.push(id);
    }
    await this.redis.setWithTtl(
      indexKey,
      JSON.stringify(existing),
      Math.min(ttlSeconds, HARD_MAX_REDIS_TTL_SECONDS),
    );
  }

  private async removeSessionFromIndex(indexKey: string, id: string): Promise<void> {
    const existing = await this.getIndexedIds(indexKey);
    const filtered = existing.filter((item) => item !== id);
    if (filtered.length === 0) {
      await this.redis.unlinkKeys([indexKey]);
      return;
    }
    await this.redis.setWithTtl(
      indexKey,
      JSON.stringify(filtered),
      HARD_MAX_REDIS_TTL_SECONDS,
    );
  }
}

/**
 * Adaptador compatible con el contrato `Adapter` de `oidc-provider` sobre Memorystore for Redis (`DA-11`).
 */
export class RedisOidcProviderModelAdapter {
  constructor(
    private readonly modelName: string,
    private readonly redis: KeyValueCacheClient,
  ) {}

  private key(id: string): string {
    return `minedec:oidc:adapter:${this.modelName}:${id}`;
  }

  private uidKey(uid: string): string {
    return `minedec:oidc:adapter:uid:${uid}`;
  }

  private grantKey(grantId: string): string {
    return `minedec:oidc:adapter:grant:${grantId}`;
  }

  public async upsert(
    id: string,
    payload: Record<string, unknown>,
    expiresIn: number,
  ): Promise<void> {
    const key = this.key(id);
    const maxTtl =
      this.modelName === 'AuthorizationCode'
        ? MAX_AUTH_CODE_TTL_SECONDS
        : HARD_MAX_REDIS_TTL_SECONDS;
    const boundedTtl = Math.min(Math.max(1, Math.floor(expiresIn || maxTtl)), maxTtl);

    await this.redis.hsetWithTtl(
      key,
      {
        payload: JSON.stringify(payload),
        ...(payload.consumed ? { consumed: String(payload.consumed) } : {}),
      },
      boundedTtl,
    );

    if (typeof payload.uid === 'string' && payload.uid) {
      await this.redis.setWithTtl(this.uidKey(payload.uid), id, boundedTtl);
    }

    if (typeof payload.grantId === 'string' && payload.grantId) {
      const gKey = this.grantKey(payload.grantId);
      const raw = await this.redis.get(gKey);
      const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (!list.includes(key)) {
        list.push(key);
      }
      await this.redis.setWithTtl(gKey, JSON.stringify(list), HARD_MAX_REDIS_TTL_SECONDS);
    }
  }

  public async find(id: string): Promise<Record<string, unknown> | undefined> {
    const data = await this.redis.hgetall(this.key(id));
    if (!data || !data.payload) {
      return undefined;
    }
    const parsed = JSON.parse(data.payload) as Record<string, unknown>;
    if (data.consumed) {
      parsed.consumed = Number(data.consumed) || true;
    }
    return parsed;
  }

  public async findByUid(uid: string): Promise<Record<string, unknown> | undefined> {
    const id = await this.redis.get(this.uidKey(uid));
    if (!id) {
      return undefined;
    }
    return this.find(id);
  }

  public async consume(id: string): Promise<void> {
    const key = this.key(id);
    const data = await this.redis.hgetall(key);
    if (!data || !data.payload) {
      return;
    }
    await this.redis.hsetWithTtl(
      key,
      {
        ...data,
        consumed: String(Math.floor(Date.now() / 1000)),
      },
      MAX_AUTH_CODE_TTL_SECONDS,
    );
  }

  public async destroy(id: string): Promise<void> {
    await this.redis.unlinkKeys([this.key(id)]);
  }

  public async revokeByGrantId(grantId: string): Promise<void> {
    const gKey = this.grantKey(grantId);
    const raw = await this.redis.get(gKey);
    if (raw) {
      const keys = JSON.parse(raw) as string[];
      if (keys.length > 0) {
        await this.redis.unlinkKeys(keys);
      }
    }
    await this.redis.unlinkKeys([gKey]);
  }
}
