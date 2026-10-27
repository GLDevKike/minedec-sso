import { AuditEventWriter, StructuredLogger } from '@minedec/shared';

import {
  EstadoLlaveJwks,
  PublicRsaJwk,
} from '../domain/entities/oidc-broker.entities';
import { IJwksKeyStorePort } from '../domain/ports/oidc-broker.ports';

export interface OpenIdConfigurationDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  claims_supported: string[];
  backchannel_logout_supported: boolean;
  backchannel_logout_session_supported: boolean;
}

/**
 * Caso de uso para `GET /.well-known/openid-configuration`, `GET /jwks` y endpoints internos
 * de rotación programada (`<= 90 días`) y revocación de emergencia (`< 1 h`) de llaves JWKS `RS256`
 * segregadas por `servicio_emisor = 'SSO_OIDC'` (`FR-009`, `US5`).
 * Libre de decoradores InversifyJS (Principio XVIII).
 */
export class ManageJwksKeysUseCase {
  constructor(
    private readonly jwksKeyStore: IJwksKeyStorePort,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  getOpenIdConfiguration(issuer: string): OpenIdConfigurationDocument {
    const cleanIssuer = issuer.replace(/\/+$/, '');
    return {
      issuer: cleanIssuer,
      authorization_endpoint: `${cleanIssuer}/authorize`,
      token_endpoint: `${cleanIssuer}/token`,
      jwks_uri: `${cleanIssuer}/jwks`,
      end_session_endpoint: `${cleanIssuer}/logout`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_basic',
        'client_secret_post',
      ],
      scopes_supported: ['openid', 'profile', 'email'],
      claims_supported: [
        'sub',
        'iss',
        'aud',
        'iat',
        'exp',
        'nonce',
        'sid',
        'auth_time',
        'email',
        'email_verified',
        'hd',
        'name',
        'tipo_identificacion',
        'numero_identificacion',
      ],
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    };
  }

  async getPublicJwks(): Promise<{ keys: PublicRsaJwk[] }> {
    const { keys } = await this.jwksKeyStore.getPublishedPublicKeysForSsoOidc();
    return { keys };
  }

  async rotateSigningKey(params: {
    newKid: string;
    secretManagerVersion: string;
    publicJwk: PublicRsaJwk;
    retireExpiredGraceKeys?: boolean;
    traceId: string;
  }): Promise<{ activeKid: string; publishedKids: string[] }> {
    const result = await this.jwksKeyStore.rotateSsoOidcSigningKey({
      newKid: params.newKid,
      secretManagerVersion: params.secretManagerVersion,
      publicJwk: params.publicJwk,
      retireExpiredGraceKeys: params.retireExpiredGraceKeys,
    });

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_JWKS_ROTADO',
      origenCanal: 'SSO_OIDC_BROKER',
      entidadAfectada: 'llave_jwks_rotacion',
      traceId: params.traceId,
      valoresNuevos: {
        servicioEmisor: 'SSO_OIDC',
        activeKid: result.activeKid,
        publishedKids: result.publishedKids,
        secretManagerVersion: params.secretManagerVersion,
      },
    });

    this.logger.info('Llave JWKS RS256 rotada en sso-oidc con ventana dual', {
      traceId: params.traceId,
      activeKid: result.activeKid,
      publishedKids: result.publishedKids,
    });

    return result;
  }

  async revokeOrRetireSigningKey(params: {
    kid: string;
    targetState: Extract<EstadoLlaveJwks, 'RETIRADA' | 'REVOCADA'>;
    reason: string;
    traceId: string;
  }): Promise<{ activeKid: string | null; publishedKids: string[] }> {
    const result = await this.jwksKeyStore.revokeOrRetireSsoOidcSigningKey({
      kid: params.kid,
      targetState: params.targetState,
      reason: params.reason,
    });

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_JWKS_REVOCADO_EMERGENCIA',
      origenCanal: 'SSO_OIDC_BROKER',
      entidadAfectada: 'llave_jwks_rotacion',
      traceId: params.traceId,
      valoresNuevos: {
        servicioEmisor: 'SSO_OIDC',
        kidAfectado: params.kid,
        targetState: params.targetState,
        reason: params.reason,
        activeKidRestante: result.activeKid,
        publishedKidsRestantes: result.publishedKids,
      },
    });

    this.logger.warn(
      'Llave JWKS RS256 retirada/revocada en sso-oidc',
      {
        traceId: params.traceId,
        kid: params.kid,
        targetState: params.targetState,
        activeKid: result.activeKid,
      },
    );

    return result;
  }
}
