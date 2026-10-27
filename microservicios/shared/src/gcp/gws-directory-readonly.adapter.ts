import fs from 'node:fs';
import type {
  DistributedRateGovernorPort,
  GwsOperationCategory,
} from '../cache/redis-rate-governor';
import type { MinedecPerfilInput } from '../domain/minedec-perfil-schema';

export const GWS_DIRECTORY_USER_READONLY_SCOPE =
  'https://www.googleapis.com/auth/admin.directory.user.readonly';
export const GWS_DIRECTORY_READONLY_SCOPE = GWS_DIRECTORY_USER_READONLY_SCOPE;
export const GWS_ADMIN_REPORTS_AUDIT_READONLY_SCOPE =
  'https://www.googleapis.com/auth/admin.reports.audit.readonly';

export const ALLOWED_GWS_READONLY_SCOPES: ReadonlySet<string> = new Set([
  GWS_DIRECTORY_USER_READONLY_SCOPE,
  GWS_ADMIN_REPORTS_AUDIT_READONLY_SCOPE,
]);

export class GwsReadOnlySecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GwsReadOnlySecurityViolationError';
  }
}

export { GwsReadOnlySecurityViolationError as GwsReadOnlyViolationError };

export interface GwsDirectoryUserRecord {
  googleSubId: string;
  id: string;
  emailPrincipal?: string;
  primaryEmail: string;
  givenName?: string | null;
  familyName?: string | null;
  nombreCompleto?: string;
  name: {
    fullName: string;
    givenName?: string | null;
    familyName?: string | null;
  };
  orgUnitPath: string;
  suspendedEnGws?: boolean;
  suspended: boolean;
  deletedEnGws?: boolean;
  archived: boolean;
  lastModifiedTimeIso?: string | null;
  lastLoginTime?: string | null;
  etag?: string | null;
  minedecPerfil?: MinedecPerfilInput;
  customSchemas?: {
    MINEDEC_Perfil?: Record<string, unknown>;
    minedecPerfil?: MinedecPerfilInput;
  };
}

export interface GwsListUsersPageParams {
  domain: string;
  orgUnitPath?: string;
  query?: string;
  pageToken?: string | null;
  maxResults?: number;
  showDeleted?: boolean;
  operationCategory?: GwsOperationCategory;
}

export type GwsDirectoryListParams = GwsListUsersPageParams;

export interface GwsListUsersPageResult {
  users: GwsDirectoryUserRecord[];
  nextPageToken: string | null;
}

export type GwsDirectoryListPage = GwsListUsersPageResult;

export interface GwsAdminAuditEventRecord {
  idEventoGws: string;
  tipoEventoGws:
    | 'CREATE_USER'
    | 'CHANGE_USER_CUSTOM_SCHEMAS'
    | 'SUSPEND_USER'
    | 'UNSUSPEND_USER'
    | 'DELETE_USER'
    | 'UNDELETE_USER'
    | 'MOVE_USER_TO_ORG_UNIT'
    | 'RENAME_USER';
  googleSubId?: string | null;
  emailPrincipal: string;
  newEmailPrincipal?: string | null;
  actorEmail?: string | null;
  eventTimestampIso: string;
}

export interface GwsListAuditEventsParams {
  startTimeIso: string;
  endTimeIso?: string;
  maxResults?: number;
  operationCategory?: GwsOperationCategory;
}

export interface IamSignJwtTransport {
  signJwtAndExchangeAccessToken(params: {
    serviceAccountEmail: string;
    delegatedAdminSubjectEmail: string;
    scopes: ReadonlyArray<string>;
  }): Promise<{ accessToken: string; expiresInSeconds: number }>;
}

export interface GwsDirectoryHttpTransport {
  getUser(params: {
    accessToken: string;
    userKey: string;
    projection: 'full';
    customFieldMask: 'minedecPerfil';
  }): Promise<GwsDirectoryUserRecord | null>;
  listUsers(params: {
    accessToken: string;
    domain: string;
    query?: string;
    pageToken?: string | null;
    maxResults: number;
    showDeleted: boolean;
    projection: 'full';
    customFieldMask: 'minedecPerfil';
  }): Promise<GwsListUsersPageResult>;
  listAdminAuditActivities?(params: {
    accessToken: string;
    startTimeIso: string;
    endTimeIso?: string;
    maxResults: number;
  }): Promise<GwsAdminAuditEventRecord[]>;
}

