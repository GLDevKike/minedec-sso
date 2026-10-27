/**
 * Servicio de Dominio Puro: Evaluador Híbrido RBAC × ABAC (`motor-pdp`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V, VI y X):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de infraestructura.
 * - Evalúa el AST recursivo `regla_cruce_abac_rbac` sobre los atributos institucionales GWS y sedes AMIE.
 * - Expande `grupo_logico` -> `rol`/`perfil` y `usuario_rol_aplicacion` con vigencia temporal y acotamiento territorial.
 * - Aplica unión aditiva `bool_or` de capacidades CRUD (`puede_crear`, `puede_leer`, `puede_editar`, `puede_eliminar`).
 * - Soporta modos `ANY` (OR) y `ALL` (AND) por ruta y Modo Sombra (`Shadow Mode`) jerárquico.
 */

import {
  ApplicationPolicyBundle,
  ContextualAssignmentEntry,
  CrudPermissions,
  DebugShadowMetadata,
  DecisionCode,
  DirectRoleOrProfileAssignment,
  HttpMethodType,
  IdentityAuthorizationContext,
  PolicyAstField,
  PolicyAstNode,
  PrecomputedAuthorizationDecision,
  RequiredCrudAction,
  RequiredRoutePermission,
  RouteCatalogEntry,
  TerritorialContext,
} from '../entities/pdp-domain.entities';
import { RouteMatchResolution } from './route-normalizer-matcher.service';

export interface RouteEvaluationOutcome {
  autorizado: boolean;
  codigo_decision: DecisionCode;
  decision_proyectada: DecisionCode;
  modo_sombra_activo: boolean;
  roles: string[];
  permisos: string[];
  permisos_crud: CrudPermissions;
  contexto_territorial: TerritorialContext;
  politicas_evaluadas: string[];
  cache_ttl_segundos: number;
  metadatos_depuracion?: DebugShadowMetadata;
}

export type EvaluationAttributeBag = Record<
  PolicyAstField,
  string | string[] | boolean | null
>;

export class RbacAbacEvaluatorService {
  /**
   * Evalúa recursivamente un nodo del AST `regla_cruce_abac_rbac` contra el diccionario de atributos del sujeto
   * o directamente contra el expediente `IdentityAuthorizationContext`.
   */
  public evaluateAstNode(
    node: PolicyAstNode,
    attributesOrContext: EvaluationAttributeBag | IdentityAuthorizationContext,
  ): boolean {
    const attributes: EvaluationAttributeBag =
      'asignaciones_contexto' in attributesOrContext
        ? this.extractAttributeBagFromContext(attributesOrContext)
        : attributesOrContext;

    if ('conditions' in node) {
      if (node.op === 'AND') {
        return node.conditions.every((child) =>
          this.evaluateAstNode(child, attributes),
        );
      }
      return node.conditions.some((child) =>
        this.evaluateAstNode(child, attributes),
      );
    }

    if ('condition' in node) {
      return !this.evaluateAstNode(node.condition, attributes);
    }

    const actualValue = attributes[node.field];
    const expectedValue = node.value;

    if (actualValue === null || actualValue === undefined) {
      return node.op === 'NEQ';
    }

    switch (node.op) {
      case 'EQ': {
        if (Array.isArray(actualValue)) {
          return (
            typeof expectedValue === 'string' &&
            actualValue.includes(expectedValue)
          );
        }
        return actualValue === expectedValue;
      }

      case 'NEQ': {
        if (Array.isArray(actualValue)) {
          return (
            typeof expectedValue === 'string' &&
            !actualValue.includes(expectedValue)
          );
        }
        return actualValue !== expectedValue;
      }

      case 'IN': {
        if (!Array.isArray(expectedValue)) {
          return false;
        }
        if (Array.isArray(actualValue)) {
          return actualValue.some((item) => expectedValue.includes(item));
        }
        return (
          typeof actualValue === 'string' && expectedValue.includes(actualValue)
        );
      }

      case 'CONTAINS': {
        if (typeof expectedValue !== 'string') {
          return false;
        }
        if (Array.isArray(actualValue)) {
          return actualValue.includes(expectedValue);
        }
        if (typeof actualValue === 'string') {
          return actualValue.includes(expectedValue);
        }
        return false;
      }
    }
  }

