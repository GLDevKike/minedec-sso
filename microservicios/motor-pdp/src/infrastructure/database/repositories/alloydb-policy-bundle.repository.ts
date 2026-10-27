/**
 * Repositorio AlloyDB de Paquetes de Políticas de Aplicación (`AlloyDbPolicyBundleRepository`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios IV, VI y XIII):
 * - Consultas SQL 100 % parametrizadas (`$1, $2`) con validación de identificadores contra `ALLOWED_PIP_SQL_IDENTIFIERS`.
 * - Carga normalizada 1FN/3FN de `aplicacion`, `ruta_catalogo`, `ruta_permiso_requerido`, `rol`, `rol_permiso`,
 *   `perfil`, `perfil_rol`, `grupo_logico`, `grupo_logico_rol` y `grupo_logico_perfil`.
 */

import { SqlQueryExecutor, assertSafeSqlIdentifier } from '@minedec/shared';
import {
  ApplicationPolicyBundle,
  LogicalGroupRule,
  PolicyAstNode,
  RequiredRoutePermission,
  RolePermissionEntry,
  RouteCatalogEntry,
} from '../../../domain/entities/pdp-domain.entities';
import {
  PolicyBundleLookupInput,
  PolicyBundleRepositoryPort,
} from '../../../domain/ports/pdp.ports';
import {
  PolicyAstNodeSchema,
  validatePolicyAstLimits,
} from '../../http/schemas/pdp-zod.schemas';

interface AplicacionRow {
  aplicacion_id: string;
  codigo_unico: string;
  nombre_visible: string;
  patron_integracion: 'PATRON_1_SP_RP' | 'PATRON_2_PEP_PERIMETRAL';
  nivel_adopcion_pep: 'PROTEGIDA' | 'INTEGRADA' | 'NATIVA' | null;
  host_publico: string;
  politica_ruta_defecto: 'PUBLICA' | 'AUTENTICADA' | 'PROTEGIDA';
  modo_sombra: boolean;
  estado_ciclo_vida:
    | 'BORRADOR'
    | 'PUBLICANDO'
    | 'PUBLICADO'
    | 'SUSPENDIDO'
    | 'DESPUBLICADO';
  version_catalogo: number;
}

interface RutaRow {
  ruta_id: string;
  aplicacion_id: string;
  patron_ruta: string;
  metodo_http: RouteCatalogEntry['metodo_http'];
  tipo_coincidencia: RouteCatalogEntry['tipo_coincidencia'];
  nivel_acceso: RouteCatalogEntry['nivel_acceso'];
  modo_evaluacion_permisos: RouteCatalogEntry['modo_evaluacion_permisos'];
  orden_especificidad: number;
  modo_sombra: boolean;
  activo: boolean;
}

interface RutaPermisoRow {
  ruta_id: string;
  permiso_id: string;
  codigo_permiso: string;
  accion_crud_requerida: RequiredRoutePermission['accion_crud_requerida'];
}

interface RolRow {
  rol_id: string;
  codigo_rol: string;
  activo: boolean;
}

