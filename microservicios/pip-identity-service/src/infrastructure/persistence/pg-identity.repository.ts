import { SqlQueryExecutor, TipoIdentificacionPersona } from '@minedec/shared';
import {
  CatalogoTerritorioSede,
  CuentaInstitucional,
  DominioInstitucional,
  EstadoPersonaIdentidad,
  EstadoSincronizacionCuenta,
  OrigenSincronizacionCuenta,
  PersonaIdentidad,
  TipoPoblacionDominio,
} from '../../domain/entities/identity-entities';
import {
  CatalogoTerritorioSedeRepositoryPort,
  CuentaInstitucionalRepositoryPort,
  DominioInstitucionalRepositoryPort,
  PersonaIdentidadRepositoryPort,
} from '../../domain/ports';

interface PersonaRow {
  id_interno: string;
  tipo_identificacion: TipoIdentificacionPersona;
  numero_identificacion: string;
  codigo_minedec_anterior: string | null;
  nombre_completo: string;
  fecha_nacimiento: string | Date | null;
  representante_legal_cedula: string | null;
  estado_persona: EstadoPersonaIdentidad;
  creado_en: string | Date;
  actualizado_en: string | Date;
}

interface CuentaRow {
  cuenta_id: string;
  id_interno: string;
  google_sub_id: string;
  email_principal: string;
  dominio: string;
  org_unit_path: string;
  given_name: string | null;
  family_name: string | null;
  tipo_usuario: CuentaInstitucional['tipoUsuario'];
  subtipo_usuario: string | null;
  cargo_funcion: string | null;
  grado_curso: string | null;
  nivel_academico_derivado: string | null;
  docente_multisede: boolean;
  fecha_inicio_vigencia: string | Date | null;
  fecha_fin_vigencia: string | Date | null;
  suspended_en_gws: boolean;
  estado_sincronizacion: EstadoSincronizacionCuenta;
  origen_ultima_sincronizacion: OrigenSincronizacionCuenta | null;
  ultima_sincronizacion_en: string | Date;
  creado_en: string | Date;
  actualizado_en: string | Date;
}

interface DominioRow {
  dominio: string;
  google_customer_id: string;
  tipo_poblacion: TipoPoblacionDominio;
  es_subdominio: boolean;
  activo: boolean;
}

interface SedeRow {
  codigo_amie: string;
  nombre_institucion: string;
  codigo_zona: string;
  codigo_distrito: string | null;
  codigo_circuito: string | null;
  provincia_dpa: string | null;
  canton_dpa: string | null;
  parroquia_dpa: string | null;
  regimen_escolar: CatalogoTerritorioSede['regimenEscolar'];
  sostenimiento: CatalogoTerritorioSede['sostenimiento'];
  modalidad_educativa: CatalogoTerritorioSede['modalidadEducativa'];
  jornada: CatalogoTerritorioSede['jornada'];
  activo: boolean;
}

function toIsoDateOnly(val: string | Date | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (typeof val === 'string') {
    return val.slice(0, 10);
  }
  return val.toISOString().slice(0, 10);
}

function toIsoDateTime(val: string | Date): string {
  if (typeof val === 'string') {
    return val;
  }
  return val.toISOString();
}

function mapPersonaRow(row: PersonaRow): PersonaIdentidad {
  return {
    idInterno: row.id_interno,
    tipoIdentificacion: row.tipo_identificacion,
    numeroIdentificacion: row.numero_identificacion,
    codigoMinedecAnterior: row.codigo_minedec_anterior,
    nombreCompleto: row.nombre_completo,
    fechaNacimiento: toIsoDateOnly(row.fecha_nacimiento),
    representanteLegalCedula: row.representante_legal_cedula,
    estadoPersona: row.estado_persona,
    creadoEn: toIsoDateTime(row.creado_en),
    actualizadoEn: toIsoDateTime(row.actualizado_en),
  };
}

function mapCuentaRow(row: CuentaRow): CuentaInstitucional {
  return {
    cuentaId: row.cuenta_id,
    idInterno: row.id_interno,
    googleSubId: row.google_sub_id,
    emailPrincipal: row.email_principal,
    dominio: row.dominio,
    orgUnitPath: row.org_unit_path,
    givenName: row.given_name,
    familyName: row.family_name,
    tipoUsuario: row.tipo_usuario,
    subtipoUsuario: row.subtipo_usuario,
    cargoFuncion: row.cargo_funcion,
    gradoCurso: row.grado_curso,
    nivelAcademicoDerivado: row.nivel_academico_derivado,
    docenteMultisede: Boolean(row.docente_multisede),
    fechaInicioVigencia: toIsoDateOnly(row.fecha_inicio_vigencia),
    fechaFinVigencia: toIsoDateOnly(row.fecha_fin_vigencia),
    suspendedEnGws: Boolean(row.suspended_en_gws),
    estadoSincronizacion: row.estado_sincronizacion,
    origenUltimaSincronizacion: row.origen_ultima_sincronizacion,
    ultimaSincronizacionEn: toIsoDateTime(row.ultima_sincronizacion_en),
    creadoEn: toIsoDateTime(row.creado_en),
    actualizadoEn: toIsoDateTime(row.actualizado_en),
  };
}

