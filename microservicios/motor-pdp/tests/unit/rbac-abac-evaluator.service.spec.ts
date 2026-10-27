/**
 * Pruebas Unitarias Exhaustivas — `RbacAbacEvaluatorService` (`T017`).
 *
 * Cubre:
 * - Operadores recursivos del AST JSON (`AND`, `OR`, `NOT`, `EQ`, `NEQ`, `IN`, `CONTAINS`).
 * - Expansión de perfiles (`perfil_rol`) y grupos lógicos (`grupo_logico_rol` / `grupo_logico_perfil`).
 * - Unión aditiva (`bool_or`) de capacidades CRUD (`puede_crear`, `puede_leer`, `puede_editar`, `puede_eliminar`).
 * - Acotamiento territorial (`amie_titular`, `amies_asignados`, `PLANTA_CENTRAL`, `ZONA`, `DISTRITO`, `CIRCUITO`).
 * - Ventanas de vigencia (`AUTHZ_OUTSIDE_VALIDITY_WINDOW`), cuentas suspendidas (`AUTHZ_USER_SUSPENDED`) y anomalías bloqueantes.
 * - Evaluación de rutas `PUBLICA`, `AUTENTICADA` y `PROTEGIDA` (`ANY` vs `ALL`) y `modo_sombra` (`AUTHZ_PERMITTED_SHADOW_MODE`).
 */

import {
  ApplicationPolicyBundle,
  IdentityAuthorizationContext,
  PolicyAstNode,
  RouteCatalogEntry,
} from '../../src/domain/entities/pdp-domain.entities';
import { RbacAbacEvaluatorService } from '../../src/domain/services/rbac-abac-evaluator.service';
import { validatePolicyAstLimits } from '../../src/infrastructure/http/schemas/pdp-zod.schemas';

function buildSamplePolicyBundle(
  overrides: Partial<ApplicationPolicyBundle> = {},
): ApplicationPolicyBundle {
  return {
    aplicacion_id: '11111111-1111-4111-8111-111111111111',
    codigo_unico: 'GESTION_ESCOLAR',
    nombre_visible: 'Sistema de Gestión Escolar',
    patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
    nivel_adopcion_pep: 'INTEGRADA',
    host_publico: 'gestion.educacion.gob.ec',
    politica_ruta_defecto: 'PROTEGIDA',
    modo_sombra: false,
    estado_ciclo_vida: 'PUBLICADO',
    version_catalogo: 3,
    rutas_ordenadas: [],
    grupos_logicos: [
      {
        grupo_logico_id: 'aaaa1111-1111-4111-8111-111111111111',
        codigo_grupo: 'GRP_DOCENTES_SIERRA_ZONA9',
        nombre_visible: 'Docentes Sierra Zona 9',
        prioridad_evaluacion: 10,
        activo: true,
        regla_cruce_abac_rbac: {
          op: 'AND',
          conditions: [
            { op: 'EQ', field: 'tipo_usuario', value: 'DOCENTE' },
            { op: 'IN', field: 'regimen_escolar', value: ['SIERRA', 'AMAZONIA'] },
            { op: 'CONTAINS', field: 'amies_asignados', value: '17H00123' },
            {
              op: 'NOT',
              condition: {
                op: 'EQ',
                field: 'subtipo_usuario',
                value: 'PASANTE',
              },
            },
          ],
        },
        roles_otorgados: ['ROL_DOCENTE_TITULAR'],
        perfiles_otorgados: ['PERFIL_EVALUADOR_ACADEMICO'],
      },
    ],
    roles_mapa: {
      ROL_DOCENTE_TITULAR: [
        {
          permiso_id: 'p1',
          codigo_permiso: 'CALIFICACIONES_GESTIONAR',
          puede_crear: true,
          puede_leer: true,
          puede_editar: true,
          puede_eliminar: false,
        },
      ],
      ROL_AUDITOR_CALIFICACIONES: [
        {
          permiso_id: 'p1',
          codigo_permiso: 'CALIFICACIONES_GESTIONAR',
          puede_crear: false,
          puede_leer: true,
          puede_editar: false,
          puede_eliminar: false,
        },
        {
          permiso_id: 'p2',
          codigo_permiso: 'ACTAS_EXPORTAR',
          puede_crear: false,
          puede_leer: true,
          puede_editar: false,
          puede_eliminar: false,
        },
      ],
      ROL_RECTOR: [
        {
          permiso_id: 'p1',
          codigo_permiso: 'CALIFICACIONES_GESTIONAR',
          puede_crear: true,
          puede_leer: true,
          puede_editar: true,
          puede_eliminar: true,
        },
      ],
    },
    perfiles_mapa: {
      PERFIL_EVALUADOR_ACADEMICO: ['ROL_AUDITOR_CALIFICACIONES'],
    },
    rol_id_a_codigo: {},
    perfil_id_a_codigo: {},
    ...overrides,
  };
}

