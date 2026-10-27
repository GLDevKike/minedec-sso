/**
 * Jerarquía de Errores de Dominio — Motor de Autorización Central (`motor-pdp`).
 *
 * Cumplimiento Constitucional (v2.10.0):
 * - Cero decoradores e imports de infraestructura.
 * - Mapeo determinístico a códigos HTTP (`400`, `401`, `403`, `404`, `503 Fail-Close`).
 */

export abstract class PdpDomainError extends Error {
  public abstract readonly errorCode: string;
  public abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PdpSecurityRejectionError extends PdpDomainError {
  public readonly errorCode = 'SECURITY_PATH_TRAVERSAL_REJECTED';
  public readonly httpStatus = 400;
  public readonly rawRoute: string;

  constructor(message: string, rawRoute: string) {
    super(message);
    this.rawRoute = rawRoute;
  }
}

export class PdpInvalidSchemaError extends PdpDomainError {
  public readonly errorCode: string;
  public readonly httpStatus = 400;

  constructor(message: string, errorCode = 'BAD_REQUEST') {
    super(message);
    this.errorCode = errorCode;
  }
}

export { PdpInvalidSchemaError as PdpBadRequestError };

export class PdpUnauthorizedM2mError extends PdpDomainError {
  public readonly errorCode = 'invalid_client';
  public readonly httpStatus = 401;

  constructor(message = 'Credenciales M2M inválidas, revocadas o expiradas') {
    super(message);
  }
}

export class PdpForbiddenM2mScopeError extends PdpDomainError {
  public readonly errorCode = 'FORBIDDEN_M2M_SCOPE';
  public readonly httpStatus = 403;

  constructor(
    message = 'La credencial M2M no está autorizada para evaluar la aplicación solicitada',
  ) {
    super(message);
  }
}

export class PdpApplicationNotFoundError extends PdpDomainError {
  public readonly errorCode = 'APPLICATION_NOT_FOUND';
  public readonly httpStatus = 404;

  constructor(
    message = 'Aplicación no encontrada, suspendida o fuera de estado PUBLICADO',
  ) {
    super(message);
  }
}

export class PdpFailCloseUnavailableError extends PdpDomainError {
  public readonly errorCode = 'AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE';
  public readonly httpStatus = 503;

  constructor(
    message = 'Denegación preventiva Fail-Close por indisponibilidad temporal de dependencias críticas de autorización',
  ) {
    super(message);
  }
}