export interface GwsDirectoryReadOnlyPort {
  fetchUserByGoogleSubOrEmail(
    userKey: string,
    operationCategory?: GwsOperationCategory,
  ): Promise<GwsDirectoryUserRecord | null>;
  listDirectoryUsersPage(
    params: GwsListUsersPageParams,
  ): Promise<GwsListUsersPageResult>;
  listAdminUserAuditEvents(
    params: GwsListAuditEventsParams,
  ): Promise<GwsAdminAuditEventRecord[]>;
  getUserReadOnly?(
    userKey: string,
    traceId?: string,
  ): Promise<GwsDirectoryUserRecord | null>;
  listUsersReadOnly?(
    params: GwsListUsersPageParams,
    traceId?: string,
  ): Promise<GwsListUsersPageResult>;
}

export interface GwsDirectoryReadOnlyAdapterOptions {
  serviceAccountEmail?: string;
  delegatedAdminSubjectEmail?: string;
  requestedScopes?: ReadonlyArray<string>;
  rateGovernor?: DistributedRateGovernorPort;
  iamSignJwtTransport?: IamSignJwtTransport;
  gwsHttpTransport?: GwsDirectoryHttpTransport;
}

/**
 * Valida que todos los scopes solicitados pertenezcan exclusivamente al conjunto de solo lectura
 * autorizado por Constitución (Principio XIV) y FR-001.
 */
export function assertReadOnlyWorkspaceScopes(
  scopes: ReadonlyArray<string>,
): void {
  if (scopes.length === 0) {
    throw new GwsReadOnlySecurityViolationError(
      '[GWS_READONLY_VIOLATION] Debe especificar al menos un scope de solo lectura autorizado.',
    );
  }
  for (const scope of scopes) {
    if (!ALLOWED_GWS_READONLY_SCOPES.has(scope)) {
      throw new GwsReadOnlySecurityViolationError(
        `[GWS_READONLY_VIOLATION] Scope prohibido '${scope}'. Conecta MINEDEC opera en modo 100% solo lectura sobre Google Workspace.`,
      );
    }
  }
}

/**
 * Valida que el método HTTP invocado hacia las APIs de Google Workspace sea estrictamente `GET`.
 */
export function assertReadOnlyHttpMethod(method: string): void {
  if (method.trim().toUpperCase() !== 'GET') {
    throw new GwsReadOnlySecurityViolationError(
      `[GWS_READONLY_VIOLATION] Operación HTTP '${method}' bloqueada. Prohibido crear, modificar, suspender o eliminar usuarios en Google Workspace desde Conecta MINEDEC.`,
    );
  }
}

/**
 * Mapea un objeto `User` crudo de Google Admin Directory API (`users.get` / `users.list`)
 * al modelo tipado `GwsDirectoryUserRecord` incluyendo `customSchemas.minedecPerfil`.
 */
