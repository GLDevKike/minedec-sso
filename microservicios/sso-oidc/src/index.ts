import { createStructuredLogger } from '@minedec/shared';

import { createSsoOidcApp } from './infrastructure/http/app';

export * from './container';
export * from './domain/entities/oidc-broker.entities';
export * from './domain/ports/oidc-broker.ports';
export * from './domain/services/oidc-security.services';
export * from './application/start-oidc-authorization.usecase';
export * from './application/handle-google-idp-callback.usecase';
export * from './application/exchange-authorization-code.usecase';
export * from './application/execute-single-logout.usecase';
export * from './application/revoke-identity-sessions.usecase';
export * from './application/manage-jwks-keys.usecase';
export * from './infrastructure/http/app';
export * from './infrastructure/http/schemas/sso-oidc.schemas';
export * from './infrastructure/oidc-provider/redis-oidc-store.adapter';
export * from './infrastructure/persistence/alloydb-oidc-client.repository';
export * from './infrastructure/google-idp/google-cloud-identity-rp.adapter';
export * from './infrastructure/pip/pip-identity-resolver.adapter';
export * from './infrastructure/crypto/alloydb-secretmanager-jwks.adapter';
export * from './infrastructure/crypto/http-backchannel-logout.adapter';

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8080);
  const logger = createStructuredLogger('sso-oidc');
  const app = createSsoOidcApp();

  app.listen(port, '0.0.0.0', () => {
    logger.info('Servicio Intermediario OIDC (sso-oidc) escuchando', {
      port,
      issuer:
        process.env.SSO_OIDC_ISSUER_URL ?? 'https://login.sso.educacion.gob.ec',
    });
  });
}
