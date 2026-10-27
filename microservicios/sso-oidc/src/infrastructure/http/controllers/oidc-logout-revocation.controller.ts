import { NextFunction, Request, Response } from 'express';

import { ExecuteSingleLogoutUseCase } from '../../../application/execute-single-logout.usecase';
import { RevokeIdentitySessionsUseCase } from '../../../application/revoke-identity-sessions.usecase';
import { resolveRequestTraceId } from '../middlewares/oidc-error-handler.middleware';
import {
  IdentityRevocationEventPayloadSchema,
  LogoutRequestParamsSchema,
} from '../schemas/sso-oidc.schemas';

import {
  extractSessionIdFromCookieHeader,
  formatClearSsoSessionCookieHeader,
} from './oidc-auth-token.controller';

/**
 * Controlador HTTP para `GET/POST /logout` (SLO) y `POST /internal/v1/oidc/events/identity-revoked` (Cloud Pub/Sub push) (`FR-008`, `US4`).
 */
export class OidcLogoutRevocationController {
  constructor(
    private readonly executeSingleLogoutUseCase: ExecuteSingleLogoutUseCase,
    private readonly revokeIdentitySessionsUseCase: RevokeIdentitySessionsUseCase,
    private readonly issuerUrl: string,
  ) {}

  async handleLogout(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const rawParams =
        req.method === 'POST'
          ? { ...(req.query ?? {}), ...(req.body ?? {}) }
          : req.query;
      const parsedParams = LogoutRequestParamsSchema.parse(rawParams);
      const currentSessionId = extractSessionIdFromCookieHeader(
        req.headers.cookie,
      );

      const result = await this.executeSingleLogoutUseCase.execute({
        idTokenHint: parsedParams.id_token_hint,
        postLogoutRedirectUri: parsedParams.post_logout_redirect_uri,
        clientId: parsedParams.client_id,
        state: parsedParams.state,
        currentSessionId,
        issuer: this.issuerUrl,
        traceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Set-Cookie', formatClearSsoSessionCookieHeader());

      if (result.postLogoutRedirectUrl) {
        res.redirect(302, result.postLogoutRedirectUrl);
        return;
      }

      res.status(200).json({
        status: 'LOGGED_OUT',
        mensajeUsuario:
          'Su sesión institucional central ha sido cerrada de forma segura.',
        destroyedSessionIds: result.destroyedSessionIds,
        backchannelDispatchedCount: result.backchannelDispatchedCount,
        traceId,
      });
    } catch (error) {
      next(error);
    }
  }

  async handleIdentityRevokedEvent(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const rawBody = req.body as Record<string, unknown> | undefined;

      let candidatePayload: unknown = rawBody;
      let pubsubMessageId: string | undefined;

      if (
        rawBody &&
        typeof rawBody.message === 'object' &&
        rawBody.message !== null &&
        typeof (rawBody.message as Record<string, unknown>).data === 'string'
      ) {
        const messageObj = rawBody.message as Record<string, unknown>;
        const decodedJson = Buffer.from(
          String(messageObj.data),
          'base64',
        ).toString('utf8');
        candidatePayload = JSON.parse(decodedJson);
        if (typeof messageObj.messageId === 'string') {
          pubsubMessageId = messageObj.messageId;
        }
      }

      const parsedPayload = IdentityRevocationEventPayloadSchema.parse({
        ...(typeof candidatePayload === 'object' && candidatePayload !== null
          ? candidatePayload
          : {}),
        traceId:
          typeof (candidatePayload as Record<string, unknown>)?.traceId ===
          'string'
            ? (candidatePayload as Record<string, unknown>).traceId
            : traceId,
      });

      const result = await this.revokeIdentitySessionsUseCase.execute({
        idInterno: parsedPayload.idInterno,
        cuentaId: parsedPayload.cuentaId,
        motivoRevocacion: parsedPayload.motivoRevocacion,
        eventoOrigenId: pubsubMessageId,
        issuer: this.issuerUrl,
        traceId: parsedPayload.traceId,
      });

      res.status(200).json({
        status: 'REVOKED',
        purgedSessionIds: result.purgedSessionIds,
        backchannelDispatchedCount: result.backchannelDispatchedCount,
        traceId: parsedPayload.traceId,
      });
    } catch (error) {
      next(error);
    }
  }
}
