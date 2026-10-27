import { RedisCacheClient, getLogger, pipMetrics } from '@minedec/shared';
import { ISyncCacheInvalidatorPort } from '../../domain/ports/sync-ports';

export interface PubSubTopicPublisherLike {
  publishMessage(message: {
    data: Buffer;
    attributes?: Record<string, string>;
  }): Promise<string>;
}

/**
 * Adaptador de invalidación de caché L2 en Memorystore Redis (`TTL <= 300 s`) y publicación
 * en el tópico Pub/Sub `minedec-identity-cache-invalidation`, soportando:
 * 1. Purga granular por `CuentaInstitucional` (Nivel 1 de Baja Diferenciada).
 * 2. Purga total en cascada por `PersonaIdentidad` (Nivel 2 de Baja Diferenciada) (`T032`).
 */
export class RedisPubSubCacheInvalidatorAdapter implements ISyncCacheInvalidatorPort {
  private readonly logger = getLogger();

  constructor(
    private readonly redisClient: RedisCacheClient,
    private readonly pubSubPublisher?: PubSubTopicPublisherLike,
    private readonly topicName: string = 'minedec-identity-cache-invalidation',
  ) {}

  public async invalidateAccountScope(params: {
    idInternoPersona: string;
    cuentaId: string;
    googleSubId: string;
    emailPrincipal: string;
    motivo: string;
    traceId: string;
  }): Promise<{ invalidatedKeysCount: number; pubSubPublished: boolean }> {
    const normalizedEmail = params.emailPrincipal.trim().toLowerCase();
    const keys = [
      RedisCacheClient.keyBySub(params.googleSubId),
      RedisCacheClient.keyByEmail(params.emailPrincipal),
      RedisCacheClient.keyByInternalId(params.idInternoPersona),
      `minedec:pip:persona:${params.idInternoPersona}`,
      `minedec:pip:gid:${params.googleSubId}`,
      `minedec:pip:email:${normalizedEmail}`,
      `minedec:pdp:authz:sub:${params.googleSubId}`,
      `minedec:pdp:authz:email:${normalizedEmail}`,
    ];

    const invalidatedKeysCount = await this.redisClient.deleteKeys(keys);
    const pubSubPublished = await this.publishInvalidationEvent({
      scope: 'ACCOUNT_ISOLATED',
      idInternoPersona: params.idInternoPersona,
      cuentaIds: [params.cuentaId],
      googleSubIds: [params.googleSubId],
      emails: [normalizedEmail],
      motivo: params.motivo,
      traceId: params.traceId,
    });

    pipMetrics.recordCacheInvalidation();
    return { invalidatedKeysCount, pubSubPublished };
  }

  public async invalidatePersonCascadeScope(params: {
    idInternoPersona: string;
    tipoIdentificacion?: string | null;
    numeroIdentificacion?: string | null;
    cuentas: Array<{
      cuentaId: string;
      googleSubId: string;
      emailPrincipal: string;
      dominio: string;
    }>;
    motivo: string;
    traceId: string;
  }): Promise<{ invalidatedKeysCount: number; pubSubPublished: boolean }> {
    const keys: string[] = [
      RedisCacheClient.keyByInternalId(params.idInternoPersona),
      `minedec:pip:persona:${params.idInternoPersona}`,
      `minedec:pdp:authz:person:${params.idInternoPersona}`,
    ];

    if (params.tipoIdentificacion && params.numeroIdentificacion) {
      keys.push(
        RedisCacheClient.keyByDoc(params.tipoIdentificacion, params.numeroIdentificacion),
        `minedec:pip:ident:${params.tipoIdentificacion.trim().toUpperCase()}:${params.numeroIdentificacion.trim().toUpperCase()}`,
      );
    }

    for (const cuenta of params.cuentas) {
      const normalizedEmail = cuenta.emailPrincipal.trim().toLowerCase();
      keys.push(
        RedisCacheClient.keyBySub(cuenta.googleSubId),
        RedisCacheClient.keyByEmail(cuenta.emailPrincipal),
        `minedec:pip:gid:${cuenta.googleSubId}`,
        `minedec:pip:email:${normalizedEmail}`,
        `minedec:pdp:authz:sub:${cuenta.googleSubId}`,
        `minedec:pdp:authz:email:${normalizedEmail}`,
      );
    }

    const invalidatedKeysCount = await this.redisClient.deleteKeys(keys);
    const pubSubPublished = await this.publishInvalidationEvent({
      scope: 'PERSON_CASCADE',
      idInternoPersona: params.idInternoPersona,
      cuentaIds: params.cuentas.map((c) => c.cuentaId),
      googleSubIds: params.cuentas.map((c) => c.googleSubId),
      emails: params.cuentas.map((c) => c.emailPrincipal.toLowerCase()),
      motivo: params.motivo,
      traceId: params.traceId,
    });

    pipMetrics.recordCacheInvalidation();
    return { invalidatedKeysCount, pubSubPublished };
  }

  private async publishInvalidationEvent(payload: {
    scope: 'ACCOUNT_ISOLATED' | 'PERSON_CASCADE';
    idInternoPersona: string;
    cuentaIds: string[];
    googleSubIds: string[];
    emails: string[];
    motivo: string;
    traceId: string;
  }): Promise<boolean> {
    if (!this.pubSubPublisher) {
      return true;
    }
    try {
      await this.pubSubPublisher.publishMessage({
        data: Buffer.from(
          JSON.stringify({
            ...payload,
            topic: this.topicName,
            publishedAt: new Date().toISOString(),
          }),
          'utf8',
        ),
        attributes: {
          scope: payload.scope,
          traceId: payload.traceId,
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        {
          event: 'PUBSUB_INVALIDATION_PUBLISH_DEGRADED',
          topicName: this.topicName,
          traceId: payload.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Fallo al publicar en Pub/Sub; la invalidación directa en Redis L2 y el TTL <= 300s garantizan el SLA.',
      );
      return false;
    }
  }
}
