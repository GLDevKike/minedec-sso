/**
 * Adaptador de Auditoría de 3 Capas sin Bloqueo Transaccional — `motor-pdp`.
 *
 * Cumplimiento Constitucional (v2.10.0, Principios V.4, XIII y XV):
 * 1. Decisiones de evaluación de alta frecuencia (`PDP_EVALUACION_PERMIT`, `PDP_EVALUACION_DENY`,
 *    `PDP_EVALUACION_SHADOW_PERMIT`) se emiten en streaming JSON con firma SHA-256 hacia
 *    Cloud Logging Sink -> BigQuery (`bq_auditoria_analitica_append_only`) y GCS WORM
 *    (`gcs_worm_archivo_forense`), evitando contención de lock transaccional en AlloyDB.
 * 2. Eventos de seguridad, credenciales M2M, rotación JWKS e invalidación Pub/Sub se persisten
 *    transaccionalmente en `auditoria_evento` (AlloyDB) con encadenamiento SHA-256.
 */

import crypto from 'node:crypto';
import {
  AuditEventWriter,
  GENESIS_AUDIT_HASH_SHA256,
  StructuredLogger,
  computeAuditEventHashSha256,
} from '@minedec/shared';
import {
  PdpAuditPort,
  PdpEvaluationAuditRecord,
  PdpTransactionalSecurityAuditRecord,
} from '../../domain/ports/pdp.ports';

export interface StreamingAuditEnvelope extends PdpEvaluationAuditRecord {
  eventoId: string;
  fechaEventoIso: string;
  origenCanal: 'PDP_MOTOR';
  hashEventoSha256: string;
  destinosForenses: readonly [
    'bq_auditoria_analitica_append_only',
    'gcs_worm_archivo_forense',
  ];
}

export class AlloyDbAndStreamingPdpAuditAdapter implements PdpAuditPort {
  private readonly recentStreamingEvents: StreamingAuditEnvelope[] = [];
  private readonly maxBufferSize = 200;

  constructor(
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  public emitStreamingEvaluationEvent(record: PdpEvaluationAuditRecord): void {
    const eventoId = crypto.randomUUID();
    const fechaEventoIso = new Date().toISOString();
    const valoresNuevosJson = JSON.stringify({
      aplicacionId: record.aplicacionId,
      codigoAplicacion: record.codigoAplicacion,
      rutaNormalizada: record.rutaNormalizada,
      metodoHttp: record.metodoHttp,
      autorizado: record.autorizado,
      codigoDecision: record.codigoDecision,
      decisionProyectada: record.decisionProyectada,
      modoSombra: Boolean(record.modoSombra),
      rolesEfectivos: record.rolesEfectivos,
      permisosEfectivos: record.permisosEfectivos,
      politicasEvaluadas: record.politicasEvaluadas,
    });

    const hashEventoSha256 = computeAuditEventHashSha256({
      eventoId,
      fechaEventoIso,
      tipoEvento: record.tipoEvento,
      actorIdentificacion: 'MOTOR_PDP',
      sujetoIdentificacion: record.sujetoIdentificacion ?? null,
      valoresNuevosJson,
      hashEventoAnteriorSha256: GENESIS_AUDIT_HASH_SHA256,
    });

    const envelope: StreamingAuditEnvelope = {
      ...record,
      eventoId,
      fechaEventoIso,
      origenCanal: 'PDP_MOTOR',
      hashEventoSha256,
      destinosForenses: [
        'bq_auditoria_analitica_append_only',
        'gcs_worm_archivo_forense',
      ],
    };

    if (this.recentStreamingEvents.length >= this.maxBufferSize) {
      this.recentStreamingEvents.shift();
    }
    this.recentStreamingEvents.push(envelope);

    setImmediate(() => {
      this.logger.info(
        {
          auditStream: true,
          eventoId: envelope.eventoId,
          tipoEvento: envelope.tipoEvento,
          origenCanal: envelope.origenCanal,
          aplicacionId: envelope.aplicacionId,
          codigoAplicacion: envelope.codigoAplicacion,
          sujetoIdentificacion: envelope.sujetoIdentificacion ?? null,
          correoAfectado: envelope.correoAfectado ?? null,
          rutaNormalizada: envelope.rutaNormalizada,
          metodoHttp: envelope.metodoHttp,
          autorizado: envelope.autorizado,
          codigoDecision: envelope.codigoDecision,
          decisionProyectada: envelope.decisionProyectada,
          modoSombra: Boolean(envelope.modoSombra),
          hashEventoSha256: envelope.hashEventoSha256,
          destinosForenses: envelope.destinosForenses,
          traceId: envelope.traceId,
        },
        `Evento de auditoría PDP en streaming: ${envelope.tipoEvento}`,
      );
    });
  }

  public async recordTransactionalSecurityEvent(
    record: PdpTransactionalSecurityAuditRecord,
  ): Promise<void> {
    const saved = await this.auditWriter.appendEvent({
      tipoEvento: record.tipoEvento,
      actorIdentificacion: record.actorIdentificacion,
      sujetoIdentificacion: record.sujetoIdentificacion ?? null,
      correoAfectado: record.correoAfectado ?? null,
      origenCanal: 'PDP_MOTOR',
      entidadAfectada: record.entidadAfectada,
      registroAfectadoId: record.registroAfectadoId,
      valoresNuevos: record.valoresNuevos,
      traceId: record.traceId,
    });

    this.logger.info(
      {
        auditTransactional: true,
        eventoId: saved.eventoId,
        tipoEvento: saved.tipoEvento,
        origenCanal: 'PDP_MOTOR',
        entidadAfectada: saved.entidadAfectada,
        registroAfectadoId: saved.registroAfectadoId,
        hashEventoAnteriorSha256: saved.hashEventoAnteriorSha256,
        hashEventoSha256: saved.hashEventoSha256,
        destinosForenses: [
          'alloydb_auditoria_evento',
          'bq_auditoria_analitica_append_only',
          'gcs_worm_archivo_forense',
        ],
        traceId: record.traceId,
      },
      `Evento transaccional de seguridad PDP registrado: ${record.tipoEvento}`,
    );
  }

  public getRecentStreamingEvents(): ReadonlyArray<StreamingAuditEnvelope> {
    return this.recentStreamingEvents;
  }

  public clearRecentStreamingEvents(): void {
    this.recentStreamingEvents.length = 0;
  }
}
