/**
 * Controlador HTTP `POST /api/v1/oauth/token` (`OAuthTokenController`) — `motor-pdp` (`T029`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, IX y XIV):
 * - Soporta autenticación `Authorization: Basic` y cuerpo `application/x-www-form-urlencoded` / `application/json`.
 * - Aplica encabezados RFC 6749 (`Cache-Control: no-store`, `Pragma: no-cache`).
 */

import { NextFunction, Request, Response } from 'express';
import { IssueM2mTokenUseCase } from '../../../application/use-cases/issue-m2m-token.use-case';
import { PdpUnauthorizedM2mError } from '../../../domain/errors/pdp-domain.errors';
import { OAuthTokenRequestSchema } from '../schemas/pdp-zod.schemas';

function extractBasicAuthCredentials(
  authorizationHeader?: string,
): { clientId: string; clientSecret: string } | null {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) {
    return null;
  }

  const encoded = authorizationHeader.slice('Basic '.length).trim();
  if (!encoded) {
    throw new PdpUnauthorizedM2mError('Encabezado Authorization Basic vacío');
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new PdpUnauthorizedM2mError(
      'Encabezado Authorization Basic mal codificado',
    );
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex <= 0) {
    throw new PdpUnauthorizedM2mError(
      'Formato Authorization Basic inválido (se esperaba client_id:client_secret)',
    );
  }

  const rawClientId = decoded.slice(0, colonIndex);
  const rawClientSecret = decoded.slice(colonIndex + 1);

  return {
    clientId: decodeURIComponent(rawClientId),
    clientSecret: decodeURIComponent(rawClientSecret),
  };
}

export class OAuthTokenController {
  constructor(private readonly issueM2mTokenUseCase: IssueM2mTokenUseCase) {}

  public handleIssueToken = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const parsedBody = OAuthTokenRequestSchema.parse(req.body ?? {});
      const basicAuth = extractBasicAuthCredentials(req.headers.authorization);

      const clientId = basicAuth?.clientId ?? parsedBody.client_id;
      const clientSecret = basicAuth?.clientSecret ?? parsedBody.client_secret;

      const tokenResponse = await this.issueM2mTokenUseCase.execute({
        grantType: parsedBody.grant_type,
        clientId,
        clientSecret,
        scope: parsedBody.scope,
        traceId: req.pdpRequestId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json(tokenResponse);
    } catch (error) {
      next(error);
    }
  };
}
