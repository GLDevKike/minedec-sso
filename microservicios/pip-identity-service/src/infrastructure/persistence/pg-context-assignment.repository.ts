import { NivelEstructuraOrganizacional, SqlQueryExecutor } from '@minedec/shared';
import { CatalogoTerritorioSede } from '../../domain/entities/identity-entities';
import { AsignacionContextoRepositoryPort } from '../../domain/ports';
import {
  AsignacionContexto,
  OrigenDatosContexto,
} from '../../domain/services/multisede-and-transition.service';

interface ContextAssignmentJoinedRow {
  asignacion_id: string;
  id_interno: string;
  cuenta_id: string | null;
  origen_datos: OrigenDatosContexto;
  es_sede_primaria: boolean;
  nivel_estructura: NivelEstructuraOrganizacional;
  viceministerio: AsignacionContexto['viceministerio'];
  codigo_zona: string;
  codigo_distrito: string | null;
  codigo_circuito: string | null;
  codigo_amie: string | null;
  codigo_dependencia_admin: string | null;
  regimen_escolar: AsignacionContexto['regimenEscolar'];
  modalidad_educativa: AsignacionContexto['modalidadEducativa'];
  jornada: AsignacionContexto['jornada'];
  activo: boolean;
  asignado_por_identificacion: string | null;
  motivo_asignacion: string | null;
  creado_en: string | Date;
  actualizado_en: string | Date;
  sede_nombre_institucion?: string | null;
  sede_codigo_zona?: string | null;
  sede_codigo_distrito?: string | null;
  sede_codigo_circuito?: string | null;
  sede_provincia_dpa?: string | null;
  sede_canton_dpa?: string | null;
  sede_parroquia_dpa?: string | null;
  sede_regimen_escolar?: CatalogoTerritorioSede['regimenEscolar'] | null;
  sede_sostenimiento?: CatalogoTerritorioSede['sostenimiento'] | null;
  sede_modalidad_educativa?: CatalogoTerritorioSede['modalidadEducativa'] | null;
  sede_jornada?: CatalogoTerritorioSede['jornada'] | null;
  sede_activo?: boolean | null;
}

function toIsoDateTime(val: string | Date): string {
  if (typeof val === 'string') {
    return val;
  }
  return val.toISOString();
}

function mapContextRow(row: ContextAssignmentJoinedRow): AsignacionContexto {
  const sedeDetalle: CatalogoTerritorioSede | null =
    row.codigo_amie && row.sede_nombre_institucion
      ? {
          codigoAmie: row.codigo_amie,
          nombreInstitucion: row.sede_nombre_institucion,
          codigoZona: row.sede_codigo_zona ?? row.codigo_zona,
          codigoDistrito: row.sede_codigo_distrito ?? row.codigo_distrito,
          codigoCircuito: row.sede_codigo_circuito ?? row.codigo_circuito,
          provinciaDpa: row.sede_provincia_dpa ?? null,
          cantonDpa: row.sede_canton_dpa ?? null,
          parroquiaDpa: row.sede_parroquia_dpa ?? null,
          regimenEscolar: row.sede_regimen_escolar ?? row.regimen_escolar,
          sostenimiento: row.sede_sostenimiento ?? null,
          modalidadEducativa: row.sede_modalidad_educativa ?? row.modalidad_educativa,
          jornada: row.sede_jornada ?? row.jornada,
          activo: row.sede_activo ?? true,
        }
      : null;

  return {
    asignacionId: row.asignacion_id,
    idInterno: row.id_interno,
    cuentaId: row.cuenta_id,
    origenDatos: row.origen_datos,
    esSedePrimaria: Boolean(row.es_sede_primaria),
    nivelEstructura: row.nivel_estructura,
    viceministerio: row.viceministerio,
    codigoZona: row.sede_codigo_zona ?? row.codigo_zona,
    codigoDistrito: row.sede_codigo_distrito ?? row.codigo_distrito,
    codigoCircuito: row.sede_codigo_circuito ?? row.codigo_circuito,
    codigoAmie: row.codigo_amie,
    codigoDependenciaAdmin: row.codigo_dependencia_admin,
    regimenEscolar: row.regimen_escolar,
    modalidadEducativa: row.modalidad_educativa,
    jornada: row.jornada,
    activo: Boolean(row.activo),
    asignadoPorIdentificacion: row.asignado_por_identificacion,
    motivoAsignacion: row.motivo_asignacion,
    creadoEn: toIsoDateTime(row.creado_en),
    actualizadoEn: toIsoDateTime(row.actualizado_en),
    sedeDetalle,
  };
}