  /**
   * Alias de conveniencia para precalcular la decisión base del sujeto para una aplicación.
   */
  public precomputeSubjectAuthorization(
    context: IdentityAuthorizationContext,
    bundle: ApplicationPolicyBundle,
    evaluationTime: Date = new Date(),
    maxCacheTtlSeconds = 300,
  ): PrecomputedAuthorizationDecision {
    return this.computeSubjectAuthorizationDecision(
      context,
      bundle,
      evaluationTime,
      maxCacheTtlSeconds,
    );
  }

  /**
   * Precalcula la decisión base del sujeto para una aplicación (roles efectivos, permisos efectivos,
   * unión aditiva `bool_or` de capacidades CRUD, scoping territorial y estado de cuenta/vigencia).
   */
  public computeSubjectAuthorizationDecision(
    context: IdentityAuthorizationContext,
    bundle: ApplicationPolicyBundle,
    evaluationTime: Date = new Date(),
    maxCacheTtlSeconds = 300,
  ): PrecomputedAuthorizationDecision {
    const politicasBase: string[] = [];
    const safeMaxTtl = Math.min(Math.max(1, maxCacheTtlSeconds), 300);

    // 1. Verificar anomalías bloqueantes o suspensión de identidad/cuenta
    const tieneAnomaliaBloqueante = context.anomalias_activas.some(
      (a) => a.efecto_acceso === 'BLOQUEANTE',
    );
    const cuentaSuspendida =
      context.estado_persona !== 'ACTIVA' ||
      context.suspended_en_gws ||
      context.estado_sincronizacion === 'SUSPENDIDA_GWS' ||
      context.estado_sincronizacion === 'BLOQUEADA_ANOMALIA' ||
      tieneAnomaliaBloqueante;

    if (cuentaSuspendida) {
      politicasBase.push('ABAC:CUENTA_SUSPENDIDA_O_BLOQUEADA');
    }

    // 2. Verificar ventana de vigencia de cuenta_institucional y asignaciones nominales
    const evalDateStr = evaluationTime.toISOString().slice(0, 10);
    const ctxStartStr = context.fecha_inicio_vigencia?.slice(0, 10) ?? null;
    const ctxEndStr = context.fecha_fin_vigencia?.slice(0, 10) ?? null;
    const cuentaFueraVigencia =
      context.estado_sincronizacion === 'VIGENCIA_VENCIDA' ||
      Boolean(ctxStartStr && evalDateStr < ctxStartStr) ||
      Boolean(ctxEndStr && evalDateStr > ctxEndStr);

    // 3. Construir el contexto territorial primario y multisede (1FN/3FN)
    const activeContexts = context.asignaciones_contexto.filter(
      (c) => c.activo,
    );
    const primaryContext: ContextualAssignmentEntry | undefined =
      activeContexts.find((c) => c.es_sede_primaria) ?? activeContexts[0];

    const amiesAsignadosSet = new Set<string>();
    for (const ctx of activeContexts) {
      if (ctx.codigo_amie) {
        amiesAsignadosSet.add(ctx.codigo_amie);
      }
    }

    const baseTerritorial: TerritorialContext = {
      amie_titular: primaryContext?.codigo_amie ?? 'NO_APLICA',
      amies_asignados: Array.from(amiesAsignadosSet),
      nivel_jurisdiccion: primaryContext?.nivel_estructura ?? 'INSTITUCIONAL',
      codigo_jurisdiccion:
        primaryContext?.codigo_amie ??
        primaryContext?.codigo_distrito ??
        primaryContext?.codigo_zona ??
        'NO_APLICA',
      zona: primaryContext?.codigo_zona ?? 'NO_APLICA',
      distrito: primaryContext?.codigo_distrito ?? 'NO_APLICA',
      circuito: primaryContext?.codigo_circuito ?? undefined,
      viceministerio: primaryContext?.viceministerio ?? 'NO_APLICA',
      codigo_dependencia_admin:
        primaryContext?.codigo_dependencia_admin ?? undefined,
    };

    // 4. Construir bolsa de atributos GWS + contexto territorial para evaluar AST
    const attributeBag: EvaluationAttributeBag = {
      tipo_usuario: context.tipo_usuario,
      subtipo_usuario: context.subtipo_usuario,
      cargo_funcion: context.cargo_funcion,
      grado_curso: context.grado_curso,
      nivel_academico_derivado: context.nivel_academico_derivado,
      docente_multisede: context.docente_multisede,
      viceministerio: primaryContext?.viceministerio ?? null,
      nivel_estructura: primaryContext?.nivel_estructura ?? null,
      codigo_zona: primaryContext?.codigo_zona ?? null,
      codigo_distrito: primaryContext?.codigo_distrito ?? null,
      codigo_circuito: primaryContext?.codigo_circuito ?? null,
      codigo_amie: primaryContext?.codigo_amie ?? null,
      amies_asignados: baseTerritorial.amies_asignados,
      codigo_dependencia_admin:
        primaryContext?.codigo_dependencia_admin ?? null,
      regimen_escolar: primaryContext?.regimen_escolar ?? null,
      modalidad_educativa: primaryContext?.modalidad_educativa ?? null,
      jornada: primaryContext?.jornada ?? null,
      dominio: context.dominio,
      org_unit_path: context.org_unit_path,
    };

    const effectiveRolesSet = new Set<string>();

    // 5. Evaluar grupos lógicos activos en orden de prioridad
    const sortedLogicalGroups = [...bundle.grupos_logicos]
      .filter((g) => g.activo)
      .sort((a, b) => a.prioridad_evaluacion - b.prioridad_evaluacion);

    for (const group of sortedLogicalGroups) {
      const matched = this.evaluateAstNode(
        group.regla_cruce_abac_rbac,
        attributeBag,
      );
      if (matched) {
        politicasBase.push(`GRUPO_LOGICO:${group.codigo_grupo}`);
        for (const roleCode of group.roles_otorgados) {
          if (bundle.roles_mapa[roleCode]) {
            effectiveRolesSet.add(roleCode);
          }
        }
        for (const profileCode of group.perfiles_otorgados) {
          const profileRoles = bundle.perfiles_mapa[profileCode] ?? [];
          for (const roleCode of profileRoles) {
            if (bundle.roles_mapa[roleCode]) {
              effectiveRolesSet.add(roleCode);
            }
          }
        }
      }
    }

    // 6. Evaluar asignaciones nominales directas (usuario_rol_aplicacion)
    let hadExpiredNominalAssignment = false;
    let nearestEndTimestampMs: number | null = null;

    if (ctxEndStr) {
      const accountEndMs = Date.parse(`${ctxEndStr}T23:59:59.999Z`);
      if (!Number.isNaN(accountEndMs)) {
        nearestEndTimestampMs = accountEndMs;
      }
    }

    for (const assignment of context.asignaciones_directas_app) {
      if (!assignment.activo) {
        continue;
      }
      if (
        assignment.cuenta_id !== null &&
        assignment.cuenta_id !== context.cuenta_id
      ) {
        continue;
      }

      const assignStartStr =
        assignment.fecha_inicio_vigencia?.slice(0, 10) ?? null;
      const assignEndStr = assignment.fecha_fin_vigencia?.slice(0, 10) ?? null;

      const startsBeforeOrToday =
        !assignStartStr || evalDateStr >= assignStartStr;
      const endsAfterOrToday = !assignEndStr || evalDateStr <= assignEndStr;

      if (!startsBeforeOrToday || !endsAfterOrToday) {
        hadExpiredNominalAssignment = true;
        politicasBase.push(
          `ABAC:VIGENCIA_NOMINAL_FUERA_VENTANA:${assignment.asignacion_rol_id}`,
        );
        continue;
      }

      if (
        !this.matchesTerritorialScope(
          assignment,
          activeContexts,
          baseTerritorial,
        )
      ) {
        politicasBase.push(
          `ABAC:ACOTAMIENTO_TERRITORIAL_NO_SATISFECHO:${assignment.asignacion_rol_id}`,
        );
        continue;
      }

      if (assignEndStr) {
        const endMs = Date.parse(`${assignEndStr}T23:59:59.999Z`);
        if (
          !Number.isNaN(endMs) &&
          (nearestEndTimestampMs === null || endMs < nearestEndTimestampMs)
        ) {
          nearestEndTimestampMs = endMs;
        }
      }

      const resolvedRoleCode =
        assignment.codigo_rol ??
        (assignment.rol_id ? bundle.rol_id_a_codigo[assignment.rol_id] : null);

      if (resolvedRoleCode && bundle.roles_mapa[resolvedRoleCode]) {
        effectiveRolesSet.add(resolvedRoleCode);
        politicasBase.push(`RBAC_NOMINAL_ROL:${resolvedRoleCode}`);
      }

      const resolvedProfileCode =
        assignment.codigo_perfil ??
        (assignment.perfil_id
          ? bundle.perfil_id_a_codigo[assignment.perfil_id]
          : null);

      if (resolvedProfileCode) {
        const expandedRoles = bundle.perfiles_mapa[resolvedProfileCode] ?? [];
        for (const rCode of expandedRoles) {
          if (bundle.roles_mapa[rCode]) {
            effectiveRolesSet.add(rCode);
          }
        }
        politicasBase.push(`RBAC_NOMINAL_PERFIL:${resolvedProfileCode}`);
      }

      if (
        assignment.codigo_amie_acotado &&
        !baseTerritorial.amies_asignados.includes(
          assignment.codigo_amie_acotado,
        )
      ) {
        baseTerritorial.amies_asignados.push(assignment.codigo_amie_acotado);
      }
    }

    // 7. Unión aditiva bool_or de capacidades CRUD sobre todos los roles efectivos
    const permisosPorCodigo: Record<string, CrudPermissions> = {};
    const permisosCrudAgregado: CrudPermissions = {
      puede_crear: false,
      puede_leer: false,
      puede_editar: false,
      puede_eliminar: false,
    };

    const rolesEfectivos = Array.from(effectiveRolesSet).sort();
    for (const roleCode of rolesEfectivos) {
      politicasBase.push(`RBAC:${roleCode}`);
      const rolePerms = bundle.roles_mapa[roleCode] ?? [];
      for (const perm of rolePerms) {
        const current = permisosPorCodigo[perm.codigo_permiso] ?? {
          puede_crear: false,
          puede_leer: false,
          puede_editar: false,
          puede_eliminar: false,
        };
        const merged: CrudPermissions = {
          puede_crear: current.puede_crear || perm.puede_crear,
          puede_leer: current.puede_leer || perm.puede_leer,
          puede_editar: current.puede_editar || perm.puede_editar,
          puede_eliminar: current.puede_eliminar || perm.puede_eliminar,
        };
        permisosPorCodigo[perm.codigo_permiso] = merged;

        permisosCrudAgregado.puede_crear =
          permisosCrudAgregado.puede_crear || merged.puede_crear;
        permisosCrudAgregado.puede_leer =
          permisosCrudAgregado.puede_leer || merged.puede_leer;
        permisosCrudAgregado.puede_editar =
          permisosCrudAgregado.puede_editar || merged.puede_editar;
        permisosCrudAgregado.puede_eliminar =
          permisosCrudAgregado.puede_eliminar || merged.puede_eliminar;
      }
    }

    const permisosEfectivos = Object.keys(permisosPorCodigo).sort();

    const fueraVentanaVigencia =
      cuentaFueraVigencia ||
      (rolesEfectivos.length === 0 && hadExpiredNominalAssignment);

    if (!fueraVentanaVigencia && !cuentaSuspendida) {
      politicasBase.push('ABAC:VIGENCIA_ACTIVA');
    }

    let computedTtl = safeMaxTtl;
    if (nearestEndTimestampMs !== null) {
      const remainingSeconds = Math.floor(
        (nearestEndTimestampMs - evaluationTime.getTime()) / 1000,
      );
      if (remainingSeconds > 0 && remainingSeconds < computedTtl) {
        computedTtl = remainingSeconds;
      }
    }

    return {
      id_interno: context.id_interno,
      cuenta_id: context.cuenta_id,
      email_principal: context.email_principal,
      tipo_identificacion: context.tipo_identificacion,
      numero_identificacion: context.numero_identificacion,
      estado_persona: context.estado_persona,
      suspended_en_gws: context.suspended_en_gws,
      estado_sincronizacion: context.estado_sincronizacion,
      fuera_ventana_vigencia: fueraVentanaVigencia,
      tiene_anomalia_bloqueante: tieneAnomaliaBloqueante,
      roles_efectivos: rolesEfectivos,
      permisos_efectivos: permisosEfectivos,
      permisos_por_codigo: permisosPorCodigo,
      permisos_crud_agregado: permisosCrudAgregado,
      contexto_territorial: baseTerritorial,
      politicas_base_evaluadas: politicasBase,
      ttl_segundos: computedTtl,
    };
  }