interface RolPermisoRow {
  codigo_rol: string;
  permiso_id: string;
  codigo_permiso: string;
  puede_crear: boolean;
  puede_leer: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

interface PerfilRow {
  perfil_id: string;
  codigo_perfil: string;
  activo: boolean;
}

interface PerfilRolRow {
  codigo_perfil: string;
  codigo_rol: string;
}

interface GrupoLogicoRow {
  grupo_logico_id: string;
  codigo_grupo: string;
  nombre_visible: string;
  prioridad_evaluacion: number;
  activo: boolean;
  regla_cruce_abac_rbac: unknown;
}

interface GrupoRolRow {
  grupo_logico_id: string;
  codigo_rol: string;
}

interface GrupoPerfilRow {
  grupo_logico_id: string;
  codigo_perfil: string;
}

export class AlloyDbPolicyBundleRepository
  implements PolicyBundleRepositoryPort
{
  private readonly inMemoryBundles = new Map<string, ApplicationPolicyBundle>();

  constructor(private readonly db?: SqlQueryExecutor) {
    assertSafeSqlIdentifier('aplicacion');
    assertSafeSqlIdentifier('ruta_catalogo');
    assertSafeSqlIdentifier('ruta_permiso_requerido');
    assertSafeSqlIdentifier('permiso_atomico');
    assertSafeSqlIdentifier('rol');
    assertSafeSqlIdentifier('rol_permiso');
    assertSafeSqlIdentifier('perfil');
    assertSafeSqlIdentifier('perfil_rol');
    assertSafeSqlIdentifier('grupo_logico');
    assertSafeSqlIdentifier('grupo_logico_rol');
    assertSafeSqlIdentifier('grupo_logico_perfil');
  }

  public registerInMemoryBundle(bundle: ApplicationPolicyBundle): void {
    this.inMemoryBundles.set(bundle.aplicacion_id, bundle);
    this.inMemoryBundles.set(bundle.codigo_unico.toLowerCase(), bundle);
    this.inMemoryBundles.set(bundle.host_publico.toLowerCase(), bundle);
  }

  public clearInMemoryBundles(): void {
    this.inMemoryBundles.clear();
  }

  public async findPolicyBundle(
    lookup: PolicyBundleLookupInput,
  ): Promise<ApplicationPolicyBundle | null> {
    if (lookup.uuid_aplicacion) {
      const memById = this.inMemoryBundles.get(lookup.uuid_aplicacion);
      if (memById) return memById;
    }
    if (lookup.codigo_unico) {
      const memByCode = this.inMemoryBundles.get(
        lookup.codigo_unico.toLowerCase(),
      );
      if (memByCode) return memByCode;
    }
    if (lookup.host_solicitado) {
      const cleanHost = lookup.host_solicitado
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.split(':')[0];
      if (cleanHost) {
        const memByHost = this.inMemoryBundles.get(cleanHost);
        if (memByHost) return memByHost;
      }
    }

    if (!this.db) {
      return null;
    }

    let appQuery = '';
    let appParam: string = '';

    if (lookup.uuid_aplicacion) {
      appQuery = `
        SELECT
          aplicacion_id,
          codigo_unico,
          nombre_visible,
          patron_integracion,
          nivel_adopcion_pep,
          host_publico,
          politica_ruta_defecto,
          modo_sombra,
          estado_ciclo_vida,
          version_catalogo
        FROM aplicacion
        WHERE aplicacion_id = $1
        LIMIT 1
      `;
      appParam = lookup.uuid_aplicacion;
    } else if (lookup.codigo_unico) {
      appQuery = `
        SELECT
          aplicacion_id,
          codigo_unico,
          nombre_visible,
          patron_integracion,
          nivel_adopcion_pep,
          host_publico,
          politica_ruta_defecto,
          modo_sombra,
          estado_ciclo_vida,
          version_catalogo
        FROM aplicacion
        WHERE LOWER(codigo_unico) = LOWER($1)
        LIMIT 1
      `;
      appParam = lookup.codigo_unico;
    } else if (lookup.host_solicitado) {
      const normalizedHost =
        lookup.host_solicitado
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .split('/')[0]
          ?.split(':')[0] ?? lookup.host_solicitado.toLowerCase();

      appQuery = `
        SELECT
          aplicacion_id,
          codigo_unico,
          nombre_visible,
          patron_integracion,
          nivel_adopcion_pep,
          host_publico,
          politica_ruta_defecto,
          modo_sombra,
          estado_ciclo_vida,
          version_catalogo
        FROM aplicacion
        WHERE LOWER(host_publico) = LOWER($1)
        LIMIT 1
      `;
      appParam = normalizedHost;
    } else {
      return null;
    }

    const appResult = await this.db.query<AplicacionRow>(appQuery, [appParam]);
    const appRow = appResult.rows[0];
    if (!appRow) {
      return null;
    }

    const appId = appRow.aplicacion_id;

    const [
      rutasResult,
      rutaPermisosResult,
      rolesResult,
      rolPermisosResult,
      perfilesResult,
      perfilRolesResult,
      gruposResult,
      grupoRolesResult,
      grupoPerfilesResult,
    ] = await Promise.all([
      this.db.query<RutaRow>(
        `SELECT
           ruta_id,
           aplicacion_id,
           patron_ruta,
           metodo_http,
           tipo_coincidencia,
           nivel_acceso,
           modo_evaluacion_permisos,
           orden_especificidad,
           modo_sombra,
           activo
         FROM ruta_catalogo
         WHERE aplicacion_id = $1 AND activo = TRUE
         ORDER BY orden_especificidad ASC, patron_ruta ASC`,
        [appId],
      ),
      this.db.query<RutaPermisoRow>(
        `SELECT
           rpr.ruta_id,
           rpr.permiso_id,
           pa.codigo_permiso,
           rpr.accion_crud_requerida
         FROM ruta_permiso_requerido rpr
         INNER JOIN permiso_atomico pa
           ON pa.aplicacion_id = rpr.aplicacion_id
          AND pa.permiso_id = rpr.permiso_id
         WHERE rpr.aplicacion_id = $1 AND pa.activo = TRUE`,
        [appId],
      ),
      this.db.query<RolRow>(
        `SELECT rol_id, codigo_rol, activo
         FROM rol
         WHERE aplicacion_id = $1 AND activo = TRUE`,
        [appId],
      ),
      this.db.query<RolPermisoRow>(
        `SELECT
           r.codigo_rol,
           rp.permiso_id,
           pa.codigo_permiso,
           rp.puede_crear,
           rp.puede_leer,
           rp.puede_editar,
           rp.puede_eliminar
         FROM rol_permiso rp
         INNER JOIN rol r
           ON r.aplicacion_id = rp.aplicacion_id
          AND r.rol_id = rp.rol_id
         INNER JOIN permiso_atomico pa
           ON pa.aplicacion_id = rp.aplicacion_id
          AND pa.permiso_id = rp.permiso_id
         WHERE rp.aplicacion_id = $1
           AND r.activo = TRUE
           AND pa.activo = TRUE`,
        [appId],
      ),
      this.db.query<PerfilRow>(
        `SELECT perfil_id, codigo_perfil, activo
         FROM perfil
         WHERE aplicacion_id = $1 AND activo = TRUE`,
        [appId],
      ),
      this.db.query<PerfilRolRow>(
        `SELECT
           pf.codigo_perfil,
           r.codigo_rol
         FROM perfil_rol pr
         INNER JOIN perfil pf
           ON pf.aplicacion_id = pr.aplicacion_id
          AND pf.perfil_id = pr.perfil_id
         INNER JOIN rol r
           ON r.aplicacion_id = pr.aplicacion_id
          AND r.rol_id = pr.rol_id
         WHERE pr.aplicacion_id = $1
           AND pf.activo = TRUE
           AND r.activo = TRUE`,
        [appId],
      ),
      this.db.query<GrupoLogicoRow>(
        `SELECT
           grupo_logico_id,
           codigo_grupo,
           nombre_visible,
           prioridad_evaluacion,
           activo,
           regla_cruce_abac_rbac
         FROM grupo_logico
         WHERE aplicacion_id = $1 AND activo = TRUE
         ORDER BY prioridad_evaluacion ASC`,
        [appId],
      ),
      this.db.query<GrupoRolRow>(
        `SELECT
           glr.grupo_logico_id,
           r.codigo_rol
         FROM grupo_logico_rol glr
         INNER JOIN rol r
           ON r.aplicacion_id = glr.aplicacion_id
          AND r.rol_id = glr.rol_id
         WHERE glr.aplicacion_id = $1 AND r.activo = TRUE`,
        [appId],
      ),
      this.db.query<GrupoPerfilRow>(
        `SELECT
           glp.grupo_logico_id,
           pf.codigo_perfil
         FROM grupo_logico_perfil glp
         INNER JOIN perfil pf
           ON pf.aplicacion_id = glp.aplicacion_id
          AND pf.perfil_id = glp.perfil_id
         WHERE glp.aplicacion_id = $1 AND pf.activo = TRUE`,
        [appId],
      ),
    ]);

    const rutaPermisosMap = new Map<string, RequiredRoutePermission[]>();
    for (const rp of rutaPermisosResult.rows) {
      const list = rutaPermisosMap.get(rp.ruta_id) ?? [];
      list.push({
        permiso_id: rp.permiso_id,
        codigo_permiso: rp.codigo_permiso,
        accion_crud_requerida: rp.accion_crud_requerida,
      });
      rutaPermisosMap.set(rp.ruta_id, list);
    }

    const rutasOrdenadas: RouteCatalogEntry[] = rutasResult.rows.map((r) => ({
      ruta_id: r.ruta_id,
      aplicacion_id: r.aplicacion_id,
      patron_ruta: r.patron_ruta,
      metodo_http: r.metodo_http,
      tipo_coincidencia: r.tipo_coincidencia,
      nivel_acceso: r.nivel_acceso,
      modo_evaluacion_permisos: r.modo_evaluacion_permisos,
      orden_especificidad: r.orden_especificidad,
      modo_sombra: Boolean(r.modo_sombra),
      activo: Boolean(r.activo),
      permisos_requeridos: rutaPermisosMap.get(r.ruta_id) ?? [],
    }));

    const rolIdACodigo: Record<string, string> = {};
    const rolesMapa: Record<string, RolePermissionEntry[]> = {};
    for (const r of rolesResult.rows) {
      rolIdACodigo[r.rol_id] = r.codigo_rol;
      rolesMapa[r.codigo_rol] = [];
    }
    for (const rp of rolPermisosResult.rows) {
      const list = rolesMapa[rp.codigo_rol] ?? [];
      list.push({
        permiso_id: rp.permiso_id,
        codigo_permiso: rp.codigo_permiso,
        puede_crear: Boolean(rp.puede_crear),
        puede_leer: Boolean(rp.puede_leer),
        puede_editar: Boolean(rp.puede_editar),
        puede_eliminar: Boolean(rp.puede_eliminar),
      });
      rolesMapa[rp.codigo_rol] = list;
    }

    const perfilIdACodigo: Record<string, string> = {};
    const perfilesMapa: Record<string, string[]> = {};
    for (const pf of perfilesResult.rows) {
      perfilIdACodigo[pf.perfil_id] = pf.codigo_perfil;
      perfilesMapa[pf.codigo_perfil] = [];
    }
    for (const pr of perfilRolesResult.rows) {
      const list = perfilesMapa[pr.codigo_perfil] ?? [];
      if (!list.includes(pr.codigo_rol)) {
        list.push(pr.codigo_rol);
      }
      perfilesMapa[pr.codigo_perfil] = list;
    }

    const grupoRolesMap = new Map<string, string[]>();
    for (const gr of grupoRolesResult.rows) {
      const list = grupoRolesMap.get(gr.grupo_logico_id) ?? [];
      list.push(gr.codigo_rol);
      grupoRolesMap.set(gr.grupo_logico_id, list);
    }

    const grupoPerfilesMap = new Map<string, string[]>();
    for (const gp of grupoPerfilesResult.rows) {
      const list = grupoPerfilesMap.get(gp.grupo_logico_id) ?? [];
      list.push(gp.codigo_perfil);
      grupoPerfilesMap.set(gp.grupo_logico_id, list);
    }

    const gruposLogicos: LogicalGroupRule[] = [];
    for (const gl of gruposResult.rows) {
      const parsedAst = PolicyAstNodeSchema.safeParse(gl.regla_cruce_abac_rbac);
      if (!parsedAst.success) {
        continue;
      }
      const limitsCheck = validatePolicyAstLimits(parsedAst.data);
      if (!limitsCheck.valid) {
        continue;
      }
      gruposLogicos.push({
        grupo_logico_id: gl.grupo_logico_id,
        codigo_grupo: gl.codigo_grupo,
        nombre_visible: gl.nombre_visible,
        prioridad_evaluacion: gl.prioridad_evaluacion,
        activo: Boolean(gl.activo),
        regla_cruce_abac_rbac: parsedAst.data as PolicyAstNode,
        roles_otorgados: grupoRolesMap.get(gl.grupo_logico_id) ?? [],
        perfiles_otorgados: grupoPerfilesMap.get(gl.grupo_logico_id) ?? [],
      });
    }

    return {
      aplicacion_id: appRow.aplicacion_id,
      codigo_unico: appRow.codigo_unico,
      nombre_visible: appRow.nombre_visible,
      patron_integracion: appRow.patron_integracion,
      nivel_adopcion_pep: appRow.nivel_adopcion_pep,
      host_publico: appRow.host_publico,
      politica_ruta_defecto: appRow.politica_ruta_defecto,
      modo_sombra: Boolean(appRow.modo_sombra),
      estado_ciclo_vida: appRow.estado_ciclo_vida,
      version_catalogo: appRow.version_catalogo,
      rutas_ordenadas: rutasOrdenadas,
      grupos_logicos: gruposLogicos,
      roles_mapa: rolesMapa,
      perfiles_mapa: perfilesMapa,
      rol_id_a_codigo: rolIdACodigo,
      perfil_id_a_codigo: perfilIdACodigo,
    };
  }
}