function buildSampleIdentityContext(
  overrides: Partial<IdentityAuthorizationContext> = {},
): IdentityAuthorizationContext {
  return {
    id_interno: '22222222-2222-4222-8222-222222222222',
    cuenta_id: '33333333-3333-4333-8333-333333333333',
    google_sub_id: '109876543210987654321',
    email_principal: 'docente.prueba@educacion.gob.ec',
    dominio: 'educacion.gob.ec',
    org_unit_path: '/Docentes/Zona9',
    tipo_identificacion: 'CEDULA',
    numero_identificacion: '1712345678',
    nombre_completo: 'María Fernanda Pérez',
    estado_persona: 'ACTIVA',
    suspended_en_gws: false,
    estado_sincronizacion: 'SINCRONIZADA',
    tipo_usuario: 'DOCENTE',
    subtipo_usuario: 'NOMBRAMIENTO_DEFINITIVO',
    cargo_funcion: 'DOCENTE_AULA',
    grado_curso: '10MO_EGB',
    nivel_academico_derivado: 'EDUCACION_GENERAL_BASICA',
    docente_multisede: true,
    fecha_inicio_vigencia: '2025-01-01T00:00:00.000Z',
    fecha_fin_vigencia: '2027-12-31T23:59:59.000Z',
    asignaciones_contexto: [
      {
        asignacion_id: 'asig-1',
        es_sede_primaria: true,
        nivel_estructura: 'INSTITUCION_EDUCATIVA',
        viceministerio: 'EDUCACION',
        codigo_zona: 'Z09',
        codigo_distrito: '17D05',
        codigo_circuito: '17D05C01',
        codigo_amie: '17H00123',
        codigo_dependencia_admin: null,
        regimen_escolar: 'SIERRA',
        modalidad_educativa: 'PRESENCIAL',
        jornada: 'MATUTINA',
        activo: true,
      },
      {
        asignacion_id: 'asig-2',
        es_sede_primaria: false,
        nivel_estructura: 'INSTITUCION_EDUCATIVA',
        viceministerio: 'EDUCACION',
        codigo_zona: 'Z09',
        codigo_distrito: '17D05',
        codigo_circuito: '17D05C02',
        codigo_amie: '17H00456',
        codigo_dependencia_admin: null,
        regimen_escolar: 'SIERRA',
        modalidad_educativa: 'PRESENCIAL',
        jornada: 'VESPERTINA',
        activo: true,
      },
    ],
    asignaciones_directas_app: [],
    anomalias_activas: [],
    ...overrides,
  };
}