function mapDominioRow(row: DominioRow): DominioInstitucional {
  return {
    dominio: row.dominio,
    googleCustomerId: row.google_customer_id,
    tipoPoblacion: row.tipo_poblacion,
    esSubdominio: Boolean(row.es_subdominio),
    activo: Boolean(row.activo),
  };
}

function mapSedeRow(row: SedeRow): CatalogoTerritorioSede {
  return {
    codigoAmie: row.codigo_amie,
    nombreInstitucion: row.nombre_institucion,
    codigoZona: row.codigo_zona,
    codigoDistrito: row.codigo_distrito,
    codigoCircuito: row.codigo_circuito,
    provinciaDpa: row.provincia_dpa,
    cantonDpa: row.canton_dpa,
    parroquiaDpa: row.parroquia_dpa,
    regimenEscolar: row.regimen_escolar,
    sostenimiento: row.sostenimiento,
    modalidadEducativa: row.modalidad_educativa,
    jornada: row.jornada,
    activo: Boolean(row.activo),
  };
}

export class PgPersonaIdentidadRepository implements PersonaIdentidadRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<PersonaRow>(
      `SELECT
        id_interno, tipo_identificacion, numero_identificacion, codigo_minedec_anterior,
        nombre_completo, fecha_nacimiento, representante_legal_cedula, estado_persona,
        creado_en, actualizado_en
      FROM persona_identidad
      WHERE id_interno = $1
      LIMIT 1`,
      [idInterno],
    );
    const row = result.rows[0];
    return row ? mapPersonaRow(row) : null;
  }

  public async findByDocument(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<PersonaRow>(
      `SELECT
        id_interno, tipo_identificacion, numero_identificacion, codigo_minedec_anterior,
        nombre_completo, fecha_nacimiento, representante_legal_cedula, estado_persona,
        creado_en, actualizado_en
      FROM persona_identidad
      WHERE tipo_identificacion = $1 AND numero_identificacion = $2
      LIMIT 1`,
      [tipoIdentificacion, numeroIdentificacion],
    );
    const row = result.rows[0];
    return row ? mapPersonaRow(row) : null;
  }

  public async findByNumeroIdentificacionOnly(
    numeroIdentificacion: string,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<PersonaRow>(
      `SELECT
        id_interno, tipo_identificacion, numero_identificacion, codigo_minedec_anterior,
        nombre_completo, fecha_nacimiento, representante_legal_cedula, estado_persona,
        creado_en, actualizado_en
      FROM persona_identidad
      WHERE numero_identificacion = $1
      ORDER BY actualizado_en DESC
      LIMIT 1`,
      [numeroIdentificacion],
    );
    const row = result.rows[0];
    return row ? mapPersonaRow(row) : null;
  }

  public async upsert(
    persona: PersonaIdentidad,
    tx?: SqlQueryExecutor,
  ): Promise<PersonaIdentidad> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<PersonaRow>(
      `INSERT INTO persona_identidad (
        id_interno, tipo_identificacion, numero_identificacion, codigo_minedec_anterior,
        nombre_completo, fecha_nacimiento, representante_legal_cedula, estado_persona,
        creado_en, actualizado_en
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id_interno) DO UPDATE SET
        tipo_identificacion = EXCLUDED.tipo_identificacion,
        numero_identificacion = EXCLUDED.numero_identificacion,
        codigo_minedec_anterior = COALESCE(EXCLUDED.codigo_minedec_anterior, persona_identidad.codigo_minedec_anterior),
        nombre_completo = EXCLUDED.nombre_completo,
        fecha_nacimiento = EXCLUDED.fecha_nacimiento,
        representante_legal_cedula = EXCLUDED.representante_legal_cedula,
        estado_persona = EXCLUDED.estado_persona,
        actualizado_en = EXCLUDED.actualizado_en
      RETURNING
        id_interno, tipo_identificacion, numero_identificacion, codigo_minedec_anterior,
        nombre_completo, fecha_nacimiento, representante_legal_cedula, estado_persona,
        creado_en, actualizado_en`,
      [
        persona.idInterno,
        persona.tipoIdentificacion,
        persona.numeroIdentificacion,
        persona.codigoMinedecAnterior,
        persona.nombreCompleto,
        persona.fechaNacimiento,
        persona.representanteLegalCedula,
        persona.estadoPersona,
        persona.creadoEn,
        persona.actualizadoEn,
      ],
    );
    const row = result.rows[0];
    return row ? mapPersonaRow(row) : persona;
  }

  public async updateEstadoPersona(
    idInterno: string,
    estadoPersona: EstadoPersonaIdentidad,
    tx?: SqlQueryExecutor,
  ): Promise<void> {
    const executor = tx ?? this.defaultExecutor;
    await executor.query(
      `UPDATE persona_identidad
       SET estado_persona = $2, actualizado_en = $3
       WHERE id_interno = $1`,
      [idInterno, estadoPersona, new Date().toISOString()],
    );
  }
}

