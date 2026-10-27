import crypto from 'crypto';

import { AuditEventWriter, StructuredLogger } from '@minedec/shared';

import {
  MetodoAutenticacionTokenOidc,
} from '../domain/entities/oidc-broker.entities';
import {
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
} from '../domain/ports/oidc-broker.ports';
import {
  ConstantTimeClientSecretVerifier,
  MinedecIdTokenClaimsBuilder,
  OAuthTokenProtocolError,
  PkceS256Validator,
} from '../domain/services/oidc-security.services';

export interface ExchangeAuthorizationCodeInput {
  grantType: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  clientSecret?: string;
  authMethodUsed: MetodoAutenticacionTokenOidc;
  issuer: string;
  traceId: string;
}

export interface ExchangeAuthorizationCodeResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  id_token: string;
  scope: string;
}

/**
 * Caso de uso para `POST /token` (`grant_type=authorization_code`, `DA-11`, `FR-004`, `FR-005`, `FR-007`).
 * Valida cliente OIDC (incluyendo ventana de gracia dual de secreto), consume código efímero
 * de un solo uso (revocando sesión ante replay), verifica `code_verifier` PKCE S256 y emite
 * `id_token` firmado con `RS256` con `aud` exclusivo por cliente y `TTL <= 300 s`.
 * Libre de decoradores InversifyJS (Principio XVIII).
 */
export class ExchangeAuthorizationCodeUseCase {
  constructor(
    private readonly clientRepository: IOidcClientRepositoryPort,
    private readonly sessionStore: IOidcSessionStorePort,
    private readonly jwksKeyStore: IJwksKeyStorePort,
    private readonly pkceValidator: PkceS256Validator,
    private readonly secretVerifier: ConstantTimeClientSecretVerifier,
    private readonly claimsBuilder: MinedecIdTokenClaimsBuilder,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  async execute(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<ExchangeAuthorizationCodeResult> {
    if (input.grantType !== 'authorization_code') {
      throw new OAuthTokenProtocolError({
        error: 'unsupported_grant_type',
        errorDescription:
          'Solo se admite grant_type=authorization_code en el endpoint /token de sso-oidc.',
        statusCode: 400,
      });
    }

    const cliente = await this.clientRepository.findByOidcClientId(
      input.clientId,
    );
    if (!cliente) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_client',
        errorDescription: `El cliente OIDC '${input.clientId}' no existe en el catálogo institucional.`,
        statusCode: 401,
      });
    }

    // 1. Autenticación del cliente OIDC (soporta PUBLIC_PKCE y secretos con rotación dual)
    this.secretVerifier.verifyClientAuthentication({
      cliente,
      providedClientSecret: input.clientSecret,
      authMethodUsed: input.authMethodUsed,
    });

    // 2. Consumo atómico de uso único del authorization_code en Redis
    const consumeResult =
      await this.sessionStore.consumeAuthorizationCodeSingleUse(input.code);

