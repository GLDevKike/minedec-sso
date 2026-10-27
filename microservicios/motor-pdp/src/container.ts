/**
 * Composition Root de InversifyJS — Motor de Autorización Central (`motor-pdp`) (`T016`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III y XVIII):
 * - Uso de `InversifyJS` (`Container` + `toDynamicValue`) confinado exclusivamente a este Composition Root.
 * - `domain/` y `application/` permanecen 100 % libres de decoradores (`@injectable`, `@inject`).
 */

import 'reflect-metadata';
import { Container } from 'inversify';
import Redis from 'ioredis';
import {
  AuditEventWriter,
  createStructuredLogger,
  PostgresDatabaseClient,
  SqlQueryExecutor,
  StructuredLogger,
  TransactionalAuditEventWriter,
} from '@minedec/shared';
import { EvaluateAccessUseCase } from './application/use-cases/evaluate-access.use-case';
import { IssueM2mTokenUseCase } from './application/use-cases/issue-m2m-token.use-case';
import {
  ExpireM2mCredentialGraceUseCase,
  ProvisionM2mCredentialUseCase,
  RevokeM2mCredentialUseCase,
  RotateM2mCredentialSecretUseCase,
} from './application/use-cases/manage-m2m-credentials.use-case';
import {
  GetPdpJwksUseCase,
  RetirePdpJwksKeyUseCase,
  RevokePdpJwksKeyUseCase,
  RotatePdpJwksKeyUseCase,
} from './application/use-cases/manage-pdp-jwks.use-case';
import {
  IdentityAuthorizationRepositoryPort,
  M2mCredentialRepositoryPort,
  PdpAssertionSignerPort,
  PdpAuditPort,
  PdpJwksKeyRepositoryPort,
  PdpL2CachePort,
  PolicyBundleRepositoryPort,
} from './domain/ports/pdp.ports';
import { RbacAbacEvaluatorService } from './domain/services/rbac-abac-evaluator.service';
import { RouteNormalizerAndMatcherService } from './domain/services/route-normalizer-matcher.service';
import { AlloyDbAndStreamingPdpAuditAdapter } from './infrastructure/audit/pdp-audit.adapter';
import {
  InMemoryPdpRedisStoreDriver,
  IoRedisDriverWrapper,
  IoRedisPdpL2CacheAdapter,
  PdpRedisStoreDriver,
} from './infrastructure/cache/ioredis-pdp-l2-cache.adapter';
import {
  JosePdpAssertionSignerAdapter,
  JosePdpAssertionSignerOptions,
} from './infrastructure/crypto/jose-pdp-assertion-signer.adapter';
import { AlloyDbIdentityAuthorizationRepository } from './infrastructure/database/repositories/alloydb-identity-authorization.repository';
import { AlloyDbM2mCredentialRepository } from './infrastructure/database/repositories/alloydb-m2m-credential.repository';
import { AlloyDbPdpJwksKeyRepository } from './infrastructure/database/repositories/alloydb-pdp-jwks-key.repository';
import { AlloyDbPolicyBundleRepository } from './infrastructure/database/repositories/alloydb-policy-bundle.repository';
import { AccessEvaluationController } from './infrastructure/http/controllers/access-evaluation.controller';
import { M2mCredentialsController } from './infrastructure/http/controllers/m2m-credentials.controller';
import { OAuthTokenController } from './infrastructure/http/controllers/oauth-token.controller';
import { PdpJwksController } from './infrastructure/http/controllers/pdp-jwks.controller';
import {
  MotorPdpEnvConfig,
  MotorPdpEnvSchema,
} from './infrastructure/http/schemas/pdp-zod.schemas';
import { PubSubPdpCacheInvalidationSubscriber } from './infrastructure/messaging/pubsub-pdp-cache-invalidation.subscriber';
import { TYPES } from './types';