  /**
   * Evalúa el acceso de un sujeto (o petición anónima en ruta PUBLICA) sobre una ruta ya normalizada y clasificada.
   */
  public evaluateRouteAccess(params: {
    routeResolution: RouteMatchResolution;
    httpMethod: HttpMethodType;
    subjectDecision: PrecomputedAuthorizationDecision | null;
    maxCacheTtlSeconds?: number;
  }): RouteEvaluationOutcome {
    const { routeResolution, httpMethod, subjectDecision } = params;
    const maxTtl = Math.min(Math.max(1, params.maxCacheTtlSeconds ?? 300), 300);

    // Caso 1: Ruta PUBLICA
    if (routeResolution.effectiveAccessLevel === 'PUBLICA') {
      return {
        autorizado: true,
        codigo_decision: 'AUTHZ_PUBLIC_ROUTE',
        decision_proyectada: 'AUTHZ_PUBLIC_ROUTE',
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: subjectDecision?.roles_efectivos ?? [],
        permisos: subjectDecision?.permisos_efectivos ?? [],
        permisos_crud: subjectDecision?.permisos_crud_agregado ?? {
          puede_crear: false,
          puede_leer: true,
          puede_editar: false,
          puede_eliminar: false,
        },
        contexto_territorial: subjectDecision?.contexto_territorial ?? {
          amie_titular: 'NO_APLICA',
          amies_asignados: [],
          nivel_jurisdiccion: 'PUBLICO',
          codigo_jurisdiccion: 'PUBLICO',
          zona: 'NO_APLICA',
          distrito: 'NO_APLICA',
        },
        politicas_evaluadas: [routeResolution.policyTraceTag],
        cache_ttl_segundos: subjectDecision?.ttl_segundos ?? maxTtl,
      };
    }

    // Si no hay expediente de identidad para ruta AUTENTICADA o PROTEGIDA -> DENY
    if (!subjectDecision) {
      const projected: DecisionCode = 'AUTHZ_DENIED_POLICY';
      const shadowPermit = routeResolution.effectiveShadowMode;
      return {
        autorizado: shadowPermit,
        codigo_decision: shadowPermit
          ? 'AUTHZ_PERMITTED_SHADOW_MODE'
          : projected,
        decision_proyectada: projected,
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: [],
        permisos: [],
        permisos_crud: {
          puede_crear: false,
          puede_leer: false,
          puede_editar: false,
          puede_eliminar: false,
        },
        contexto_territorial: {
          amie_titular: 'NO_APLICA',
          amies_asignados: [],
          nivel_jurisdiccion: 'SIN_IDENTIDAD',
          codigo_jurisdiccion: 'SIN_IDENTIDAD',
          zona: 'NO_APLICA',
          distrito: 'NO_APLICA',
        },
        politicas_evaluadas: [
          routeResolution.policyTraceTag,
          'ABAC:IDENTIDAD_NO_ENCONTRADA',
        ],
        cache_ttl_segundos: maxTtl,
      };
    }

    const politicas = [
      routeResolution.policyTraceTag,
      ...subjectDecision.politicas_base_evaluadas,
    ];

    // Caso 2: Usuario suspendido, inactivo o con anomalía bloqueante (NUNCA se permite ni siquiera en Modo Sombra)
    const isSuspended =
      subjectDecision.estado_persona !== 'ACTIVA' ||
      subjectDecision.suspended_en_gws ||
      subjectDecision.estado_sincronizacion === 'SUSPENDIDA_GWS' ||
      subjectDecision.estado_sincronizacion === 'BLOQUEADA_ANOMALIA' ||
      subjectDecision.tiene_anomalia_bloqueante;

    if (isSuspended) {
      return {
        autorizado: false,
        codigo_decision: 'AUTHZ_USER_SUSPENDED',
        decision_proyectada: 'AUTHZ_USER_SUSPENDED',
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: [],
        permisos: [],
        permisos_crud: {
          puede_crear: false,
          puede_leer: false,
          puede_editar: false,
          puede_eliminar: false,
        },
        contexto_territorial: subjectDecision.contexto_territorial,
        politicas_evaluadas: politicas,
        cache_ttl_segundos: subjectDecision.ttl_segundos,
      };
    }

    // Caso 3: Usuario fuera de ventana de vigencia temporal
    if (subjectDecision.fuera_ventana_vigencia) {
      return {
        autorizado: false,
        codigo_decision: 'AUTHZ_OUTSIDE_VALIDITY_WINDOW',
        decision_proyectada: 'AUTHZ_OUTSIDE_VALIDITY_WINDOW',
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: subjectDecision.roles_efectivos,
        permisos: subjectDecision.permisos_efectivos,
        permisos_crud: subjectDecision.permisos_crud_agregado,
        contexto_territorial: subjectDecision.contexto_territorial,
        politicas_evaluadas: politicas,
        cache_ttl_segundos: subjectDecision.ttl_segundos,
      };
    }

    // Caso 4: Ruta AUTENTICADA (basta sesión institucional válida y activa)
    if (routeResolution.effectiveAccessLevel === 'AUTENTICADA') {
      return {
        autorizado: true,
        codigo_decision: 'AUTHZ_AUTHENTICATED_ROUTE',
        decision_proyectada: 'AUTHZ_AUTHENTICATED_ROUTE',
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: subjectDecision.roles_efectivos,
        permisos: subjectDecision.permisos_efectivos,
        permisos_crud: subjectDecision.permisos_crud_agregado,
        contexto_territorial: subjectDecision.contexto_territorial,
        politicas_evaluadas: politicas,
        cache_ttl_segundos: subjectDecision.ttl_segundos,
      };
    }

    // Caso 5: Ruta PROTEGIDA — evaluar permisos requeridos y capacidades CRUD
    const matchedRoute = routeResolution.matchedRoute;
    const requiredPerms = matchedRoute?.permisos_requeridos ?? [];
    const evalMode = matchedRoute?.modo_evaluacion_permisos ?? 'ANY';

    let isPermittedByPolicy = false;

    if (requiredPerms.length > 0) {
      const checkSingleReq = (reqPerm: RequiredRoutePermission): boolean => {
        const heldCrud =
          subjectDecision.permisos_por_codigo[reqPerm.codigo_permiso];
        if (!heldCrud) {
          return false;
        }
        return this.satisfiesCrudAction(
          heldCrud,
          reqPerm.accion_crud_requerida,
        );
      };

      if (evalMode === 'ALL') {
        isPermittedByPolicy = requiredPerms.every(checkSingleReq);
      } else {
        isPermittedByPolicy = requiredPerms.some(checkSingleReq);
      }
    } else if (matchedRoute !== null) {
      // Ruta explícitamente catalogada como PROTEGIDA sin permisos atómicos específicos:
      // requiere poseer al menos un rol/permiso en la aplicación y satisfacer el verbo HTTP
      const impliedAction = this.mapHttpMethodToCrudAction(httpMethod);
      isPermittedByPolicy =
        subjectDecision.roles_efectivos.length > 0 &&
        this.satisfiesCrudAction(
          subjectDecision.permisos_crud_agregado,
          impliedAction,
        );
    } else {
      // Ruta no catalogada que cae en politica_ruta_defecto = PROTEGIDA -> Deny by default
      isPermittedByPolicy = false;
      politicas.push('RBAC:RUTA_NO_CATALOGADA_DENEGADA_POR_DEFECTO');
    }

    if (isPermittedByPolicy) {
      return {
        autorizado: true,
        codigo_decision: 'AUTHZ_PERMITTED',
        decision_proyectada: 'AUTHZ_PERMITTED',
        modo_sombra_activo: routeResolution.effectiveShadowMode,
        roles: subjectDecision.roles_efectivos,
        permisos: subjectDecision.permisos_efectivos,
        permisos_crud: subjectDecision.permisos_crud_agregado,
        contexto_territorial: subjectDecision.contexto_territorial,
        politicas_evaluadas: politicas,
        cache_ttl_segundos: subjectDecision.ttl_segundos,
      };
    }

    // Si es denegado por política pero el Modo Sombra está activo (en app o ruta):
    if (routeResolution.effectiveShadowMode) {
      politicas.push('SHADOW_MODE:PERMIT_ON_DENIED_POLICY');
      politicas.push('SHADOW_MODE_OVERRIDE:AUTHZ_DENIED_POLICY');
      return {
        autorizado: true,
        codigo_decision: 'AUTHZ_PERMITTED_SHADOW_MODE',
        decision_proyectada: 'AUTHZ_DENIED_POLICY',
        modo_sombra_activo: true,
        roles: subjectDecision.roles_efectivos,
        permisos: subjectDecision.permisos_efectivos,
        permisos_crud: subjectDecision.permisos_crud_agregado,
        contexto_territorial: subjectDecision.contexto_territorial,
        politicas_evaluadas: politicas,
        cache_ttl_segundos: subjectDecision.ttl_segundos,
        metadatos_depuracion: {
          modo_sombra_activo: true,
          decision_proyectada: 'AUTHZ_DENIED_POLICY',
          reglas_evaluadas: [...politicas],
        },
      };
    }

    return {
      autorizado: false,
      codigo_decision: 'AUTHZ_DENIED_POLICY',
      decision_proyectada: 'AUTHZ_DENIED_POLICY',
      modo_sombra_activo: false,
      roles: subjectDecision.roles_efectivos,
      permisos: subjectDecision.permisos_efectivos,
      permisos_crud: subjectDecision.permisos_crud_agregado,
      contexto_territorial: subjectDecision.contexto_territorial,
      politicas_evaluadas: politicas,
      cache_ttl_segundos: subjectDecision.ttl_segundos,
    };
  }

