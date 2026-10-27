import {
  CodigoCausalAnomalia,
  EfectoAccesoAnomalia,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  AnomaliaIdentidadRepositoryPort,
  AnomalyFilterQuery,
  AnomalyPaginatedList,
} from '../../domain/ports';
import {
  AnomaliaIdentidad,
  EstadoAnomalia,
  OrigenResolucionAnomalia,
} from '../../domain/services/anomaly-lifecycle.service';

interface AnomalyRow {
  anomalia_id: string;
  anomalia_anterior_id: string | null;
  id_interno: string | null;
  cuenta_id: string | null;
  google_sub_id: string;
  email_principal: string;
  dominio: string;
  codigo_causal: CodigoCausalAnomalia;
  efecto_acceso: EfectoAccesoAnomalia;
  estado_anomalia: EstadoAnomalia;
  origen_resolucion: OrigenResolucionAnomalia | null;
  resuelta_por_identificacion: string | null;
  motivo_resolucion: string | null;
  valor_anterior: Record<string, unknown> | string | null;
  valor_nuevo: Record<string, unknown> | string | null;
  detalle_tecnico: string;
  detectada_en: string | Date;
  resuelta_en: string | Date | null;
}

function parseJsonColumn(
  raw: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return raw;
}

function toIsoDateTime(val: string | Date | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (typeof val === 'string') {
    return val;
  }
  return val.toISOString();
}

function mapAnomalyRow(row: AnomalyRow): AnomaliaIdentidad {
  return {
    anomaliaId: row.anomalia_id,
    anomaliaAnteriorId: row.anomalia_anterior_id,
    idInterno: row.id_interno,
    cuentaId: row.cuenta_id,
    googleSubId: row.google_sub_id,
    emailPrincipal: row.email_principal,
    dominio: row.dominio,
    codigoCausal: row.codigo_causal,
    efectoAcceso: row.efecto_acceso,
    estadoAnomalia: row.estado_anomalia,
    origenResolucion: row.origen_resolucion,
    resueltaPorIdentificacion: row.resuelta_por_identificacion,
    motivoResolucion: row.motivo_resolucion,
    valorAnterior: parseJsonColumn(row.valor_anterior),
    valorNuevo: parseJsonColumn(row.valor_nuevo),
    detalleTecnico: row.detalle_tecnico,
    detectadaEn: toIsoDateTime(row.detectada_en) ?? new Date().toISOString(),
    resueltaEn: toIsoDateTime(row.resuelta_en),
  };
}

