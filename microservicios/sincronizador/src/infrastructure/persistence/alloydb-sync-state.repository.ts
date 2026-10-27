import { SqlQueryExecutor } from '@minedec/shared';
import {
  CheckpointConciliacion,
  EstadoEjecucionCheckpoint,
  EstadoRegistroDlq,
  EventoSincronizacionGws,
  RegistroFalloSincronizacion,
  TipoProcesoConciliacion,
} from '../../domain/entities/sync-entities';
import {
  ICheckpointRepositoryPort,
  IDlqRepositoryPort,
  IProcessedEventRepositoryPort,
} from '../../domain/ports/sync-ports';

const ORPHAN_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Repositorio SQL 100% parametrizado (`$1, $2`) para las tablas de estado de sincronización:
 * `evento_sincronizacion_procesado`, `checkpoint_conciliacion` y `registro_fallo_sincronizacion` (`T018`).
 */
export class AlloyDbSyncStateRepository
  implements
    IProcessedEventRepositoryPort,
    ICheckpointRepositoryPort,
    IDlqRepositoryPort
{
  constructor(private readonly db: SqlQueryExecutor) {}

  public async findByIdEventoExterno(
    idEventoExterno: string,
    tx: SqlQueryExecutor = this.db,
  ): Promise<EventoSincronizacionGws | null> {
    const res = await tx.query<Record<string, unknown>>(
      `SELECT id_evento_externo, google_sub_id, email_principal, tipo_evento,
              timestamp_evento_gws, origen_canal, modo_despacho, resultado,
              hash_payload_gws, procesado_en
       FROM evento_sincronizacion_procesado
       WHERE id_evento_externo = $1`,
      [idEventoExterno],
    );
    if (!res.rows[0]) {
      return null;
    }
    return this.mapProcessedEventRow(res.rows[0]);
  }

  public async findLatestTimestampForUser(
    googleSubId: string,
    tx: SqlQueryExecutor = this.db,
  ): Promise<string | null> {
    const res = await tx.query<{ timestamp_evento_gws: Date | string }>(
      `SELECT timestamp_evento_gws
       FROM evento_sincronizacion_procesado
       WHERE google_sub_id = $1
       ORDER BY timestamp_evento_gws DESC
       LIMIT 1`,
      [googleSubId],
    );
    if (!res.rows[0]) {
      return null;
    }
    const raw = res.rows[0].timestamp_evento_gws;
    return raw instanceof Date ? raw.toISOString() : String(raw);
  }

  public async recordProcessedEvent(
    event: EventoSincronizacionGws,
    tx: SqlQueryExecutor = this.db,
  ): Promise<{ inserted: boolean; record: EventoSincronizacionGws }> {
    const res = await tx.query<Record<string, unknown>>(
      `INSERT INTO evento_sincronizacion_procesado (
         id_evento_externo, google_sub_id, email_principal, tipo_evento,
         timestamp_evento_gws, origen_canal, modo_despacho, resultado,
         hash_payload_gws, procesado_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id_evento_externo) DO NOTHING
       RETURNING id_evento_externo, google_sub_id, email_principal, tipo_evento,
                 timestamp_evento_gws, origen_canal, modo_despacho, resultado,
                 hash_payload_gws, procesado_en`,
      [
        event.idEventoExterno,
        event.googleSubId,
        event.emailPrincipal,
        event.tipoEvento,
        event.timestampEventoGws,
        event.origenCanal,
        event.modoDespacho,
        event.resultado,
        event.hashPayloadGws,
        event.procesadoEn,
      ],
    );
    if (res.rows[0]) {
      return { inserted: true, record: this.mapProcessedEventRow(res.rows[0]) };
    }
    const existing = await this.findByIdEventoExterno(event.idEventoExterno, tx);
    return { inserted: false, record: existing ?? event };
  }

  public async findByPartition(
    dominio: string,
    orgUnitPath: string,
    tipoProceso: TipoProcesoConciliacion,
    tx: SqlQueryExecutor = this.db,
  ): Promise<CheckpointConciliacion | null> {
    const res = await tx.query<Record<string, unknown>>(
      `SELECT checkpoint_id, dominio, org_unit_path, tipo_proceso, next_page_token,
              cuentas_procesadas, cuentas_actualizadas, cuentas_omitidas_hash,
              cuentas_baja_detectadas, anomalias_abiertas, estado_ejecucion,
              worker_instancia_id, lock_advisory_key, heartbeat_en, iniciado_en,
              completado_en, ultimo_error_codigo, diagnostico_operativo
       FROM checkpoint_conciliacion
       WHERE dominio = $1 AND org_unit_path = $2 AND tipo_proceso = $3`,
      [dominio.toLowerCase(), orgUnitPath, tipoProceso],
    );
    if (!res.rows[0]) {
      return null;
    }
    return this.mapCheckpointRow(res.rows[0]);
  }

  public async listCheckpoints(
    filters: {
      dominio?: string;
      tipoProceso?: TipoProcesoConciliacion;
      estadoEjecucion?: EstadoEjecucionCheckpoint;
    } = {},
    tx: SqlQueryExecutor = this.db,
  ): Promise<CheckpointConciliacion[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.dominio) {
      params.push(filters.dominio.toLowerCase());
      conditions.push(`dominio = $${params.length}`);
    }
    if (filters.tipoProceso) {
      params.push(filters.tipoProceso);
      conditions.push(`tipo_proceso = $${params.length}`);
    }
    if (filters.estadoEjecucion) {
      params.push(filters.estadoEjecucion);
      conditions.push(`estado_ejecucion = $${params.length}`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await tx.query<Record<string, unknown>>(
      `SELECT checkpoint_id, dominio, org_unit_path, tipo_proceso, next_page_token,
              cuentas_procesadas, cuentas_actualizadas, cuentas_omitidas_hash,
              cuentas_baja_detectadas, anomalias_abiertas, estado_ejecucion,
              worker_instancia_id, lock_advisory_key, heartbeat_en, iniciado_en,
              completado_en, ultimo_error_codigo, diagnostico_operativo
       FROM checkpoint_conciliacion
       ${whereSql}
       ORDER BY actualizado_en DESC`,
      params,
    );
    return res.rows.map((r) => this.mapCheckpointRow(r));
  }

  public async upsertCheckpoint(
    checkpoint: CheckpointConciliacion,
    tx: SqlQueryExecutor = this.db,
  ): Promise<CheckpointConciliacion> {
    const res = await tx.query<Record<string, unknown>>(
      `INSERT INTO checkpoint_conciliacion (
         checkpoint_id, dominio, org_unit_path, tipo_proceso, next_page_token,
         cuentas_procesadas, cuentas_actualizadas, cuentas_omitidas_hash,
         cuentas_baja_detectadas, anomalias_abiertas, estado_ejecucion,
         worker_instancia_id, lock_advisory_key, heartbeat_en, iniciado_en,
         completado_en, ultimo_error_codigo, diagnostico_operativo
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (dominio, org_unit_path, tipo_proceso) DO UPDATE SET
         next_page_token = EXCLUDED.next_page_token,
         cuentas_procesadas = EXCLUDED.cuentas_procesadas,
         cuentas_actualizadas = EXCLUDED.cuentas_actualizadas,
         cuentas_omitidas_hash = EXCLUDED.cuentas_omitidas_hash,
         cuentas_baja_detectadas = EXCLUDED.cuentas_baja_detectadas,
         anomalias_abiertas = EXCLUDED.anomalias_abiertas,
         estado_ejecucion = EXCLUDED.estado_ejecucion,
         worker_instancia_id = EXCLUDED.worker_instancia_id,
         heartbeat_en = EXCLUDED.heartbeat_en,
         completado_en = EXCLUDED.completado_en,
         ultimo_error_codigo = EXCLUDED.ultimo_error_codigo,
         diagnostico_operativo = EXCLUDED.diagnostico_operativo,
         actualizado_en = NOW()
       RETURNING checkpoint_id, dominio, org_unit_path, tipo_proceso, next_page_token,
                 cuentas_procesadas, cuentas_actualizadas, cuentas_omitidas_hash,
                 cuentas_baja_detectadas, anomalias_abiertas, estado_ejecucion,
                 worker_instancia_id, lock_advisory_key, heartbeat_en, iniciado_en,
                 completado_en, ultimo_error_codigo, diagnostico_operativo`,
      [
        checkpoint.checkpointId,
        checkpoint.dominio.toLowerCase(),
        checkpoint.orgUnitPath,
        checkpoint.tipoProceso,
        checkpoint.nextPageToken,
        checkpoint.cuentasProcesadas,
        checkpoint.cuentasActualizadas,
        checkpoint.cuentasOmitidasHash,
        checkpoint.cuentasBajaDetectadas,
        checkpoint.anomaliasAbiertas,
        checkpoint.estadoEjecucion,
        checkpoint.workerInstanciaId,
        checkpoint.lockAdvisoryKey,
        checkpoint.heartbeatEn,
        checkpoint.iniciadoEn,
        checkpoint.completadoEn,
        checkpoint.ultimoErrorCodigo,
        checkpoint.diagnosticoOperativo,
      ],
    );
    return this.mapCheckpointRow(res.rows[0]);
  }

  public async findById(
    dlqId: string,
    tx: SqlQueryExecutor = this.db,
  ): Promise<RegistroFalloSincronizacion | null> {
    const res = await tx.query<Record<string, unknown>>(
      `SELECT dlq_id, id_evento_externo, origen_canal, google_sub_id, email_principal,
              dominio, tipo_evento, payload_original, intentos_realizados,
              codigo_error, detalle_error_tecnico, diagnostico_lenguaje_natural,
              accion_recomendada, estado_dlq, resuelto_por_identificacion,
              motivo_resolucion, creado_en, actualizado_en, resuelto_en
       FROM registro_fallo_sincronizacion
       WHERE dlq_id = $1`,
      [dlqId],
    );
    if (!res.rows[0]) {
      return null;
    }
    return this.mapDlqRow(res.rows[0]);
  }

  public async findByExternalEventId(
    idEventoExterno: string,
    tx: SqlQueryExecutor = this.db,
  ): Promise<RegistroFalloSincronizacion | null> {
    const res = await tx.query<Record<string, unknown>>(
      `SELECT dlq_id, id_evento_externo, origen_canal, google_sub_id, email_principal,
              dominio, tipo_evento, payload_original, intentos_realizados,
              codigo_error, detalle_error_tecnico, diagnostico_lenguaje_natural,
              accion_recomendada, estado_dlq, resuelto_por_identificacion,
              motivo_resolucion, creado_en, actualizado_en, resuelto_en
       FROM registro_fallo_sincronizacion
       WHERE id_evento_externo = $1`,
      [idEventoExterno],
    );
    if (!res.rows[0]) {
      return null;
    }
    return this.mapDlqRow(res.rows[0]);
  }

  public async upsertDlqFailure(
    record: RegistroFalloSincronizacion,
    tx: SqlQueryExecutor = this.db,
  ): Promise<RegistroFalloSincronizacion> {
    const res = await tx.query<Record<string, unknown>>(
      `INSERT INTO registro_fallo_sincronizacion (
         dlq_id, id_evento_externo, origen_canal, google_sub_id, email_principal,
         dominio, tipo_evento, payload_original, intentos_realizados,
         codigo_error, detalle_error_tecnico, diagnostico_lenguaje_natural,
         accion_recomendada, estado_dlq, resuelto_por_identificacion,
         motivo_resolucion, creado_en, actualizado_en, resuelto_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (id_evento_externo) DO UPDATE SET
         intentos_realizados = EXCLUDED.intentos_realizados,
         codigo_error = EXCLUDED.codigo_error,
         detalle_error_tecnico = EXCLUDED.detalle_error_tecnico,
         diagnostico_lenguaje_natural = EXCLUDED.diagnostico_lenguaje_natural,
         accion_recomendada = EXCLUDED.accion_recomendada,
         estado_dlq = EXCLUDED.estado_dlq,
         resuelto_por_identificacion = EXCLUDED.resuelto_por_identificacion,
         motivo_resolucion = EXCLUDED.motivo_resolucion,
         actualizado_en = EXCLUDED.actualizado_en,
         resuelto_en = EXCLUDED.resuelto_en
       RETURNING dlq_id, id_evento_externo, origen_canal, google_sub_id, email_principal,
                 dominio, tipo_evento, payload_original, intentos_realizados,
                 codigo_error, detalle_error_tecnico, diagnostico_lenguaje_natural,
                 accion_recomendada, estado_dlq, resuelto_por_identificacion,
                 motivo_resolucion, creado_en, actualizado_en, resuelto_en`,
      [
        record.dlqId,
        record.idEventoExterno,
        record.origenCanal,
        record.googleSubId,
        record.emailPrincipal,
        record.dominio,
        record.tipoEvento,
        JSON.stringify(record.payloadOriginal),
        record.intentosRealizados,
        record.codigoError,
        record.detalleErrorTecnico,
        record.diagnosticoLenguajeNatural,
        record.accionRecomendada,
        record.estadoDlq,
        record.resueltoPorIdentificacion,
        record.motivoResolucion,
        record.creadoEn,
        record.actualizadoEn,
        record.resueltoEn,
      ],
    );
    return this.mapDlqRow(res.rows[0]);
  }

  public async listDlqRecords(
    filters: {
      estadoDlq?: EstadoRegistroDlq;
      dominio?: string;
      limit?: number;
      dlqIds?: string[];
    } = {},
    tx: SqlQueryExecutor = this.db,
  ): Promise<{ items: RegistroFalloSincronizacion[]; totalPendientes: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.estadoDlq) {
      params.push(filters.estadoDlq);
      conditions.push(`estado_dlq = $${params.length}`);
    }
    if (filters.dominio) {
      params.push(filters.dominio.toLowerCase());
      conditions.push(`dominio = $${params.length}`);
    }
    if (filters.dlqIds && filters.dlqIds.length > 0) {
      params.push(filters.dlqIds);
      conditions.push(`dlq_id = ANY($${params.length}::uuid[])`);
    }

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    params.push(limit);
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const listRes = await tx.query<Record<string, unknown>>(
      `SELECT dlq_id, id_evento_externo, origen_canal, google_sub_id, email_principal,
              dominio, tipo_evento, payload_original, intentos_realizados,
              codigo_error, detalle_error_tecnico, diagnostico_lenguaje_natural,
              accion_recomendada, estado_dlq, resuelto_por_identificacion,
              motivo_resolucion, creado_en, actualizado_en, resuelto_en
       FROM registro_fallo_sincronizacion
       ${whereSql}
       ORDER BY creado_en DESC
       LIMIT $${params.length}`,
      params,
    );

    const totalPendientes = await this.countPendingDlq(tx);
    return {
      items: listRes.rows.map((r) => this.mapDlqRow(r)),
      totalPendientes,
    };
  }

  public async countPendingDlq(tx: SqlQueryExecutor = this.db): Promise<number> {
    const res = await tx.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM registro_fallo_sincronizacion
       WHERE estado_dlq = $1`,
      ['PENDIENTE_REVISION'],
    );
    return Number(res.rows[0]?.count ?? 0);
  }

  private mapProcessedEventRow(row: Record<string, unknown>): EventoSincronizacionGws {
    return {
      idEventoExterno: String(row.id_evento_externo),
      googleSubId: String(row.google_sub_id),
      emailPrincipal: row.email_principal ? String(row.email_principal) : null,
      dominio: row.email_principal ? String(row.email_principal).split('@')[1] ?? '' : '',
      tipoEvento: String(row.tipo_evento),
      timestampEventoGws:
        row.timestamp_evento_gws instanceof Date
          ? row.timestamp_evento_gws.toISOString()
          : String(row.timestamp_evento_gws),
      origenCanal: String(row.origen_canal) as EventoSincronizacionGws['origenCanal'],
      modoDespacho: String(row.modo_despacho) as EventoSincronizacionGws['modoDespacho'],
      resultado: String(row.resultado) as EventoSincronizacionGws['resultado'],
      hashPayloadGws: row.hash_payload_gws ? String(row.hash_payload_gws) : null,
      procesadoEn:
        row.procesado_en instanceof Date
          ? row.procesado_en.toISOString()
          : String(row.procesado_en),
    };
  }

  private mapCheckpointRow(row: Record<string, unknown>): CheckpointConciliacion {
    const heartbeatIso =
      row.heartbeat_en instanceof Date
        ? row.heartbeat_en.toISOString()
        : String(row.heartbeat_en);
    const estadoEjecucion = String(row.estado_ejecucion) as EstadoEjecucionCheckpoint;
    const isOrphan =
      estadoEjecucion === 'EN_PROGRESO' &&
      Date.now() - Date.parse(heartbeatIso) > ORPHAN_THRESHOLD_MS;

    return {
      checkpointId: String(row.checkpoint_id),
      dominio: String(row.dominio),
      orgUnitPath: String(row.org_unit_path),
      tipoProceso: String(row.tipo_proceso) as TipoProcesoConciliacion,
      nextPageToken: row.next_page_token ? String(row.next_page_token) : null,
      cuentasProcesadas: Number(row.cuentas_procesadas ?? 0),
      cuentasActualizadas: Number(row.cuentas_actualizadas ?? 0),
      cuentasOmitidasHash: Number(row.cuentas_omitidas_hash ?? 0),
      cuentasBajaDetectadas: Number(row.cuentas_baja_detectadas ?? 0),
      anomaliasAbiertas: Number(row.anomalias_abiertas ?? 0),
      estadoEjecucion,
      workerInstanciaId: row.worker_instancia_id ? String(row.worker_instancia_id) : null,
      lockAdvisoryKey: String(row.lock_advisory_key),
      heartbeatEn: heartbeatIso,
      iniciadoEn:
        row.iniciado_en instanceof Date
          ? row.iniciado_en.toISOString()
          : String(row.iniciado_en),
      completadoEn: row.completado_en
        ? row.completado_en instanceof Date
          ? row.completado_en.toISOString()
          : String(row.completado_en)
        : null,
      ultimoErrorCodigo: row.ultimo_error_codigo ? String(row.ultimo_error_codigo) : null,
      diagnosticoOperativo: row.diagnostico_operativo
        ? String(row.diagnostico_operativo)
        : null,
      esParticionHuerfana: isOrphan,
    };
  }

  private mapDlqRow(row: Record<string, unknown>): RegistroFalloSincronizacion {
    const rawPayload = row.payload_original;
    const parsedPayload =
      typeof rawPayload === 'string'
        ? (JSON.parse(rawPayload) as Record<string, unknown>)
        : ((rawPayload ?? {}) as Record<string, unknown>);
    const timestampEvento =
      typeof parsedPayload.timestampEventoGws === 'string'
        ? parsedPayload.timestampEventoGws
        : row.creado_en instanceof Date
          ? row.creado_en.toISOString()
          : String(row.creado_en);

    return {
      dlqId: String(row.dlq_id),
      idEventoExterno: String(row.id_evento_externo),
      origenCanal: String(row.origen_canal) as RegistroFalloSincronizacion['origenCanal'],
      googleSubId: row.google_sub_id ? String(row.google_sub_id) : null,
      emailPrincipal: row.email_principal ? String(row.email_principal) : null,
      dominio: row.dominio ? String(row.dominio) : null,
      tipoEvento: String(row.tipo_evento),
      timestampEventoGws: timestampEvento,
      payloadOriginal: parsedPayload,
      intentosRealizados: Number(row.intentos_realizados ?? 5),
      ultimoBackoffMs: Number(parsedPayload.ultimoBackoffMs ?? 16000),
      codigoError: String(row.codigo_error),
      httpStatusGws:
        typeof parsedPayload.httpStatusGws === 'number'
          ? parsedPayload.httpStatusGws
          : null,
      detalleErrorTecnico: String(row.detalle_error_tecnico),
      diagnosticoLenguajeNatural: String(row.diagnostico_lenguaje_natural),
      accionRecomendada: String(row.accion_recomendada),
      estadoDlq: String(row.estado_dlq) as EstadoRegistroDlq,
      resueltoPorIdentificacion: row.resuelto_por_identificacion
        ? String(row.resuelto_por_identificacion)
        : null,
      motivoResolucion: row.motivo_resolucion ? String(row.motivo_resolucion) : null,
      creadoEn:
        row.creado_en instanceof Date
          ? row.creado_en.toISOString()
          : String(row.creado_en),
      actualizadoEn:
        row.actualizado_en instanceof Date
          ? row.actualizado_en.toISOString()
          : String(row.actualizado_en),
      resueltoEn: row.resuelto_en
        ? row.resuelto_en instanceof Date
          ? row.resuelto_en.toISOString()
          : String(row.resuelto_en)
        : null,
    };
  }
}
