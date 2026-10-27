import {
  GWS_DIRECTORY_READONLY_SCOPE,
  GwsDirectoryListPage,
  GwsDirectoryListParams,
  GwsDirectoryReadOnlyAdapter,
  GwsDirectoryReadOnlyAdapterOptions,
  GwsDirectoryUserRecord,
  GwsReadOnlyViolationError,
} from '@minedec/shared';
import { IGoogleDirectoryReadOnlyPort } from '../../domain/ports/sync-ports';

export {
  GWS_DIRECTORY_READONLY_SCOPE,
  GwsDirectoryReadOnlyAdapter,
  GwsReadOnlyViolationError,
};

/**
 * Adaptador de solo lectura de Google Workspace Admin SDK Directory API (`T017`).
 * Utiliza exclusivamente `IAM Credentials API signJwt` (`admin.directory.user.readonly`, 0 llaves JSON)
 * y bloquea estática y dinámicamente cualquier método de escritura.
 */
export class SincronizadorGwsDirectoryReadOnlyAdapter
  extends GwsDirectoryReadOnlyAdapter
  implements IGoogleDirectoryReadOnlyPort
{
  constructor(options: GwsDirectoryReadOnlyAdapterOptions) {
    super(options);
  }

  public override async getUserReadOnly(
    userKey: string,
    traceId?: string,
  ): Promise<GwsDirectoryUserRecord | null> {
    return super.getUserReadOnly(userKey, traceId);
  }

  public override async listUsersReadOnly(
    params: GwsDirectoryListParams,
    traceId?: string,
  ): Promise<GwsDirectoryListPage> {
    return super.listUsersReadOnly(params, traceId);
  }
}