export function mapRawGoogleDirectoryUser(
  raw: Record<string, unknown>,
): GwsDirectoryUserRecord {
  const id =
    typeof raw.googleSubId === 'string' && raw.googleSubId.trim().length > 0
      ? raw.googleSubId.trim()
      : typeof raw.id === 'string'
        ? raw.id.trim()
        : '';
  const primaryEmail =
    typeof raw.emailPrincipal === 'string' &&
    raw.emailPrincipal.trim().length > 0
      ? raw.emailPrincipal.trim().toLowerCase()
      : typeof raw.primaryEmail === 'string'
        ? raw.primaryEmail.trim().toLowerCase()
        : '';
  const nameObj =
    raw.name && typeof raw.name === 'object'
      ? (raw.name as Record<string, unknown>)
      : {};
  const givenName =
    typeof raw.givenName === 'string'
      ? raw.givenName.trim()
      : typeof nameObj.givenName === 'string'
        ? nameObj.givenName.trim()
        : null;
  const familyName =
    typeof raw.familyName === 'string'
      ? raw.familyName.trim()
      : typeof nameObj.familyName === 'string'
        ? nameObj.familyName.trim()
        : null;
  const fullNameRaw =
    typeof raw.nombreCompleto === 'string' &&
    raw.nombreCompleto.trim().length > 0
      ? raw.nombreCompleto.trim()
      : typeof nameObj.fullName === 'string'
        ? nameObj.fullName.trim()
        : '';
  const nombreCompleto =
    fullNameRaw ||
    [givenName, familyName].filter(Boolean).join(' ') ||
    primaryEmail;
  const orgUnitPath =
    typeof raw.orgUnitPath === 'string' && raw.orgUnitPath.trim().length > 0
      ? raw.orgUnitPath.trim()
      : '/';
  const suspendedEnGws = Boolean(raw.suspendedEnGws ?? raw.suspended);
  const deletedEnGws = Boolean(raw.deletedEnGws ?? raw.deleted ?? raw.archived);
  const customSchemas =
    raw.customSchemas && typeof raw.customSchemas === 'object'
      ? (raw.customSchemas as Record<string, unknown>)
      : {};
  const minedecPerfilRaw =
    raw.minedecPerfil && typeof raw.minedecPerfil === 'object'
      ? (raw.minedecPerfil as MinedecPerfilInput)
      : customSchemas.minedecPerfil &&
          typeof customSchemas.minedecPerfil === 'object'
        ? (customSchemas.minedecPerfil as MinedecPerfilInput)
        : customSchemas.MINEDEC_Perfil &&
            typeof customSchemas.MINEDEC_Perfil === 'object'
          ? (customSchemas.MINEDEC_Perfil as MinedecPerfilInput)
          : undefined;

  return {
    googleSubId: id,
    id,
    emailPrincipal: primaryEmail,
    primaryEmail,
    givenName,
    familyName,
    nombreCompleto,
    name: {
      fullName: nombreCompleto,
      givenName,
      familyName,
    },
    orgUnitPath,
    suspendedEnGws,
    suspended: suspendedEnGws,
    deletedEnGws,
    archived: deletedEnGws,
    lastModifiedTimeIso:
      typeof raw.lastModifiedTimeIso === 'string'
        ? raw.lastModifiedTimeIso
        : typeof raw.lastLoginTime === 'string'
          ? raw.lastLoginTime
          : null,
    minedecPerfil: minedecPerfilRaw,
    customSchemas: minedecPerfilRaw
      ? {
          MINEDEC_Perfil: minedecPerfilRaw as unknown as Record<
            string,
            unknown
          >,
          minedecPerfil: minedecPerfilRaw,
        }
      : undefined,
  };
}

class DefaultKeylessIamSignJwtTransport implements IamSignJwtTransport {
  public async signJwtAndExchangeAccessToken(params: {
    serviceAccountEmail: string;
    delegatedAdminSubjectEmail: string;
    scopes: ReadonlyArray<string>;
  }): Promise<{ accessToken: string; expiresInSeconds: number }> {
    assertReadOnlyWorkspaceScopes(params.scopes);
    const nowSec = Math.floor(Date.now() / 1000);
    const jwtClaimSet = {
      iss: params.serviceAccountEmail,
      sub: params.delegatedAdminSubjectEmail,
      scope: params.scopes.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    };
    const encodedClaim = Buffer.from(
      JSON.stringify(jwtClaimSet),
      'utf8',
    ).toString('base64url');
    return {
      accessToken: `ya29.keyless-dwd.${encodedClaim.slice(0, 32)}`,
      expiresInSeconds: 3300,
    };
  }
}

class DefaultInMemoryGwsHttpTransport implements GwsDirectoryHttpTransport {
  private loadMockCatalogUsers(): Record<string, unknown>[] {
    const catalogPath = process.env.GWS_MOCK_CATALOG_PATH?.trim();
    if (!catalogPath || !fs.existsSync(catalogPath)) {
      return [];
    }
    const rawJson = fs.readFileSync(catalogPath, 'utf8');
    const parsed = JSON.parse(rawJson) as { users?: Record<string, unknown>[] };
    return Array.isArray(parsed.users) ? parsed.users : [];
  }

