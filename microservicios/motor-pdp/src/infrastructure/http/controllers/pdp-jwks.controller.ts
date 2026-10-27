/**
 * Controlador HTTP de JWKS y Rotación de Llaves RS256 (`PdpJwksController`) — `motor-pdp` (`T041`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III y IX):
 * - `GET /api/v1/.well-known/jwks.json` (`Cache-Control: public, max-age=3600`).
 * - `POST /internal/v1/pdp/jwks/rotate` (rotación periódica <= 90 días con ventana de gracia dual).
 * - `POST /internal/v1/pdp/jwks/:kid/revoke` (revocación de emergencia < 1 h).
 */

import { NextFunction, Request, Response } from 'express';
import {
  GetPdpJwksUseCase,
  RetirePdpJwksKeyUseCase,
  RevokePdpJwksKeyUseCase,
  RotatePdpJwksKeyUseCase,
} from '../../../application/use-cases/manage-pdp-jwks.use-case';
import { JwksRotateRequestSchema } from '../schemas/pdp-zod.schemas';

export class PdpJwksController {
  constructor(
    private readonly getPdpJwksUseCase: GetPdpJwksUseCase,
    private readonly rotatePdpJwksKeyUseCase: RotatePdpJwksKeyUseCase,
    private readonly revokePdpJwksKeyUseCase: RevokePdpJwksKeyUseCase,
    private readonly retirePdpJwksKeyUseCase?: RetirePdpJwksKeyUseCase,
  ) {}

  public handleGetJwks = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const jwks = await this.getPdpJwksUseCase.execute();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).json(jwks);
    } catch (error) {
      next(error);
    }
  };

  public handleRotateKey = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const parsedBody = JwksRotateRequestSchema.parse(req.body ?? {});
      const result = await this.rotatePdpJwksKeyUseCase.execute({
        kid: parsedBody.kid,
        secret_manager_version: parsedBody.secret_manager_version,
        traceId: req.pdpRequestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public handleRevokeKey = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawKid = Array.isArray(req.params.kid)
        ? req.params.kid[0]
        : (req.params.kid ?? '');
      const result = await this.revokePdpJwksKeyUseCase.execute({
        kid: rawKid,
        traceId: req.pdpRequestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public handleRetireKey = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawKid = Array.isArray(req.params.kid)
        ? req.params.kid[0]
        : (req.params.kid ?? '');
      if (!this.retirePdpJwksKeyUseCase) {
        res.status(501).json({ error: 'NOT_IMPLEMENTED' });
        return;
      }
      const result = await this.retirePdpJwksKeyUseCase.execute({
        kid: rawKid,
        traceId: req.pdpRequestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}
