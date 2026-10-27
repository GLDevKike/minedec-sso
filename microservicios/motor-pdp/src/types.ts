/**
 * Símbolos de Inyección de Dependencias — Composition Root (`motor-pdp`).
 */

export const TYPES = {
  EnvConfig: Symbol.for('MotorPdp.EnvConfig'),
  Logger: Symbol.for('MotorPdp.Logger'),
  SqlQueryExecutor: Symbol.for('MotorPdp.SqlQueryExecutor'),
  AuditEventWriter: Symbol.for('MotorPdp.AuditEventWriter'),

  // Puertos de salida (Repositorios y Adaptadores)
  PolicyBundleRepositoryPort: Symbol.for('MotorPdp.PolicyBundleRepositoryPort'),
  IdentityAuthorizationRepositoryPort: Symbol.for(
    'MotorPdp.IdentityAuthorizationRepositoryPort',
  ),
  M2mCredentialRepositoryPort: Symbol.for(
    'MotorPdp.M2mCredentialRepositoryPort',
  ),
  PdpJwksKeyRepositoryPort: Symbol.for('MotorPdp.PdpJwksKeyRepositoryPort'),
  PdpL2CachePort: Symbol.for('MotorPdp.PdpL2CachePort'),
  PdpAssertionSignerPort: Symbol.for('MotorPdp.PdpAssertionSignerPort'),
  PdpAuditPort: Symbol.for('MotorPdp.PdpAuditPort'),

  // Servicios de Dominio Puros
  RbacAbacEvaluatorService: Symbol.for('MotorPdp.RbacAbacEvaluatorService'),
  RouteNormalizerAndMatcherService: Symbol.for(
    'MotorPdp.RouteNormalizerAndMatcherService',
  ),

  // Casos de Uso de Aplicación
  EvaluateAccessUseCase: Symbol.for('MotorPdp.EvaluateAccessUseCase'),
  IssueM2mTokenUseCase: Symbol.for('MotorPdp.IssueM2mTokenUseCase'),
  ProvisionM2mCredentialUseCase: Symbol.for(
    'MotorPdp.ProvisionM2mCredentialUseCase',
  ),
  RotateM2mCredentialSecretUseCase: Symbol.for(
    'MotorPdp.RotateM2mCredentialSecretUseCase',
  ),
  ExpireM2mCredentialGraceUseCase: Symbol.for(
    'MotorPdp.ExpireM2mCredentialGraceUseCase',
  ),
  RevokeM2mCredentialUseCase: Symbol.for('MotorPdp.RevokeM2mCredentialUseCase'),
  GetPdpJwksUseCase: Symbol.for('MotorPdp.GetPdpJwksUseCase'),
  RotatePdpJwksKeyUseCase: Symbol.for('MotorPdp.RotatePdpJwksKeyUseCase'),
  RevokePdpJwksKeyUseCase: Symbol.for('MotorPdp.RevokePdpJwksKeyUseCase'),
  RetirePdpJwksKeyUseCase: Symbol.for('MotorPdp.RetirePdpJwksKeyUseCase'),

  // Controladores HTTP y Suscriptores
  AccessEvaluationController: Symbol.for('MotorPdp.AccessEvaluationController'),
  OAuthTokenController: Symbol.for('MotorPdp.OAuthTokenController'),
  M2mCredentialsController: Symbol.for('MotorPdp.M2mCredentialsController'),
  PdpJwksController: Symbol.for('MotorPdp.PdpJwksController'),
  PubSubPdpCacheInvalidationSubscriber: Symbol.for(
    'MotorPdp.PubSubPdpCacheInvalidationSubscriber',
  ),
} as const;