export class PgAnomaliaIdentidadRepository implements AnomaliaIdentidadRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findById(
    anomaliaId: string,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `SELECT
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
       FROM anomalia_identidad
       WHERE anomalia_id = $1
       LIMIT 1`,
      [anomaliaId],
    );
    const row = result.rows[0];
    return row ? mapAnomalyRow(row) : null;
  }

  public async findActiveByGoogleSubId(
    googleSubId: string,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad[]> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `SELECT
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
       FROM anomalia_identidad
       WHERE google_sub_id = $1
         AND estado_anomalia IN ('ABIERTA', 'EN_REVISION', 'LISTA_PARA_CERRAR')
       ORDER BY detectada_en ASC`,
      [googleSubId],
    );
    return result.rows.map(mapAnomalyRow);
  }

  public async findActiveByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad[]> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `SELECT
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
       FROM anomalia_identidad
       WHERE id_interno = $1
         AND estado_anomalia IN ('ABIERTA', 'EN_REVISION', 'LISTA_PARA_CERRAR')
       ORDER BY detectada_en ASC`,
      [idInterno],
    );
    return result.rows.map(mapAnomalyRow);
  }

  public async findLatestResolvedByGoogleSubIdAndCausal(
    googleSubId: string,
    codigoCausal: CodigoCausalAnomalia,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `SELECT
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
       FROM anomalia_identidad
       WHERE google_sub_id = $1
         AND codigo_causal = $2
         AND estado_anomalia = 'RESUELTA'
       ORDER BY resuelta_en DESC NULLS LAST, detectada_en DESC
       LIMIT 1`,
      [googleSubId, codigoCausal],
    );
    const row = result.rows[0];
    return row ? mapAnomalyRow(row) : null;
  }

  public async insert(
    anomalia: AnomaliaIdentidad,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `INSERT INTO anomalia_identidad (
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13,
        $14::jsonb, $15::jsonb, $16, $17, $18
      )
      RETURNING
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en`,
      [
        anomalia.anomaliaId,
        anomalia.anomaliaAnteriorId,
        anomalia.idInterno,
        anomalia.cuentaId,
        anomalia.googleSubId,
        anomalia.emailPrincipal,
        anomalia.dominio,
        anomalia.codigoCausal,
        anomalia.efectoAcceso,
        anomalia.estadoAnomalia,
        anomalia.origenResolucion,
        anomalia.resueltaPorIdentificacion,
        anomalia.motivoResolucion,
        anomalia.valorAnterior ? JSON.stringify(anomalia.valorAnterior) : null,
        anomalia.valorNuevo ? JSON.stringify(anomalia.valorNuevo) : null,
        anomalia.detalleTecnico,
        anomalia.detectadaEn,
        anomalia.resueltaEn,
      ],
    );
    const row = result.rows[0];
    return row ? mapAnomalyRow(row) : anomalia;
  }

  public async update(
    anomalia: AnomaliaIdentidad,
    tx?: SqlQueryExecutor,
  ): Promise<AnomaliaIdentidad> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<AnomalyRow>(
      `UPDATE anomalia_identidad SET
        id_interno = $2,
        cuenta_id = $3,
        email_principal = $4,
        dominio = $5,
        estado_anomalia = $6,
        origen_resolucion = $7,
        resuelta_por_identificacion = $8,
        motivo_resolucion = $9,
        valor_anterior = $10::jsonb,
        valor_nuevo = $11::jsonb,
        detalle_tecnico = $12,
        resuelta_en = $13
       WHERE anomalia_id = $1
       RETURNING
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en`,
      [
        anomalia.anomaliaId,
        anomalia.idInterno,
        anomalia.cuentaId,
        anomalia.emailPrincipal,
        anomalia.dominio,
        anomalia.estadoAnomalia,
        anomalia.origenResolucion,
        anomalia.resueltaPorIdentificacion,
        anomalia.motivoResolucion,
        anomalia.valorAnterior ? JSON.stringify(anomalia.valorAnterior) : null,
        anomalia.valorNuevo ? JSON.stringify(anomalia.valorNuevo) : null,
        anomalia.detalleTecnico,
        anomalia.resueltaEn,
      ],
    );
    const row = result.rows[0];
    return row ? mapAnomalyRow(row) : anomalia;
  }

  public async listPaginated(
    query: AnomalyFilterQuery,
    tx?: SqlQueryExecutor,
  ): Promise<AnomalyPaginatedList> {
    const executor = tx ?? this.defaultExecutor;
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 100);
    const offset = query.cursor ? Math.max(0, Number.parseInt(query.cursor, 10) || 0) : 0;

    const params: unknown[] = [
      query.estadoAnomalia ?? null,
      query.efectoAcceso ?? null,
      query.codigoCausal ?? null,
      query.dominio ? query.dominio.toLowerCase() : null,
      pageSize + 1,
      offset,
    ];

    const result = await executor.query<AnomalyRow>(
      `SELECT
        anomalia_id, anomalia_anterior_id, id_interno, cuenta_id, google_sub_id,
        email_principal, dominio, codigo_causal, efecto_acceso, estado_anomalia,
        origen_resolucion, resuelta_por_identificacion, motivo_resolucion,
        valor_anterior, valor_nuevo, detalle_tecnico, detectada_en, resuelta_en
       FROM anomalia_identidad
       WHERE ($1::text IS NULL OR estado_anomalia = $1)
         AND ($2::text IS NULL OR efecto_acceso = $2)
         AND ($3::text IS NULL OR codigo_causal = $3)
         AND ($4::text IS NULL OR LOWER(dominio) = $4)
       ORDER BY detectada_en DESC, anomalia_id ASC
       LIMIT $5 OFFSET $6`,
      params,
    );

    const hasNext = result.rows.length > pageSize;
    const slice = hasNext ? result.rows.slice(0, pageSize) : result.rows;
    const nextCursor = hasNext ? String(offset + pageSize) : null;

    return {
      items: slice.map(mapAnomalyRow),
      nextCursor,
    };
  }
}