export class PgCuentaInstitucionalRepository implements CuentaInstitucionalRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findByGoogleSubId(
    googleSubId: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CuentaRow>(
      `SELECT
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en
      FROM cuenta_institucional
      WHERE google_sub_id = $1
      LIMIT 1`,
      [googleSubId],
    );
    const row = result.rows[0];
    return row ? mapCuentaRow(row) : null;
  }

  public async findByEmailPrincipal(
    emailPrincipal: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CuentaRow>(
      `SELECT
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en
      FROM cuenta_institucional
      WHERE LOWER(email_principal) = LOWER($1)
      LIMIT 1`,
      [emailPrincipal.trim()],
    );
    const row = result.rows[0];
    return row ? mapCuentaRow(row) : null;
  }

  public async findByCuentaId(
    cuentaId: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CuentaRow>(
      `SELECT
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en
      FROM cuenta_institucional
      WHERE cuenta_id = $1
      LIMIT 1`,
      [cuentaId],
    );
    const row = result.rows[0];
    return row ? mapCuentaRow(row) : null;
  }

  public async findAllByIdInterno(
    idInterno: string,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional[]> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CuentaRow>(
      `SELECT
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en
      FROM cuenta_institucional
      WHERE id_interno = $1
      ORDER BY creado_en ASC`,
      [idInterno],
    );
    return result.rows.map(mapCuentaRow);
  }

  public async upsert(
    cuenta: CuentaInstitucional,
    tx?: SqlQueryExecutor,
  ): Promise<CuentaInstitucional> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<CuentaRow>(
      `INSERT INTO cuenta_institucional (
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        $21, $22
      )
      ON CONFLICT (google_sub_id) DO UPDATE SET
        id_interno = EXCLUDED.id_interno,
        email_principal = EXCLUDED.email_principal,
        dominio = EXCLUDED.dominio,
        org_unit_path = EXCLUDED.org_unit_path,
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        tipo_usuario = EXCLUDED.tipo_usuario,
        subtipo_usuario = EXCLUDED.subtipo_usuario,
        cargo_funcion = EXCLUDED.cargo_funcion,
        grado_curso = EXCLUDED.grado_curso,
        nivel_academico_derivado = EXCLUDED.nivel_academico_derivado,
        docente_multisede = EXCLUDED.docente_multisede,
        fecha_inicio_vigencia = EXCLUDED.fecha_inicio_vigencia,
        fecha_fin_vigencia = EXCLUDED.fecha_fin_vigencia,
        suspended_en_gws = EXCLUDED.suspended_en_gws,
        estado_sincronizacion = EXCLUDED.estado_sincronizacion,
        origen_ultima_sincronizacion = EXCLUDED.origen_ultima_sincronizacion,
        ultima_sincronizacion_en = EXCLUDED.ultima_sincronizacion_en,
        actualizado_en = EXCLUDED.actualizado_en
      RETURNING
        cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
        given_name, family_name, tipo_usuario, subtipo_usuario, cargo_funcion,
        grado_curso, nivel_academico_derivado, docente_multisede,
        fecha_inicio_vigencia, fecha_fin_vigencia, suspended_en_gws,
        estado_sincronizacion, origen_ultima_sincronizacion, ultima_sincronizacion_en,
        creado_en, actualizado_en`,
      [
        cuenta.cuentaId,
        cuenta.idInterno,
        cuenta.googleSubId,
        cuenta.emailPrincipal,
        cuenta.dominio,
        cuenta.orgUnitPath,
        cuenta.givenName,
        cuenta.familyName,
        cuenta.tipoUsuario,
        cuenta.subtipoUsuario,
        cuenta.cargoFuncion,
        cuenta.gradoCurso,
        cuenta.nivelAcademicoDerivado,
        cuenta.docenteMultisede,
        cuenta.fechaInicioVigencia,
        cuenta.fechaFinVigencia,
        cuenta.suspendedEnGws,
        cuenta.estadoSincronizacion,
        cuenta.origenUltimaSincronizacion,
        cuenta.ultimaSincronizacionEn,
        cuenta.creadoEn,
        cuenta.actualizadoEn,
      ],
    );
    const row = result.rows[0];
    return row ? mapCuentaRow(row) : cuenta;
  }
}

