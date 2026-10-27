import { z } from 'zod';

/**
 * Esquemas `zod` de validación estricta en tiempo de ejecución para el Servicio Intermediario OIDC (`sso-oidc`).
 * 100% alineados con `specs/003-sso-oidc-intermediario/contracts/sso-oidc-api.openapi.yaml` (Constitución V y XIV.1).
 */

export const SafeUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (uri) =>
      /^https:\/\/[^\s*]+$/.test(uri) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?(\/[^\s*]*)?$/.test(uri),
    {
      message:
        'La URI debe utilizar HTTPS (o http://localhost en pruebas locales) y no puede contener comodines (*).',
    },
  );

export const AuthorizeRequestQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().trim().min(3).max(128),
  redirect_uri: SafeUriSchema,
  scope: z
    .string()
    .trim()
    .min(6)
    .max(256)
    .refine((val) => val.split(/\s+/).includes('openid'), {
      message: 'El parámetro scope debe incluir obligatoriamente "openid".',
    }),
  state: z.string().trim().min(8).max(512),
  nonce: z.string().trim().min(8).max(512).optional(),
  code_challenge: z.string().trim().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  prompt: z.enum(['none', 'login', 'consent', 'select_account']).optional(),
  hd: z.string().trim().min(3).max(120).optional(),
});

export const GoogleCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).max(2048).optional(),
  state: z.string().trim().min(8).max(512),
  error: z.string().trim().min(1).max(128).optional(),
  error_description: z.string().trim().max(512).optional(),
});

export const TokenExchangeBodySchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().trim().min(16).max(512),
  redirect_uri: SafeUriSchema,
  client_id: z.string().trim().min(3).max(128).optional(),
  client_secret: z.string().min(1).max(512).optional(),
  code_verifier: z
    .string()
    .trim()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9\-._~]{43,128}$/),
});

export const LogoutRequestParamsSchema = z.object({
  id_token_hint: z.string().trim().min(10).max(4096).optional(),
  client_id: z.string().trim().min(3).max(128).optional(),
  post_logout_redirect_uri: SafeUriSchema.optional(),
  state: z.string().trim().min(1).max(512).optional(),
});

export const IdentityRevocationEventPayloadSchema = z
  .object({
    alcanceRevocacion: z.enum(['CUENTA_INSTITUCIONAL', 'PERSONA_IDENTIDAD']),
    cuentaId: z.string().uuid().optional(),
    idInterno: z.string().uuid().optional(),
    motivoRevocacion: z.enum([
      'SUSPENDIDA_GWS',
      'ELIMINADA_GWS',
      'VIGENCIA_VENCIDA',
      'PERSONA_INACTIVA',
      'BLOQUEADA_ANOMALIA',
    ]),
    traceId: z.string().trim().min(1).max(128),
  })
  .refine(
    (payload) =>
      (payload.alcanceRevocacion === 'CUENTA_INSTITUCIONAL' && Boolean(payload.cuentaId)) ||
      (payload.alcanceRevocacion === 'PERSONA_IDENTIDAD' && Boolean(payload.idInterno)),
    {
      message:
        'Se requiere cuentaId cuando alcanceRevocacion=CUENTA_INSTITUCIONAL o idInterno cuando alcanceRevocacion=PERSONA_IDENTIDAD.',
    },
  );

export const PublicRsaJwkSchema = z
  .object({
    kty: z.literal('RSA'),
    use: z.literal('sig'),
    alg: z.literal('RS256'),
    kid: z.string().trim().min(3).max(64),
    n: z.string().trim().min(16),
    e: z.string().trim().min(2),
  })
  .strict();

export const RotateJwksKeyRequestSchema = z
  .object({
    newKid: z.string().trim().min(3).max(64),
    secretManagerVersion: z
      .string()
      .trim()
      .min(10)
      .max(255)
      .regex(/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/),
    publicJwk: PublicRsaJwkSchema,
    retireExpiredGraceKeys: z.boolean().optional().default(true),
  })
  .strict();

export const RevokeJwksKeyRequestSchema = z
  .object({
    targetState: z.enum(['RETIRADA', 'REVOCADA']),
    reason: z.string().trim().min(5).max(512),
  })
  .strict();

/**
 * Esquema estricto (`additionalProperties: false`) del `id_token` emitido por `sso-oidc`.
 * Rechaza cualquier reclamo de roles, permisos o atributos de autorización (`FR-009`, `SC-002`).
 */
export const MinedecIdTokenClaimsSchema = z
  .object({
    iss: z.string().url(),
    sub: z.string().uuid(),
    aud: z.string().trim().min(3).max(128),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
    auth_time: z.number().int().positive().optional(),
    nonce: z.string().trim().min(8).max(512).optional(),
    sid: z.string().trim().min(8).max(128),
    tipo_identificacion: z.enum(['CEDULA', 'PASAPORTE', 'CODIGO_MINEDEC']),
    numero_identificacion: z.string().trim().min(4).max(32),
    nombre_completo: z.string().trim().min(2).max(250),
    email: z.string().email(),
    email_verified: z.literal(true),
    hd: z.string().trim().min(3).max(120),
  })
  .strict();
