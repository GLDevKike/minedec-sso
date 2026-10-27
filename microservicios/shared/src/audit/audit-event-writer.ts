import crypto from 'node:crypto';
import { SqlQueryExecutor } from '../db/postgres-client';

/**
 * Hash semilla génesis (64 ceros hexadecimales) para el primer evento de la cadena de auditoría SHA-256.
 */
export const GENESIS_AUDIT_HASH_SHA256 = '0'.repeat(64);

export type OrigenCanalAuditoria =
  | 'PIP_INGEST'
  | 'LOGIN_JIT'
  | 'PDP_MOTOR'
  | 'PAP_ADMIN'
  | 'SYNC_INCREMENTAL'
  | 'SYNC_BATCH_JOB'
  | 'SINCRONIZADOR_GWS'
  | 'SSO_OIDC_BROKER';

export type TipoEventoAuditoriaPip =
  | 'IDENTIDAD_SINCRONIZADA'
  | 'IDENTIDAD_SUSPENDIDA'
  | 'IDENTIDAD_ELIMINADA'
  | 'PERSONA_DESACTIVADA'
  | 'TRANSICION_CODIGO_A_CEDULA'
  | 'INTENTO_MUTACION_CEDULA_RECHAZADO'
  | 'REGISTRO_CALIENTE_CREADO'
  | 'REGISTRO_CALIENTE_UNIFICADO'
  | 'ANOMALIA_DETECTADA'
  | 'ANOMALIA_RESUELTA'
  | 'ASIGNACION_CONTEXTO_CREADA'
  | 'ASIGNACION_CONTEXTO_DESACTIVADA'
  | 'CACHE_INVALIDADO'
  | 'CATALOGO_ACTUALIZADO'
  | 'CONCILIACION_PARTICION_COMPLETADA'
  | 'CONCILIACION_PARTICION_RECLAMADA'
  | 'EVENTO_DLQ_REGISTRADO'
  | 'EVENTO_DLQ_REPROCESADO'
  | 'OIDC_AUTHORIZE_INICIADO'
  | 'OIDC_FEDERACION_GOOGLE_EXITOSA'
  | 'OIDC_ID_TOKEN_EMITIDO'
  | 'OIDC_REGISTRO_CALIENTE_PENDIENTE_BLOQUEADO'
  | 'OIDC_RECHAZO_SEGURIDAD'
  | 'OIDC_SLO_EJECUTADO'
  | 'OIDC_SESION_REVOCADA_PUBSUB'
  | 'OIDC_JWKS_ROTADO'
  | 'OIDC_JWKS_REVOCADO_EMERGENCIA'
  | 'PDP_EVALUACION_PERMIT'
  | 'PDP_EVALUACION_DENY'
  | 'PDP_EVALUACION_SHADOW_PERMIT'
  | 'PDP_TOKEN_M2M_EMITIDO'
  | 'PDP_TOKEN_M2M_RECHAZADO'
  | 'PDP_CACHE_INVALIDADO_PUBSUB'
  | 'PDP_RECHAZO_SEGURIDAD_RUTA'
  | 'PDP_JWKS_ROTADO'
  | 'PDP_JWKS_REVOCADO_EMERGENCIA'
  | 'JWKS_ROTACION_EJECUTADA'
  | 'JWKS_REVOCACION_EMERGENCIA'
  | string;

export interface AuditEventInput {
  eventoId?: string;
  tipoEvento: TipoEventoAuditoriaPip;
  actorIdInterno?: string | null;
  actorIdentificacion?: string;
  actorSub?: string;
  idInterno?: string | null;
  cuentaId?: string | null;
  sujetoIdentificacion?: string | null;
  correoAfectado?: string | null;
  origenCanal?: OrigenCanalAuditoria | string;
  origenComponente?: string;
  entidadAfectada?: string;
  registroAfectadoId?: string;
  valoresAnteriores?: Record<string, unknown> | null;
  valoresNuevos?: Record<string, unknown> | null;
  datosPrevios?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
  payloadEvento?: Record<string, unknown> | null;
  resumenCambio?: string;
  traceId?: string;
  fechaEvento?: Date;
}

export interface AuditEventRecord extends AuditEventInput {
  eventoId: string;
  actorIdentificacion: string;
  origenCanal: OrigenCanalAuditoria;
  entidadAfectada: string;
  registroAfectadoId: string;
  fechaEvento: Date;
  hashEventoAnteriorSha256: string;
  hashEventoSha256: string;
}

/**
 * Calcula de forma determinística el hash SHA-256 encadenado de un evento de auditoría (Constitución XV / FR-014).
 */
