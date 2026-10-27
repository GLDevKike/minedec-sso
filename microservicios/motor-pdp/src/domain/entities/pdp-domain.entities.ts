/**
 * Entidades y Objetos de Valor del Dominio — Motor de Autorización Central (`motor-pdp`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V, VI y X):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de infraestructura.
 * - Exclusivo para Personas Naturales (`id_interno` UUID + `CEDULA` | `PASAPORTE` | `CODIGO_MINEDEC`).
 * - Cero campos de latencia en Node.js.
 */

export type NaturalPersonIdType = 'CEDULA' | 'PASAPORTE' | 'CODIGO_MINEDEC';

export type DecisionCode =
  | 'AUTHZ_PERMITTED'
  | 'AUTHZ_PUBLIC_ROUTE'
  | 'AUTHZ_AUTHENTICATED_ROUTE'
  | 'AUTHZ_DENIED_POLICY'
  | 'AUTHZ_USER_SUSPENDED'
  | 'AUTHZ_OUTSIDE_VALIDITY_WINDOW'
  | 'AUTHZ_PERMITTED_SHADOW_MODE';

export type HttpMethodType =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'ALL';

export type RouteMatchType = 'EXACTA' | 'PREFIJO' | 'EXTENSION';

export type RouteAccessLevel = 'PUBLICA' | 'AUTENTICADA' | 'PROTEGIDA';

export type PermissionEvaluationMode = 'ANY' | 'ALL';

export type RequiredCrudAction =
  | 'CREAR'
  | 'LEER'
  | 'EDITAR'
  | 'ELIMINAR'
  | 'CUALQUIERA';

