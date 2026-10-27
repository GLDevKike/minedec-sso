/**
 * Suscriptor de Invalidación Proactiva de Caché L2 vía Cloud Pub/Sub — `motor-pdp` (`T034`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V, X y XVI):
 * - Consume eventos de baja/suspensión/revocación de sujeto (`id_interno` / `email_principal`)
 *   y actualización de políticas (`codigo_aplicacion`) desde la suscripción
 *   `conecta-pdp-cache-invalidation-sub` (`<= 5 s`, acoplado al SLA duro `<= 300 s`).
 * - Registra evento transaccional `PDP_CACHE_INVALIDADO_PUBSUB` en `auditoria_evento`.
 */

import { Message, PubSub, Subscription } from '@google-cloud/pubsub';
import { StructuredLogger } from '@minedec/shared';
import { z } from 'zod';
import { PdpAuditPort, PdpL2CachePort } from '../../domain/ports/pdp.ports';
import { MotorPdpEnvConfig } from '../http/schemas/pdp-zod.schemas';

export const PdpCacheInvalidationEventSchema = z
  .object({
    event_type: z
      .enum([
        'REVOKE_SUBJECT',
        'USER_SUSPENDED',
        'ANOMALY_BLOCKED',
        'ROLE_ASSIGNMENT_CHANGED',
        'POLICY_BUNDLE_UPDATED',
        'PUBSUB_USER_REVOKED',
        'PUBSUB_POLICY_PUBLISHED',
        'PUBSUB_EMERGENCY_FLUSH_ALL',
      ])
      .optional(),
    tipo_evento: z
      .enum([
        'REVOKE_SUBJECT',
        'USER_SUSPENDED',
        'ANOMALY_BLOCKED',
        'ROLE_ASSIGNMENT_CHANGED',
        'POLICY_BUNDLE_UPDATED',
        'PUBSUB_USER_REVOKED',
        'PUBSUB_POLICY_PUBLISHED',
        'PUBSUB_EMERGENCY_FLUSH_ALL',
      ])
      .optional(),
    id_interno: z.string().uuid().optional(),
    email_principal: z.string().email().optional(),
    codigo_aplicacion: z.string().min(1).max(64).optional(),
    actor_identificacion: z.string().default('SISTEMA_PUBSUB_SYNC'),
    reason: z.string().default('EVENTO_REVOCACION_PROACTIVA'),
    trace_id: z.string().optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.id_interno ||
          data.email_principal ||
          data.codigo_aplicacion ||
          data.event_type === 'PUBSUB_EMERGENCY_FLUSH_ALL' ||
          data.tipo_evento === 'PUBSUB_EMERGENCY_FLUSH_ALL',
      ),
    {
      message:
        'El evento de invalidación debe incluir al menos id_interno, email_principal, codigo_aplicacion o PUBSUB_EMERGENCY_FLUSH_ALL',
    },
  );

export type PdpCacheInvalidationEventPayload = z.infer<
  typeof PdpCacheInvalidationEventSchema
>;

export class PubSubPdpCacheInvalidationSubscriber {
  private subscription?: Subscription;

  constructor(
    private readonly l2Cache: PdpL2CachePort,
    private readonly auditPort: PdpAuditPort,
    private readonly envConfig: MotorPdpEnvConfig,
    private readonly logger: StructuredLogger,
  ) {}

  public async handleInvalidationEvent(
    rawPayload: unknown,
  ): Promise<{ purgedKeysCount: number; invalidatedKeys: number }> {
    const parsed = PdpCacheInvalidationEventSchema.parse(rawPayload);
    const effectiveEventType =
      parsed.event_type ?? parsed.tipo_evento ?? 'REVOKE_SUBJECT';
    let purgedKeysCount = 0;

    if (
      effectiveEventType === 'PUBSUB_EMERGENCY_FLUSH_ALL' &&
      this.l2Cache.flushAll
    ) {
      purgedKeysCount += await this.l2Cache.flushAll();
    }

    if (parsed.id_interno || parsed.email_principal) {
      purgedKeysCount += await this.l2Cache.invalidateBySubject({
        idInterno: parsed.id_interno,
        emailPrincipal: parsed.email_principal,
      });
    }

    if (parsed.codigo_aplicacion) {
      purgedKeysCount += await this.l2Cache.invalidateByApplication(
        parsed.codigo_aplicacion,
      );
    }

    const registroAfectadoId =
      parsed.id_interno ??
      parsed.codigo_aplicacion ??
      parsed.email_principal ??
      'GLOBAL';

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_CACHE_INVALIDADO_PUBSUB',
      actorIdentificacion: parsed.actor_identificacion,
      sujetoIdentificacion: parsed.id_interno ?? null,
      correoAfectado: parsed.email_principal ?? null,
      entidadAfectada: parsed.codigo_aplicacion
        ? 'aplicacion'
        : 'persona_identidad',
      registroAfectadoId,
      valoresNuevos: {
        event_type: effectiveEventType,
        codigo_aplicacion: parsed.codigo_aplicacion ?? null,
        id_interno: parsed.id_interno ?? null,
        purged_keys_count: purgedKeysCount,
        reason: parsed.reason,
      },
      traceId: parsed.trace_id,
    });

    this.logger.info('Caché L2 de motor-pdp invalidado vía Pub/Sub', {
      eventType: effectiveEventType,
      idInterno: parsed.id_interno,
      codigoAplicacion: parsed.codigo_aplicacion,
      purgedKeysCount,
    });

    return { purgedKeysCount, invalidatedKeys: purgedKeysCount };
  }

  public async handlePubSubMessage(
    message: Pick<Message, 'id' | 'data' | 'ack' | 'nack'>,
  ): Promise<void> {
    try {
      const jsonText = Buffer.from(message.data).toString('utf8');
      const payload = JSON.parse(jsonText) as unknown;
      await this.handleInvalidationEvent(payload);
      message.ack();
    } catch (error) {
      this.logger.error(
        'Error al procesar mensaje Pub/Sub de invalidación L2 en motor-pdp',
        {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      message.nack();
    }
  }

  public startListening(pubSubClient?: PubSub): void {
    const client =
      pubSubClient ??
      new PubSub({
        projectId: this.envConfig.GCP_PROJECT_ID,
      });
    this.subscription = client.subscription(
      this.envConfig.PUBSUB_PDP_SUBSCRIPTION,
    );
    this.subscription.on('message', (msg: Message) => {
      void this.handlePubSubMessage(msg);
    });
    this.subscription.on('error', (err: Error) => {
      this.logger.error(
        'Error en suscripción Pub/Sub de invalidación L2 motor-pdp',
        {
          subscription: this.envConfig.PUBSUB_PDP_SUBSCRIPTION,
          error: err.message,
        },
      );
    });
  }

  public async stopListening(): Promise<void> {
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = undefined;
    }
  }
}