  /**
   * Evalúa la decisión de ruta a partir de `bundle`, `matchedRoute` y `precomputed`.
   */
  public evaluateRouteDecision(params: {
    bundle: ApplicationPolicyBundle;
    matchedRoute: RouteCatalogEntry | null;
    precomputed: PrecomputedAuthorizationDecision | null;
    httpMethod?: HttpMethodType;
    maxCacheTtlSeconds?: number;
  }): RouteEvaluationOutcome {
    const { bundle, matchedRoute, precomputed } = params;
    const httpMethod =
      params.httpMethod ?? matchedRoute?.metodo_http ?? 'GET';
    const routeResolution: RouteMatchResolution = matchedRoute
      ? {
          normalizedPath: matchedRoute.patron_ruta,
          matchedRoute,
          effectiveAccessLevel: matchedRoute.nivel_acceso,
          effectiveShadowMode: Boolean(
            bundle.modo_sombra || matchedRoute.modo_sombra,
          ),
          policyTraceTag: `RUTA_${matchedRoute.nivel_acceso}:${matchedRoute.patron_ruta}`,
        }
      : {
          normalizedPath: '/',
          matchedRoute: null,
          effectiveAccessLevel: bundle.politica_ruta_defecto,
          effectiveShadowMode: Boolean(bundle.modo_sombra),
          policyTraceTag: `POLITICA_RUTA_DEFECTO:${bundle.politica_ruta_defecto}`,
        };

    const outcome = this.evaluateRouteAccess({
      routeResolution,
      httpMethod,
      subjectDecision: precomputed,
      maxCacheTtlSeconds: params.maxCacheTtlSeconds,
    });

    if (outcome.modo_sombra_activo && !outcome.metadatos_depuracion) {
      return {
        ...outcome,
        metadatos_depuracion: {
          modo_sombra_activo: true,
          decision_proyectada: outcome.decision_proyectada,
          reglas_evaluadas: [...outcome.politicas_evaluadas],
        },
      };
    }

    return outcome;
  }

