/**
 * API Pública del Paquete `@minedec/motor-pdp`.
 */

export * from './types';
export * from './container';
export * from './app';
export * from './main';

export * from './domain/entities/pdp-domain.entities';
export * from './domain/errors/pdp-domain.errors';
export * from './domain/ports/pdp.ports';
export * from './domain/services/rbac-abac-evaluator.service';
export * from './domain/services/route-normalizer-matcher.service';

export * from './application/use-cases/evaluate-access.use-case';
export * from './application/use-cases/issue-m2m-token.use-case';
export * from './application/use-cases/manage-pdp-jwks.use-case';

export * from './infrastructure/audit/pdp-audit.adapter';
export * from './infrastructure/cache/ioredis-pdp-l2-cache.adapter';
export * from './infrastructure/crypto/jose-pdp-assertion-signer.adapter';
export * from './infrastructure/database/repositories/alloydb-identity-authorization.repository';
export * from './infrastructure/database/repositories/alloydb-m2m-credential.repository';
export * from './infrastructure/database/repositories/alloydb-pdp-jwks-key.repository';
export * from './infrastructure/database/repositories/alloydb-policy-bundle.repository';
export * from './infrastructure/http/controllers/access-evaluation.controller';
export * from './infrastructure/http/controllers/oauth-token.controller';
export * from './infrastructure/http/controllers/pdp-jwks.controller';
export * from './infrastructure/http/middlewares/m2m-bearer-auth.middleware';
export * from './infrastructure/http/middlewares/pdp-error-and-trace.middleware';
export * from './infrastructure/http/schemas/pdp-zod.schemas';
export * from './infrastructure/messaging/pubsub-pdp-cache-invalidation.subscriber';