export function computeAuditEventHashSha256(params: {
  eventoId: string;
  fechaEventoIso: string;
  tipoEvento: string;
  actorIdentificacion: string;
  sujetoIdentificacion?: string | null;
  valoresNuevosJson?: string;
  hashEventoAnteriorSha256: string;
}): string {
  const payload = [
    params.eventoId,
    params.fechaEventoIso,
    params.tipoEvento,
    params.actorIdentificacion,
    params.sujetoIdentificacion ?? '',
    params.valoresNuevosJson ?? '',
    params.hashEventoAnteriorSha256,
  ].join('||');

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Identificador de bloqueo consultivo transaccional (AlloyDB / PostgreSQL 16) para serializar
 * el eslabonamiento SHA-256 de `auditoria_evento` sin bifurcaciones bajo concurrencia alta.
 */
export const AUDIT_CHAIN_ADVISORY_LOCK_KEY = 2026022001;

function isSqlQueryExecutor(obj: unknown): obj is SqlQueryExecutor {
  return Boolean(obj && typeof obj === 'object' && typeof (obj as SqlQueryExecutor).query === 'function');
}

/**
 * Escritor transaccional append-only (solo INSERT y SELECT) sobre la tabla `auditoria_evento`.
 */
export class TransactionalAuditEventWriter {
  constructor(private readonly defaultExecutor?: SqlQueryExecutor) {}

  public async appendEvent(
    inputOrTx: AuditEventInput | SqlQueryExecutor,
    txOrInput?: SqlQueryExecutor | AuditEventInput,
  ): Promise<AuditEventRecord> {
    let input: AuditEventInput;
    let executor: SqlQueryExecutor | undefined;

    if (isSqlQueryExecutor(inputOrTx)) {
      executor = inputOrTx;
      input = (txOrInput ?? {}) as AuditEventInput;
    } else {
      input = inputOrTx;
      executor = (txOrInput as SqlQueryExecutor | undefined) ?? this.defaultExecutor;
    }

    const eventoId = input.eventoId ?? crypto.randomUUID();
    const fechaEvento = input.fechaEvento ?? new Date();
    const fechaEventoIso = fechaEvento.toISOString();
    const actorIdentificacion =
      input.actorIdentificacion ?? input.actorSub ?? 'SYSTEM_SYNC';
    const actorIdInterno = input.actorIdInterno ?? input.idInterno ?? null;
    const origenCanal = (input.origenCanal ??
      input.origenComponente ??
      'SYNC_INCREMENTAL') as OrigenCanalAuditoria;
    const entidadAfectada = input.entidadAfectada ?? 'SINCRONIZACION_GWS';
    const registroAfectadoId =
      input.registroAfectadoId ?? input.cuentaId ?? input.idInterno ?? eventoId;

    const valoresAnterioresObj = input.valoresAnteriores ?? input.datosPrevios ?? null;
    const valoresNuevosObj =
      input.valoresNuevos ??
      input.datosNuevos ??
      input.payloadEvento ??
      (input.resumenCambio ? { resumenCambio: input.resumenCambio } : null);

    const valoresAnterioresJson = valoresAnterioresObj
      ? JSON.stringify(valoresAnterioresObj)
      : null;
    const valoresNuevosJson = valoresNuevosObj
      ? JSON.stringify(valoresNuevosObj)
      : null;

    if (!executor) {
      const hashEventoSha256 = computeAuditEventHashSha256({
        eventoId,
        fechaEventoIso,
        tipoEvento: input.tipoEvento,
        actorIdentificacion,
        sujetoIdentificacion: input.sujetoIdentificacion ?? null,
        valoresNuevosJson: valoresNuevosJson ?? '',
        hashEventoAnteriorSha256: GENESIS_AUDIT_HASH_SHA256,
      });
      return {
        ...input,
        eventoId,
        actorIdentificacion,
        origenCanal,
        entidadAfectada,
        registroAfectadoId,
        fechaEvento,
        hashEventoAnteriorSha256: GENESIS_AUDIT_HASH_SHA256,
        hashEventoSha256,
      };
    }

    await executor.query('SELECT pg_advisory_xact_lock($1)', [
      AUDIT_CHAIN_ADVISORY_LOCK_KEY,
    ]);

    const prevResult = await executor.query<{ hash_evento_sha256: string }>(
      `SELECT hash_evento_sha256
       FROM auditoria_evento
       ORDER BY fecha_evento DESC, evento_id DESC
       LIMIT 1`,
    );

    const hashEventoAnteriorSha256 =
      prevResult.rows[0]?.hash_evento_sha256 ?? GENESIS_AUDIT_HASH_SHA256;

    const hashEventoSha256 = computeAuditEventHashSha256({
      eventoId,
      fechaEventoIso,
      tipoEvento: input.tipoEvento,
      actorIdentificacion,
      sujetoIdentificacion: input.sujetoIdentificacion ?? null,
      valoresNuevosJson: valoresNuevosJson ?? '',
      hashEventoAnteriorSha256,
    });

    await executor.query(
      `INSERT INTO auditoria_evento (
        evento_id,
        tipo_evento,
        actor_id_interno,
        actor_identificacion,
        sujeto_identificacion,
        correo_afectado,
        origen_canal,
        entidad_afectada,
        registro_afectado_id,
        valores_anteriores,
        valores_nuevos,
        hash_evento_anterior_sha256,
        hash_evento_sha256,
        fecha_evento
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14)`,
      [
        eventoId,
        input.tipoEvento,
        actorIdInterno,
        actorIdentificacion,
        input.sujetoIdentificacion ?? null,
        input.correoAfectado ?? null,
        origenCanal,
        entidadAfectada,
        registroAfectadoId,
        valoresAnterioresJson,
        valoresNuevosJson,
        hashEventoAnteriorSha256,
        hashEventoSha256,
        fechaEventoIso,
      ],
    );

    return {
      ...input,
      eventoId,
      actorIdentificacion,
      origenCanal,
      entidadAfectada,
      registroAfectadoId,
      fechaEvento,
      hashEventoAnteriorSha256,
      hashEventoSha256,
    };
  }
}

export { TransactionalAuditEventWriter as AuditEventWriter };