  private extractAttributeBagFromContext(
    context: IdentityAuthorizationContext,
  ): EvaluationAttributeBag {
    const activeContexts = context.asignaciones_contexto.filter(
      (c) => c.activo,
    );
    const primaryContext: ContextualAssignmentEntry | undefined =
      activeContexts.find((c) => c.es_sede_primaria) ?? activeContexts[0];
    const amiesAsignadosSet = new Set<string>();
    for (const ctx of activeContexts) {
      if (ctx.codigo_amie) {
        amiesAsignadosSet.add(ctx.codigo_amie);
      }
    }
    return {
      tipo_usuario: context.tipo_usuario,
      subtipo_usuario: context.subtipo_usuario,
      cargo_funcion: context.cargo_funcion,
      grado_curso: context.grado_curso,
      nivel_academico_derivado: context.nivel_academico_derivado,
      docente_multisede: context.docente_multisede,
      viceministerio: primaryContext?.viceministerio ?? null,
      nivel_estructura: primaryContext?.nivel_estructura ?? null,
      codigo_zona: primaryContext?.codigo_zona ?? null,
      codigo_distrito: primaryContext?.codigo_distrito ?? null,
      codigo_circuito: primaryContext?.codigo_circuito ?? null,
      codigo_amie: primaryContext?.codigo_amie ?? null,
      amies_asignados: Array.from(amiesAsignadosSet),
      codigo_dependencia_admin:
        primaryContext?.codigo_dependencia_admin ?? null,
      regimen_escolar: primaryContext?.regimen_escolar ?? null,
      modalidad_educativa: primaryContext?.modalidad_educativa ?? null,
      jornada: primaryContext?.jornada ?? null,
      dominio: context.dominio,
      org_unit_path: context.org_unit_path,
    };
  }

