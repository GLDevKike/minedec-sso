import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  buildNaturalLanguageIncidentDiagnostic,
  extractOrCreateOtelSpanContext,
  StructuredLogger,
} from '@minedec/shared';
import {
  OAuthTokenProtocolError,
  OidcSecurityError,
} from '../../../domain/services/oidc-security.services';

/**
 * Extrae o genera el `traceId` W3C / GCP y propaga las cabeceras de correlación sin calcular
 * jamás duraciones por petición en Node.js (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII).
 */
export function resolveRequestTraceId(req: Request, res: Response): string {
  const existing = req.headers['x-trace-id'];
  if (typeof existing === 'string' && existing.trim().length > 0) {
    res.setHeader('X-Trace-Id', existing.trim());
    return existing.trim();
  }

  const traceCtx = extractOrCreateOtelSpanContext(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const traceId = traceCtx.traceId || crypto.randomUUID();
  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('traceparent', traceCtx.traceparent);
  return traceId;
}

/**
 * Guardia perimetral contra secuencias ambiguas o *path traversal* (`%2F`, `%5C`, `..`) (Constitución XIV.3).
 */
export function oidcPathNormalizationGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rawUrl = req.originalUrl || req.url || '';
  const lowerUrl = rawUrl.toLowerCase();
  const pathPart = lowerUrl.split('?')[0] ?? '';

  if (
    pathPart.includes('..') ||
    pathPart.includes('%2f') ||
    pathPart.includes('%5c') ||
    pathPart.includes('\\')
  ) {
    const traceId = resolveRequestTraceId(req, res);
    res.status(400).json({
      codigoError: 'REDIRECT_URI_NO_REGISTRADA',
      mensajeUsuario:
        'La ruta solicitada contiene secuencias ambiguas o no permitidas por la política de seguridad.',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      reintentarPermitido: false,
      traceId,
      diagnosticoAdministrador: {
        queOcurrio: `Se bloqueó una ruta con secuencias de path traversal o barras codificadas: "${pathPart}".`,
        impactoOperativo: 'La solicitud fue rechazada antes de llegar al controlador OIDC.',
        accionRecomendada: 'Utilice rutas canónicas normalizadas sin %2F, %5C ni ..',
      },
    });
    return;
  }

  resolveRequestTraceId(req, res);
  next();
}

/**
 * Middleware centralizado de manejo de errores para `sso-oidc` (`OidcSecurityErrorResponse` / `OAuthTokenErrorResponse`).
 * Cero cálculo de latencia por petición (`Date.now() - startedAt` prohibido).
 */
export function createOidcErrorHandlerMiddleware(logger: StructuredLogger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const traceId = resolveRequestTraceId(req, res);

    if (err instanceof OAuthTokenProtocolError) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      logger.warn('Error de protocolo OAuth 2.0 en endpoint /token', {
        traceId,
        oauthError: err.error,
        errorDescription: err.errorDescription,
        path: req.path,
      });
      res.status(err.statusCode).json({
        error: err.error,
        error_description: err.errorDescription,
        trace_id: traceId,
      });
      return;
    }

    if (err instanceof OidcSecurityError) {
      logger.warn('Rechazo de seguridad OIDC con postura fail-close', {
        traceId,
        codigoError: err.codigoError,
        statusCode: err.statusCode,
        path: req.path,
        diagnosticoAdministrador: err.diagnosticoAdministrador,
      });
      res.status(err.statusCode).json({
        codigoError: err.codigoError,
        mensajeUsuario: err.mensajeUsuario,
        posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
        reintentarPermitido: err.reintentarPermitido,
        traceId,
        diagnosticoAdministrador: err.diagnosticoAdministrador,
      });
      return;
    }

    if (err instanceof ZodError) {
      const issuesSummary = err.issues
        .map((issue) => `${issue.path.join('.') || 'param'}: ${issue.message}`)
        .join('; ');

      if (req.path === '/token') {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.status(400).json({
          error: 'invalid_request',
          error_description: `Parámetros inválidos en solicitud de token: ${issuesSummary}`,
          trace_id: traceId,
        });
        return;
      }

      const isPkceError = err.issues.some((i) =>
        i.path.some((p) => p === 'code_challenge' || p === 'code_challenge_method'),
      );

      res.status(400).json({
        codigoError: isPkceError ? 'PKCE_S256_OBLIGATORIO' : 'CLIENTE_OIDC_NO_AUTORIZADO',
        mensajeUsuario: isPkceError
          ? 'La solicitud de inicio de sesión exige obligatoriamente PKCE con método S256.'
          : `Los parámetros de la solicitud OIDC no cumplen el esquema requerido (${issuesSummary}).`,
        posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
        reintentarPermitido: false,
        traceId,
        diagnosticoAdministrador: {
          queOcurrio: `Fallo de validación Zod en ${req.method} ${req.path}: ${issuesSummary}`,
          impactoOperativo: 'La solicitud fue rechazada preventivamente con postura fail-close.',
          accionRecomendada:
            'Verifique que el cliente OIDC envíe todos los parámetros requeridos según el contrato OpenAPI.',
        },
      });
      return;
    }

    const naturalDiag = buildNaturalLanguageIncidentDiagnostic(err, {
      traceId,
      componentHint: 'ALLOYDB_POSTGRESQL_16',
    });

    logger.error('Fallo inesperado en sso-oidc; aplicando postura fail-close', {
      traceId,
      error: err instanceof Error ? err.message : String(err),
      diagnosticoAdministrador: naturalDiag,
    });

    res.status(503).json({
      codigoError: 'DEPENDENCIA_CRITICA_NO_DISPONIBLE',
      mensajeUsuario:
        'El Servicio de Inicio de Sesión Único no pudo completar la verificación por indisponibilidad temporal de un componente crítico. Por seguridad se ha denegado el acceso (fail-close).',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      reintentarPermitido: true,
      traceId,
      diagnosticoAdministrador: {
        queOcurrio: naturalDiag.explicacionLenguajeNatural,
        impactoOperativo: naturalDiag.impactoOperativoYSeguridad,
        accionRecomendada: naturalDiag.accionesRecomendadasAdministrador.join(' '),
      },
    });
  };
}