export interface CrudPermissions {
  puede_crear: boolean;
  puede_leer: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface TerritorialContext {
  amie_titular: string;
  amies_asignados: string[];
  nivel_jurisdiccion: string;
  codigo_jurisdiccion: string;
  zona: string;
  distrito: string;
  circuito?: string;
  viceministerio?: string;
  codigo_dependencia_admin?: string;
}

export interface DebugShadowMetadata {
  modo_sombra_activo: boolean;
  decision_proyectada: DecisionCode;
  reglas_evaluadas?: string[];
}

export interface AccessDecision {
  autorizado: boolean;
  codigo_decision: DecisionCode;
  numero_identificacion: string;
  tipo_identificacion: NaturalPersonIdType;
  roles: string[];
  permisos: string[];
  permisos_crud: CrudPermissions;
  contexto_territorial: TerritorialContext;
  assertion_jwt: string;
  cabeceras_inyectadas?: Record<string, string>;
  politicas_evaluadas: string[];
  cache_ttl_segundos: number;
  timestamp: string;
  metadatos_depuracion?: DebugShadowMetadata;
}

export type PolicyAstField =
  | 'tipo_usuario'
  | 'subtipo_usuario'
  | 'cargo_funcion'
  | 'grado_curso'
  | 'nivel_academico_derivado'
  | 'docente_multisede'
  | 'viceministerio'
  | 'nivel_estructura'
  | 'codigo_zona'
  | 'codigo_distrito'
  | 'codigo_circuito'
  | 'codigo_amie'
  | 'amies_asignados'
  | 'codigo_dependencia_admin'
  | 'regimen_escolar'
  | 'modalidad_educativa'
  | 'jornada'
  | 'dominio'
  | 'org_unit_path';

export type PolicyAstNode =
  | { op: 'AND' | 'OR'; conditions: PolicyAstNode[] }
  | { op: 'NOT'; condition: PolicyAstNode }
  | {
      op: 'EQ' | 'NEQ' | 'IN' | 'CONTAINS';
      field: PolicyAstField;
      value: string | string[] | boolean;
    };

export interface RequiredRoutePermission {
  permiso_id: string;
  codigo_permiso: string;
  accion_crud_requerida: RequiredCrudAction;
}

export interface RouteCatalogEntry {
  ruta_id: string;
  aplicacion_id: string;
  patron_ruta: string;
  metodo_http: HttpMethodType;
  tipo_coincidencia: RouteMatchType;
  nivel_acceso: RouteAccessLevel;
  modo_evaluacion_permisos: PermissionEvaluationMode;
  orden_especificidad: number;
  modo_sombra: boolean;
  activo: boolean;
  permisos_requeridos: RequiredRoutePermission[];
}

export interface RolePermissionEntry {
  permiso_id: string;
  codigo_permiso: string;
  puede_crear: boolean;
  puede_leer: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface LogicalGroupRule {
  grupo_logico_id: string;
  codigo_grupo: string;
  nombre_visible: string;
  prioridad_evaluacion: number;
  activo: boolean;
  regla_cruce_abac_rbac: PolicyAstNode;
  roles_otorgados: string[];
  perfiles_otorgados: string[];
}

export interface ApplicationPolicyBundle {
  aplicacion_id: string;
  codigo_unico: string;
  nombre_visible: string;
  patron_integracion: 'PATRON_1_SP_RP' | 'PATRON_2_PEP_PERIMETRAL';
  nivel_adopcion_pep: 'PROTEGIDA' | 'INTEGRADA' | 'NATIVA' | null;
  host_publico: string;
  politica_ruta_defecto: RouteAccessLevel;
  modo_sombra: boolean;
  estado_ciclo_vida:
    | 'BORRADOR'
    | 'PUBLICANDO'
    | 'PUBLICADO'
    | 'SUSPENDIDO'
    | 'DESPUBLICADO';
  version_catalogo: number;
  rutas_ordenadas: RouteCatalogEntry[];
  grupos_logicos: LogicalGroupRule[];
  /** Mapa codigo_rol -> lista de permisos con sus capacidades CRUD */
  roles_mapa: Record<string, RolePermissionEntry[]>;
  /** Mapa codigo_perfil -> lista de codigo_rol activos */
  perfiles_mapa: Record<string, string[]>;
  /** Mapa rol_id -> codigo_rol */
  rol_id_a_codigo: Record<string, string>;
  /** Mapa perfil_id -> codigo_perfil */
  perfil_id_a_codigo: Record<string, string>;
}

export interface ContextualAssignmentEntry {
  asignacion_id: string;
  es_sede_primaria: boolean;
  nivel_estructura:
    | 'PLANTA_CENTRAL'
    | 'ZONA'
    | 'DISTRITO'
    | 'CIRCUITO'
    | 'INSTITUCION_EDUCATIVA';
  viceministerio:
    | 'EDUCACION'
    | 'DEPORTE'
    | 'CULTURA'
    | 'GESTION_EDUCATIVA'
    | 'NO_APLICA';
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

export interface DirectRoleOrProfileAssignment {
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
  fecha_inicio_vigencia: string;
  fecha_fin_vigencia: string | null;
  activo: boolean;
}

export interface ActiveIdentityAnomalyEntry {
  anomalia_id: string;
  codigo_causal: string;
  efecto_acceso: 'BLOQUEANTE' | 'RESTRINGIDA';
  estado_anomalia: string;
}

export interface IdentityAuthorizationContext {
  id_interno: string;
  cuenta_id: string;
  google_sub_id: string;
  email_principal: string;
  dominio: string;
  org_unit_path: string;
  tipo_identificacion: NaturalPersonIdType;
  numero_identificacion: string;
  nombre_completo: string;
  estado_persona:
    | 'ACTIVA'
    | 'PENDIENTE_IDENTIFICACION'
    | 'RESTRINGIDA_ANOMALIA'
    | 'BLOQUEADA_ANOMALIA'
    | 'INACTIVA';
  suspended_en_gws: boolean;
  estado_sincronizacion:
    | 'SINCRONIZADA'
    | 'REGISTRO_CALIENTE'
    | 'SUSPENDIDA_GWS'
    | 'VIGENCIA_VENCIDA'
    | 'BLOQUEADA_ANOMALIA';
  tipo_usuario: string | null;
  subtipo_usuario: string | null;
  cargo_funcion: string | null;
  grado_curso: string | null;
  nivel_academico_derivado: string | null;
  docente_multisede: boolean;
  fecha_inicio_vigencia: string | null;
  fecha_fin_vigencia: string | null;
  asignaciones_contexto: ContextualAssignmentEntry[];
  asignaciones_directas_app: DirectRoleOrProfileAssignment[];
  anomalias_activas: ActiveIdentityAnomalyEntry[];
}

export interface PrecomputedAuthorizationDecision {
  id_interno: string;
  cuenta_id: string;
  email_principal: string;
  tipo_identificacion: NaturalPersonIdType;
  numero_identificacion: string;
  estado_persona: IdentityAuthorizationContext['estado_persona'];
  suspended_en_gws: boolean;
  estado_sincronizacion: IdentityAuthorizationContext['estado_sincronizacion'];
  fuera_ventana_vigencia: boolean;
  tiene_anomalia_bloqueante: boolean;
  roles_efectivos: string[];
  permisos_efectivos: string[];
  permisos_por_codigo: Record<string, CrudPermissions>;
  permisos_crud_agregado: CrudPermissions;
  contexto_territorial: TerritorialContext;
  politicas_base_evaluadas: string[];
  ttl_segundos: number;
}

export type M2mClientType = 'APLICACION_PATRON_1' | 'PEP_PATRON_2';

export type M2mCredentialStatus = 'ACTIVA' | 'EN_ROTACION_GRACIA' | 'REVOCADA';

export interface M2mClientCredential {
  credencial_id: string;
  aplicacion_id: string | null;
  tipo_cliente: M2mClientType;
  client_id: string;
  secreto_activo_hash: string;
  secreto_anterior_hash: string | null;
  gracia_hasta: Date | null;
  expira_rotacion_en: Date;
  scopes_permitidos: string;
  estado_credencial: M2mCredentialStatus;
}

export interface M2mTokenClaims {
  sub: string;
  client_id: string;
  tipo_cliente: M2mClientType;
  aplicacion_id: string | null;
  scope: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export type PdpKeyState =
  | 'ACTIVA_FIRMA'
  | 'GRACIA_VERIFICACION'
  | 'RETIRADA'
  | 'REVOCADA';

export interface PublicJwkEntry {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}

export interface PdpSigningKeyRecord {
  kid: string;
  servicio_emisor: 'MOTOR_PDP';
  algoritmo: 'RS256';
  secret_manager_version: string;
  public_jwk_json: PublicJwkEntry;
  estado_llave: PdpKeyState;
  activada_en: Date;
  expira_rotacion_en: Date;
  retirada_en: Date | null;
}
