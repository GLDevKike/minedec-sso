import crypto from 'node:crypto';
import express, { ErrorRequestHandler, Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Container } from 'inversify';
import { ZodError } from 'zod';
import {
  buildNaturalLanguageIncidentDiagnostic,
  createStructuredLogger,
  extractOrCreateOtelSpanContext,
  isInfrastructureOutageError,
  OtelSpanContext,
  StructuredLogger,
} from '@minedec/shared';
import {
  createSincronizadorContainer,
  SincronizadorContainerOverrides,
  SINCRONIZADOR_TYPES,
} from '../../container';
import { AdminSyncController } from './controllers/admin-sync.controller';
import { InternalSyncController } from './controllers/internal-sync.controller';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
      otelContext?: OtelSpanContext;
    }
  }
}

export interface CreateSincronizadorAppOptions {
  requireServiceAuth?: boolean;
  expectedBearerToken?: string;
  logger?: StructuredLogger;
}

const defaultSyncErrorLogger = createStructuredLogger('conecta-sincronizador');

/**
 * Middleware centralizado de manejo de errores para `backend/sincronizador` (`T085`).
 * Registra el incidente en `pino` con `traceId`, `spanId`, `httpMethod`, `httpPath`
 * y diagnóstico en lenguaje natural (`diagnosticoAdministrador`).
 */
export function createSyncErrorHandler(
  logger: StructuredLogger = defaultSyncErrorLogger,
): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const traceId =
      req.traceId ?? String(req.headers['x-trace-id'] ?? crypto.randomUUID());
    const spanId = req.spanId;

    if (err instanceof ZodError) {
      const details = err.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `Error de validación de esquema: ${details}`,
        traceId,
      });
      return;
    }

    const diagnostic = buildNaturalLanguageIncidentDiagnostic(err, { traceId });

    logger.error(diagnostic.tituloLenguajeNatural, {
      traceId,
      spanId,
      httpMethod: req.method,
      httpPath: req.originalUrl || req.url,
      error: err,
      diagnosticoAdministrador: diagnostic,
    });

    if (isInfrastructureOutageError(err)) {
      res.status(503).json({
        code: diagnostic.codigoIncidente,
        posturaSeguridad: diagnostic.posturaSeguridad,
        message: `${diagnostic.tituloLenguajeNatural}: ${diagnostic.explicacionLenguajeNatural}`,
        diagnosticoAdministrador: diagnostic,
        traceId,
      });
      return;
    }

    const errorMessage =
      err instanceof Error ? err.message : 'Error interno inesperado en el Sincronizador.';
    res.status(500).json({
      code: 'INTERNAL_SYNC_ERROR',
      posturaSeguridad: diagnostic.posturaSeguridad,
      message: errorMessage,
      diagnosticoAdministrador: diagnostic,
      traceId,
    });
  };
}

export const syncErrorHandler: ErrorRequestHandler = createSyncErrorHandler();

function isInversifyContainer(
  input: Container | SincronizadorContainerOverrides,
): input is Container {
  return Boolean(input && typeof (input as Container).get === 'function');
}

/**
 * Construye la aplicación HTTP Express 5 (`app.ts`) del servicio `backend/sincronizador`
 * con cabeceras de seguridad (`helmet`), correlación OpenTelemetry W3C (`traceparent`,
 * `X-Cloud-Trace-Context`, `X-Trace-Id`, `X-Span-Id`), normalización de rutas
 * (rechazando `%2F` y `..`), verificación de token OIDC de `sa-sync` y `syncErrorHandler` (`T029`, `T037`, `T084`, `T085`).
 */