export class PgDominioInstitucionalRepository implements DominioInstitucionalRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findByDomain(
    dominio: string,
    tx?: SqlQueryExecutor,
  ): Promise<DominioInstitucional | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<DominioRow>(
      `SELECT dominio, google_customer_id, tipo_poblacion, es_subdominio, activo
       FROM dominio_institucional
       WHERE LOWER(dominio) = LOWER($1)
       LIMIT 1`,
      [dominio.trim()],
    );
    const row = result.rows[0];
    return row ? mapDominioRow(row) : null;
  }

  public async upsert(
    dominio: DominioInstitucional,
    tx?: SqlQueryExecutor,
  ): Promise<DominioInstitucional> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<DominioRow>(
      `INSERT INTO dominio_institucional (
        dominio, google_customer_id, tipo_poblacion, es_subdominio, activo
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (dominio) DO UPDATE SET
        google_customer_id = EXCLUDED.google_customer_id,
        tipo_poblacion = EXCLUDED.tipo_poblacion,
        es_subdominio = EXCLUDED.es_subdominio,
        activo = EXCLUDED.activo
      RETURNING dominio, google_customer_id, tipo_poblacion, es_subdominio, activo`,
      [
        dominio.dominio.toLowerCase(),
        dominio.googleCustomerId,
        dominio.tipoPoblacion,
        dominio.esSubdominio,
        dominio.activo,
      ],
    );
    const row = result.rows[0];
    return row ? mapDominioRow(row) : dominio;
  }
}

export class PgCatalogoTerritorioSedeRepository implements CatalogoTerritorioSedeRepositoryPort {
  public constructor(private readonly defaultExecutor: SqlQueryExecutor) {}

  public async findByCodigoAmie(
    codigoAmie: string,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoTerritorioSede | null> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<SedeRow>(
      `SELECT
        codigo_amie, nombre_institucion, codigo_zona, codigo_distrito, codigo_circuito,
        provincia_dpa, canton_dpa, parroquia_dpa, regimen_escolar, sostenimiento,
        modalidad_educativa, jornada, activo
       FROM catalogo_territorio_sede
       WHERE codigo_amie = $1
       LIMIT 1`,
      [codigoAmie.trim().toUpperCase()],
    );
    const row = result.rows[0];
    return row ? mapSedeRow(row) : null;
  }

  public async upsert(
    sede: CatalogoTerritorioSede,
    tx?: SqlQueryExecutor,
  ): Promise<CatalogoTerritorioSede> {
    const executor = tx ?? this.defaultExecutor;
    const result = await executor.query<SedeRow>(
      `INSERT INTO catalogo_territorio_sede (
        codigo_amie, nombre_institucion, codigo_zona, codigo_distrito, codigo_circuito,
        provincia_dpa, canton_dpa, parroquia_dpa, regimen_escolar, sostenimiento,
        modalidad_educativa, jornada, activo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (codigo_amie) DO UPDATE SET
        nombre_institucion = EXCLUDED.nombre_institucion,
        codigo_zona = EXCLUDED.codigo_zona,
        codigo_distrito = EXCLUDED.codigo_distrito,
        codigo_circuito = EXCLUDED.codigo_circuito,
        provincia_dpa = EXCLUDED.provincia_dpa,
        canton_dpa = EXCLUDED.canton_dpa,
        parroquia_dpa = EXCLUDED.parroquia_dpa,
        regimen_escolar = EXCLUDED.regimen_escolar,
        sostenimiento = EXCLUDED.sostenimiento,
        modalidad_educativa = EXCLUDED.modalidad_educativa,
        jornada = EXCLUDED.jornada,
        activo = EXCLUDED.activo,
        actualizado_en = NOW()
      RETURNING
        codigo_amie, nombre_institucion, codigo_zona, codigo_distrito, codigo_circuito,
        provincia_dpa, canton_dpa, parroquia_dpa, regimen_escolar, sostenimiento,
        modalidad_educativa, jornada, activo`,
      [
        sede.codigoAmie,
        sede.nombreInstitucion,
        sede.codigoZona,
        sede.codigoDistrito,
        sede.codigoCircuito,
        sede.provinciaDpa,
        sede.cantonDpa,
        sede.parroquiaDpa,
        sede.regimenEscolar,
        sede.sostenimiento,
        sede.modalidadEducativa,
        sede.jornada,
        sede.activo,
      ],
    );
    const row = result.rows[0];
    return row ? mapSedeRow(row) : sede;
  }
}
