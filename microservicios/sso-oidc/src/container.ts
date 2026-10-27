import 'reflect-metadata';
import { Container } from 'inversify';

import {
  AuditEventWriter,
  createStructuredLogger,
  KeyValueCacheClient,
  PostgresDatabaseClient,
  RedisCacheClient,
  SqlQueryExecutor,
  StructuredLogger,
  TransactionalAuditEventWriter,
} from '@minedec/shared';

import { ExchangeAuthorizationCodeUseCase } from './application/exchange-authorization-code.usecase';
import { ExecuteSingleLogoutUseCase } from './application/execute-single-logout.usecase';
import { HandleGoogleIdpCallbackUseCase } from './application/handle-google-idp-callback.usecase';
import { ManageJwksKeysUseCase } from './application/manage-jwks-keys.usecase';
import { RevokeIdentitySessionsUseCase } from './application/revoke-identity-sessions.usecase';
import { StartOidcAuthorizationUseCase } from './application/start-oidc-authorization.usecase';
import {
  IBackchannelLogoutDispatcherPort,
  IGoogleIdpFederationPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
  IPipIdentityResolverPort,
  SSO_OIDC_TYPES,
} from './domain/ports/oidc-broker.ports';
import {
  BackchannelLogoutTokenBuilder,
  ConstantTimeClientSecretVerifier,
  ExactRedirectUriValidator,
  MinedecIdTokenClaimsBuilder,
  PkceS256Validator,
} from './domain/services/oidc-security.services';
import {
  AlloyDbAndSecretManagerJwksAdapter,
  AlloyDbAndSecretManagerJwksOptions,
} from './infrastructure/crypto/alloydb-secretmanager-jwks.adapter';
import {
  HttpBackchannelLogoutDispatcherAdapter,
  HttpBackchannelLogoutDispatcherOptions,
} from './infrastructure/crypto/http-backchannel-logout.adapter';
import {
  GoogleCloudIdentityRelyingPartyAdapter,
  GoogleIdpAdapterOptions,
} from './infrastructure/google-idp/google-cloud-identity-rp.adapter';
import { OidcAuthTokenController } from './infrastructure/http/controllers/oidc-auth-token.controller';
import { OidcDiscoveryJwksController } from './infrastructure/http/controllers/oidc-discovery-jwks.controller';
import { OidcLogoutRevocationController } from './infrastructure/http/controllers/oidc-logout-revocation.controller';
import { RedisOidcStoreAdapter } from './infrastructure/oidc-provider/redis-oidc-store.adapter';
import { AlloyDbOidcClientRepository } from './infrastructure/persistence/alloydb-oidc-client.repository';
import {
  PipIdentityResolverAdapter,
  PipIdentityResolverAdapterOptions,
} from './infrastructure/pip/pip-identity-resolver.adapter';

export { SSO_OIDC_TYPES };

export interface SsoOidcContainerOverrides {
  issuerUrl?: string;
  db?: SqlQueryExecutor;
  redis?: KeyValueCacheClient;
  logger?: StructuredLogger;
  auditWriter?: AuditEventWriter;
  clientRepository?: IOidcClientRepositoryPort;
  sessionStore?: IOidcSessionStorePort;
  googleIdpPort?: IGoogleIdpFederationPort;
  googleIdpOptions?: GoogleIdpAdapterOptions;
  pipResolverPort?: IPipIdentityResolverPort;
  pipResolverOptions?: PipIdentityResolverAdapterOptions;
  jwksKeyStore?: IJwksKeyStorePort;
  jwksOptions?: AlloyDbAndSecretManagerJwksOptions;
  backchannelDispatcher?: IBackchannelLogoutDispatcherPort;
  backchannelOptions?: HttpBackchannelLogoutDispatcherOptions;
}

/**
 * Composition Root de InversifyJS para `backend/sso-oidc` (`T016`).
 * Cumple estrictamente con el Principio XVIII de la Constitución v2.10.0:
 * `domain/` y `application/` permanecen 100% libres de decoradores `@injectable()` y `@inject()`,
 * registrando las dependencias mediante `toDynamicValue()` en el Composition Root.
 */
