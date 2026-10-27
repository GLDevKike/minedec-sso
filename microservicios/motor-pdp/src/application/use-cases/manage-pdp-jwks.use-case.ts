/**
 * Casos de Uso: Publicación, Rotación Dual (`<= 90 días`) y Revocación de Emergencia (`< 1 h`)
 * de Llaves JWKS `RS256` (`servicio_emisor = 'MOTOR_PDP'`) — `motor-pdp` (`T040`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, IX y XVI):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de infraestructura.
 * - Segregación estricta de dominio criptográfico `servicio_emisor = 'MOTOR_PDP'`.
 * - Registro transaccional de `PDP_JWKS_ROTADO` y `PDP_JWKS_REVOCADO_EMERGENCIA`.
 */

import { PublicJwkEntry } from '../../domain/entities/pdp-domain.entities';
import { PdpInvalidSchemaError } from '../../domain/errors/pdp-domain.errors';
import {
  PdpAssertionSignerPort,
  PdpAuditPort,
  PdpJwksKeyRepositoryPort,
} from '../../domain/ports/pdp.ports';

export class GetPdpJwksUseCase {
  constructor(private readonly jwksRepo: PdpJwksKeyRepositoryPort) {}

  public async execute(): Promise<{ keys: PublicJwkEntry[] }> {
    const records = await this.jwksRepo.listActiveAndGraceKeys();
    const keys = records
      .filter((r) => r.servicio_emisor === 'MOTOR_PDP')
      .map((r) => r.public_jwk_json);
    return { keys };
  }
}

export class RotatePdpJwksKeyUseCase {
  constructor(
    private readonly assertionSigner: PdpAssertionSignerPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params?: {
    kid?: string;
    secret_manager_version?: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    kid_activo: string;
    kid_gracia: string | null;
    rotatedKey: { kid: string };
    previousKeyKid: string | null;
  }> {
    const rotated = await this.assertionSigner.generateAndRotateKeyPair({
      kid: params?.kid,
      secretManagerVersion: params?.secret_manager_version,
    });

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_JWKS_ROTADO',
      actorIdentificacion:
        params?.actorIdentificacion ?? 'SCHEDULER_ROTACION_JWKS',
      sujetoIdentificacion: null,
      correoAfectado: null,
      entidadAfectada: 'llave_jwks_rotacion',
      registroAfectadoId: rotated.kid_activo,
      valoresNuevos: {
        servicio_emisor: 'MOTOR_PDP',
        kid_activo: rotated.kid_activo,
        kid_gracia: rotated.kid_gracia,
      },
      traceId: params?.traceId,
    });

    return {
      kid_activo: rotated.kid_activo,
      kid_gracia: rotated.kid_gracia,
      rotatedKey: { kid: rotated.kid_activo },
      previousKeyKid: rotated.kid_gracia,
    };
  }
}

export class RetirePdpJwksKeyUseCase {
  constructor(
    private readonly jwksRepo: PdpJwksKeyRepositoryPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    kid: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    kid: string;
    estado_llave: 'RETIRADA';
    retired: true;
  }> {
    const trimmedKid = params.kid?.trim() ?? '';
    if (!trimmedKid) {
      throw new PdpInvalidSchemaError(
        'El parámetro kid es obligatorio para retirar una llave JWKS en gracia',
      );
    }

    if (!this.jwksRepo.retireGraceKey) {
      throw new PdpInvalidSchemaError(
        'El repositorio JWKS no soporta retiro de llaves en gracia',
      );
    }

    const retired = await this.jwksRepo.retireGraceKey(trimmedKid);
    if (!retired) {
      throw new PdpInvalidSchemaError(
        `No se encontró una llave JWKS en estado GRACIA_VERIFICACION (${trimmedKid}) con servicio_emisor = MOTOR_PDP`,
        'JWKS_GRACE_KEY_NOT_FOUND',
      );
    }

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_JWKS_RETIRADO',
      actorIdentificacion:
        params.actorIdentificacion ?? 'SCHEDULER_ROTACION_JWKS',
      sujetoIdentificacion: null,
      correoAfectado: null,
      entidadAfectada: 'llave_jwks_rotacion',
      registroAfectadoId: retired.kid,
      valoresNuevos: {
        servicio_emisor: 'MOTOR_PDP',
        kid: retired.kid,
        estado_llave: retired.estado_llave,
      },
      traceId: params.traceId,
    });

    return {
      ...retired,
      retired: true,
    };
  }
}

export class RevokePdpJwksKeyUseCase {
  constructor(
    private readonly jwksRepo: PdpJwksKeyRepositoryPort,
    private readonly auditPort: PdpAuditPort,
  ) {}

  public async execute(params: {
    kid: string;
    actorIdentificacion?: string;
    traceId?: string;
  }): Promise<{
    kid: string;
    estado_llave: 'REVOCADA';
    revoked: true;
  }> {
    const trimmedKid = params.kid?.trim() ?? '';
    if (!trimmedKid) {
      throw new PdpInvalidSchemaError(
        'El parámetro kid es obligatorio para revocación de emergencia',
      );
    }

    const revoked = await this.jwksRepo.revokeKeyEmergency(trimmedKid);
    if (!revoked) {
      throw new PdpInvalidSchemaError(
        `No se encontró la llave JWKS (${trimmedKid}) con servicio_emisor = MOTOR_PDP`,
        'JWKS_KEY_NOT_FOUND',
      );
    }

    await this.auditPort.recordTransactionalSecurityEvent({
      tipoEvento: 'PDP_JWKS_REVOCADO_EMERGENCIA',
      actorIdentificacion:
        params.actorIdentificacion ?? 'SEGURIDAD_EMERGENCIA_JWKS',
      sujetoIdentificacion: null,
      correoAfectado: null,
      entidadAfectada: 'llave_jwks_rotacion',
      registroAfectadoId: revoked.kid,
      valoresNuevos: {
        servicio_emisor: 'MOTOR_PDP',
        kid: revoked.kid,
        estado_llave: revoked.estado_llave,
      },
      traceId: params.traceId,
    });

    return {
      ...revoked,
      revoked: true,
    };
  }
}
