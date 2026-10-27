/**
 * Controlador HTTP de Administración Interna del Ciclo de Vida de Credenciales M2M
 * (`M2mCredentialsController`) — `motor-pdp` (`Feature 005`).
 *
 * Cumplimiento Constitucional (v2.11.0, Principios III, IX, X y XVI):
 * - `POST /internal/v1/pdp/m2m/credentials` (provisión inicial CSPRNG con retorno único de secreto).
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/rotate` (rotación dual `<= 90 días` sin *downtime*).
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/expire-grace` (cierre de ventana de gracia).
 * - `POST /internal/v1/pdp/m2m/credentials/:clientId/revoke` (revocación de emergencia `< 1 h` e invalidación L2 `<= 300 s`).
 */

import { NextFunction, Request, Response } from 'express';
import {
  ExpireM2mCredentialGraceUseCase,
  ProvisionM2mCredentialUseCase,
  RevokeM2mCredentialUseCase,
  RotateM2mCredentialSecretUseCase,
} from '../../../application/use-cases/manage-m2m-credentials.use-case';
import {
  ProvisionM2mCredentialSchema,
  RotateM2mCredentialSchema,
} from '../schemas/pdp-zod.schemas';

export class M2mCredentialsController {
  constructor(
    private readonly provisionUseCase: ProvisionM2mCredentialUseCase,
    private readonly rotateUseCase: RotateM2mCredentialSecretUseCase,
    private readonly expireGraceUseCase: ExpireM2mCredentialGraceUseCase,
    private readonly revokeUseCase: RevokeM2mCredentialUseCase,
  ) {}

  public handleProvisionCredential = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const parsed = ProvisionM2mCredentialSchema.parse(req.body ?? {});
      const result = await this.provisionUseCase.execute({
        client_id: parsed.client_id,
        tipo_cliente: parsed.tipo_cliente,
        aplicacion_id: parsed.aplicacion_id ?? null,
        scopes_permitidos: parsed.scopes_permitidos,
        expires_in_days: parsed.expires_in_days,
        custom_secret: parsed.custom_secret,
        traceId: req.pdpRequestId,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  public handleRotateCredential = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawClientId = Array.isArray(req.params.clientId)
        ? req.params.clientId[0]
        : (req.params.clientId ?? '');
      const parsed = RotateM2mCredentialSchema.parse(req.body ?? {});
      const result = await this.rotateUseCase.execute({
        client_id: rawClientId,
        grace_window_seconds: parsed.grace_window_seconds,
        expires_in_days: parsed.expires_in_days,
        custom_secret: parsed.custom_secret,
        traceId: req.pdpRequestId,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public handleExpireGrace = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawClientId = Array.isArray(req.params.clientId)
        ? req.params.clientId[0]
        : (req.params.clientId ?? '');
      const result = await this.expireGraceUseCase.execute({
        client_id: rawClientId,
        traceId: req.pdpRequestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  public handleRevokeCredential = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawClientId = Array.isArray(req.params.clientId)
        ? req.params.clientId[0]
        : (req.params.clientId ?? '');
      const result = await this.revokeUseCase.execute({
        client_id: rawClientId,
        traceId: req.pdpRequestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}