export function createSincronizadorHttpApp(
  containerOrOverrides: Container | SincronizadorContainerOverrides = {},
  options: CreateSincronizadorAppOptions = {},
): Express {
  const container = isInversifyContainer(containerOrOverrides)
    ? containerOrOverrides
    : createSincronizadorContainer(containerOrOverrides);

  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  // Normalización y rechazo de rutas ambiguas (%2F, ..) - Constitución XIV + Propagación W3C Trace Context (T084)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const rawUrl = req.originalUrl || req.url;
    if (/%2f/i.test(rawUrl) || /%5c/i.test(rawUrl) || rawUrl.includes('..') || rawUrl.includes('\\')) {
      res.status(400).json({
        code: 'AMBIGUOUS_PATH_REJECTED',
        message: 'Ruta rechazada por contener secuencias ambiguas (%2F o ..).',
      });
      return;
    }

    const otelContext = extractOrCreateOtelSpanContext(
      req.headers as Record<string, string | string[] | undefined>,
    );
    const explicitTraceHeader = (req.headers['x-trace-id'] as string | undefined)?.trim();
    const traceId =
      explicitTraceHeader && explicitTraceHeader.length > 0
        ? explicitTraceHeader
        : otelContext.traceId;

    req.traceId = traceId;
    req.spanId = otelContext.spanId;
    req.otelContext = otelContext;
    req.headers['x-trace-id'] = traceId;
    req.headers['traceparent'] = otelContext.traceparent;
    req.headers['x-cloud-trace-context'] = otelContext.cloudTraceContext;

    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('X-Span-Id', otelContext.spanId);
    res.setHeader('traceparent', otelContext.traceparent);
    next();
  });

  // Verificación opcional de token OIDC de cuenta de servicio (sa-sync)
  if (options.requireServiceAuth) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/internal/v1/sync/health/detailed') {
        next();
        return;
      }
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          code: 'UNAUTHORIZED_SERVICE_CALL',
          message: 'Se requiere token OIDC Bearer válido de sa-sync o sesión IAP.',
        });
        return;
      }
      const token = authHeader.slice('Bearer '.length).trim();
      if (options.expectedBearerToken && token !== options.expectedBearerToken) {
        res.status(403).json({
          code: 'FORBIDDEN_SERVICE_CALL',
          message: 'Token de servicio no autorizado para invocar el Sincronizador.',
        });
        return;
      }
      next();
    });
  }

  const internalController = container.get<InternalSyncController>(
    SINCRONIZADOR_TYPES.InternalSyncController,
  );
  const adminController = container.get<AdminSyncController>(
    SINCRONIZADOR_TYPES.AdminSyncController,
  );

  // Endpoints internos (Cloud Pub/Sub Push, Cloud Tasks, Cloud Scheduler, Observabilidad)
  app.post(
    ['/internal/v1/sync/events/pubsub-push', '/internal/v1/sync/events/pubsub'],
    internalController.handlePubSubPush,
  );
  app.post(
    ['/internal/v1/sync/tasks/incremental', '/internal/v1/sync/incremental'],
    internalController.handleIncrementalTask,
  );
  app.post(
    ['/internal/v1/sync/tasks/delta-sweep', '/internal/v1/sync/delta-sweep'],
    internalController.handleDeltaSweepTask,
  );
  app.post(
    [
      '/internal/v1/sync/tasks/priority-hot-registration',
      '/internal/v1/sync/hot-registration/reconcile',
    ],
    internalController.handlePriorityHotRegistrationTask,
  );
  app.get(
    '/internal/v1/sync/health/detailed',
    internalController.handleDetailedHealth,
  );

  // Endpoints administrativos PAP (Baja en dos niveles, Checkpoints, DLQ)
  app.post(
    '/api/v1/admin/sync/persons/:idInterno/deactivate',
    adminController.handleDeactivatePerson,
  );
  app.get(
    '/api/v1/admin/sync/checkpoints',
    adminController.handleListCheckpoints,
  );
  app.post(
    '/api/v1/admin/sync/partitions/trigger',
    adminController.handleTriggerPartition,
  );
  app.get('/api/v1/admin/sync/dlq', adminController.handleListDlq);
  app.post('/api/v1/admin/sync/dlq/replay', adminController.handleReplayDlq);

  app.use(
    options.logger ? createSyncErrorHandler(options.logger) : syncErrorHandler,
  );

  return app;
}

export const createSincronizadorApp = createSincronizadorHttpApp;