const SELECT_WITH_SEDE_JOIN = `
  SELECT
    ac.asignacion_id, ac.id_interno, ac.cuenta_id, ac.origen_datos, ac.es_sede_primaria,
    ac.nivel_estructura, ac.viceministerio, ac.codigo_zona, ac.codigo_distrito, ac.codigo_circuito,
    ac.codigo_amie, ac.codigo_dependencia_admin, ac.regimen_escolar, ac.modalidad_educativa,
    ac.jornada, ac.activo, ac.asignado_por_identificacion, ac.motivo_asignacion,
    ac.creado_en, ac.actualizado_en,
    cts.nombre_institucion AS sede_nombre_institucion,
    cts.codigo_zona AS sede_codigo_zona,
    cts.codigo_distrito AS sede_codigo_distrito,
    cts.codigo_circuito AS sede_codigo_circuito,
    cts.provincia_dpa AS sede_provincia_dpa,
    cts.canton_dpa AS sede_canton_dpa,
    cts.parroquia_dpa AS sede_parroquia_dpa,
    cts.regimen_escolar AS sede_regimen_escolar,
    cts.sostenimiento AS sede_sostenimiento,
    cts.modalidad_educativa AS sede_modalidad_educativa,
    cts.jornada AS sede_jornada,
    cts.activo AS sede_activo
  FROM asignacion_contexto ac
  LEFT JOIN catalogo_territorio_sede cts ON cts.codigo_amie = ac.codigo_amie
`;