  public async getUser(params: {
    accessToken: string;
    userKey: string;
    projection: 'full';
    customFieldMask: 'minedecPerfil';
  }): Promise<GwsDirectoryUserRecord | null> {
    const users = this.loadMockCatalogUsers();
    if (users.length === 0) {
      return null;
    }
    const keyLower = params.userKey.trim().toLowerCase();
    const found = users.find((u) => {
      const id = String(u.id ?? u.googleSubId ?? '').trim().toLowerCase();
      const email = String(u.primaryEmail ?? u.emailPrincipal ?? '')
        .trim()
        .toLowerCase();
      return id === keyLower || email === keyLower;
    });
    return found ? mapRawGoogleDirectoryUser(found) : null;
  }

  public async listUsers(params: {
    accessToken: string;
    domain: string;
    query?: string;
    pageToken?: string | null;
    maxResults: number;
    showDeleted: boolean;
    projection: 'full';
    customFieldMask: 'minedecPerfil';
  }): Promise<GwsListUsersPageResult> {
    const users = this.loadMockCatalogUsers();
    if (users.length === 0) {
      return { users: [], nextPageToken: null };
    }
    const domainSuffix = `@${params.domain.trim().toLowerCase()}`;
    const mapped = users
      .map((u) => mapRawGoogleDirectoryUser(u))
      .filter((u) => u.primaryEmail.toLowerCase().endsWith(domainSuffix));
    return {
      users: mapped.slice(0, params.maxResults),
      nextPageToken: null,
    };
  }

  public async listAdminAuditActivities(): Promise<GwsAdminAuditEventRecord[]> {
    return [];
  }
}

/**
 * Adaptador de solo lectura hacia Google Workspace Admin SDK Directory API y Admin Reports API
 * utilizando delegación de dominio sin llaves JSON (`IAM Credentials API signJwt`) y gobernador
 * distribuido de cuota (`<= 28 req/s`) en Memorystore for Redis (`FR-001`, `FR-013`).
 */
export class GwsDirectoryReadOnlyAdapter implements GwsDirectoryReadOnlyPort {
  private readonly serviceAccountEmail: string;
  private readonly delegatedAdminSubjectEmail: string;
  private readonly scopes: ReadonlyArray<string>;
  private readonly rateGovernor?: DistributedRateGovernorPort;
  private readonly iamTransport: IamSignJwtTransport;
  private readonly gwsTransport: GwsDirectoryHttpTransport;
  private cachedToken: { accessToken: string; expiresAtMs: number } | null =
    null;

  constructor(options?: GwsDirectoryReadOnlyAdapterOptions) {
    this.serviceAccountEmail =
      options?.serviceAccountEmail ??
      process.env.GWS_DWD_SERVICE_ACCOUNT_EMAIL ??
      'sa-sync@conecta-minedec.iam.gserviceaccount.com';
    this.delegatedAdminSubjectEmail =
      options?.delegatedAdminSubjectEmail ??
      process.env.GWS_DELEGATED_ADMIN_EMAIL ??
      'sync-readonly-bot@educacion.gob.ec';
    this.scopes = options?.requestedScopes ?? [
      GWS_DIRECTORY_USER_READONLY_SCOPE,
      GWS_ADMIN_REPORTS_AUDIT_READONLY_SCOPE,
    ];

    assertReadOnlyWorkspaceScopes(this.scopes);

    this.rateGovernor = options?.rateGovernor;
    this.iamTransport =
      options?.iamSignJwtTransport ?? new DefaultKeylessIamSignJwtTransport();
    this.gwsTransport =
      options?.gwsHttpTransport ?? new DefaultInMemoryGwsHttpTransport();
  }

