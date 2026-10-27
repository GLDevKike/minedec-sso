/**
 * Middleware de Autenticación Bearer M2M (`m2mBearerAuthMiddleware`) — `motor-pdp` (`T024`, `Feature 005`).
 *
 * Cumplimiento Constitucional (v2.11.0, Principios IX, X y XIV):
 * - Verifica firma RS256, `iss`, `aud` y expiración de tokens M2M antes de evaluar `/api/v1/access/evaluation`.
 * - Verifica en tiempo real (`<= 300 s`) que la credencial M2M emisora del token no haya sido revocada
 *   de emergencia (`estado_credencial = 'REVOCADA'` o marca en caché L2 Redis) ni tenga rotación vencida.
 */

import { NextFunction, Request, Response } from 'express';
import { M2mTokenClaims } from '../../../domain/entities/pdp-domain.entities';
import { PdpUnauthorizedM2mError } from '../../../domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAssertionSignerPort,
  PdpL2CachePort,
} from '../../../domain/ports/pdp.ports';

declare module 'express-serve-static-core' {
  interface Request {
    m2mClientClaims?: M2mTokenClaims;
  }
}

export function createM2mBearerAuthMiddleware(
  assertionSigner: PdpAssertionSignerPort,
  m2mCredentialRepo?: M2mCredentialRepositoryPort,
  l2Cache?: PdpL2CachePort,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new PdpUnauthorizedM2mError(
          'Se requiere encabezado Authorization: Bearer <token_m2m>',
        );
      }

      const rawToken = authHeader.slice('Bearer '.length).trim();
      if (!rawToken) {
        throw new PdpUnauthorizedM2mError('Token Bearer M2M vacío');
      }

      const claims = await assertionSigner.verifyM2mAccessToken(rawToken);

      if (l2Cache?.isM2mClientRevoked) {
        const revokedInL2 = await l2Cache.isM2mClientRevoked(claims.client_id);
        if (revokedInL2) {
          throw new PdpUnauthorizedM2mError(
            `Credencial M2M revocada de emergencia (${claims.client_id})`,
          );
        }
      }

      if (m2mCredentialRepo) {
        const credentialRecord = await m2mCredentialRepo.findByClientId(
          claims.client_id,
        );
        if (
          credentialRecord &&
          (credentialRecord.estado_credencial === 'REVOCADA' ||
            credentialRecord.expira_rotacion_en.getTime() <= Date.now())
        ) {
          throw new PdpUnauthorizedM2mError(
            `Credencial M2M inactiva, revocada o con rotación vencida (${claims.client_id})`,
          );
        }
      }

      req.m2mClientClaims = claims;
      next();
    } catch (error) {
      next(error);
    }
  };
}