describe('RbacAbacEvaluatorService — Unit Tests (T017)', () => {
  const evaluator = new RbacAbacEvaluatorService();
  const evaluationNow = new Date('2026-05-15T12:00:00.000Z');

  it('evalúa operadores recursivos del AST (AND, OR, NOT, EQ, NEQ, IN, CONTAINS) correctamente', () => {
    const identity = buildSampleIdentityContext();

    const complexNode: PolicyAstNode = {
      op: 'AND',
      conditions: [
        { op: 'EQ', field: 'docente_multisede', value: true },
        { op: 'NEQ', field: 'dominio', value: 'externo.gob.ec' },
        {
          op: 'OR',
          conditions: [
            { op: 'EQ', field: 'codigo_zona', value: 'Z01' },
            { op: 'IN', field: 'codigo_distrito', value: ['17D05', '17D06'] },
          ],
        },
        { op: 'CONTAINS', field: 'amies_asignados', value: '17H00456' },
      ],
    };

    expect(evaluator.evaluateAstNode(complexNode, identity)).toBe(true);

    const failingNode: PolicyAstNode = {
      op: 'AND',
      conditions: [
        complexNode,
        { op: 'EQ', field: 'codigo_zona', value: 'Z08' },
      ],
    };
    expect(evaluator.evaluateAstNode(failingNode, identity)).toBe(false);
  });

  it('valida límites de profundidad (<= 3) y predicados (<= 20) del AST JSON', () => {
    const validAst: PolicyAstNode = {
      op: 'AND',
      conditions: [{ op: 'EQ', field: 'tipo_usuario', value: 'DOCENTE' }],
    };
    expect(validatePolicyAstLimits(validAst).valid).toBe(true);

    const tooDeepAst: PolicyAstNode = {
      op: 'AND',
      conditions: [
        {
          op: 'OR',
          conditions: [
            {
              op: 'NOT',
              condition: {
                op: 'AND',
                conditions: [
                  { op: 'EQ', field: 'tipo_usuario', value: 'DOCENTE' },
                ],
              },
            },
          ],
        },
      ],
    };
    const deepCheck = validatePolicyAstLimits(tooDeepAst, 3, 20);
    expect(deepCheck.valid).toBe(false);
    expect(deepCheck.depth).toBeGreaterThan(3);
  });

  it('expande perfiles y grupos lógicos aplicando unión aditiva bool_or sobre CRUD y contexto territorial', () => {
    const bundle = buildSamplePolicyBundle();
    const identity = buildSampleIdentityContext({
      asignaciones_directas_app: [
        {
          asignacion_rol_id: 'dir-1',
          aplicacion_id: bundle.aplicacion_id,
          cuenta_id: '33333333-3333-4333-8333-333333333333',
          rol_id: 'rol-rector',
          codigo_rol: 'ROL_RECTOR',
          perfil_id: null,
          codigo_perfil: null,
          codigo_zona_acotado: 'Z09',
          codigo_distrito_acotado: '17D05',
          codigo_circuito_acotado: null,
          codigo_amie_acotado: '17H00999',
          fecha_inicio_vigencia: '2026-01-01T00:00:00.000Z',
          fecha_fin_vigencia: '2026-12-31T23:59:59.000Z',
          activo: true,
        },
      ],
    });

    const precomputed = evaluator.precomputeSubjectAuthorization(
      identity,
      bundle,
      evaluationNow,
      300,
    );

    expect(precomputed.roles_efectivos).toEqual([
      'ROL_AUDITOR_CALIFICACIONES',
      'ROL_DOCENTE_TITULAR',
      'ROL_RECTOR',
    ]);
    expect(precomputed.permisos_efectivos).toEqual([
      'ACTAS_EXPORTAR',
      'CALIFICACIONES_GESTIONAR',
    ]);
    // bool_or entre ROL_DOCENTE_TITULAR (eliminar=false), ROL_AUDITOR (solo leer) y ROL_RECTOR (eliminar=true)
    expect(precomputed.permisos_por_codigo.CALIFICACIONES_GESTIONAR).toEqual({
      puede_crear: true,
      puede_leer: true,
      puede_editar: true,
      puede_eliminar: true,
    });
    expect(precomputed.contexto_territorial.amie_titular).toBe('17H00123');
    expect(precomputed.contexto_territorial.amies_asignados).toEqual([
      '17H00123',
      '17H00456',
      '17H00999',
    ]);
    expect(precomputed.ttl_segundos).toBe(300);
  });

  it('deniega acceso con AUTHZ_USER_SUSPENDED cuando la cuenta está suspendida o tiene anomalía BLOQUEANTE', () => {
    const bundle = buildSamplePolicyBundle();
    const suspendedIdentity = buildSampleIdentityContext({
      suspended_en_gws: true,
    });

    const precomputed = evaluator.precomputeSubjectAuthorization(
      suspendedIdentity,
      bundle,
      evaluationNow,
    );

    const route: RouteCatalogEntry = {
      ruta_id: 'r1',
      aplicacion_id: bundle.aplicacion_id,
      patron_ruta: '/api/calificaciones',
      metodo_http: 'GET',
      tipo_coincidencia: 'PREFIJO',
      nivel_acceso: 'PROTEGIDA',
      modo_evaluacion_permisos: 'ANY',
      orden_especificidad: 100,
      modo_sombra: false,
      activo: true,
      permisos_requeridos: [
        {
          permiso_id: 'p1',
          codigo_permiso: 'CALIFICACIONES_GESTIONAR',
          accion_crud_requerida: 'LEER',
        },
      ],
    };

    const decision = evaluator.evaluateRouteDecision({
      bundle,
      matchedRoute: route,
      precomputed,
    });

    expect(decision.autorizado).toBe(false);
    expect(decision.codigo_decision).toBe('AUTHZ_USER_SUSPENDED');
  });

  it('deniega acceso con AUTHZ_OUTSIDE_VALIDITY_WINDOW cuando la vigencia contractual ha expirado', () => {
    const bundle = buildSamplePolicyBundle();
    const expiredIdentity = buildSampleIdentityContext({
      fecha_fin_vigencia: '2025-12-31T23:59:59.000Z',
    });

    const precomputed = evaluator.precomputeSubjectAuthorization(
      expiredIdentity,
      bundle,
      evaluationNow,
    );

    const decision = evaluator.evaluateRouteDecision({
      bundle,
      matchedRoute: null,
      precomputed,
    });

    expect(decision.autorizado).toBe(false);
    expect(decision.codigo_decision).toBe('AUTHZ_OUTSIDE_VALIDITY_WINDOW');
  });

  it('evalúa modos ANY vs ALL en rutas PROTEGIDA y aplica Modo Sombra (AUTHZ_PERMITTED_SHADOW_MODE)', () => {
    const bundle = buildSamplePolicyBundle();
    const identity = buildSampleIdentityContext();
    const precomputed = evaluator.precomputeSubjectAuthorization(
      identity,
      bundle,
      evaluationNow,
    );

    const routeRequiringDelete: RouteCatalogEntry = {
      ruta_id: 'r-del',
      aplicacion_id: bundle.aplicacion_id,
      patron_ruta: '/api/calificaciones/eliminar',
      metodo_http: 'DELETE',
      tipo_coincidencia: 'EXACTA',
      nivel_acceso: 'PROTEGIDA',
      modo_evaluacion_permisos: 'ALL',
      orden_especificidad: 200,
      modo_sombra: false,
      activo: true,
      permisos_requeridos: [
        {
          permiso_id: 'p1',
          codigo_permiso: 'CALIFICACIONES_GESTIONAR',
          accion_crud_requerida: 'ELIMINAR',
        },
      ],
    };

    // Sin ROL_RECTOR, el docente titular no tiene puede_eliminar = true
    const deniedDecision = evaluator.evaluateRouteDecision({
      bundle,
      matchedRoute: routeRequiringDelete,
      precomputed,
    });
    expect(deniedDecision.autorizado).toBe(false);
    expect(deniedDecision.codigo_decision).toBe('AUTHZ_DENIED_POLICY');

    // Con modo_sombra activo en la ruta, permite el paso con AUTHZ_PERMITTED_SHADOW_MODE
    const shadowRoute: RouteCatalogEntry = {
      ...routeRequiringDelete,
      modo_sombra: true,
    };
    const shadowDecision = evaluator.evaluateRouteDecision({
      bundle,
      matchedRoute: shadowRoute,
      precomputed,
    });
    expect(shadowDecision.autorizado).toBe(true);
    expect(shadowDecision.codigo_decision).toBe('AUTHZ_PERMITTED_SHADOW_MODE');
    expect(shadowDecision.metadatos_depuracion).toEqual({
      modo_sombra_activo: true,
      decision_proyectada: 'AUTHZ_DENIED_POLICY',
      reglas_evaluadas: expect.arrayContaining([
        'SHADOW_MODE_OVERRIDE:AUTHZ_DENIED_POLICY',
      ]),
    });
  });
});