export class PgAsignacionContextoRepository implements AsignacionContextoRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findActiveByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<ContextAssignmentJoinedRow>(
      `${SELECT_WITH_SEDE_JOIN}
       WHERE ac.id_interno = $1 AND ac.activo = true
       ORDER BY ac.es_sede_primaria DESC, ac.creado_en ASC`,
      [idInterno],
    );
    return result.rows.map(mapContextRow);
  }

  public async findAllByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<ContextAssignmentJoinedRow>(
      `${SELECT_WITH_SEDE_JOIN}
       WHERE ac.id_interno = $1
       ORDER BY ac.es_sede_primaria DESC, ac.creado_en ASC`,
      [idInterno],
    );
    return result.rows.map(mapContextRow);
  }

  public async findPrimaryByCuentaId(
    cuentaId: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<ContextAssignmentJoinedRow>(
      `${SELECT_WITH_SEDE_JOIN}
       WHERE ac.cuenta_id = $1 AND ac.origen_datos = 'GWS_PRIMARIO' AND ac.es_sede_primaria = true AND ac.activo = true
       LIMIT 1`,
      [cuentaId],
    );
    const row = result.rows[0];
    return row ? mapContextRow(row) : null;
  }

  public async upsertPrimaryAssignment(
    assignment: AsignacionContexto,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<ContextAssignmentJoinedRow>(
      `INSERT INTO asignacion_contexto (
        asignacion_id, id_interno, cuenta_id, origen_datos, es_sede_primaria,
        nivel_estructura, viceministerio, codigo_zona, codigo_distrito, codigo_circuito,
        codigo_amie, codigo_dependencia_admin, regimen_escolar, modalidad_educativa,
        jornada, activo, asignado_por_identificacion, motivo_asignacion,
        creado_en, actualizado_en
      ) VALUES (
        $1, $2, $3, 'GWS_PRIMARIO', true,
        $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18
      )
      ON CONFLICT (asignacion_id) DO UPDATE SET
        id_interno = EXCLUDED.id_interno,
        cuenta_id = EXCLUDED.cuenta_id,
        nivel_estructura = EXCLUDED.nivel_estructura,
        viceministerio = EXCLUDED.viceministerio,
        codigo_zona = EXCLUDED.codigo_zona,
        codigo_distrito = EXCLUDED.codigo_distrito,
        codigo_circuito = EXCLUDED.codigo_circuito,
        codigo_amie = EXCLUDED.codigo_amie,
        codigo_dependencia_admin = EXCLUDED.codigo_dependencia_admin,
        regimen_escolar = EXCLUDED.regimen_escolar,
        modalidad_educativa = EXCLUDED.modalidad_educativa,
        jornada = EXCLUDED.jornada,
        activo = EXCLUDED.activo,
        actualizado_en = EXCLUDED.actualizado_en
      RETURNING *`,
      [
        assignment.asignacionId,
        assignment.idInterno,
        assignment.cuentaId,
        assignment.nivelEstructura,
        assignment.viceministerio,
        assignment.codigoZona,
        assignment.codigoDistrito,
        assignment.codigoCircuito,
        assignment.codigoAmie,
        assignment.codigoDependenciaAdmin,
        assignment.regimenEscolar,
        assignment.modalidadEducativa,
        assignment.jornada,
        assignment.activo,
        assignment.asignadoPorIdentificacion,
        assignment.motivoAsignacion,
        assignment.creadoEn,
        assignment.actualizadoEn,
      ],
    );
    const row = result.rows[0];
    return row ? { ...mapContextRow(row), sedeDetalle: assignment.sedeDetalle ?? null } : assignment;
  }

  public async insertDelegatedAssignment(
    assignment: AsignacionContexto,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<ContextAssignmentJoinedRow>(
      `INSERT INTO asignacion_contexto (
        asignacion_id, id_interno, cuenta_id, origen_datos, es_sede_primaria,
        nivel_estructura, viceministerio, codigo_zona, codigo_distrito, codigo_circuito,
        codigo_amie, codigo_dependencia_admin, regimen_escolar, modalidad_educativa,
        jornada, activo, asignado_por_identificacion, motivo_asignacion,
        creado_en, actualizado_en
      ) VALUES (
        $1, $2, $3, 'PAP_DELEGADO', false,
        $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18
      )
      RETURNING *`,
      [
        assignment.asignacionId,
        assignment.idInterno,
        assignment.cuentaId,
        assignment.nivelEstructura,
        assignment.viceministerio,
        assignment.codigoZona,
        assignment.codigoDistrito,
        assignment.codigoCircuito,
        assignment.codigoAmie,
        assignment.codigoDependenciaAdmin,
        assignment.regimenEscolar,
        assignment.modalidadEducativa,
        assignment.jornada,
        assignment.activo,
        assignment.asignadoPorIdentificacion,
        assignment.motivoAsignacion,
        assignment.creadoEn,
        assignment.actualizadoEn,
      ],
    );
    const row = result.rows[0];
    return row ? { ...mapContextRow(row), sedeDetalle: assignment.sedeDetalle ?? null } : assignment;
  }

  public async deactivateDelegatedAssignmentsByIdInterno(
    idInterno: string,
    cuentaId?: string,
    tx?: SqlQueryExecutor,
  ): Promise<AsignacionContexto[]> {
    const executor = tx ?? this.defaultExecutor;
    const nowIso = new Date().toISOString();

    const result = cuentaId
      ? await executor.query<ContextAssignmentJoinedRow>(
          `UPDATE asignacion_contexto
           SET activo = false, actualizado_en = $3
           WHERE id_interno = $1 AND (cuenta_id = $2 OR cuenta_id IS NULL)
             AND origen_datos = 'PAP_DELEGADO' AND activo = true
           RETURNING *`,
          [idInterno, cuentaId, nowIso],
        )
      : await executor.query<ContextAssignmentJoinedRow>(
          `UPDATE asignacion_contexto
           SET activo = false, actualizado_en = $2
           WHERE id_interno = $1 AND origen_datos = 'PAP_DELEGADO' AND activo = true
           RETURNING *`,
          [idInterno, nowIso],
        );

    return result.rows.map(mapContextRow);
  }

  public async relinkAssignmentsToPersona(
    fromIdInterno: string,
    toIdInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<void> {
    const executor = tx ?? this.defaultExecutor;
    await executor.query(
      `UPDATE asignacion_contexto
       SET id_interno = $2, actualizado_en = $3
       WHERE id_interno = $1`,
      [fromIdInterno, toIdInterno, new Date().toISOString()],
    );
  }
}
