/**
 * Casos de Uso: Ciclo de Vida, Rotación Dual (`<= 90 días`) y Revocación de Emergencia (`< 1 h` / `<= 300 s`)
 * de Credenciales M2M (`credencial_m2m`) — `motor-pdp` (`Feature 005`).
 *
 * Cumplimiento Constitucional (v2.11.0, Principios III, IV, IX, X, XV y XVI):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de frameworks de infraestructura.
 * - Generación CSPRNG (`>= 256 bits`), persistencia exclusiva de hashes SHA-256 (`CHAR(64)`) y entrega
 *   de `client_secret_unica_vez` por única vez al aprovisionar o rotar.
 * - Invariante estricto por patrón: `APLICACION_PATRON_1` exige `aplicacion_id` UUID; `PEP_PATRON_2` exige `aplicacion_id = null`.
 * - Revocación de emergencia registra marca inmediata en caché L2 Redis (`<= 300 s`) y en AlloyDB.
 */

import crypto from 'node:crypto';
import {
  M2mClientCredential,
  M2mClientType,
} from '../../domain/entities/pdp-domain.entities';
import { PdpInvalidSchemaError } from '../../domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAuditPort,
  PdpL2CachePort,
} from '../../domain/ports/pdp.ports';

function computeSha256Hex(rawSecret: string): string {
  return crypto.createHash('sha256').update(rawSecret, 'utf8').digest('hex');
}

function generateCsprngM2mSecret(): string {
  return `m2m_sec_${crypto.randomBytes(32).toString('base64url')}`;
}

export class ProvisionM2mCredentialUseCase {
  constructor(
    private readonly credentialRepo: M2mCredentialRepositoryPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    client_id: string;
    tipo_cliente: M2mClientType;
    aplicacion_id?: string | null;
    scopes_permitidos?: string;
    expires_in_days?: number;
    custom_secret?: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    credencial_id: string;
    client_id: string;
    tipo_cliente: M2mClientType;
    aplicacion_id: string | null;
    scopes_permitidos: string;
    estado_credencial: 'ACTIVA';
    expira_rotacion_en: string;
    client_secret_unica_vez: string;
  }> {
    const clientId = params.client_id?.trim() ?? '';
    if (!clientId) {
      throw new PdpInvalidSchemaError(
        'El parámetro client_id es obligatorio para aprovisionar una credencial M2M',
      );
    }

    const aplicacionId = params.aplicacion_id?.trim() || null;

    if (params.tipo_cliente === 'APLICACION_PATRON_1' && !aplicacionId) {
      throw new PdpInvalidSchemaError(
        'Las credenciales de tipo APLICACION_PATRON_1 requieren aplicacion_id obligatorio (invariante ck_m2m_patron_alcance)',
        'M2M_PATRON_1_REQUIRES_APP_ID',
      );
    }

    if (params.tipo_cliente === 'PEP_PATRON_2' && aplicacionId !== null) {
      throw new PdpInvalidSchemaError(
        'Las credenciales transversales de tipo PEP_PATRON_2 deben tener aplicacion_id = null (invariante ck_m2m_patron_alcance)',
        'M2M_PEP_PATRON_2_FORBIDS_APP_ID',
      );
    }

    if (
      params.expires_in_days !== undefined &&
      (params.expires_in_days < 1 || params.expires_in_days > 90)
    ) {
      throw new PdpInvalidSchemaError(
        'El período de rotación expires_in_days debe estar entre 1 y 90 días (Constitución Principio IX / XVI)',
        'M2M_ROTATION_EXCEEDS_90_DAYS',
      );
    }

    if (!this.credentialRepo.createCredential) {
      throw new PdpInvalidSchemaError(
        'El repositorio de credenciales M2M no soporta aprovisionamiento dinámico',
      );
    }

    const plainSecret =
      params.custom_secret && params.custom_secret.trim().length >= 16
        ? params.custom_secret.trim()
        : generateCsprngM2mSecret();
    const secretoActivoHash = computeSha256Hex(plainSecret);

    const created: M2mClientCredential =
      await this.credentialRepo.createCredential({
        aplicacionId,
        tipoCliente: params.tipo_cliente,
        clientId,
        secretoActivoHash,
        scopesPermitidos: params.scopes_permitidos ?? 'pdp:evaluate',
        expiresInDays: params.expires_in_days ?? 90,
      });

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_CREDENCIAL_M2M_CREADA',
      actorIdentificacion:
        params.actorIdentificacion ?? 'ADMIN_SEGURIDAD_M2M',
      sujetoIdentificacion: clientId,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: created.credencial_id,
      valoresNuevos: {
        client_id: created.client_id,
        tipo_cliente: created.tipo_cliente,
        aplicacion_id: created.aplicacion_id,
        scopes_permitidos: created.scopes_permitidos,
        estado_credencial: created.estado_credencial,
        expira_rotacion_en: created.expira_rotacion_en.toISOString(),
      },
      traceId: params.traceId,
    });

    return {
      credencial_id: created.credencial_id,
      client_id: created.client_id,
      tipo_cliente: created.tipo_cliente,
      aplicacion_id: created.aplicacion_id,
      scopes_permitidos: created.scopes_permitidos,
      estado_credencial: 'ACTIVA',
      expira_rotacion_en: created.expira_rotacion_en.toISOString(),
      client_secret_unica_vez: plainSecret,
    };
  }
}