export function createSsoOidcContainer(
  overrides: SsoOidcContainerOverrides = {},
): Container {
  const container = new Container({ defaultScope: 'Singleton' });

  const issuerUrl = (
    overrides.issuerUrl ??
    process.env.SSO_OIDC_ISSUER_URL ??
    'https://login.sso.educacion.gob.ec'
  ).replace(/\/+$/, '');

  const hasRealDbEnv = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
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
    .bind<SqlQueryExecutor>(SSO_OIDC_TYPES.SqlQueryExecutor)
    .toConstantValue(defaultDb);

  container
    .bind<KeyValueCacheClient>(SSO_OIDC_TYPES.RedisClient)
    .toDynamicValue(() => overrides.redis ?? new RedisCacheClient());

  container
    .bind<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger)
    .toDynamicValue(
      () => overrides.logger ?? createStructuredLogger('sso-oidc'),
    );

  container
    .bind<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter)
    .toDynamicValue(
      (ctx) =>
        overrides.auditWriter ??
        new TransactionalAuditEventWriter(
          ctx.container.get<SqlQueryExecutor>(SSO_OIDC_TYPES.SqlQueryExecutor),
        ),
    );

  // Servicios de Dominio (100% libres de decoradores)
  container
    .bind<PkceS256Validator>(SSO_OIDC_TYPES.PkceS256Validator)
    .toDynamicValue(() => new PkceS256Validator());

  container
    .bind<ExactRedirectUriValidator>(SSO_OIDC_TYPES.ExactRedirectUriValidator)
    .toDynamicValue(() => new ExactRedirectUriValidator());

  container
    .bind<ConstantTimeClientSecretVerifier>(
      SSO_OIDC_TYPES.ConstantTimeClientSecretVerifier,
    )
    .toDynamicValue(() => new ConstantTimeClientSecretVerifier());

  container
    .bind<MinedecIdTokenClaimsBuilder>(
      SSO_OIDC_TYPES.MinedecIdTokenClaimsBuilder,
    )
    .toDynamicValue(() => new MinedecIdTokenClaimsBuilder());

  container
    .bind<BackchannelLogoutTokenBuilder>(
      SSO_OIDC_TYPES.BackchannelLogoutTokenBuilder,
    )
    .toDynamicValue(() => new BackchannelLogoutTokenBuilder());

  // Puertos de Infraestructura
  container
    .bind<IOidcClientRepositoryPort>(SSO_OIDC_TYPES.OidcClientRepositoryPort)
    .toDynamicValue(
      (ctx) =>
        overrides.clientRepository ??
        new AlloyDbOidcClientRepository(
          ctx.container.get<SqlQueryExecutor>(SSO_OIDC_TYPES.SqlQueryExecutor),
          ctx.container.get<KeyValueCacheClient>(SSO_OIDC_TYPES.RedisClient),
        ),
    );

  container
    .bind<IOidcSessionStorePort>(SSO_OIDC_TYPES.OidcSessionStorePort)
    .toDynamicValue(
      (ctx) =>
        overrides.sessionStore ??
        new RedisOidcStoreAdapter(
          ctx.container.get<KeyValueCacheClient>(SSO_OIDC_TYPES.RedisClient),
        ),
    );

  container
    .bind<IGoogleIdpFederationPort>(SSO_OIDC_TYPES.GoogleIdpFederationPort)
    .toDynamicValue(
      (ctx) =>
        overrides.googleIdpPort ??
        new GoogleCloudIdentityRelyingPartyAdapter({
          logger: ctx.container.get<StructuredLogger>(
            SSO_OIDC_TYPES.StructuredLogger,
          ),
          ...(overrides.googleIdpOptions ?? {}),
        }),
    );

  container
    .bind<IPipIdentityResolverPort>(SSO_OIDC_TYPES.PipIdentityResolverPort)
    .toDynamicValue(
      (ctx) =>
        overrides.pipResolverPort ??
        new PipIdentityResolverAdapter(
          ctx.container.get<SqlQueryExecutor>(SSO_OIDC_TYPES.SqlQueryExecutor),
          ctx.container.get<KeyValueCacheClient>(SSO_OIDC_TYPES.RedisClient),
          {
            logger: ctx.container.get<StructuredLogger>(
              SSO_OIDC_TYPES.StructuredLogger,
            ),
            ...(overrides.pipResolverOptions ?? {}),
          },
        ),
    );

  container
    .bind<IJwksKeyStorePort>(SSO_OIDC_TYPES.JwksKeyStorePort)
    .toDynamicValue(
      (ctx) =>
        overrides.jwksKeyStore ??
        new AlloyDbAndSecretManagerJwksAdapter(
          ctx.container.get<SqlQueryExecutor>(SSO_OIDC_TYPES.SqlQueryExecutor),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
          overrides.jwksOptions ?? {},
        ),
    );

  container
    .bind<IBackchannelLogoutDispatcherPort>(
      SSO_OIDC_TYPES.BackchannelLogoutDispatcherPort,
    )
    .toDynamicValue(
      (ctx) =>
        overrides.backchannelDispatcher ??
        new HttpBackchannelLogoutDispatcherAdapter(
          ctx.container.get<IJwksKeyStorePort>(SSO_OIDC_TYPES.JwksKeyStorePort),
          ctx.container.get<BackchannelLogoutTokenBuilder>(
            SSO_OIDC_TYPES.BackchannelLogoutTokenBuilder,
          ),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
          overrides.backchannelOptions ?? {},
        ),
    );

  // Casos de Uso de Aplicación (100% libres de decoradores)
  container
    .bind<StartOidcAuthorizationUseCase>(
      SSO_OIDC_TYPES.StartOidcAuthorizationUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new StartOidcAuthorizationUseCase(
          ctx.container.get<IOidcClientRepositoryPort>(
            SSO_OIDC_TYPES.OidcClientRepositoryPort,
          ),
          ctx.container.get<IOidcSessionStorePort>(
            SSO_OIDC_TYPES.OidcSessionStorePort,
          ),
          ctx.container.get<IGoogleIdpFederationPort>(
            SSO_OIDC_TYPES.GoogleIdpFederationPort,
          ),
          ctx.container.get<IPipIdentityResolverPort>(
            SSO_OIDC_TYPES.PipIdentityResolverPort,
          ),
          ctx.container.get<PkceS256Validator>(
            SSO_OIDC_TYPES.PkceS256Validator,
          ),
          ctx.container.get<ExactRedirectUriValidator>(
            SSO_OIDC_TYPES.ExactRedirectUriValidator,
          ),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  container
    .bind<HandleGoogleIdpCallbackUseCase>(
      SSO_OIDC_TYPES.HandleGoogleIdpCallbackUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new HandleGoogleIdpCallbackUseCase(
          ctx.container.get<IOidcClientRepositoryPort>(
            SSO_OIDC_TYPES.OidcClientRepositoryPort,
          ),
          ctx.container.get<IOidcSessionStorePort>(
            SSO_OIDC_TYPES.OidcSessionStorePort,
          ),
          ctx.container.get<IGoogleIdpFederationPort>(
            SSO_OIDC_TYPES.GoogleIdpFederationPort,
          ),
          ctx.container.get<IPipIdentityResolverPort>(
            SSO_OIDC_TYPES.PipIdentityResolverPort,
          ),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  container
    .bind<ExchangeAuthorizationCodeUseCase>(
      SSO_OIDC_TYPES.ExchangeAuthorizationCodeUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new ExchangeAuthorizationCodeUseCase(
          ctx.container.get<IOidcClientRepositoryPort>(
            SSO_OIDC_TYPES.OidcClientRepositoryPort,
          ),
          ctx.container.get<IOidcSessionStorePort>(
            SSO_OIDC_TYPES.OidcSessionStorePort,
          ),
          ctx.container.get<IJwksKeyStorePort>(SSO_OIDC_TYPES.JwksKeyStorePort),
          ctx.container.get<PkceS256Validator>(
            SSO_OIDC_TYPES.PkceS256Validator,
          ),
          ctx.container.get<ConstantTimeClientSecretVerifier>(
            SSO_OIDC_TYPES.ConstantTimeClientSecretVerifier,
          ),
          ctx.container.get<MinedecIdTokenClaimsBuilder>(
            SSO_OIDC_TYPES.MinedecIdTokenClaimsBuilder,
          ),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  container
    .bind<ExecuteSingleLogoutUseCase>(SSO_OIDC_TYPES.ExecuteSingleLogoutUseCase)
    .toDynamicValue(
      (ctx) =>
        new ExecuteSingleLogoutUseCase(
          ctx.container.get<IOidcClientRepositoryPort>(
            SSO_OIDC_TYPES.OidcClientRepositoryPort,
          ),
          ctx.container.get<IOidcSessionStorePort>(
            SSO_OIDC_TYPES.OidcSessionStorePort,
          ),
          ctx.container.get<IJwksKeyStorePort>(SSO_OIDC_TYPES.JwksKeyStorePort),
          ctx.container.get<IBackchannelLogoutDispatcherPort>(
            SSO_OIDC_TYPES.BackchannelLogoutDispatcherPort,
          ),
          ctx.container.get<ExactRedirectUriValidator>(
            SSO_OIDC_TYPES.ExactRedirectUriValidator,
          ),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  container
    .bind<RevokeIdentitySessionsUseCase>(
      SSO_OIDC_TYPES.RevokeIdentitySessionsUseCase,
    )
    .toDynamicValue(
      (ctx) =>
        new RevokeIdentitySessionsUseCase(
          ctx.container.get<IOidcClientRepositoryPort>(
            SSO_OIDC_TYPES.OidcClientRepositoryPort,
          ),
          ctx.container.get<IOidcSessionStorePort>(
            SSO_OIDC_TYPES.OidcSessionStorePort,
          ),
          ctx.container.get<IBackchannelLogoutDispatcherPort>(
            SSO_OIDC_TYPES.BackchannelLogoutDispatcherPort,
          ),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  container
    .bind<ManageJwksKeysUseCase>(SSO_OIDC_TYPES.ManageJwksKeysUseCase)
    .toDynamicValue(
      (ctx) =>
        new ManageJwksKeysUseCase(
          ctx.container.get<IJwksKeyStorePort>(SSO_OIDC_TYPES.JwksKeyStorePort),
          ctx.container.get<AuditEventWriter>(SSO_OIDC_TYPES.AuditEventWriter),
          ctx.container.get<StructuredLogger>(SSO_OIDC_TYPES.StructuredLogger),
        ),
    );

  // Controladores HTTP Express 5
  container
    .bind<OidcAuthTokenController>(SSO_OIDC_TYPES.OidcAuthTokenController)
    .toDynamicValue(
      (ctx) =>
        new OidcAuthTokenController(
          ctx.container.get<StartOidcAuthorizationUseCase>(
            SSO_OIDC_TYPES.StartOidcAuthorizationUseCase,
          ),
          ctx.container.get<HandleGoogleIdpCallbackUseCase>(
            SSO_OIDC_TYPES.HandleGoogleIdpCallbackUseCase,
          ),
          ctx.container.get<ExchangeAuthorizationCodeUseCase>(
            SSO_OIDC_TYPES.ExchangeAuthorizationCodeUseCase,
          ),
          issuerUrl,
        ),
    );

  container
    .bind<OidcLogoutRevocationController>(
      SSO_OIDC_TYPES.OidcLogoutRevocationController,
    )
    .toDynamicValue(
      (ctx) =>
        new OidcLogoutRevocationController(
          ctx.container.get<ExecuteSingleLogoutUseCase>(
            SSO_OIDC_TYPES.ExecuteSingleLogoutUseCase,
          ),
          ctx.container.get<RevokeIdentitySessionsUseCase>(
            SSO_OIDC_TYPES.RevokeIdentitySessionsUseCase,
          ),
          issuerUrl,
        ),
    );

  container
    .bind<OidcDiscoveryJwksController>(
      SSO_OIDC_TYPES.OidcDiscoveryJwksController,
    )
    .toDynamicValue(
      (ctx) =>
        new OidcDiscoveryJwksController(
          ctx.container.get<ManageJwksKeysUseCase>(
            SSO_OIDC_TYPES.ManageJwksKeysUseCase,
          ),
          issuerUrl,
        ),
    );

  return container;
}
