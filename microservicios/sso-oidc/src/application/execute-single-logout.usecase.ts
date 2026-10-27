import { AuditEventWriter, StructuredLogger } from '@minedec/shared';

import {
  SesionCentralOidc,
} from '../domain/entities/oidc-broker.entities';
import {
  BackchannelLogoutDispatchTarget,
  IBackchannelLogoutDispatcherPort,
  IJwksKeyStorePort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
} from '../domain/ports/oidc-broker.ports';
import {
  ExactRedirectUriValidator,
  OidcSecurityError,
} from '../domain/services/oidc-security.services';

export interface ExecuteSingleLogoutInput {
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  clientId?: string;
  state?: string;
  currentSessionId?: string;
  issuer: string;
  traceId: string;
}

export interface ExecuteSingleLogoutResult {
  destroyedSessionIds: string[];
  postLogoutRedirectUrl: string | null;
  backchannelDispatchedCount: number;
}

/**
 * Caso de uso para `GET /logout` y `POST /logout` (RP-Initiated Single Logout + Back-Channel Logout, `FR-008`, `US4`).
 * Destruye la sesión central en Redis, invalida códigos pendientes, notifica a las aplicaciones
 * participantes vía Back-Channel Logout y valida `post_logout_redirect_uri` por coincidencia exacta.
 * Libre de decoradores InversifyJS (Principio XVIII).
 */