    if (consumeResult.status === 'REPLAY_DETECTED') {
      const replayedRecord = consumeResult.codeRecord;
      if (replayedRecord) {
        await this.sessionStore.destroySession(replayedRecord.sessionId);
        await this.sessionStore.purgeAuthorizationCodesForSession(
          replayedRecord.sessionId,
        );
      }

      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        idInterno: replayedRecord?.idInterno ?? null,
        cuentaId: replayedRecord?.cuentaId ?? null,
        correoAfectado: replayedRecord?.emailPrincipal ?? null,
        entidadAfectada: 'cliente_oidc',
        registroAfectadoId: cliente.clienteOidcId,
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'REPLAY_AUTHORIZATION_CODE_DETECTADO',
          oidcClientId: input.clientId,
          sessionIdRevocada: replayedRecord?.sessionId ?? null,
        },
      });

      this.logger.warn(
        'Intento de reutilización (replay) de authorization_code detectado; sesión revocada',
        {
          traceId: input.traceId,
          clientId: input.clientId,
          sessionId: replayedRecord?.sessionId,
        },
      );

      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'El código de autorización ya fue utilizado previamente. Por seguridad se revocó la sesión asociada.',
        statusCode: 400,
      });
    }

    if (
      consumeResult.status === 'NOT_FOUND_OR_EXPIRED' ||
      !consumeResult.codeRecord
    ) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'El código de autorización no existe o ha expirado (TTL máximo 60 segundos).',
        statusCode: 400,
      });
    }

    const codeRecord = consumeResult.codeRecord;

    // 3. Validar aislamiento estricto de cliente y coincidencia exacta de redirect_uri (`FR-005`)
    if (codeRecord.clientId !== cliente.oidcClientId) {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        idInterno: codeRecord.idInterno,
        cuentaId: codeRecord.cuentaId,
        correoAfectado: codeRecord.emailPrincipal,
        entidadAfectada: 'cliente_oidc',
        registroAfectadoId: cliente.clienteOidcId,
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'AISLAMIENTO_CLIENTE_VIOLADO_EN_TOKEN',
          clientIdCodigo: codeRecord.clientId,
          clientIdSolicitante: cliente.oidcClientId,
        },
      });

      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'El código de autorización fue emitido para otro cliente OIDC.',
        statusCode: 400,
      });
    }

    if (codeRecord.redirectUri !== input.redirectUri) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'El parámetro redirect_uri no coincide exactamente con el utilizado en /authorize.',
        statusCode: 400,
      });
    }

    // 4. Verificar code_verifier PKCE S256
    const pkceValid = this.pkceValidator.verifyCodeVerifier(
      input.codeVerifier,
      codeRecord.codeChallenge,
    );
    if (!pkceValid) {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        idInterno: codeRecord.idInterno,
        cuentaId: codeRecord.cuentaId,
        correoAfectado: codeRecord.emailPrincipal,
        entidadAfectada: 'cliente_oidc',
        registroAfectadoId: cliente.clienteOidcId,
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'PKCE_CODE_VERIFIER_INVALIDO',
          oidcClientId: cliente.oidcClientId,
        },
      });

      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'La verificación criptográfica PKCE S256 (code_verifier) falló.',
        statusCode: 400,
      });
    }

    // 5. Verificar que la sesión central siga activa en Redis (protección ante revocación concurrente)
    const activeSession = await this.sessionStore.getSession(
      codeRecord.sessionId,
    );
    if (!activeSession) {
      throw new OAuthTokenProtocolError({
        error: 'invalid_grant',
        errorDescription:
          'La sesión central asociada al código de autorización fue cerrada o revocada.',
        statusCode: 400,
      });
    }

    // 6. Construir claims limpios de identidad (0 roles/permisos RBAC/ABAC, TTL <= 300 s) y firmar RS256
    const idTokenClaims = this.claimsBuilder.buildClaims({
      issuer: input.issuer,
      idInterno: codeRecord.idInterno,
      oidcClientId: cliente.oidcClientId,
      sessionId: codeRecord.sessionId,
      tipoIdentificacion: codeRecord.tipoIdentificacion,
      numeroIdentificacion: codeRecord.numeroIdentificacion,
      nombreCompleto: codeRecord.nombreCompleto,
      emailPrincipal: codeRecord.emailPrincipal,
      dominio: codeRecord.dominio,
      nonce: codeRecord.nonce,
      authTimeEpochSeconds: codeRecord.authTimeEpochSeconds,
      ttlSeconds: MinedecIdTokenClaimsBuilder.MAX_ID_TOKEN_TTL_SECONDS,
    });

    const { idTokenJwt, kid } =
      await this.jwksKeyStore.signIdToken(idTokenClaims);
    const opaqueAccessToken = crypto.randomBytes(32).toString('base64url');

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_ID_TOKEN_EMITIDO',
      origenCanal: 'SSO_OIDC_BROKER',
      idInterno: codeRecord.idInterno,
      cuentaId: codeRecord.cuentaId,
      correoAfectado: codeRecord.emailPrincipal,
      sujetoIdentificacion: codeRecord.numeroIdentificacion,
      entidadAfectada: 'cliente_oidc',
      registroAfectadoId: cliente.clienteOidcId,
      traceId: input.traceId,
      valoresNuevos: {
        oidcClientId: cliente.oidcClientId,
        sessionId: codeRecord.sessionId,
        kid,
        expiresInSeconds: MinedecIdTokenClaimsBuilder.MAX_ID_TOKEN_TTL_SECONDS,
      },
    });

    return {
      access_token: opaqueAccessToken,
      token_type: 'Bearer',
      expires_in: MinedecIdTokenClaimsBuilder.MAX_ID_TOKEN_TTL_SECONDS,
      id_token: idTokenJwt,
      scope: codeRecord.scope,
    };
  }
}
