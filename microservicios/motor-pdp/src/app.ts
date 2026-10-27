/**
 * Aplicación HTTP Express 5 — Motor de Autorización Central (`motor-pdp`) (`T016`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V, XIII y XVII):
 * - Express 5 con `helmet`, cabeceras de seguridad Nivel A y trazabilidad W3C.
 * - Sondas de salud Kubernetes (`/health`, `/ready`, `/healthz`).
 * - Degradación `Fail-Close` ante fallos no controlados (`503 AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE`).
 * - Cero cálculo ni exposición de latencia en Node.js.
 */

import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Container } from 'inversify';
import { SqlQueryExecutor, StructuredLogger } from '@minedec/shared';
import {
  createMotorPdpContainer,
  MotorPdpContainerOverrides,
} from './container';
import { PdpFailCloseUnavailableError } from './domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAssertionSignerPort,
  PdpL2CachePort,
} from './domain/ports/pdp.ports';
import { AccessEvaluationController } from './infrastructure/http/controllers/access-evaluation.controller';
import { M2mCredentialsController } from './infrastructure/http/controllers/m2m-credentials.controller';
import { OAuthTokenController } from './infrastructure/http/controllers/oauth-token.controller';
import { PdpJwksController } from './infrastructure/http/controllers/pdp-jwks.controller';
import { createM2mBearerAuthMiddleware } from './infrastructure/http/middlewares/m2m-bearer-auth.middleware';
import {
  createPdpFailCloseErrorHandler,
  pdpTraceAndSecurityHeadersMiddleware,
} from './infrastructure/http/middlewares/pdp-error-and-trace.middleware';
import { PubSubPdpCacheInvalidationSubscriber } from './infrastructure/messaging/pubsub-pdp-cache-invalidation.subscriber';
import { TYPES } from './types';

export function createMotorPdpApp(
  containerOrOverrides?: Container | MotorPdpContainerOverrides,
): Express {
  const container =
    containerOrOverrides instanceof Container
      ? containerOrOverrides
      : createMotorPdpContainer(containerOrOverrides);

  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      noSniff: true,
    }),
  );

  app.use(pdpTraceAndSecurityHeadersMiddleware);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  const logger = container.get<StructuredLogger>(TYPES.Logger);
  const db = container.get<SqlQueryExecutor>(TYPES.SqlQueryExecutor);
  const l2Cache = container.get<PdpL2CachePort>(TYPES.PdpL2CachePort);
  const assertionSigner = container.get<PdpAssertionSignerPort>(
    TYPES.PdpAssertionSignerPort,
  );
  const m2mCredentialRepo = container.get<M2mCredentialRepositoryPort>(
    TYPES.M2mCredentialRepositoryPort,
  );
  const accessEvaluationController = container.get<AccessEvaluationController>(
    TYPES.AccessEvaluationController,
  );
  const oauthTokenController = container.get<OAuthTokenController>(
    TYPES.OAuthTokenController,
  );
  const m2mCredentialsController = container.get<M2mCredentialsController>(
    TYPES.M2mCredentialsController,
  );
  const pdpJwksController = container.get<PdpJwksController>(
    TYPES.PdpJwksController,
  );
  const pubSubSubscriber = container.get<PubSubPdpCacheInvalidationSubscriber>(
    TYPES.PubSubPdpCacheInvalidationSubscriber,
  );

  const m2mAuthMiddleware = createM2mBearerAuthMiddleware(
    assertionSigner,
    m2mCredentialRepo,
    l2Cache,
  );

  // Sondas de Liveness y Readiness para GKE Autopilot
  const handleLiveness = (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'ok',
      service: 'motor-pdp',
    });
  };

  const handleReadiness = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const redisHealthy = await l2Cache.ping();
      if (!redisHealthy) {
        throw new PdpFailCloseUnavailableError(
          'Readiness check fallido: Memorystore for Redis no disponible',
        );
      }
      await db.query('SELECT 1');
      res.status(200).json({
        status: 'ready',
        service: 'motor-pdp',
      });
    } catch (error) {
      next(
        error instanceof PdpFailCloseUnavailableError
          ? error
          : new PdpFailCloseUnavailableError(
              'Readiness check fallido: Dependencias críticas no disponibles',
            ),
      );
    }
  };

  app.get('/health', handleLiveness);
  app.get('/healthz', handleLiveness);
  app.get('/ready', handleReadiness);
  app.get('/readyz', handleReadiness);

  // Endpoints públicos/internos de Autorización Central y OAuth 2.0 M2M
  app.post('/api/v1/oauth/token', oauthTokenController.handleIssueToken);
  app.post(
    '/api/v1/access/evaluation',
    m2mAuthMiddleware,
    accessEvaluationController.handleEvaluateAccess,
  );
  app.get('/api/v1/.well-known/jwks.json', pdpJwksController.handleGetJwks);
  app.get('/api/v1/oauth/jwks', pdpJwksController.handleGetJwks);

  // Endpoints administrativos internos (GKE Internal Service / Cloud Scheduler)
  app.post(
    '/internal/v1/pdp/m2m/credentials',
    m2mCredentialsController.handleProvisionCredential,
  );
  app.post(
    '/internal/v1/pdp/m2m/credentials/:clientId/rotate',
    m2mCredentialsController.handleRotateCredential,
  );
  app.post(
    '/internal/v1/pdp/m2m/credentials/:clientId/expire-grace',
    m2mCredentialsController.handleExpireGrace,
  );
  app.post(
    '/internal/v1/pdp/m2m/credentials/:clientId/revoke',
    m2mCredentialsController.handleRevokeCredential,
  );
  app.post('/internal/v1/pdp/jwks/rotate', pdpJwksController.handleRotateKey);
  app.post(
    '/internal/v1/pdp/jwks/:kid/revoke',
    pdpJwksController.handleRevokeKey,
  );
  app.post(
    '/internal/v1/pdp/jwks/:kid/retire',
    pdpJwksController.handleRetireKey,
  );
  app.post(
    '/internal/v1/pdp/cache/invalidate',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const result = await pubSubSubscriber.handleInvalidationEvent({
          ...(req.body ?? {}),
          trace_id: req.pdpRequestId,
        });
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(createPdpFailCloseErrorHandler(logger));

  return app;
}
