import { AuditEventWriter, StructuredLogger } from '@minedec/shared';

import {
  MotivoRevocacionOidc,
  SesionCentralOidc,
} from '../domain/entities/oidc-broker.entities';
import {
  BackchannelLogoutDispatchTarget,
  IBackchannelLogoutDispatcherPort,
  IOidcClientRepositoryPort,
  IOidcSessionStorePort,
} from '../domain/ports/oidc-broker.ports';

export interface RevokeIdentitySessionsInput {
  idInterno?: string;
  cuentaId?: string;
  emailPrincipal?: string;
  motivoRevocacion: MotivoRevocacionOidc;
  eventoOrigenId?: string;
  issuer: string;
  traceId: string;
}

export interface RevokeIdentitySessionsResult {
  purgedSessionIds: string[];
  backchannelDispatchedCount: number;
}

/**
 * Caso de uso para `POST /internal/v1/oidc/events/identity-revoked` (Cloud Pub/Sub push, `RF-GI-06`, `RF-AUT-06`, `FR-008`, `US4`).
 * Purga inmediatamente todas las sesiones centrales y códigos efímeros en Memorystore for Redis
 * por `cuenta_id` e `id_interno`, notifica a clientes participantes vía Back-Channel Logout
 * y registra auditoría inmutable (`OIDC_SESION_REVOCADA_PUBSUB`), garantizando el SLA `<= 300 s`.
 * Libre de decoradores InversifyJS (Principio XVIII).
 */
export class RevokeIdentitySessionsUseCase {
  constructor(
    private readonly clientRepository: IOidcClientRepositoryPort,
    private readonly sessionStore: IOidcSessionStorePort,
    private readonly backchannelDispatcher: IBackchannelLogoutDispatcherPort,
    private readonly auditWriter: AuditEventWriter,
    private readonly logger: StructuredLogger,
  ) {}

  async execute(
    input: RevokeIdentitySessionsInput,
  ): Promise<RevokeIdentitySessionsResult> {
    const destroyedSessionsMap = new Map<string, SesionCentralOidc>();

    if (input.cuentaId) {
      const purgedByAccount = await this.sessionStore.purgeSessionsByAccount(
        input.cuentaId,
      );
      for (const session of purgedByAccount) {
        destroyedSessionsMap.set(session.sessionId, session);
      }
    }

    if (input.idInterno) {
      const purgedByPerson = await this.sessionStore.purgeSessionsByPerson(
        input.idInterno,
      );
      for (const session of purgedByPerson) {
        destroyedSessionsMap.set(session.sessionId, session);
      }
    }

    const destroyedSessions = Array.from(destroyedSessionsMap.values());

    for (const session of destroyedSessions) {
      await this.sessionStore.purgeAuthorizationCodesForSession(
        session.sessionId,
      );
    }

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

    await this.auditWriter.appendEvent({
      tipoEvento: 'OIDC_SESION_REVOCADA_PUBSUB',
      origenCanal: 'SSO_OIDC_BROKER',
      idInterno:
        input.idInterno ?? destroyedSessions[0]?.idInterno ?? null,
      cuentaId:
        input.cuentaId ?? destroyedSessions[0]?.cuentaId ?? null,
      correoAfectado:
        input.emailPrincipal ?? destroyedSessions[0]?.emailPrincipal ?? null,
      sujetoIdentificacion:
        destroyedSessions[0]?.numeroIdentificacion ?? undefined,
      entidadAfectada: 'cuenta_institucional',
      registroAfectadoId:
        input.cuentaId ?? destroyedSessions[0]?.cuentaId ?? undefined,
      traceId: input.traceId,
      valoresNuevos: {
        motivoRevocacion: input.motivoRevocacion,
        eventoOrigenId: input.eventoOrigenId ?? null,
        purgedSessionIds: destroyedSessions.map((s) => s.sessionId),
        backchannelDispatchedCount,
      },
    });

    this.logger.info(
      'Sesiones OIDC revocadas inmediatamente por evento administrativo Pub/Sub',
      {
        traceId: input.traceId,
        motivoRevocacion: input.motivoRevocacion,
        purgedSessionsCount: destroyedSessions.length,
        backchannelDispatchedCount,
      },
    );

    return {
      purgedSessionIds: destroyedSessions.map((s) => s.sessionId),
      backchannelDispatchedCount,
    };
  }
}
