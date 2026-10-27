/**
 * Caso de Uso: Emisión de Tokens OAuth 2.0 `client_credentials` M2M (`IssueM2mTokenUseCase`) — `motor-pdp` (`T028`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, IX y XIV):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de frameworks de infraestructura.
 * - Comparación en tiempo constante (`crypto.timingSafeEqual`) sobre hashes SHA-256.
 * - Ventana de gracia dual (`secreto_activo_hash` + `secreto_anterior_hash` con `gracia_hasta > NOW()`).
 * - Auditoría transaccional (`PDP_TOKEN_M2M_EMITIDO` / `PDP_TOKEN_M2M_RECHAZADO`) con Zero-Secret.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  PdpInvalidSchemaError,
  PdpUnauthorizedM2mError,
} from '../../domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAssertionSignerPort,
  PdpAuditPort,
} from '../../domain/ports/pdp.ports';

export interface IssueM2mTokenCommand {
  grantType: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  traceId?: string;
  now?: Date;
}

export interface IssueM2mTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function constantTimeHexEquals(hashA: string, hashB: string): boolean {
  const cleanA = hashA.trim().toLowerCase();
  const cleanB = hashB.trim().toLowerCase();
  if (cleanA.length !== 64 || cleanB.length !== 64) {
    return false;
  }
  const bufA = Buffer.from(cleanA, 'utf8');
  const bufB = Buffer.from(cleanB, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export class IssueM2mTokenUseCase {
  constructor(
    private readonly credentialRepo: M2mCredentialRepositoryPort,
    private readonly assertionSigner: PdpAssertionSignerPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(
    command: IssueM2mTokenCommand,
  ): Promise<IssueM2mTokenResponse> {
    if (command.grantType !== 'client_credentials') {
      throw new PdpInvalidSchemaError(
        'El parámetro grant_type debe ser exactamente client_credentials',
        'unsupported_grant_type',
      );
    }

    const clientId = command.clientId?.trim() ?? '';
    const clientSecret = command.clientSecret ?? '';

    if (!clientId || !clientSecret) {
      await this.recordRejectedEvent(
        clientId || 'CLIENTE_ANONIMO',
        'CREDENCIALES_INCOMPLETAS',
        command.traceId,
      );
      throw new PdpUnauthorizedM2mError(
        'Se requieren client_id y client_secret válidos',
      );
    }

    const credential = await this.credentialRepo.findByClientId(clientId);
    if (!credential) {
      await this.recordRejectedEvent(
        clientId,
        'CLIENT_ID_NO_REGISTRADO',
        command.traceId,
      );
      throw new PdpUnauthorizedM2mError();
    }

    if (credential.estado_credencial === 'REVOCADA') {
      await this.recordRejectedEvent(
        clientId,
        'CREDENCIAL_REVOCADA',
        command.traceId,
      );
      throw new PdpUnauthorizedM2mError('La credencial M2M se encuentra revocada');
    }

    const candidateHash = sha256Hex(clientSecret);
    const now = command.now ?? new Date();

    if (
      credential.expira_rotacion_en &&
      credential.expira_rotacion_en.getTime() <= now.getTime()
    ) {
      await this.recordRejectedEvent(
        clientId,
        'ROTACION_OBLIGATORIA_VENCIDA',
        command.traceId,
      );
      throw new PdpUnauthorizedM2mError(
        'La credencial M2M superó su vigencia de rotación máxima de 90 días',
      );
    }

    const matchedActive = constantTimeHexEquals(
      candidateHash,
      credential.secreto_activo_hash,
    );

    let matchedGrace = false;
    let usedGraceSecret = false;
    if (
      !matchedActive &&
      credential.secreto_anterior_hash &&
      credential.gracia_hasta &&
      credential.gracia_hasta.getTime() > now.getTime()
    ) {
      matchedGrace = constantTimeHexEquals(
        candidateHash,
        credential.secreto_anterior_hash,
      );
      usedGraceSecret = matchedGrace;
    }

    if (!matchedActive && !matchedGrace) {
      const graceExpired =
        Boolean(credential.secreto_anterior_hash) &&
        Boolean(
          credential.gracia_hasta &&
            credential.gracia_hasta.getTime() <= now.getTime(),
        ) &&
        constantTimeHexEquals(candidateHash, credential.secreto_anterior_hash!);

      await this.recordRejectedEvent(
        clientId,
        graceExpired ? 'SECRETO_GRACIA_EXPIRADO' : 'HASH_SECRETO_INVALIDO',
        command.traceId,
      );
      throw new PdpUnauthorizedM2mError();
    }

    const allowedScopes = credential.scopes_permitidos
      .split(/\s+/)
      .filter(Boolean);
    const trimmedRequestedScope = command.scope?.trim();
    if (
      trimmedRequestedScope &&
      trimmedRequestedScope.length > 0 &&
      !allowedScopes.includes(trimmedRequestedScope)
    ) {
      await this.recordRejectedEvent(
        clientId,
        'SCOPE_NO_AUTORIZADO',
        command.traceId,
      );
      throw new PdpInvalidSchemaError(
        'El scope solicitado no está permitido para esta credencial M2M',
        'invalid_scope',
      );
    }

    const effectiveScope =
      trimmedRequestedScope && trimmedRequestedScope.length > 0
        ? trimmedRequestedScope
        : (allowedScopes[0] ?? 'pdp:evaluate');

    const { accessToken, expiresIn } =
      await this.assertionSigner.signM2mAccessToken({
        clientId: credential.client_id,
        tipoCliente: credential.tipo_cliente,
        aplicacionId: credential.aplicacion_id,
        scope: effectiveScope,
      });

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_TOKEN_M2M_EMITIDO',
      actorIdentificacion: credential.client_id,
      sujetoIdentificacion: null,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: credential.credencial_id,
      valoresNuevos: {
        client_id: credential.client_id,
        tipo_cliente: credential.tipo_cliente,
        aplicacion_id: credential.aplicacion_id,
        scope: effectiveScope,
        expires_in: expiresIn,
        used_grace_secret: usedGraceSecret,
        matched_grace_secret: usedGraceSecret,
      },
      traceId: command.traceId,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: effectiveScope,
    };
  }

  private async recordRejectedEvent(
    clientId: string,
    motivo: string,
    traceId?: string,
  ): Promise<void> {
    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_TOKEN_M2M_RECHAZADO',
      actorIdentificacion: clientId,
      sujetoIdentificacion: null,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: clientId,
      valoresNuevos: {
        client_id: clientId,
        motivo_rechazo: motivo,
      },
      traceId,
    });
  }
}
