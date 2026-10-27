import {
  OrigenCanalAuditoria,
  SqlQueryExecutor,
  StructuredLogger,
  TipoEventoAuditoriaPip,
  TransactionalAuditEventWriter,
} from '@minedec/shared';
import {
  AuditLogPort,
  AuditRecordRequest,
  CacheInvalidationEventPayload,
  CacheInvalidationPublisherPort,
} from '../../domain/ports';

export interface PubSubCacheInvalidationOptions {
  topicName?: string;
  logger?: StructuredLogger;
}

export class PubSubCacheInvalidationAdapter implements CacheInvalidationPublisherPort {
  private readonly publishedEvents: CacheInvalidationEventPayload[] = [];
  private readonly subscribers: Array<(event: CacheInvalidationEventPayload) => Promise<void> | void> = [];
  private readonly topicName: string;
  private readonly logger?: StructuredLogger;

  public constructor(
    topicOrOptions?: string | PubSubCacheInvalidationOptions,
    logger?: StructuredLogger,
  ) {
    if (typeof topicOrOptions === 'string') {
      this.topicName = topicOrOptions;
      this.logger = logger;
    } else {
      this.topicName =
        topicOrOptions?.topicName ??
        process.env.PUBSUB_CACHE_INVALIDATION_TOPIC ??
        'minedec-sso-pip-cache-invalidation';
      this.logger = topicOrOptions?.logger ?? logger;
    }
  }

  public async publishInvalidationEvent(
    event: CacheInvalidationEventPayload,
  ): Promise<void> {
    this.publishedEvents.push(event);

    this.logger?.info('Published reactive cache invalidation event to Cloud Pub/Sub (< 5 s SLA)', {
      topicName: this.topicName,
      eventId: event.eventId,
      idInterno: event.idInterno,
      reason: event.reason,
      keysUnlinkedCount: event.keysUnlinkedCount,
    });

    for (const subscriber of this.subscribers) {
      await subscriber(event);
    }
  }

  public onInvalidationPublished(
    listener: (event: CacheInvalidationEventPayload) => Promise<void> | void,
  ): void {
    this.subscribers.push(listener);
  }

  public getPublishedEvents(): readonly CacheInvalidationEventPayload[] {
    return this.publishedEvents;
  }

  public clearPublishedEvents(): void {
    this.publishedEvents.length = 0;
  }
}

function mapOrigenCanal(
  origenComponente: AuditRecordRequest['origenComponente'],
): OrigenCanalAuditoria {
  switch (origenComponente) {
    case 'PAP_ADMIN':
      return 'PAP_ADMIN';
    case 'PDP_MOTOR':
      return 'LOGIN_JIT';
    default:
      return 'PIP_INGEST';
  }
}

function mapTipoEventoAuditoria(
  rawTipo: string,
): TipoEventoAuditoriaPip {
  switch (rawTipo) {
    case 'TRANSICION_CODIGO_MINEDEC_A_CEDULA':
    case 'TRANSICION_CODIGO_A_CEDULA':
      return 'TRANSICION_CODIGO_A_CEDULA';
    case 'INTENTO_MUTACION_CEDULA_RECHAZADO':
      return 'INTENTO_MUTACION_CEDULA_RECHAZADO';
    case 'REGISTRO_CALIENTE_PROVISIONAL':
    case 'REGISTRO_CALIENTE_CREADO':
      return 'REGISTRO_CALIENTE_CREADO';
    case 'REGISTRO_CALIENTE_UNIFICADO':
      return 'REGISTRO_CALIENTE_UNIFICADO';
    case 'ANOMALIA_DETECTADA':
      return 'ANOMALIA_DETECTADA';
    case 'ANOMALIA_RESUELTA_AUTOMATICA':
    case 'ANOMALIA_RESUELTA_MANUAL':
    case 'ANOMALIA_RESUELTA':
      return 'ANOMALIA_RESUELTA';
    case 'ASIGNACION_CONTEXTO_MODIFICADA':
    case 'ASIGNACION_CONTEXTO_CREADA':
      return 'ASIGNACION_CONTEXTO_CREADA';
    case 'ASIGNACION_CONTEXTO_DESACTIVADA':
      return 'ASIGNACION_CONTEXTO_DESACTIVADA';
    case 'CATALOGO_ACTUALIZADO':
      return 'CATALOGO_ACTUALIZADO';
    case 'IDENTIDAD_SUSPENDIDA':
      return 'IDENTIDAD_SUSPENDIDA';
    default:
      return 'IDENTIDAD_SINCRONIZADA';
  }
}

export class TransactionalAuditLogAdapter implements AuditLogPort {
  public constructor(
    private readonly auditWriter: TransactionalAuditEventWriter,
    private readonly defaultExecutor: SqlQueryExecutor,
  ) {}

  public async recordEvent(
    request: AuditRecordRequest,
    tx?: SqlQueryExecutor,
  ): Promise<void> {
    const executor = tx ?? this.defaultExecutor;
    await this.auditWriter.appendEvent(
      {
        tipoEvento: mapTipoEventoAuditoria(request.tipoEvento),
        actorIdentificacion: request.actorIdentificacion,
        sujetoIdentificacion: request.idInterno ?? null,
        origenCanal: mapOrigenCanal(request.origenComponente),
        entidadAfectada: request.cuentaId ? 'cuenta_institucional' : 'persona_identidad',
        registroAfectadoId:
          request.cuentaId ?? request.idInterno ?? 'GLOBAL_SYSTEM_EVENT',
        valoresNuevos: request.payloadEvento,
      },
      executor,
    );
  }
}