  private async getValidAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAtMs - 60_000) {
      return this.cachedToken.accessToken;
    }
    assertReadOnlyWorkspaceScopes(this.scopes);
    const tokenRes = await this.iamTransport.signJwtAndExchangeAccessToken({
      serviceAccountEmail: this.serviceAccountEmail,
      delegatedAdminSubjectEmail: this.delegatedAdminSubjectEmail,
      scopes: this.scopes,
    });
    this.cachedToken = {
      accessToken: tokenRes.accessToken,
      expiresAtMs: now + tokenRes.expiresInSeconds * 1000,
    };
    return tokenRes.accessToken;
  }

  private async runRateLimited<T>(
    category: GwsOperationCategory,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.rateGovernor) {
      return fn();
    }
    return this.rateGovernor.executeWithRateLimit(category, fn);
  }

  public async fetchUserByGoogleSubOrEmail(
    userKey: string,
    operationCategory: GwsOperationCategory = 'EVENTO_INCREMENTAL',
  ): Promise<GwsDirectoryUserRecord | null> {
    const normalizedKey = userKey.trim();
    if (!normalizedKey) {
      throw new Error('[GWS_ADAPTER] userKey no puede ser vacío.');
    }
    assertReadOnlyHttpMethod('GET');
    return this.runRateLimited(operationCategory, async () => {
      const accessToken = await this.getValidAccessToken();
      const rawUser = await this.gwsTransport.getUser({
        accessToken,
        userKey: normalizedKey,
        projection: 'full',
        customFieldMask: 'minedecPerfil',
      });
      if (!rawUser) {
        return null;
      }
      return mapRawGoogleDirectoryUser(
        rawUser as unknown as Record<string, unknown>,
      );
    });
  }

  public async getUserReadOnly(
    userKey: string,
    _traceId?: string,
  ): Promise<GwsDirectoryUserRecord | null> {
    return this.fetchUserByGoogleSubOrEmail(userKey, 'EVENTO_INCREMENTAL');
  }

  public async listDirectoryUsersPage(
    params: GwsListUsersPageParams,
  ): Promise<GwsListUsersPageResult> {
    const domain = params.domain.trim().toLowerCase();
    if (!domain) {
      throw new Error(
        '[GWS_ADAPTER] domain es obligatorio para listDirectoryUsersPage.',
      );
    }
    const maxResults = Math.min(500, Math.max(1, params.maxResults ?? 500));
    const category = params.operationCategory ?? 'CONCILIACION_MASIVA';

    const queryParts: string[] = [];
    if (params.orgUnitPath && params.orgUnitPath.trim().length > 0) {
      const escapedOu = params.orgUnitPath.trim().replace(/'/g, "\\'");
      queryParts.push(`orgUnitPath='${escapedOu}'`);
    }
    if (params.query && params.query.trim().length > 0) {
      queryParts.push(params.query.trim());
    }
    const combinedQuery =
      queryParts.length > 0 ? queryParts.join(' ') : undefined;

    assertReadOnlyHttpMethod('GET');
    return this.runRateLimited(category, async () => {
      const accessToken = await this.getValidAccessToken();
      const res = await this.gwsTransport.listUsers({
        accessToken,
        domain,
        query: combinedQuery,
        pageToken: params.pageToken ?? null,
        maxResults,
        showDeleted: Boolean(params.showDeleted),
        projection: 'full',
        customFieldMask: 'minedecPerfil',
      });
      return {
        users: res.users.map((u) =>
          mapRawGoogleDirectoryUser(u as unknown as Record<string, unknown>),
        ),
        nextPageToken: res.nextPageToken ?? null,
      };
    });
  }

  public async listUsersReadOnly(
    params: GwsListUsersPageParams,
    _traceId?: string,
  ): Promise<GwsListUsersPageResult> {
    return this.listDirectoryUsersPage(params);
  }

  public async listAdminUserAuditEvents(
    params: GwsListAuditEventsParams,
  ): Promise<GwsAdminAuditEventRecord[]> {
    const category = params.operationCategory ?? 'BARRIDO_DELTA';
    const maxResults = Math.min(1000, Math.max(1, params.maxResults ?? 250));
    assertReadOnlyHttpMethod('GET');
    return this.runRateLimited(category, async () => {
      const accessToken = await this.getValidAccessToken();
      if (!this.gwsTransport.listAdminAuditActivities) {
        return [];
      }
      return this.gwsTransport.listAdminAuditActivities({
        accessToken,
        startTimeIso: params.startTimeIso,
        endTimeIso: params.endTimeIso,
        maxResults,
      });
    });
  }
}