  private satisfiesCrudAction(
    crud: CrudPermissions,
    requiredAction: RequiredCrudAction,
  ): boolean {
    switch (requiredAction) {
      case 'CREAR':
        return crud.puede_crear;
      case 'LEER':
        return crud.puede_leer;
      case 'EDITAR':
        return crud.puede_editar;
      case 'ELIMINAR':
        return crud.puede_eliminar;
      case 'CUALQUIERA':
        return (
          crud.puede_crear ||
          crud.puede_leer ||
          crud.puede_editar ||
          crud.puede_eliminar
        );
    }
  }

  private mapHttpMethodToCrudAction(method: HttpMethodType): RequiredCrudAction {
    switch (method) {
      case 'POST':
        return 'CREAR';
      case 'PUT':
      case 'PATCH':
        return 'EDITAR';
      case 'DELETE':
        return 'ELIMINAR';
      case 'GET':
      case 'HEAD':
      case 'OPTIONS':
      case 'ALL':
        return 'LEER';
    }
  }

  private matchesTerritorialScope(
    assignment: DirectRoleOrProfileAssignment,
    activeContexts: ContextualAssignmentEntry[],
    baseTerritorial: TerritorialContext,
  ): boolean {
    const hasScopeConstraint = Boolean(
      assignment.codigo_zona_acotado ||
        assignment.codigo_distrito_acotado ||
        assignment.codigo_circuito_acotado ||
        assignment.codigo_amie_acotado,
    );

    if (!hasScopeConstraint) {
      return true;
    }

    if (activeContexts.length === 0) {
      return false;
    }

    return activeContexts.some((ctx) => {
      if (
        assignment.codigo_zona_acotado &&
        ctx.codigo_zona !== assignment.codigo_zona_acotado
      ) {
        return false;
      }
      if (
        assignment.codigo_distrito_acotado &&
        ctx.codigo_distrito !== assignment.codigo_distrito_acotado
      ) {
        return false;
      }
      if (
        assignment.codigo_circuito_acotado &&
        ctx.codigo_circuito !== assignment.codigo_circuito_acotado
      ) {
        return false;
      }
      if (
        assignment.codigo_amie_acotado &&
        !assignment.codigo_zona_acotado &&
        !assignment.codigo_distrito_acotado &&
        ctx.codigo_amie !== assignment.codigo_amie_acotado &&
        !baseTerritorial.amies_asignados.includes(
          assignment.codigo_amie_acotado,
        )
      ) {
        return false;
      }
      return true;
    });
  }
}
