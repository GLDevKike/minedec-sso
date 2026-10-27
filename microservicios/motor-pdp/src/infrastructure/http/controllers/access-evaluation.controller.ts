/**
 * Controlador HTTP `POST /api/v1/access/evaluation` (`AccessEvaluationController`) — `motor-pdp` (`T024`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V y XIII):
 * - Valida el esquema de petición con `zod` (`EvaluationRequestSchema`).
 * - Invoca `EvaluateAccessUseCase` con claims M2M autenticados.
 * - Devuelve `200 OK` para decisiones de negocio tanto permitidas (`autorizado: true`) como denegadas (`autorizado: false`).
 * - Cero campos de latencia en el cuerpo de respuesta.
 */

import { NextFunction, Request, Response } from 'express';
import { EvaluateAccessUseCase } from '../../../application/use-cases/evaluate-access.use-case';
import { PdpUnauthorizedM2mError } from '../../../domain/errors/pdp-domain.errors';
import { EvaluationRequestSchema } from '../schemas/pdp-zod.schemas';

export class AccessEvaluationController {
  constructor(private readonly evaluateAccessUseCase: EvaluateAccessUseCase) {}

  public handleEvaluateAccess = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const m2mClaims = req.m2mClientClaims;
      if (!m2mClaims) {
        throw new PdpUnauthorizedM2mError(
          'Contexto de autenticación M2M no disponible',
        );
      }

      const validatedBody = EvaluationRequestSchema.parse(req.body ?? {});

      const decision = await this.evaluateAccessUseCase.execute({
        email_autenticado: validatedBody.email_autenticado,
        uuid_aplicacion: validatedBody.uuid_aplicacion,
        codigo_aplicacion: validatedBody.codigo_aplicacion,
        host_solicitado: validatedBody.host_solicitado,
        ruta_solicitada: validatedBody.ruta_solicitada,
        metodo_http: validatedBody.metodo_http,
        atributos_contexto: validatedBody.atributos_contexto,
        m2mClientClaims: m2mClaims,
        traceId: req.pdpRequestId,
      });

      res.status(200).json(decision);
    } catch (error) {
      next(error);
    }
  };
}
