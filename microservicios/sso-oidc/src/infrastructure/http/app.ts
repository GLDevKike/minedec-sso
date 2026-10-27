import express, { Express } from 'express';
import helmet from 'helmet';
import { Container } from 'inversify';

import { StructuredLogger } from '@minedec/shared';

import {
  createSsoOidcContainer,
  SSO_OIDC_TYPES,
  SsoOidcContainerOverrides,
} from '../../container';

import { OidcAuthTokenController } from './controllers/oidc-auth-token.controller';
import { OidcDiscoveryJwksController } from './controllers/oidc-discovery-jwks.controller';
import { OidcLogoutRevocationController } from './controllers/oidc-logout-revocation.controller';
import {
  createOidcErrorHandlerMiddleware,
  oidcPathNormalizationGuard,
  resolveRequestTraceId,
} from './middlewares/oidc-error-handler.middleware';

/**
 * Crea la aplicación HTTP Express 5 del Servicio Intermediario OIDC (`sso-oidc`, `DA-11`, `T023`).
 * Configura cabeceras de seguridad Grado A (`helmet`: HSTS, CSP, X-Frame-Options: DENY, nosniff),
 * normalización de rutas y propagación de `traceId` sin cálculo de latencia en Node.js.
 */
export function createSsoOidcApp(
  containerOrOverrides?: Container | SsoOidcContainerOverrides,
): Express {
  const container =
    containerOrOverrides instanceof Container
      ? containerOrOverrides
      : createSsoOidcContainer(containerOrOverrides);

  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(oidcPathNormalizationGuard);
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  const logger = container.get<StructuredLogger>(
    SSO_OIDC_TYPES.StructuredLogger,
  );
  const authTokenController = container.get<OidcAuthTokenController>(
    SSO_OIDC_TYPES.OidcAuthTokenController,
  );
  const logoutRevocationController =
    container.get<OidcLogoutRevocationController>(
      SSO_OIDC_TYPES.OidcLogoutRevocationController,
    );
  const discoveryJwksController = container.get<OidcDiscoveryJwksController>(
    SSO_OIDC_TYPES.OidcDiscoveryJwksController,
  );

  // Healthcheck de GKE Autopilot (cero cálculo de latencia en Node.js)
  app.get('/healthz', (req, res) => {
    const traceId = resolveRequestTraceId(req, res);
    res.status(200).json({
      status: 'UP',
      servicio: 'sso-oidc',
      traceId,
    });
  });

  // Endpoints OIDC públicos detrás de Cloud Load Balancing + Cloud Armor (sin IAP)
  app.get('/.well-known/openid-configuration', (req, res, next) => {
    discoveryJwksController.handleOpenIdConfiguration(req, res, next);
  });

  app.get('/jwks', (req, res, next) => {
    void discoveryJwksController.handleJwks(req, res, next);
  });

  app.get('/authorize', (req, res, next) => {
    void authTokenController.handleAuthorize(req, res, next);
  });

  app.get('/callback', (req, res, next) => {
    void authTokenController.handleGoogleCallback(req, res, next);
  });

  app.post('/token', (req, res, next) => {
    void authTokenController.handleTokenExchange(req, res, next);
  });

  app.get('/logout', (req, res, next) => {
    void logoutRevocationController.handleLogout(req, res, next);
  });

  app.post('/logout', (req, res, next) => {
    void logoutRevocationController.handleLogout(req, res, next);
  });

  // Endpoints operativos internos (Cloud Pub/Sub push y rotación/revocación JWKS)
  app.post('/internal/v1/oidc/events/identity-revoked', (req, res, next) => {
    void logoutRevocationController.handleIdentityRevokedEvent(req, res, next);
  });

  app.post('/internal/v1/oidc/jwks/rotate', (req, res, next) => {
    void discoveryJwksController.handleRotateSigningKey(req, res, next);
  });

  app.post('/internal/v1/oidc/jwks/:kid/revoke', (req, res, next) => {
    void discoveryJwksController.handleRevokeSigningKey(req, res, next);
  });

  app.use(createOidcErrorHandlerMiddleware(logger));

  return app;
}
