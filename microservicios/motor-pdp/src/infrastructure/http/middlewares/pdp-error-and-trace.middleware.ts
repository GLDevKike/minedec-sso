/**
 * Middleware HTTP de Trazabilidad W3C, Cabeceras Nivel A y Manejador Global Fail-Close — `motor-pdp`.
 *
 * Cumplimiento Constitucional (v2.10.0, Principios V.4, XIII y XVI):
 * - Cero cálculo ni exposición de latencia en Node.js (toda medición de latencia delegada a Cloud Trace / Envoy).
 * - Postura Fail-Close estricta (`HTTP 503`) ante indisponibilidad de dependencias críticas.
 * - Cabeceras de seguridad HTTP de nivel A (`HSTS`, `CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { StructuredLogger } from '@minedec/shared';
import { ZodError } from 'zod';
import {
  PdpDomainError,
  PdpFailCloseUnavailableError,
} from '../../../domain/errors/pdp-domain.errors';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    pdpRequestId?: string;
    traceparent?: string;
  }
}

export interface TracedPdpRequest extends Request {
  requestId?: string;
  pdpRequestId?: string;
  traceparent?: string;
}

export function createTraceAndSecurityHeadersMiddleware() {
  return (req: TracedPdpRequest, res: Response, next: NextFunction): void => {
    const incomingRequestId = req.header('X-Minedec-Request-Id')?.trim();
    const requestId =
      incomingRequestId && incomingRequestId.length > 0
        ? incomingRequestId
        : crypto.randomUUID();

    const incomingTraceparent = req.header('traceparent')?.trim();
    const traceparent =
      incomingTraceparent && incomingTraceparent.length > 0
        ? incomingTraceparent
        : `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`;

    req.requestId = requestId;
    req.pdpRequestId = requestId;
    req.traceparent = traceparent;

    res.setHeader('X-Minedec-Request-Id', requestId);
    res.setHeader('traceparent', traceparent);
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    next();
  };
}

export function createFailCloseErrorHandlerMiddleware(
  logger: StructuredLogger,
) {
  return (
    err: unknown,
    req: TracedPdpRequest,
    res: Response,
    _next: NextFunction,
  ): void => {
    const timestamp = new Date().toISOString();
    const traceId = req.requestId ?? crypto.randomUUID();

    if (err instanceof ZodError) {
      const firstIssue = err.issues[0];
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: firstIssue
          ? `${firstIssue.path.join('.') || 'body'}: ${firstIssue.message}`
          : 'Petición mal formada o parámetros inválidos',
        timestamp,
      });
      return;
    }

    if (err instanceof PdpDomainError) {
      logger.warn(
        {
          traceId,
          errorCode: err.errorCode,
          httpStatus: err.httpStatus,
          path: req.originalUrl,
        },
        `Rechazo controlado en motor-pdp: ${err.errorCode} (${err.message})`,
      );

      res.status(err.httpStatus).json({
        error: err.errorCode,
        message: err.message,
        timestamp,
      });
      return;
    }

    const failCloseErr = new PdpFailCloseUnavailableError();
    logger.error(
      {
        traceId,
        error: err instanceof Error ? err.message : String(err),
        path: req.originalUrl,
      },
      'Fallo crítico en motor-pdp — aplicando denegación preventiva Fail-Close (HTTP 503)',
    );

    res.status(failCloseErr.httpStatus).json({
      error: failCloseErr.errorCode,
      message: failCloseErr.message,
      timestamp,
    });
  };
}

export const pdpTraceAndSecurityHeadersMiddleware =
  createTraceAndSecurityHeadersMiddleware();

export const createPdpFailCloseErrorHandler =
  createFailCloseErrorHandlerMiddleware;
