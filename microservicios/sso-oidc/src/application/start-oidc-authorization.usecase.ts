import { randomBytes } from 'node:crypto';
import { AuditEventWriter, StructuredLogger } from '@minedec/shared';
import {
  CodigoAutorizacionEfimero,
  CorrelacionFederacionGoogle,
} from '../domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
  IPipIdentityResolverPort,
} from '../domain/ports/oidc-broker.ports';
import {
  ExactRedirectUriValidator,
  OidcSecurityError,
  PkceS256Validator,
} from '../domain/services/oidc-security.services';

export interface StartOidcAuthorizationInput {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
  hd?: string;
  sessionIdFromCookie?: string;
  traceId: string;
}

export interface StartOidcAuthorizationOutput {
  outcome: 'REDIRECT_TO_GOOGLE_IDP' | 'SILENT_SSO_REDIRECT';
  redirectUrl: string;
  sessionId?: string;
  clearSessionCookie?: boolean;
}

const AUTH_CODE_TTL_SECONDS = 60;
const FEDERATION_CORRELATION_TTL_SECONDS = 300;
const REVALIDATION_TTL_SECONDS = 300;

/**
 * Caso de uso de inicio de autorización OIDC (`GET /authorize`) (`T020`, `T027`).
 * Clase pura de aplicación 100% libre de decoradores de framework/DI.
 */