export class RotateM2mCredentialSecretUseCase {
  constructor(
    private readonly credentialRepo: M2mCredentialRepositoryPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    client_id: string;
    grace_window_seconds?: number;
    expires_in_days?: number;
    custom_secret?: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    credencial_id: string;
    client_id: string;
    estado_credencial: 'EN_ROTACION_GRACIA';
    gracia_hasta: string;
    expira_rotacion_en: string;
    client_secret_unica_vez: string;
  }> {
    const clientId = params.client_id?.trim() ?? '';
    if (!clientId) {
      throw new PdpInvalidSchemaError(
        'El parámetro client_id es obligatorio para rotar el secreto M2M',
      );
    }

    if (
      params.expires_in_days !== undefined &&
      (params.expires_in_days < 1 || params.expires_in_days > 90)
    ) {
      throw new PdpInvalidSchemaError(
        'El período de rotación expires_in_days no puede exceder 90 días',
        'M2M_ROTATION_EXCEEDS_90_DAYS',
      );
    }

    if (!this.credentialRepo.rotateCredentialSecret) {
      throw new PdpInvalidSchemaError(
        'El repositorio de credenciales M2M no soporta rotación de secretos',
      );
    }

    const newPlainSecret =
      params.custom_secret && params.custom_secret.trim().length >= 16
        ? params.custom_secret.trim()
        : generateCsprngM2mSecret();
    const nuevoSecretoHash = computeSha256Hex(newPlainSecret);

    const rotated = await this.credentialRepo.rotateCredentialSecret({
      clientId,
      nuevoSecretoHash,
      graceWindowSeconds: params.grace_window_seconds ?? 86400,
      expiresInDays: params.expires_in_days ?? 90,
    });

    if (!rotated || !rotated.gracia_hasta) {
      throw new PdpInvalidSchemaError(
        `No se encontró una credencial M2M activa o elegible para rotación (${clientId})`,
        'M2M_CREDENTIAL_NOT_FOUND_OR_REVOKED',
      );
    }

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_CREDENCIAL_M2M_ROTADA',
      actorIdentificacion:
        params.actorIdentificacion ?? 'SCHEDULER_ROTACION_M2M',
      sujetoIdentificacion: rotated.client_id,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: rotated.credencial_id,
      valoresNuevos: {
        client_id: rotated.client_id,
        estado_credencial: rotated.estado_credencial,
        gracia_hasta: rotated.gracia_hasta.toISOString(),
        expira_rotacion_en: rotated.expira_rotacion_en.toISOString(),
      },
      traceId: params.traceId,
    });

    return {
      credencial_id: rotated.credencial_id,
      client_id: rotated.client_id,
      estado_credencial: 'EN_ROTACION_GRACIA',
      gracia_hasta: rotated.gracia_hasta.toISOString(),
      expira_rotacion_en: rotated.expira_rotacion_en.toISOString(),
      client_secret_unica_vez: newPlainSecret,
    };
  }
}

