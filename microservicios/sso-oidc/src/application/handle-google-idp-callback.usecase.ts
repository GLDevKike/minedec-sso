import crypto from 'crypto';

import { AuditEventWriter, StructuredLogger } from '@minedec/shared';

import {
  CodigoAutorizacionEfimero,
  SesionCentralOidc,
} from '../domain/entities/oidc-broker.entities';
import {
  IGoogleIdpFederationPort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
  IPipIdentityResolverPort,
} from '../domain/ports/oidc-broker.ports';
import { OidcSecurityError } from '../domain/services/oidc-security.services';

export interface HandleGoogleIdpCallbackInput {
  googleCode?: string;
  googleState?: string;
  googleError?: string;
  googleErrorDescription?: string;
  traceId: string;
}

export interface HandleGoogleIdpCallbackResult {
  clientRedirectUrl: string;
  sessionId: string;
  sessionCookieMaxAgeSeconds: number;
  idInterno: string;
  fueRegistroCaliente: boolean;
}

const DEFAULT_SESSION_TTL_SECONDS = 28_800;
const AUTHORIZATION_CODE_TTL_SECONDS = 60;

/**
 * Caso de uso para procesar `GET /callback` desde Google Cloud Identity (`DA-11`, `RF-GI-01`, `FR-006`).
 * Verifica estado correlacionado, intercambia el código con Google, valida el dominio institucional,
 * resuelve/registra en caliente en el PIP (con espera local acotada <= 3.000 ms y 0 llamadas a Google Admin SDK),
 * emite código efímero de uso único (TTL <= 60 s) y crea/actualiza la sesión central SSO en Redis.
 * Libre de decoradores InversifyJS (Principio XVIII).
 */
export class HandleGoogleIdpCallbackUseCase {
  constructor(
    private readonly clientRepository: IOidcClientRepositoryPort,
    private readonly sessionStore: IOidcSessionStorePort,
    private readonly googleIdpPort: IGoogleIdpFederationPort,
    private readonly pipResolverPort: IPipIdentityResolverPort,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  async execute(
    input: HandleGoogleIdpCallbackInput,
  ): Promise<HandleGoogleIdpCallbackResult> {
    if (!input.googleState || input.googleState.trim().length === 0) {
      throw new OidcSecurityError({
        codigoError: 'PKCE_S256_OBLIGATORIO',
        statusCode: 400,
        mensajeUsuario:
          'La respuesta de autenticación institucional no contiene un estado de correlación válido.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio:
            'El callback desde Google Cloud Identity llegó sin parámetro state.',
          impactoOperativo:
            'Se rechazó el callback para prevenir ataques CSRF / Login-CSRF.',
          accionRecomendada:
            'Inicie nuevamente el flujo de autenticación desde la aplicación institucional.',
        },
      });
    }

    const correlation = await this.sessionStore.consumeGoogleFederationState(
      input.googleState,
    );
    if (!correlation) {
      throw new OidcSecurityError({
        codigoError: 'PKCE_S256_OBLIGATORIO',
        statusCode: 400,
        mensajeUsuario:
          'La solicitud de inicio de sesión expiró o ya fue procesada. Por favor intente ingresar nuevamente.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio:
            'El state de correlación de federación no existe en Redis o ya fue consumido.',
          impactoOperativo:
            'Se bloqueó el callback huérfano o repetido conforme a OIDC Core.',
          accionRecomendada:
            'Solicite al usuario iniciar sesión nuevamente desde la aplicación cliente.',
        },
      });
    }

