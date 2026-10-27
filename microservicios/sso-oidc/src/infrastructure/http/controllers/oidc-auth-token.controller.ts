import { NextFunction, Request, Response } from 'express';

import { ExchangeAuthorizationCodeUseCase } from '../../../application/exchange-authorization-code.usecase';
import { HandleGoogleIdpCallbackUseCase } from '../../../application/handle-google-idp-callback.usecase';
import { StartOidcAuthorizationUseCase } from '../../../application/start-oidc-authorization.usecase';
import {
  MetodoAutenticacionTokenOidc,
} from '../../../domain/entities/oidc-broker.entities';
import { OAuthTokenProtocolError } from '../../../domain/services/oidc-security.services';
import { resolveRequestTraceId } from '../middlewares/oidc-error-handler.middleware';
import {
  AuthorizeRequestQuerySchema,
  GoogleCallbackQuerySchema,
  TokenExchangeBodySchema,
} from '../schemas/sso-oidc.schemas';

export const SSO_SESSION_COOKIE_NAME = '__Host-minedec_sso_sid';

export function extractSessionIdFromCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const cookies = cookieHeader.split(';');
  for (const rawCookie of cookies) {
    const [rawName, ...rest] = rawCookie.trim().split('=');
    if (rawName === SSO_SESSION_COOKIE_NAME && rest.length > 0) {
      const value = decodeURIComponent(rest.join('=').trim());
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

export function formatSsoSessionCookieHeader(
  sessionId: string,
  maxAgeSeconds: number,
): string {
  return `${SSO_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function formatClearSsoSessionCookieHeader(): string {
  return `${SSO_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Controlador HTTP para `GET /authorize`, `GET /callback` y `POST /token` (`DA-11`, `FR-001`..`FR-007`).
 */
export class OidcAuthTokenController {
  constructor(
    private readonly startAuthorizationUseCase: StartOidcAuthorizationUseCase,
    private readonly handleCallbackUseCase: HandleGoogleIdpCallbackUseCase,
    private readonly exchangeCodeUseCase: ExchangeAuthorizationCodeUseCase,
    private readonly issuerUrl: string,
  ) {}

  async handleAuthorize(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const parsedQuery = AuthorizeRequestQuerySchema.parse(req.query);
      const existingSessionId = extractSessionIdFromCookieHeader(
        req.headers.cookie,
      );

      const result = await this.startAuthorizationUseCase.execute({
        responseType: parsedQuery.response_type,
        clientId: parsedQuery.client_id,
        redirectUri: parsedQuery.redirect_uri,
        scope: parsedQuery.scope,
        state: parsedQuery.state,
        nonce: parsedQuery.nonce,
        codeChallenge: parsedQuery.code_challenge,
        codeChallengeMethod: parsedQuery.code_challenge_method,
        prompt: parsedQuery.prompt,
        hd: parsedQuery.hd,
        sessionIdFromCookie: existingSessionId,
        traceId,
      });

      if (result.clearSessionCookie) {
        res.setHeader('Set-Cookie', formatClearSsoSessionCookieHeader());
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.redirect(302, result.redirectUrl);
    } catch (error) {
      next(error);
    }
  }

  async handleGoogleCallback(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const parsedQuery = GoogleCallbackQuerySchema.parse(req.query);

      const result = await this.handleCallbackUseCase.execute({
        googleCode: parsedQuery.code,
        googleState: parsedQuery.state,
        googleError: parsedQuery.error,
        googleErrorDescription: parsedQuery.error_description,
        traceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader(
        'Set-Cookie',
        formatSsoSessionCookieHeader(
          result.sessionId,
          result.sessionCookieMaxAgeSeconds,
        ),
      );
      res.redirect(302, result.clientRedirectUrl);
    } catch (error) {
      next(error);
    }
  }

  async handleTokenExchange(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const parsedBody = TokenExchangeBodySchema.parse(req.body);

      const { clientId, clientSecret, authMethodUsed } =
        this.extractClientCredentials(req, parsedBody);

      const tokenResponse = await this.exchangeCodeUseCase.execute({
        grantType: parsedBody.grant_type,
        code: parsedBody.code,
        redirectUri: parsedBody.redirect_uri,
        clientId,
        codeVerifier: parsedBody.code_verifier,
        clientSecret,
        authMethodUsed,
        issuer: this.issuerUrl,
        traceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json(tokenResponse);
    } catch (error) {
      next(error);
    }
  }

  private extractClientCredentials(
    req: Request,
    parsedBody: {
      client_id?: string;
      client_secret?: string;
    },
  ): {
    clientId: string;
    clientSecret?: string;
    authMethodUsed: MetodoAutenticacionTokenOidc;
  } {
    const authHeader = req.headers.authorization;
    if (
      typeof authHeader === 'string' &&
      authHeader.toLowerCase().startsWith('basic ')
    ) {
      const base64Credentials = authHeader.slice(6).trim();
      const decoded = Buffer.from(base64Credentials, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx <= 0) {
        throw new OAuthTokenProtocolError({
          error: 'invalid_client',
          errorDescription:
            'Cabecera Authorization Basic malformada en solicitud /token.',
          statusCode: 401,
        });
      }
      const basicClientId = decodeURIComponent(decoded.slice(0, colonIdx));
      const basicClientSecret = decodeURIComponent(decoded.slice(colonIdx + 1));

      if (
        parsedBody.client_id &&
        parsedBody.client_id.trim() !== basicClientId
      ) {
        throw new OAuthTokenProtocolError({
          error: 'invalid_client',
          errorDescription:
            'El client_id en Authorization Basic no coincide con el client_id del cuerpo.',
          statusCode: 401,
        });
      }

      return {
        clientId: basicClientId,
        clientSecret: basicClientSecret,
        authMethodUsed: 'client_secret_basic',
      };
    }

    if (!parsedBody.client_id || parsedBody.client_id.trim().length === 0) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_request',
        errorDescription:
          'Se requiere client_id en cuerpo o cabecera Authorization Basic.',
        statusCode: 400,
      });
    }

    if (
      parsedBody.client_secret &&
      parsedBody.client_secret.trim().length > 0
    ) {
      return {
        clientId: parsedBody.client_id.trim(),
        clientSecret: parsedBody.client_secret,
        authMethodUsed: 'client_secret_post',
      };
    }

    return {
      clientId: parsedBody.client_id.trim(),
      authMethodUsed: 'none',
    };
  }
}
