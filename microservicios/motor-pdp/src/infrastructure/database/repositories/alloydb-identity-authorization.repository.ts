/**
 * Repositorio AlloyDB de Contexto de Identidad y Autorización (`AlloyDbIdentityAuthorizationRepository`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios IV, VI, X y XIII):
 * - Consultas SQL 100 % parametrizadas (`$1, $2`).
 * - Exclusivo para Personas Naturales (`id_interno` UUID + `CEDULA` | `PASAPORTE` | `CODIGO_MINEDEC`).
 * - Consulta en 3FN sobre `persona_identidad`, `cuenta_institucional`, `asignacion_contexto`,
 *   `anomalia_identidad` y `usuario_rol_aplicacion`.
 */

import { SqlQueryExecutor, assertSafeSqlIdentifier } from '@minedec/shared';
import {
  ActiveIdentityAnomalyEntry,
  ContextualAssignmentEntry,
  DirectRoleOrProfileAssignment,
  IdentityAuthorizationContext,
  NaturalPersonIdType,
} from '../../../domain/entities/pdp-domain.entities';
import { IdentityAuthorizationRepositoryPort } from '../../../domain/ports/pdp.ports';

interface CuentaPersonaRow {
  id_interno: string;
  cuenta_id: string;
  google_sub_id: string;
  email_principal: string;
  dominio: string;
  org_unit_path: string;
  tipo_identificacion: NaturalPersonIdType;
  numero_identificacion: string;
  nombre_completo: string;
  estado_persona: IdentityAuthorizationContext['estado_persona'];
  suspended_en_gws: boolean;
  estado_sincronizacion: IdentityAuthorizationContext['estado_sincronizacion'];
  tipo_usuario: string | null;
  subtipo_usuario: string | null;
  cargo_funcion: string | null;
  grado_curso: string | null;
  nivel_academico_derivado: string | null;
  docente_multisede: boolean;
  fecha_inicio_vigencia: string | Date | null;
  fecha_fin_vigencia: string | Date | null;
}

interface AsignacionContextoRow {
  asignacion_id: string;
  es_sede_primaria: boolean;
  nivel_estructura: ContextualAssignmentEntry['nivel_estructura'];
  viceministerio: ContextualAssignmentEntry['viceministerio'];
  codigo_zona: string;
  codigo_distrito: string | null;
  codigo_circuito: string | null;
  codigo_amie: string | null;
  codigo_dependencia_admin: string | null;
  regimen_escolar: string;
  modalidad_educativa: string;
  jornada: string;
  activo: boolean;
}

interface UsuarioRolAplicacionRow {
  asignacion_rol_id: string;
  aplicacion_id: string;
  cuenta_id: string | null;
  rol_id: string | null;
  codigo_rol: string | null;
  perfil_id: string | null;
  codigo_perfil: string | null;
  codigo_zona_acotado: string | null;
  codigo_distrito_acotado: string | null;
  codigo_circuito_acotado: string | null;
  codigo_amie_acotado: string | null;
  fecha_inicio_vigencia: string | Date;
  fecha_fin_vigencia: string | Date | null;
  activo: boolean;
}

interface AnomaliaRow {
  anomalia_id: string;
  codigo_causal: string;
  efecto_acceso: 'BLOQUEANTE' | 'RESTRINGIDA';
  estado_anomalia: string;
}