export class ExecuteSingleLogoutUseCase {
  constructor(
    private readonly clientRepository: IOidcClientRepositoryPort,
    private readonly sessionStore: IOidcSessionStorePort,
    private readonly jwksKeyStore: IJwksKeyStorePort,
    private readonly backchannelDispatcher: IBackchannelLogoutDispatcherPort,
    private readonly redirectUriValidator: ExactRedirectUriValidator,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  async execute(
    input: ExecuteSingleLogoutInput,
  ): Promise<ExecuteSingleLogoutResult> {
    let verifiedHint: { sub: string; sid?: string; aud: string } | null = null;

    if (input.idTokenHint && input.idTokenHint.trim().length > 0) {
      verifiedHint = await this.jwksKeyStore.verifySsoOidcIdTokenHint(
        input.idTokenHint.trim(),
      );
    }

    // 1. Validar post_logout_redirect_uri ANTES de redirigir (prevención de Open Redirect, FR-002 / FR-008)
    let validatedRedirectUrl: string | null = null;
    const effectiveClientId = input.clientId ?? verifiedHint?.aud;

    if (
      input.postLogoutRedirectUri &&
      input.postLogoutRedirectUri.trim().length > 0
    ) {
      if (!effectiveClientId) {
        throw new OidcSecurityError({
          codigoError: 'REDIRECT_URI_NO_REGISTRADA',
          statusCode: 400,
          mensajeUsuario:
            'No se pudo verificar la dirección de retorno posterior al cierre de sesión.',
          reintentarPermitido: false,
          diagnosticoAdministrador: {
            queOcurrio:
              'Se solicitó post_logout_redirect_uri sin client_id ni id_token_hint válido.',
            impactoOperativo:
              'Se bloqueó la redirección posterior al logout para evitar Open Redirect.',
            accionRecomendada:
              'Incluya id_token_hint o client_id al invocar /logout con post_logout_redirect_uri.',
          },
        });
      }

      const cliente =
        await this.clientRepository.findByOidcClientId(effectiveClientId);
      if (!cliente) {
        throw new OidcSecurityError({
          codigoError: 'CLIENTE_OIDC_NO_AUTORIZADO',
          statusCode: 400,
          mensajeUsuario:
            'La aplicación solicitante del cierre de sesión no se encuentra registrada.',
          reintentarPermitido: false,
          diagnosticoAdministrador: {
            queOcurrio: `El client_id '${effectiveClientId}' no existe en cliente_oidc durante /logout.`,
            impactoOperativo: 'Se rechazó post_logout_redirect_uri.',
            accionRecomendada:
              'Verifique el client_id configurado en el RP.',
          },
        });
      }

      this.redirectUriValidator.assertExactRedirectUriRegistered(
        cliente,
        input.postLogoutRedirectUri,
        'POST_LOGOUT',
      );

      const redirectTarget = new URL(input.postLogoutRedirectUri);
      if (input.state && input.state.trim().length > 0) {
        redirectTarget.searchParams.set('state', input.state);
      }
      validatedRedirectUrl = redirectTarget.toString();
    }

    // 2. Destruir sesión central en Redis y purgar códigos efímeros asociados
    const destroyedSessions: SesionCentralOidc[] = [];
    const candidateSessionIds = new Set<string>();

    if (input.currentSessionId) {
      candidateSessionIds.add(input.currentSessionId);
    }
    if (verifiedHint?.sid) {
      candidateSessionIds.add(verifiedHint.sid);
    }

    for (const sid of candidateSessionIds) {
      await this.sessionStore.purgeAuthorizationCodesForSession(sid);
      const destroyed = await this.sessionStore.destroySession(sid);
      if (destroyed) {
        destroyedSessions.push(destroyed);
      }
    }

    if (destroyedSessions.length === 0 && verifiedHint?.sub) {
      const purgedByPerson = await this.sessionStore.purgeSessionsByPerson(
        verifiedHint.sub,
      );
      destroyedSessions.push(...purgedByPerson);
    }

    // 3. Despachar Back-Channel Logout a todos los clientes participantes con URI BACKCHANNEL_LOGOUT activa
    const backchannelTargets: BackchannelLogoutDispatchTarget[] = [];
    const allParticipatingClientIds = Array.from(
      new Set(
        destroyedSessions.flatMap((session) => session.participatingClientIds),
      ),
    );

    if (allParticipatingClientIds.length > 0) {
      const clientes = await this.clientRepository.findByOidcClientIds(
        allParticipatingClientIds,
      );
      const clientMap = new Map(
        clientes.map((cliente) => [cliente.oidcClientId, cliente]),
      );

      for (const session of destroyedSessions) {
        for (const oidcClientId of session.participatingClientIds) {
          const cliente = clientMap.get(oidcClientId);
          if (!cliente) {
            continue;
          }
          const backchannelUriEntry = cliente.redirectUris.find(
            (entry) => entry.activo && entry.tipoUri === 'BACKCHANNEL_LOGOUT',
          );
          if (backchannelUriEntry) {
            backchannelTargets.push({
              oidcClientId,
              backchannelLogoutUri: backchannelUriEntry.uri,
              idInterno: session.idInterno,
              sessionId: session.sessionId,
            });
          }
        }
      }
    }

    let backchannelDispatchedCount = 0;
    if (backchannelTargets.length > 0) {
      const dispatchSummary =
        await this.backchannelDispatcher.dispatchLogoutTokens({
          issuer: input.issuer,
          targets: backchannelTargets,
          traceId: input.traceId,
        });
      backchannelDispatchedCount = dispatchSummary.dispatchedCount;
    }

    const primarySession = destroyedSessions[0];
    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_SLO_EJECUTADO',
      origenCanal: 'SSO_OIDC_BROKER',
      idInterno: primarySession?.idInterno ?? verifiedHint?.sub ?? null,
      cuentaId: primarySession?.cuentaId ?? null,
      correoAfectado: primarySession?.emailPrincipal ?? null,
      sujetoIdentificacion: primarySession?.numeroIdentificacion ?? undefined,
      entidadAfectada: 'cuenta_institucional',
      registroAfectadoId: primarySession?.cuentaId ?? null,
      traceId: input.traceId,
      valoresNuevos: {
        destroyedSessionIds: destroyedSessions.map((s) => s.sessionId),
        participatingClientIds: allParticipatingClientIds,
        backchannelDispatchedCount,
        postLogoutRedirectSolicitado: Boolean(input.postLogoutRedirectUri),
      },
    });

    this.logger.info('Single Logout (SLO) procesado en sso-oidc', {
      traceId: input.traceId,
      destroyedSessionsCount: destroyedSessions.length,
      backchannelDispatchedCount,
    });

    return {
      destroyedSessionIds: destroyedSessions.map((s) => s.sessionId),
      postLogoutRedirectUrl: validatedRedirectUrl,
      backchannelDispatchedCount,
    };
  }
}