export class ExpireM2mCredentialGraceUseCase {
  constructor(
    private readonly credentialRepo: M2mCredentialRepositoryPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    client_id: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    credencial_id: string;
    client_id: string;
    estado_credencial: 'ACTIVA';
    gracia_hasta: null;
  }> {
    const clientId = params.client_id?.trim() ?? '';
    if (!clientId) {
      throw new PdpInvalidSchemaError(
        'El parámetro client_id es obligatorio para cerrar la ventana de gracia',
      );
    }

    if (!this.credentialRepo.expireGraceWindow) {
      throw new PdpInvalidSchemaError(
        'El repositorio de credenciales M2M no soporta expiración de ventana de gracia',
      );
    }

    const updated = await this.credentialRepo.expireGraceWindow(clientId);
    if (!updated) {
      throw new PdpInvalidSchemaError(
        `No se encontró una credencial M2M elegible para cierre de ventana de gracia (${clientId})`,
        'M2M_CREDENTIAL_NOT_FOUND_OR_REVOKED',
      );
    }

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA',
      actorIdentificacion:
        params.actorIdentificacion ?? 'SCHEDULER_ROTACION_M2M',
      sujetoIdentificacion: updated.client_id,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: updated.credencial_id,
      valoresNuevos: {
        client_id: updated.client_id,
        estado_credencial: updated.estado_credencial,
        gracia_hasta: null,
      },
      traceId: params.traceId,
    });

    return {
      credencial_id: updated.credencial_id,
      client_id: updated.client_id,
      estado_credencial: 'ACTIVA',
      gracia_hasta: null,
    };
  }
}

export class RevokeM2mCredentialUseCase {
  constructor(
    private readonly credentialRepo: M2mCredentialRepositoryPort,
    private readonly l2Cache: PdpL2CachePort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    client_id: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    credencial_id: string;
    client_id: string;
    estado_credencial: 'REVOCADA';
    revoked: true;
  }> {
    const clientId = params.client_id?.trim() ?? '';
    if (!clientId) {
      throw new PdpInvalidSchemaError(
        'El parámetro client_id es obligatorio para revocación de emergencia',
      );
    }

    if (!this.credentialRepo.revokeCredentialEmergency) {
      throw new PdpInvalidSchemaError(
        'El repositorio de credenciales M2M no soporta revocación de emergencia',
      );
    }

    const revoked =
      await this.credentialRepo.revokeCredentialEmergency(clientId);
    if (!revoked) {
      throw new PdpInvalidSchemaError(
        `No se encontró la credencial M2M (${clientId}) para revocación de emergencia`,
        'M2M_CREDENTIAL_NOT_FOUND',
      );
    }

    if (this.l2Cache.markM2mClientRevoked) {
      await this.l2Cache.markM2mClientRevoked(revoked.client_id, 300);
    }

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_CREDENCIAL_M2M_REVOCADA',
      actorIdentificacion:
        params.actorIdentificacion ?? 'SEGURIDAD_EMERGENCIA_M2M',
      sujetoIdentificacion: revoked.client_id,
      correoAfectado: null,
      entidadAfectada: 'credencial_m2m',
      registroAfectadoId: revoked.credencial_id,
      valoresNuevos: {
        client_id: revoked.client_id,
        estado_credencial: 'REVOCADA',
      },
      traceId: params.traceId,
    });

    return {
      credencial_id: revoked.credencial_id,
      client_id: revoked.client_id,
      estado_credencial: 'REVOCADA',
      revoked: true,
    };
  }
}