export class StartOidcAuthorizationUseCase {
  constructor(
    private readonly clientRepository: IOidcClientRepositoryPort,
    private readonly sessionStore: IOidcSessionStorePort,
    private readonly googleIdp: IGoogleIdpFederationPort,
    private readonly pipResolver: IPipIdentityResolverPort,
    private readonly pkceValidator: PkceS256Validator,
    private readonly redirectUriValidator: ExactRedirectUriValidator,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  public async execute(
    input: StartOidcAuthorizationInput,
  ): Promise<StartOidcAuthorizationOutput> {
    const rawClient = await this.clientRepository.findByOidcClientId(input.clientId);
    const client = this.redirectUriValidator.validateClientLifecycle(
      rawClient,
      input.clientId,
    );

    const validatedRedirectUri =
      this.redirectUriValidator.assertExactRedirectUriRegistered(
        client,
        input.redirectUri,
        'LOGIN_CALLBACK',
      );

    if (input.responseType !== 'code') {
      throw new OidcSecurityError({
        codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
        statusCode: 400,
        mensajeUsuario:
          'Solo se admite response_type=code (Authorization Code Flow + PKCE S256).',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `El cliente ${client.oidcClientId} envió response_type="${input.responseType}".`,
          impactoOperativo: 'Flujo implícito o híbrido bloqueado por política OAuth 2.0 Security Best Current Practice.',
          accionRecomendada: 'Utilice exclusivamente response_type=code con PKCE S256.',
        },
      });
    }

    const scopes = input.scope
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!scopes.includes('openid')) {
      throw new OidcSecurityError({
        codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
        statusCode: 400,
        mensajeUsuario: 'El parámetro scope debe incluir obligatoriamente openid.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio: `El cliente ${client.oidcClientId} omitió el scope obligatorio "openid".`,
          impactoOperativo: 'Solicitud rechazada en GET /authorize.',
          accionRecomendada: 'Incluya "openid" (ej. "openid profile email") en el parámetro scope.',
        },
      });
    }

    this.pkceValidator.validateChallengeParameters(
      input.codeChallenge,
      input.codeChallengeMethod,
    );
    const validCodeChallenge = input.codeChallenge!;

    // Evaluar sesión central activa en Redis (Silent SSO entre aplicaciones)
    let clearSessionCookie = false;
    if (input.sessionIdFromCookie && input.prompt !== 'login') {
      const existingSession = await this.sessionStore.getSession(
        input.sessionIdFromCookie,
      );

      if (existingSession) {
        const isFresh = await this.sessionStore.isSessionRevalidationFresh(
          existingSession.sessionId,
        );
        let subjectActive = true;

        if (!isFresh) {
          subjectActive = await this.pipResolver.verifySessionSubjectStillActive({
            idInterno: existingSession.idInterno,
            cuentaId: existingSession.cuentaId,
            traceId: input.traceId,
          });

          if (subjectActive) {
            await this.sessionStore.refreshSessionRevalidationMark(
              existingSession.sessionId,
              REVALIDATION_TTL_SECONDS,
            );
          } else {
            await this.sessionStore.destroySession(existingSession.sessionId);
            await this.sessionStore.purgeAuthorizationCodesForSession(
              existingSession.sessionId,
            );
            clearSessionCookie = true;
            await this.auditWriter.appendEvent({
              tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
              origenCanal: 'SSO_OIDC_BROKER',
              idInterno: existingSession.idInterno,
              cuentaId: existingSession.cuentaId,
              correoAfectado: existingSession.emailPrincipal,
              sujetoIdentificacion: existingSession.numeroIdentificacion,
              entidadAfectada: 'SESION_CENTRAL_OIDC',
              registroAfectadoId: existingSession.sessionId,
              traceId: input.traceId,
              valoresNuevos: {
                motivo: 'REVALIDACION_PIP_CUENTA_O_PERSONA_INACTIVA',
                sessionId: existingSession.sessionId,
                clientId: client.oidcClientId,
              },
            });
          }
        }

        if (subjectActive) {
          const codeId = randomBytes(32).toString('base64url');
          const nowEpoch = Math.floor(Date.now() / 1000);
          const authTimeEpoch = Math.floor(
            new Date(existingSession.createdAt).getTime() / 1000,
          );

          const codeRecord: CodigoAutorizacionEfimero = {
            codeId,
            clientId: client.oidcClientId,
            redirectUri: validatedRedirectUri,
            scope: scopes.join(' '),
            codeChallenge: validCodeChallenge,
            codeChallengeMethod: 'S256',
            nonce: input.nonce,
            sessionId: existingSession.sessionId,
            idInterno: existingSession.idInterno,
            cuentaId: existingSession.cuentaId,
            googleSubId: existingSession.googleSubId,
            emailPrincipal: existingSession.emailPrincipal,
            dominio: existingSession.dominio,
            tipoIdentificacion: existingSession.tipoIdentificacion,
            numeroIdentificacion: existingSession.numeroIdentificacion,
            nombreCompleto: existingSession.nombreCompleto,
            authTimeEpochSeconds: Number.isFinite(authTimeEpoch)
              ? authTimeEpoch
              : nowEpoch,
            issuedAtEpochSeconds: nowEpoch,
            expiresAtEpochSeconds: nowEpoch + AUTH_CODE_TTL_SECONDS,
            consumedAt: null,
          };

          await this.sessionStore.saveAuthorizationCode(
            codeRecord,
            AUTH_CODE_TTL_SECONDS,
          );
          await this.sessionStore.addParticipatingClientToSession(
            existingSession.sessionId,
            client.oidcClientId,
          );

          await this.auditWriter.appendEvent({
            tipoEvento: 'OIDC_AUTHORIZE_INICIADO',
            origenCanal: 'SSO_OIDC_BROKER',
            idInterno: existingSession.idInterno,
            cuentaId: existingSession.cuentaId,
            correoAfectado: existingSession.emailPrincipal,
            sujetoIdentificacion: existingSession.numeroIdentificacion,
            entidadAfectada: 'CLIENTE_OIDC',
            registroAfectadoId: client.oidcClientId,
            traceId: input.traceId,
            valoresNuevos: {
              modo: 'SILENT_SSO',
              clientId: client.oidcClientId,
              sessionId: existingSession.sessionId,
              scopes,
            },
          });

          const redirectTarget = new URL(validatedRedirectUri);
          redirectTarget.searchParams.set('code', codeId);
          redirectTarget.searchParams.set('state', input.state);

          return {
            outcome: 'SILENT_SSO_REDIRECT',
            redirectUrl: redirectTarget.toString(),
            sessionId: existingSession.sessionId,
          };
        }
      } else {
        clearSessionCookie = true;
      }
    }

    if (input.prompt === 'none') {
      throw new OidcSecurityError({
        codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
        statusCode: 401,
        mensajeUsuario:
          'Se solicitó prompt=none pero no existe sesión central SSO activa o vigente.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio:
            'El cliente OIDC solicitó autenticación silenciosa (prompt=none) sin sesión activa en Redis.',
          impactoOperativo: 'El broker devolvió rechazo controlado sin redirigir a Google.',
          accionRecomendada:
            'Inicie una solicitud interactiva a /authorize sin prompt=none.',
        },
      });
    }

    const googleState = randomBytes(32).toString('base64url');
    const googleNonce = randomBytes(24).toString('base64url');
    const googleCodeVerifier = randomBytes(32).toString('base64url');
    const googleCodeChallenge =
      this.pkceValidator.computeS256CodeChallenge(googleCodeVerifier);

    const correlation: CorrelacionFederacionGoogle = {
      googleState,
      clientId: client.oidcClientId,
      redirectUri: validatedRedirectUri,
      scope: scopes.join(' '),
      clientState: input.state,
      clientNonce: input.nonce,
      codeChallenge: validCodeChallenge,
      codeChallengeMethod: 'S256',
      googleNonce,
      googleCodeVerifier,
      requestedHd: input.hd,
      traceId: input.traceId,
      createdAtIso: new Date().toISOString(),
    };

    await this.sessionStore.saveGoogleFederationState(
      correlation,
      FEDERATION_CORRELATION_TTL_SECONDS,
    );

    const googleRedirectUrl = await this.googleIdp.buildAuthorizationRedirectUrl({
      googleState,
      googleNonce,
      googleCodeChallenge,
      hdHint: input.hd,
      prompt: input.prompt,
    });

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_AUTHORIZE_INICIADO',
      origenCanal: 'SSO_OIDC_BROKER',
      entidadAfectada: 'CLIENTE_OIDC',
      registroAfectadoId: client.oidcClientId,
      traceId: input.traceId,
      valoresNuevos: {
        modo: 'REDIRECT_TO_GOOGLE_IDP',
        clientId: client.oidcClientId,
        scopes,
      },
    });

    this.logger.info('Redirección OIDC iniciada hacia Google Cloud Identity', {
      clientId: client.oidcClientId,
      traceId: input.traceId,
    });

    return {
      outcome: 'REDIRECT_TO_GOOGLE_IDP',
      redirectUrl: googleRedirectUrl,
      clearSessionCookie,
    };
  }
}