export interface MotorPdpContainerOverrides {
  envConfig?: Partial<MotorPdpEnvConfig>;
  db?: SqlQueryExecutor;
  logger?: StructuredLogger;
  auditWriter?: AuditEventWriter;
  redisStoreDriver?: PdpRedisStoreDriver;
  policyBundleRepo?: PolicyBundleRepositoryPort;
  identityRepo?: IdentityAuthorizationRepositoryPort;
  m2mCredentialRepo?: M2mCredentialRepositoryPort;
  pdpJwksRepo?: PdpJwksKeyRepositoryPort;
  l2Cache?: PdpL2CachePort;
  assertionSigner?: PdpAssertionSignerPort;
  assertionSignerOptions?: JosePdpAssertionSignerOptions;
  auditPort?: PdpAuditPort;
}

export function createMotorPdpContainer(
  overrides: MotorPdpContainerOverrides = {},
): Container {
  const container = new Container({ defaultScope: 'Singleton' });

  const parsedEnv = MotorPdpEnvSchema.parse({
    ...process.env,
    ...(overrides.envConfig ?? {}),
  });

  container
    .bind<MotorPdpEnvConfig>(TYPES.EnvConfig)
    .toConstantValue(parsedEnv);

  container
    .bind<StructuredLogger>(TYPES.Logger)
    .toDynamicValue(
      () => overrides.logger ?? createStructuredLogger('motor-pdp'),
    );

  const hasRealDbEnv = Boolean(
    parsedEnv.DATABASE_URL || process.env.DATABASE_URL || process.env.PGHOST,
  );
  const defaultDb: SqlQueryExecutor =
    overrides.db ??
    (hasRealDbEnv
      ? new PostgresDatabaseClient()
      : ({
          query: async () => ({
            rows: [],
            rowCount: 0,
            command: 'SELECT',
            oid: 0,
            fields: [],
          }),
        } as unknown as SqlQueryExecutor));

  container
    .bind<SqlQueryExecutor>(TYPES.SqlQueryExecutor)
    .toConstantValue(defaultDb);

  container
    .bind<AuditEventWriter>(TYPES.AuditEventWriter)
    .toDynamicValue(
      (ctx) =>
        overrides.auditWriter ??
        new TransactionalAuditEventWriter(
          ctx.container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor),
        ),
    );

  // Servicios de Dominio Puros (100 % libres de decoradores)
  container
    .bind<RouteNormalizerAndMatcherService>(
      TYPES.RouteNormalizerAndMatcherService,
    )
    .toDynamicValue(() => new RouteNormalizerAndMatcherService());

  container
    .bind<RbacAbacEvaluatorService>(TYPES.RbacAbacEvaluatorService)
    .toDynamicValue(() => new RbacAbacEvaluatorService());

  // Puertos de Salida (Repositorios y Adaptadores de Infraestructura)
  container
    .bind<PolicyBundleRepositoryPort>(TYPES.PolicyBundleRepositoryPort)
    .toDynamicValue(
      (ctx) =>
        overrides.policyBundleRepo ??
        new AlloyDbPolicyBundleRepository(
          ctx.container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor),
        ),
    );

  container
    .bind<IdentityAuthorizationRepositoryPort>(
      TYPES.IdentityAuthorizationRepositoryPort,
    )
    .toDynamicValue(
      (ctx) =>
        overrides.identityRepo ??
        new AlloyDbIdentityAuthorizationRepository(
          ctx.container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor),
        ),
    );

  container
    .bind<M2mCredentialRepositoryPort>(TYPES.M2mCredentialRepositoryPort)
    .toDynamicValue(
      (ctx) =>
        overrides.m2mCredentialRepo ??
        new AlloyDbM2mCredentialRepository(
          ctx.container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor),
        ),
    );

  container
    .bind<PdpJwksKeyRepositoryPort>(TYPES.PdpJwksKeyRepositoryPort)
    .toDynamicValue(
      (ctx) =>
        overrides.pdpJwksRepo ??
        new AlloyDbPdpJwksKeyRepository(
          ctx.container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor),
        ),
    );

  container
    .bind<PdpL2CachePort>(TYPES.PdpL2CachePort)
    .toDynamicValue((ctx) => {
      if (overrides.l2Cache) {
        return overrides.l2Cache;
      }
      const env = ctx.container.get<MotorPdpEnvConfig>(TYPES.EnvConfig);
      const logger = ctx.container.get<StructuredLogger>(TYPES.Logger);
      const driver: PdpRedisStoreDriver =
        overrides.redisStoreDriver ??
        (env.REDIS_URL
          ? new IoRedisDriverWrapper(
              new Redis(env.REDIS_URL, {
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
                lazyConnect: true,
              }),
            )
          : new InMemoryPdpRedisStoreDriver());
      return new IoRedisPdpL2CacheAdapter(
        driver,
        logger,
        env.CACHE_TTL_MAX_SECONDS,
      );
    });

  container
    .bind<PdpAssertionSignerPort>(TYPES.PdpAssertionSignerPort)
    .toDynamicValue(
      (ctx) =>
        overrides.assertionSigner ??
        new JosePdpAssertionSignerAdapter(
          ctx.container.get<PdpJwksKeyRepositoryPort>(
            TYPES.PdpJwksKeyRepositoryPort,
          ),
          ctx.container.get<MotorPdpEnvConfig>(TYPES.EnvConfig),
          ctx.container.get<StructuredLogger>(TYPES.Logger),
          overrides.assertionSignerOptions ?? {},
        ),
    );

  container
    .bind<PdpAuditPort>(TYPES.PdpAuditPort)
    .toDynamicValue(
      (ctx) =>
        overrides.auditPort ??
        new AlloyDbAndStreamingPdpAuditAdapter(
          ctx.container.get<AuditEventWriter>(TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(TYPES.Logger),
        ),
    );

  // Casos de Uso de Aplicación (100 % libres de decoradores)
  container
    .bind<EvaluateAccessUseCase>(TYPES.EvaluateAccessUseCase)
    .toDynamicValue(
      (ctx) =>
        new EvaluateAccessUseCase(
          ctx.container.get<PolicyBundleRepositoryPort>(
            TYPES.PolicyBundleRepositoryPort,
          ),
          ctx.container.get<IdentityAuthorizationRepositoryPort>(
            TYPES.IdentityAuthorizationRepositoryPort,
          ),
          ctx.container.get<PdpL2CachePort>(TYPES.PdpL2CachePort),
          ctx.container.get<RouteNormalizerAndMatcherService>(
            TYPES.RouteNormalizerAndMatcherService,
          ),
          ctx.container.get<RbacAbacEvaluatorService>(
            TYPES.RbacAbacEvaluatorService,
          ),
          ctx.container.get<PdpAssertionSignerPort>(
            TYPES.PdpAssertionSignerPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
          ctx.container.get<MotorPdpEnvConfig>(TYPES.EnvConfig)
            .CACHE_TTL_MAX_SECONDS,
        ),
    );

  container
    .bind<IssueM2mTokenUseCase>(TYPES.IssueM2mTokenUseCase)
    .toDynamicValue(
      (ctx) =>
        new IssueM2mTokenUseCase(
          ctx.container.get<M2mCredentialRepositoryPort>(
            TYPES.M2mCredentialRepositoryPort,
          ),
          ctx.container.get<PdpAssertionSignerPort>(
            TYPES.PdpAssertionSignerPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<ProvisionM2mCredentialUseCase>(TYPES.ProvisionM2mCredentialUseCase)
    .toDynamicValue(
      (ctx) =>
        new ProvisionM2mCredentialUseCase(
          ctx.container.get<M2mCredentialRepositoryPort>(
            TYPES.M2mCredentialRepositoryPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<RotateM2mCredentialSecretUseCase>(
      TYPES.RotateM2mCredentialSecretUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new RotateM2mCredentialSecretUseCase(
          ctx.container.get<M2mCredentialRepositoryPort>(
            TYPES.M2mCredentialRepositoryPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<ExpireM2mCredentialGraceUseCase>(TYPES.ExpireM2mCredentialGraceUseCase)
    .toDynamicValue(
      (ctx) =>
        new ExpireM2mCredentialGraceUseCase(
          ctx.container.get<M2mCredentialRepositoryPort>(
            TYPES.M2mCredentialRepositoryPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<RevokeM2mCredentialUseCase>(TYPES.RevokeM2mCredentialUseCase)
    .toDynamicValue(
      (ctx) =>
        new RevokeM2mCredentialUseCase(
          ctx.container.get<M2mCredentialRepositoryPort>(
            TYPES.M2mCredentialRepositoryPort,
          ),
          ctx.container.get<PdpL2CachePort>(TYPES.PdpL2CachePort),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<GetPdpJwksUseCase>(TYPES.GetPdpJwksUseCase)
    .toDynamicValue(
      (ctx) =>
        new GetPdpJwksUseCase(
          ctx.container.get<PdpJwksKeyRepositoryPort>(
            TYPES.PdpJwksKeyRepositoryPort,
          ),
        ),
    );

  container
    .bind<RotatePdpJwksKeyUseCase>(TYPES.RotatePdpJwksKeyUseCase)
    .toDynamicValue(
      (ctx) =>
        new RotatePdpJwksKeyUseCase(
          ctx.container.get<PdpAssertionSignerPort>(
            TYPES.PdpAssertionSignerPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<RevokePdpJwksKeyUseCase>(TYPES.RevokePdpJwksKeyUseCase)
    .toDynamicValue(
      (ctx) =>
        new RevokePdpJwksKeyUseCase(
          ctx.container.get<PdpJwksKeyRepositoryPort>(
            TYPES.PdpJwksKeyRepositoryPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  container
    .bind<RetirePdpJwksKeyUseCase>(TYPES.RetirePdpJwksKeyUseCase)
    .toDynamicValue(
      (ctx) =>
        new RetirePdpJwksKeyUseCase(
          ctx.container.get<PdpJwksKeyRepositoryPort>(
            TYPES.PdpJwksKeyRepositoryPort,
          ),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
        ),
    );

  // Controladores HTTP y Suscriptor Pub/Sub
  container
    .bind<AccessEvaluationController>(TYPES.AccessEvaluationController)
    .toDynamicValue(
      (ctx) =>
        new AccessEvaluationController(
          ctx.container.get<EvaluateAccessUseCase>(TYPES.EvaluateAccessUseCase),
        ),
    );

  container
    .bind<OAuthTokenController>(TYPES.OAuthTokenController)
    .toDynamicValue(
      (ctx) =>
        new OAuthTokenController(
          ctx.container.get<IssueM2mTokenUseCase>(TYPES.IssueM2mTokenUseCase),
        ),
    );

  container
    .bind<M2mCredentialsController>(TYPES.M2mCredentialsController)
    .toDynamicValue(
      (ctx) =>
        new M2mCredentialsController(
          ctx.container.get<ProvisionM2mCredentialUseCase>(
            TYPES.ProvisionM2mCredentialUseCase,
          ),
          ctx.container.get<RotateM2mCredentialSecretUseCase>(
            TYPES.RotateM2mCredentialSecretUseCase,
          ),
          ctx.container.get<ExpireM2mCredentialGraceUseCase>(
            TYPES.ExpireM2mCredentialGraceUseCase,
          ),
          ctx.container.get<RevokeM2mCredentialUseCase>(
            TYPES.RevokeM2mCredentialUseCase,
          ),
        ),
    );

  container
    .bind<PdpJwksController>(TYPES.PdpJwksController)
    .toDynamicValue(
      (ctx) =>
        new PdpJwksController(
          ctx.container.get<GetPdpJwksUseCase>(TYPES.GetPdpJwksUseCase),
          ctx.container.get<RotatePdpJwksKeyUseCase>(
            TYPES.RotatePdpJwksKeyUseCase,
          ),
          ctx.container.get<RevokePdpJwksKeyUseCase>(
            TYPES.RevokePdpJwksKeyUseCase,
          ),
          ctx.container.get<RetirePdpJwksKeyUseCase>(
            TYPES.RetirePdpJwksKeyUseCase,
          ),
        ),
    );

  container
    .bind<PubSubPdpCacheInvalidationSubscriber>(
      TYPES.PubSubPdpCacheInvalidationSubscriber,
    )
    .toDynamicValue(
      (ctx) =>
        new PubSubPdpCacheInvalidationSubscriber(
          ctx.container.get<PdpL2CachePort>(TYPES.PdpL2CachePort),
          ctx.container.get<PdpAuditPort>(TYPES.PdpAuditPort),
          ctx.container.get<MotorPdpEnvConfig>(TYPES.EnvConfig),
          ctx.container.get<StructuredLogger>(TYPES.Logger),
        ),
    );

  return container;
}
