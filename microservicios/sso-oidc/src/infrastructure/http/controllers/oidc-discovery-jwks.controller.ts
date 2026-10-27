import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { ManageJwksKeysUseCase } from '../../../application/manage-jwks-keys.usecase';
import { resolveRequestTraceId } from '../middlewares/oidc-error-handler.middleware';
import {
  RevokeJwksKeyRequestSchema,
  RotateJwksKeyRequestSchema,
} from '../schemas/sso-oidc.schemas';

const KidParamSchema = z.object({
  kid: z.string().trim().min(3).max(64),
});

/**
 * Controlador HTTP para `GET /.well-known/openid-configuration`, `GET /jwks` y endpoints internos
 * de rotación y revocación de emergencia de llaves JWKS `RS256` (`FR-009`, `US5`).
 */
export class OidcDiscoveryJwksController {
  constructor(
    private readonly manageJwksKeysUseCase: ManageJwksKeysUseCase,
    private readonly issuerUrl: string,
  ) {}

  handleOpenIdConfiguration(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    try {
      resolveRequestTraceId(req, res);
      const doc = this.manageJwksKeysUseCase.getOpenIdConfiguration(
        this.issuerUrl,
      );
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).json(doc);
    } catch (error) {
      next(error);
    }
  }

  async handleJwks(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      resolveRequestTraceId(req, res);
      const jwks = await this.manageJwksKeysUseCase.getPublicJwks();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).json(jwks);
    } catch (error) {
      next(error);
    }
  }

  async handleRotateSigningKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const parsedBody = RotateJwksKeyRequestSchema.parse(req.body);

      const result = await this.manageJwksKeysUseCase.rotateSigningKey({
        newKid: parsedBody.newKid,
        secretManagerVersion: parsedBody.secretManagerVersion,
        publicJwk: parsedBody.publicJwk,
        retireExpiredGraceKeys: parsedBody.retireExpiredGraceKeys,
        traceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        status: 'ROTATED',
        servicioEmisor: 'SSO_OIDC',
        activeKid: result.activeKid,
        publishedKids: result.publishedKids,
        traceId,
      });
    } catch (error) {
      next(error);
    }
  }

  async handleRevokeSigningKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const traceId = resolveRequestTraceId(req, res);
      const { kid } = KidParamSchema.parse(req.params);
      const parsedBody = RevokeJwksKeyRequestSchema.parse(req.body);

      const result = await this.manageJwksKeysUseCase.revokeOrRetireSigningKey({
        kid,
        targetState: parsedBody.targetState,
        reason: parsedBody.reason,
        traceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        status: parsedBody.targetState,
        servicioEmisor: 'SSO_OIDC',
        kid,
        activeKid: result.activeKid,
        publishedKids: result.publishedKids,
        traceId,
      });
    } catch (error) {
      next(error);
    }
  }
}