function formatDateColumn(val: string | Date | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

export class AlloyDbIdentityAuthorizationRepository
  implements IdentityAuthorizationRepositoryPort
{
  private readonly inMemoryContexts = new Map<
    string,
    IdentityAuthorizationContext
  >();

  constructor(private readonly db?: SqlQueryExecutor) {
    assertSafeSqlIdentifier('persona_identidad');
    assertSafeSqlIdentifier('cuenta_institucional');
    assertSafeSqlIdentifier('asignacion_contexto');
    assertSafeSqlIdentifier('anomalia_identidad');
    assertSafeSqlIdentifier('usuario_rol_aplicacion');
  }

  public registerInMemoryContext(
    context: IdentityAuthorizationContext,
    aplicacionId?: string,
  ): void {
    const emailKey = context.email_principal.toLowerCase();
    this.inMemoryContexts.set(emailKey, context);
    if (aplicacionId) {
      this.inMemoryContexts.set(`${emailKey}::${aplicacionId}`, context);
    }
  }

  public clearInMemoryContexts(): void {
    this.inMemoryContexts.clear();
  }

  public async findAuthorizationContextByEmail(
    emailPrincipal: string,
    aplicacionId: string,
  ): Promise<IdentityAuthorizationContext | null> {
    const normalizedEmail = emailPrincipal.trim().toLowerCase();
    const compositeKey = `${normalizedEmail}::${aplicacionId}`;

    const memComposite = this.inMemoryContexts.get(compositeKey);
    if (memComposite) {
      return memComposite;
    }
    const memByEmail = this.inMemoryContexts.get(normalizedEmail);
    if (memByEmail) {
      return {
        ...memByEmail,
        asignaciones_directas_app: memByEmail.asignaciones_directas_app.filter(
          (a) => a.aplicacion_id === aplicacionId,
        ),
      };
    }

    if (!this.db) {
      return null;
    }

    const baseResult = await this.db.query<CuentaPersonaRow>(
      `SELECT
         p.id_interno,
         c.cuenta_id,
         c.google_sub_id,
         c.email_principal,
         c.dominio,
         c.org_unit_path,
         p.tipo_identificacion,
         p.numero_identificacion,
         p.nombre_completo,
         p.estado_persona,
         c.suspended_en_gws,
         c.estado_sincronizacion,
         c.tipo_usuario,
         c.subtipo_usuario,
         c.cargo_funcion,
         c.grado_curso,
         c.nivel_academico_derivado,
         c.docente_multisede,
         c.fecha_inicio_vigencia,
         c.fecha_fin_vigencia
       FROM cuenta_institucional c
       INNER JOIN persona_identidad p
         ON p.id_interno = c.id_interno
       WHERE LOWER(c.email_principal) = $1
       LIMIT 1`,
      [normalizedEmail],
    );

    const baseRow = baseResult.rows[0];
    if (!baseRow) {
      return null;
    }

    const [contextosResult, asignacionesRolResult, anomaliasResult] =
      await Promise.all([
        this.db.query<AsignacionContextoRow>(
          `SELECT
             asignacion_id,
             es_sede_primaria,
             nivel_estructura,
             viceministerio,
             codigo_zona,
             codigo_distrito,
             codigo_circuito,
             codigo_amie,
             codigo_dependencia_admin,
             regimen_escolar,
             modalidad_educativa,
             jornada,
             activo
           FROM asignacion_contexto
           WHERE id_interno = $1
             AND (cuenta_id IS NULL OR cuenta_id = $2)
             AND activo = TRUE
           ORDER BY es_sede_primaria DESC, creado_en ASC`,
          [baseRow.id_interno, baseRow.cuenta_id],
        ),
        this.db.query<UsuarioRolAplicacionRow>(
          `SELECT
             ura.asignacion_rol_id,
             ura.aplicacion_id,
             ura.cuenta_id,
             ura.rol_id,
             r.codigo_rol,
             ura.perfil_id,
             pf.codigo_perfil,
             ura.codigo_zona_acotado,
             ura.codigo_distrito_acotado,
             ura.codigo_circuito_acotado,
             ura.codigo_amie_acotado,
             ura.fecha_inicio_vigencia,
             ura.fecha_fin_vigencia,
             ura.activo
           FROM usuario_rol_aplicacion ura
           LEFT JOIN rol r
             ON r.aplicacion_id = ura.aplicacion_id
            AND r.rol_id = ura.rol_id
           LEFT JOIN perfil pf
             ON pf.aplicacion_id = ura.aplicacion_id
            AND pf.perfil_id = ura.perfil_id
           WHERE ura.id_interno = $1
             AND ura.aplicacion_id = $2
             AND (ura.cuenta_id IS NULL OR ura.cuenta_id = $3)
             AND ura.activo = TRUE`,
          [baseRow.id_interno, aplicacionId, baseRow.cuenta_id],
        ),
        this.db.query<AnomaliaRow>(
          `SELECT
             anomalia_id,
             codigo_causal,
             efecto_acceso,
             estado_anomalia
           FROM anomalia_identidad
           WHERE (id_interno = $1 OR cuenta_id = $2)
             AND estado_anomalia IN ('ABIERTA', 'EN_REVISION', 'LISTA_PARA_CERRAR')`,
          [baseRow.id_interno, baseRow.cuenta_id],
        ),
      ]);

    const asignacionesContexto: ContextualAssignmentEntry[] =
      contextosResult.rows.map((row) => ({
        asignacion_id: row.asignacion_id,
        es_sede_primaria: Boolean(row.es_sede_primaria),
        nivel_estructura: row.nivel_estructura,
        viceministerio: row.viceministerio,
        codigo_zona: row.codigo_zona,
        codigo_distrito: row.codigo_distrito,
        codigo_circuito: row.codigo_circuito,
        codigo_amie: row.codigo_amie,
        codigo_dependencia_admin: row.codigo_dependencia_admin,
        regimen_escolar: row.regimen_escolar,
        modalidad_educativa: row.modalidad_educativa,
        jornada: row.jornada,
        activo: Boolean(row.activo),
      }));

    const asignacionesDirectas: DirectRoleOrProfileAssignment[] =
      asignacionesRolResult.rows.map((row) => ({
        asignacion_rol_id: row.asignacion_rol_id,
        aplicacion_id: row.aplicacion_id,
        cuenta_id: row.cuenta_id,
        rol_id: row.rol_id,
        codigo_rol: row.codigo_rol,
        perfil_id: row.perfil_id,
        codigo_perfil: row.codigo_perfil,
        codigo_zona_acotado: row.codigo_zona_acotado,
        codigo_distrito_acotado: row.codigo_distrito_acotado,
        codigo_circuito_acotado: row.codigo_circuito_acotado,
        codigo_amie_acotado: row.codigo_amie_acotado,
        fecha_inicio_vigencia:
          formatDateColumn(row.fecha_inicio_vigencia) ?? '1970-01-01',
        fecha_fin_vigencia: formatDateColumn(row.fecha_fin_vigencia),
        activo: Boolean(row.activo),
      }));

    const anomaliasActivas: ActiveIdentityAnomalyEntry[] =
      anomaliasResult.rows.map((row) => ({
        anomalia_id: row.anomalia_id,
        codigo_causal: row.codigo_causal,
        efecto_acceso: row.efecto_acceso,
        estado_anomalia: row.estado_anomalia,
      }));

    return {
      id_interno: baseRow.id_interno,
      cuenta_id: baseRow.cuenta_id,
      google_sub_id: baseRow.google_sub_id,
      email_principal: baseRow.email_principal,
      dominio: baseRow.dominio,
      org_unit_path: baseRow.org_unit_path,
      tipo_identificacion: baseRow.tipo_identificacion,
      numero_identificacion: baseRow.numero_identificacion,
      nombre_completo: baseRow.nombre_completo,
      estado_persona: baseRow.estado_persona,
      suspended_en_gws: Boolean(baseRow.suspended_en_gws),
      estado_sincronizacion: baseRow.estado_sincronizacion,
      tipo_usuario: baseRow.tipo_usuario,
      subtipo_usuario: baseRow.subtipo_usuario,
      cargo_funcion: baseRow.cargo_funcion,
      grado_curso: baseRow.grado_curso,
      nivel_academico_derivado: baseRow.nivel_academico_derivado,
      docente_multisede: Boolean(baseRow.docente_multisede),
      fecha_inicio_vigencia: formatDateColumn(baseRow.fecha_inicio_vigencia),
      fecha_fin_vigencia: formatDateColumn(baseRow.fecha_fin_vigencia),
      asignaciones_contexto: asignacionesContexto,
      asignaciones_directas_app: asignacionesDirectas,
      anomalias_activas: anomaliasActivas,
    };
  }
}