    if (input.googleError || !input.googleCode) {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        entidadAfectada: 'cliente_oidc',
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'ERROR_DEVUELTO_POR_GOOGLE_IDP',
          googleError: input.googleError ?? 'missing_code',
          googleErrorDescription: input.googleErrorDescription ?? null,
          oidcClientId: correlation.clientId,
        },
      });

      throw new OidcSecurityError({
        codigoError: 'DOMINIO_EXTERNO_RECHAZADO',
        statusCode: 403,
        mensajeUsuario:
          'No se pudo completar la autenticación institucional con Google Workspace.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio: `Google Cloud Identity devolvió error '${input.googleError ?? 'missing_code'}'.`,
          impactoOperativo: 'No se emitió sesión central ni código OIDC.',
          accionRecomendada:
            'Verifique que el usuario utilice su cuenta institucional @educacion.gob.ec.',
        },
      });
    }

    // 1. Intercambiar código de Google y verificar id_token RS256 de Google Cloud Identity
    const googleClaims =
      await this.googleIdpPort.exchangeGoogleCodeAndVerifyIdToken({
        googleCode: input.googleCode,
        googleCodeVerifier: correlation.googleCodeVerifier,
        expectedNonce: correlation.googleNonce,
      });

    // 2. Verificar que el dominio (`hd`) pertenezca al catálogo activo en AlloyDB (`FR-002`, `US1`)
    const normalizedDomain = (googleClaims.hd ?? '').trim().toLowerCase();
    const isAllowedDomain = normalizedDomain
      ? await this.clientRepository.isInstitutionalDomainActive(normalizedDomain)
      : false;

    if (!isAllowedDomain) {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        correoAfectado: googleClaims.emailPrincipal,
        entidadAfectada: 'catalogo_dominio_institucional',
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'DOMINIO_EXTERNO_NO_AUTORIZADO',
          dominioRecibido: googleClaims.hd ?? 'SIN_HD',
          googleSubId: googleClaims.googleSubId,
          oidcClientId: correlation.clientId,
        },
      });

      this.logger.warn('Cuenta de dominio no institucional rechazada en callback OIDC', {
        traceId: input.traceId,
        dominio: googleClaims.hd ?? 'SIN_HD',
        clientId: correlation.clientId,
      });

      throw new OidcSecurityError({
        codigoError: 'DOMINIO_EXTERNO_RECHAZADO',
        statusCode: 403,
        mensajeUsuario:
          'Solo se permite el acceso con cuentas institucionales autorizadas del Ministerio de Educación, Deporte y Cultura.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio: `La cuenta autenticada pertenece al dominio '${googleClaims.hd ?? 'externo'}', que no está activo en catalogo_dominio_institucional.`,
          impactoOperativo:
            'Se denegó la federación OIDC y no se creó sesión central.',
          accionRecomendada:
            'Indique al usuario autenticarse con su cuenta institucional @educacion.gob.ec.',
        },
      });
    }

    // 3. Resolver identidad en el Directorio Único PIP (`US3`, `FR-006`)
    const pipResolution =
      await this.pipResolverPort.resolveIdentityForOidcCallback({
        googleClaims,
        traceId: input.traceId,
      });

    if (pipResolution.estadoResolucion === 'CUENTA_SUSPENDIDA_O_INACTIVA') {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_RECHAZO_SEGURIDAD',
        origenCanal: 'SSO_OIDC_BROKER',
        idInterno: pipResolution.idInterno ?? null,
        cuentaId: pipResolution.cuentaId ?? null,
        correoAfectado: googleClaims.emailPrincipal,
        entidadAfectada: 'cuenta_institucional',
        registroAfectadoId: pipResolution.cuentaId ?? undefined,
        traceId: input.traceId,
        valoresNuevos: {
          motivo: 'CUENTA_SUSPENDIDA_O_PERSONA_INACTIVA',
          estadoPersona: pipResolution.estadoPersona ?? null,
          suspendedEnGws: pipResolution.suspendedEnGws ?? null,
          oidcClientId: correlation.clientId,
        },
      });

      throw new OidcSecurityError({
        codigoError: 'CUENTA_SUSPENDIDA_O_INACTIVA',
        statusCode: 403,
        mensajeUsuario:
          'Su cuenta institucional se encuentra suspendida o inactiva. Comuníquese con la Mesa de Ayuda Institucional.',
        reintentarPermitido: false,
        diagnosticoAdministrador: {
          queOcurrio:
            pipResolution.motivoDenegacion ??
            'La identidad figura como suspendida o inactiva en el Directorio Único PIP.',
          impactoOperativo:
            'Fail-close aplicado: se impidió la creación de sesión central y la emisión de código OIDC.',
          accionRecomendada:
            'Verifique el estado administrativo del funcionario y su cuenta en Google Workspace.',
        },
      });
    }

    if (
      pipResolution.estadoResolucion === 'PENDIENTE_IDENTIFICACION_RETENIDA' ||
      !pipResolution.idInterno ||
      !pipResolution.cuentaId ||
      !pipResolution.tipoIdentificacion ||
      !pipResolution.numeroIdentificacion ||
      !pipResolution.nombreCompleto
    ) {
      await this.auditWriter.appendEvent({
        tipoEvento: 'OIDC_REGISTRO_CALIENTE_PENDIENTE_BLOQUEADO',
        origenCanal: 'SSO_OIDC_BROKER',
        idInterno: pipResolution.idInterno ?? null,
        cuentaId: pipResolution.cuentaId ?? null,
        correoAfectado: googleClaims.emailPrincipal,
        entidadAfectada: 'persona_identidad',
        registroAfectadoId: pipResolution.idInterno ?? undefined,
        traceId: input.traceId,
        valoresNuevos: {
          googleSubId: googleClaims.googleSubId,
          oidcClientId: correlation.clientId,
          intentosEsperaRealizados: pipResolution.intentosEsperaRealizados,
          estadoSincronizacion:
            pipResolution.estadoSincronizacion ?? 'PENDIENTE_IDENTIFICACION',
        },
      });

      throw new OidcSecurityError({
        codigoError: 'IDENTIDAD_PENDIENTE_SINCRONIZACION',
        statusCode: 403,
        mensajeUsuario:
          'Su cuenta institucional fue registrada recientemente y su identificación oficial se encuentra en proceso de consolidación. Por favor intente nuevamente en unos momentos.',
        reintentarPermitido: true,
        diagnosticoAdministrador: {
          queOcurrio:
            'La cuenta fue registrada en caliente en el PIP pero permanece en estado PENDIENTE_IDENTIFICACION tras la ventana de espera local acotada (<= 3.000 ms).',
          impactoOperativo:
            'No se emitió código OIDC ni id_token sin identificación oficial verificada (FR-006). El job de conciliación consolidará el registro asíncronamente.',
          accionRecomendada:
            'Espere a que el Sincronizador / Job de Conciliación complete el enriquecimiento de MINEDEC_Perfil o verifique el atributo identificación en Google Workspace.',
        },
      });
    }

    // 4. Crear sesión central en Redis y código efímero OIDC (TTL <= 60 s)
    const nowIso = new Date().toISOString();
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const sessionId = crypto.randomUUID();
    const codeId = crypto.randomBytes(32).toString('base64url');

    const session: SesionCentralOidc = {
      sessionId,
      idInterno: pipResolution.idInterno,
      cuentaId: pipResolution.cuentaId,
      googleSubId: pipResolution.googleSubId,
      emailPrincipal: pipResolution.emailPrincipal,
      dominio: pipResolution.dominio,
      tipoIdentificacion: pipResolution.tipoIdentificacion,
      numeroIdentificacion: pipResolution.numeroIdentificacion,
      nombreCompleto: pipResolution.nombreCompleto,
      participatingClientIds: [correlation.clientId],
      createdAt: nowIso,
      lastPipValidatedAt: nowIso,
    };

    const ephemeralCode: CodigoAutorizacionEfimero = {
      codeId,
      clientId: correlation.clientId,
      redirectUri: correlation.redirectUri,
      scope: correlation.scope,
      codeChallenge: correlation.codeChallenge,
      codeChallengeMethod: 'S256',
      nonce: correlation.clientNonce,
      sessionId,
      idInterno: pipResolution.idInterno,
      cuentaId: pipResolution.cuentaId,
      googleSubId: pipResolution.googleSubId,
      emailPrincipal: pipResolution.emailPrincipal,
      dominio: pipResolution.dominio,
      tipoIdentificacion: pipResolution.tipoIdentificacion,
      numeroIdentificacion: pipResolution.numeroIdentificacion,
      nombreCompleto: pipResolution.nombreCompleto,
      authTimeEpochSeconds: nowEpochSeconds,
      issuedAtEpochSeconds: nowEpochSeconds,
      expiresAtEpochSeconds: nowEpochSeconds + AUTHORIZATION_CODE_TTL_SECONDS,
    };

    await this.sessionStore.saveSession(session, DEFAULT_SESSION_TTL_SECONDS);
    await this.sessionStore.saveAuthorizationCode(
      ephemeralCode,
      AUTHORIZATION_CODE_TTL_SECONDS,
    );

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_FEDERACION_GOOGLE_EXITOSA',
      origenCanal: 'SSO_OIDC_BROKER',
      idInterno: pipResolution.idInterno,
      cuentaId: pipResolution.cuentaId,
      correoAfectado: pipResolution.emailPrincipal,
      sujetoIdentificacion: pipResolution.numeroIdentificacion,
      entidadAfectada: 'cuenta_institucional',
      registroAfectadoId: pipResolution.cuentaId,
      traceId: input.traceId,
      valoresNuevos: {
        oidcClientId: correlation.clientId,
        sessionId,
        fueRegistroCaliente: Boolean(pipResolution.fueRegistroCaliente),
      },
    });

    const redirectUrl = new URL(correlation.redirectUri);
    redirectUrl.searchParams.set('code', codeId);
    redirectUrl.searchParams.set('state', correlation.clientState);

    return {
      clientRedirectUrl: redirectUrl.toString(),
      sessionId,
      sessionCookieMaxAgeSeconds: DEFAULT_SESSION_TTL_SECONDS,
      idInterno: pipResolution.idInterno,
      fueRegistroCaliente: Boolean(pipResolution.fueRegistroCaliente),
    };
  }
}
