/**
 * Esquemas de Validación en Tiempo de Ejecución (`zod`) — `motor-pdp`.
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III y XIII):
 * - Validación estricta de esquemas de entrada HTTP, configuración de entorno y AST JSON de políticas.
 */

import { z } from 'zod';
import {
  PolicyAstField,
  PolicyAstNode,
} from '../../../domain/entities/pdp-domain.entities';

export const MotorPdpEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  GCP_PROJECT_ID: z.string().min(1).default('minedec-sso-c22'),
  PDP_ISSUER_URL: z
    .string()
    .url()
    .default('https://pdp.sso.educacion.gob.ec'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  CACHE_TTL_MAX_SECONDS: z.coerce.number().int().min(1).max(300).default(300),
  ASSERTION_JWT_TTL_SECONDS: z.coerce.number().int().min(10).max(60).default(60),
  M2M_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(3600),
  PUBSUB_PDP_SUBSCRIPTION: z
    .string()
    .default('conecta-pdp-cache-invalidation-sub'),
});

export type MotorPdpEnvConfig = z.infer<typeof MotorPdpEnvSchema>;

export const POLICY_AST_FIELDS: readonly [PolicyAstField, ...PolicyAstField[]] =
  [
    'tipo_usuario',
    'subtipo_usuario',
    'cargo_funcion',
    'grado_curso',
    'nivel_academico_derivado',
    'docente_multisede',
    'viceministerio',
    'nivel_estructura',
    'codigo_zona',
    'codigo_distrito',
    'codigo_circuito',
    'codigo_amie',
    'amies_asignados',
    'codigo_dependencia_admin',
    'regimen_escolar',
    'modalidad_educativa',
    'jornada',
    'dominio',
    'org_unit_path',
  ];

const LeafPredicateSchema = z.object({
  op: z.enum(['EQ', 'NEQ', 'IN', 'CONTAINS']),
  field: z.enum(POLICY_AST_FIELDS),
  value: z.union([z.string(), z.array(z.string()), z.boolean()]),
});

export const PolicyAstNodeSchema: z.ZodType<PolicyAstNode> = z.lazy(() =>
  z.union([
    LeafPredicateSchema,
    z.object({
      op: z.enum(['AND', 'OR']),
      conditions: z.array(PolicyAstNodeSchema).min(1).max(20),
    }),
    z.object({
      op: z.literal('NOT'),
      condition: PolicyAstNodeSchema,
    }),
  ]),
);

export function validatePolicyAstLimits(
  node: PolicyAstNode,
  maxDepth = 3,
  maxPredicates = 20,
): { valid: boolean; depth: number; predicates: number; reason?: string } {
  let predicateCount = 0;

  function traverse(current: PolicyAstNode, currentDepth: number): number {
    if ('field' in current) {
      predicateCount += 1;
      return currentDepth;
    }
    if ('condition' in current) {
      return traverse(current.condition, currentDepth + 1);
    }
    let deepest = currentDepth;
    for (const child of current.conditions) {
      const d = traverse(child, currentDepth + 1);
      if (d > deepest) {
        deepest = d;
      }
    }
    return deepest;
  }

  const depth = traverse(node, 0);
  if (depth > maxDepth) {
    return {
      valid: false,
      depth,
      predicates: predicateCount,
      reason: `Profundidad del AST (${depth}) excede el máximo permitido (${maxDepth})`,
    };
  }
  if (predicateCount > maxPredicates) {
    return {
      valid: false,
      depth,
      predicates: predicateCount,
      reason: `Número de predicados (${predicateCount}) excede el máximo permitido (${maxPredicates})`,
    };
  }
  return { valid: true, depth, predicates: predicateCount };
}

export const EvaluationRequestSchema = z
  .object({
    email_autenticado: z
      .string()
      .trim()
      .email('Formato de email_autenticado inválido')
      .nullable()
      .optional(),
    uuid_aplicacion: z
      .string()
      .trim()
      .uuid('Formato de uuid_aplicacion inválido')
      .optional(),
    codigo_aplicacion: z.string().trim().min(1).max(64).optional(),
    host_solicitado: z.string().trim().min(1).max(255).optional(),
    ruta_solicitada: z.string().min(1, 'ruta_solicitada es obligatoria'),
    metodo_http: z.enum([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'HEAD',
    ]),
    atributos_contexto: z
      .object({
        ip_origen: z.string().optional(),
        user_agent: z.string().optional(),
        dispositivo_gestionado: z.boolean().optional(),
        request_id: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.uuid_aplicacion || data.codigo_aplicacion || data.host_solicitado,
      ),
    {
      message:
        'Debe proporcionar al menos uno de: uuid_aplicacion, codigo_aplicacion o host_solicitado',
      path: ['uuid_aplicacion'],
    },
  );

export type EvaluationRequestDto = z.infer<typeof EvaluationRequestSchema>;

export const OAuthTokenRequestSchema = z.object({
  grant_type: z.string().min(1, 'grant_type es obligatorio'),
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  scope: z.string().trim().default('pdp:evaluate'),
});

export type OAuthTokenRequestDto = z.infer<typeof OAuthTokenRequestSchema>;

export const JwksRotateRequestSchema = z.object({
  kid: z.string().trim().min(3).max(64).optional(),
  secret_manager_version: z.string().trim().min(3).max(255).optional(),
});

export type JwksRotateRequestDto = z.infer<typeof JwksRotateRequestSchema>;

export const ProvisionM2mCredentialSchema = z
  .object({
    client_id: z.string().trim().min(3).max(128),
    tipo_cliente: z.enum(['APLICACION_PATRON_1', 'PEP_PATRON_2']),
    aplicacion_id: z.string().trim().uuid().nullable().optional(),
    scopes_permitidos: z.string().trim().min(1).max(255).default('pdp:evaluate'),
    expires_in_days: z.coerce.number().int().min(1).max(90).default(90),
    custom_secret: z.string().trim().min(16).max(256).optional(),
  })
  .refine(
    (data) =>
      (data.tipo_cliente === 'APLICACION_PATRON_1' &&
        Boolean(data.aplicacion_id)) ||
      (data.tipo_cliente === 'PEP_PATRON_2' &&
        (data.aplicacion_id === null || data.aplicacion_id === undefined)),
    {
      message:
        'Invariante ck_m2m_patron_alcance: APLICACION_PATRON_1 requiere aplicacion_id UUID y PEP_PATRON_2 requiere aplicacion_id null',
      path: ['aplicacion_id'],
    },
  );

export type ProvisionM2mCredentialDto = z.infer<
  typeof ProvisionM2mCredentialSchema
>;

export const RotateM2mCredentialSchema = z.object({
  grace_window_seconds: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(86400),
  expires_in_days: z.coerce.number().int().min(1).max(90).default(90),
  custom_secret: z.string().trim().min(16).max(256).optional(),
});

export type RotateM2mCredentialDto = z.infer<typeof RotateM2mCredentialSchema>;
