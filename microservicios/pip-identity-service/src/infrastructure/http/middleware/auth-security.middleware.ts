import { randomUUID } from 'crypto';
import { NextFunction, Request, Response, RequestHandler, ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import {
  buildNaturalLanguageIncidentDiagnostic,
  createStructuredLogger,
  extractOrCreateOtelSpanContext,
  isInfrastructureOutageError,
  OtelSpanContext,
} from '@minedec/shared';
import { DomainRuleError } from '../../../domain/entities/identity-entities';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
      otelContext?: OtelSpanContext;
      actorIdentificacion?: string;
    }
  }
}

const errorLogger = createStructuredLogger('pip-http-error-handler');

export function createSecurityHeadersMiddleware(): RequestHandler[] {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
  });

  const explicitHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
    next();
  };

  return [helmetMiddleware, explicitHeaders];
}

/**
 * Rechaza rutas ambiguas (%2F, %5C, ..) conforme a la Constitución v2.8.0 (Principio XIII).
 */
export const rejectAmbiguousPathsMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const rawUrl = req.originalUrl || req.url || '';
  const traceId = req.traceId ?? randomUUID();

  if (
    /%2f/i.test(rawUrl) ||
    /%5c/i.test(rawUrl) ||
    rawUrl.includes('..') ||
    rawUrl.includes('\\')
  ) {
    res.status(400).json({
      code: 'AMBIGUOUS_PATH_REJECTED',
      message:
        'Ruta rechazada por contener secuencias ambiguas o de recorrido de directorios (%2F, %5C o ..).',
      traceId,
    });
    return;
  }

  next();
};

/**
 * Middleware de propagación de contexto distribuido OpenTelemetry (W3C `traceparent` + GCP `X-Cloud-Trace-Context`).
 */
export const traceContextMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
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

  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('X-Span-Id', otelContext.spanId);
  res.setHeader('traceparent', otelContext.traceparent);
  next();
};

export interface AuthMiddlewareOptions {
  enforceBearerOrIap?: boolean;
}

/**
 * Valida token OIDC interno de cuenta de servicio GCP o aserción Cloud IAP.
 */
export function createInternalOrIapAuthMiddleware(
  options: AuthMiddlewareOptions = {},
): RequestHandler {
  const enforce =
    options.enforceBearerOrIap ?? process.env.PIP_ENFORCE_AUTH === 'true';

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const iapAssertion = req.headers['x-goog-iap-jwt-assertion'] as string | undefined;
    const actorHeader = req.headers['x-actor-identificacion'] as string | undefined;

    if (enforce && !authHeader?.startsWith('Bearer ') && !iapAssertion) {
      res.status(401).json({
        code: 'UNAUTHORIZED_INTERNAL_CALL',
        message:
          'Se requiere un token OIDC Bearer de cuenta de servicio interna o aserción Cloud IAP válida.',
        traceId: req.traceId ?? randomUUID(),
      });
      return;
    }

    req.actorIdentificacion =
      actorHeader?.trim() ||
      (iapAssertion ? 'IAP_AUTHENTICATED_ADMIN' : 'INTERNAL_SERVICE_ACCOUNT');
    next();
  };
}

export const pipErrorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const traceId = req.traceId ?? randomUUID();
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

  if (err instanceof DomainRuleError) {
    res.status(err.statusCode).json({
      code: err.errorCode,
      message: err.message,
      traceId,
    });
    return;
  }

  const diagnostic = buildNaturalLanguageIncidentDiagnostic(err, { traceId });

  errorLogger.error(diagnostic.tituloLenguajeNatural, {
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
    err instanceof Error ? err.message : 'Error interno inesperado en el PIP.';
  res.status(500).json({
    code: 'INTERNAL_PIP_ERROR',
    posturaSeguridad: diagnostic.posturaSeguridad,
    message: errorMessage,
    diagnosticoAdministrador: diagnostic,
    traceId,
  });
};
