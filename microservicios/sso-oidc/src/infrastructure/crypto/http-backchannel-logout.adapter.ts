import { StructuredLogger } from '@minedec/shared';
import {
  BackchannelLogoutDispatchTarget,
  IBackchannelLogoutDispatcherPort,
  IJwksKeyStorePort,
} from '../../domain/ports/oidc-broker.ports';
import { BackchannelLogoutTokenBuilder } from '../../domain/services/oidc-security.services';

export type BackchannelHttpPostFn = (params: {
  url: string;
  logoutTokenJwt: string;
  traceId: string;
  timeoutMs: number;
}) => Promise<{ status: number }>;

export interface HttpBackchannelLogoutDispatcherOptions {
  timeoutMs?: number;
  httpPostFn?: BackchannelHttpPostFn;
}

const DEFAULT_BACKCHANNEL_TIMEOUT_MS = 2_500;

async function defaultHttpPostFn(params: {
  url: string;
  logoutTokenJwt: string;
  traceId: string;
  timeoutMs: number;
}): Promise<{ status: number }> {
  const body = new URLSearchParams({
    logout_token: params.logoutTokenJwt,
  }).toString();

  const response = await fetch(params.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cache-control': 'no-store',
      'x-trace-id': params.traceId,
    },
    body,
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  return { status: response.status };
}

/**
 * Adaptador HTTP para envío de `logout_token` OIDC Back-Channel Logout 1.0
 * a cada Relying Party participante con `BACKCHANNEL_LOGOUT` configurado (`T034`).
 */
export class HttpBackchannelLogoutDispatcherAdapter
  implements IBackchannelLogoutDispatcherPort
{
  private readonly timeoutMs: number;
  private readonly httpPostFn: BackchannelHttpPostFn;

  constructor(
    private readonly jwksKeyStore: IJwksKeyStorePort,
    private readonly logoutTokenBuilder: BackchannelLogoutTokenBuilder,
    private readonly logger: StructuredLogger,
    options: HttpBackchannelLogoutDispatcherOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BACKCHANNEL_TIMEOUT_MS;
    this.httpPostFn = options.httpPostFn ?? defaultHttpPostFn;
  }

  public async dispatchLogoutTokens(params: {
    issuer: string;
    targets: ReadonlyArray<BackchannelLogoutDispatchTarget>;
    traceId: string;
  }): Promise<{
    dispatchedCount: number;
    succeededCount: number;
    failedClients: string[];
  }> {
    if (params.targets.length === 0) {
      return {
        dispatchedCount: 0,
        succeededCount: 0,
        failedClients: [],
      };
    }

    const failedClients: string[] = [];
    let succeededCount = 0;

    await Promise.all(
      params.targets.map(async (target) => {
        try {
          const claims = this.logoutTokenBuilder.buildLogoutTokenClaims({
            issuer: params.issuer,
            oidcClientId: target.oidcClientId,
            idInterno: target.idInterno,
            sessionId: target.sessionId,
          });
          const { logoutTokenJwt } =
            await this.jwksKeyStore.signBackchannelLogoutToken(
              claims as unknown as Record<string, unknown>,
            );

          const response = await this.httpPostFn({
            url: target.backchannelLogoutUri,
            logoutTokenJwt,
            traceId: params.traceId,
            timeoutMs: this.timeoutMs,
          });

          if (response.status >= 200 && response.status < 300) {
            succeededCount += 1;
          } else {
            failedClients.push(target.oidcClientId);
            this.logger.warn(
              'Relying Party devolvió estado no exitoso en Back-Channel Logout',
              {
                oidcClientId: target.oidcClientId,
                status: response.status,
                traceId: params.traceId,
              },
            );
          }
        } catch (err) {
          failedClients.push(target.oidcClientId);
          this.logger.warn('Fallo despachando Back-Channel Logout a Relying Party', {
            oidcClientId: target.oidcClientId,
            error: err instanceof Error ? err.message : String(err),
            traceId: params.traceId,
          });
        }
      }),
    );

    return {
      dispatchedCount: params.targets.length,
      succeededCount,
      failedClients,
    };
  }
}
