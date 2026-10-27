import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import {
  quotePipIdentifier,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import {
  decodeProtectedHeader,
  importJWK,
  importPKCS8,
  JWK,
  jwtVerify,
  KeyLike,
  SignJWT,
} from 'jose';
import {
  EstadoLlaveJwks,
  LlaveJwksRotacion,
  MinedecIdTokenClaims,
  PublicRsaJwk,
  ServicioEmisorJwks,
} from '../../domain/entities/oidc-broker.entities';
import { IJwksKeyStorePort } from '../../domain/ports/oidc-broker.ports';

interface LlaveJwksRow {
  kid: string;
  servicio_emisor: ServicioEmisorJwks;
  algoritmo: 'RS256';
  secret_manager_version: string;
  public_jwk_json: PublicRsaJwk | string;
  estado_llave: EstadoLlaveJwks;
  activada_en: Date | string;
  expira_rotacion_en: Date | string;
  retirada_en: Date | string | null;
}

export type SecretPrivateKeyResolverFn = (
  secretManagerVersion: string,
  kid: string,
) => Promise<string>;

export interface AlloyDbAndSecretManagerJwksOptions {
  secretResolverFn?: SecretPrivateKeyResolverFn;
}

const SERVICIO_EMISOR_SSO_OIDC: ServicioEmisorJwks = 'SSO_OIDC';

function parsePublicJwk(raw: PublicRsaJwk | string): PublicRsaJwk {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as PublicRsaJwk;
  }
  return raw;
}

/**
 * Adaptador de rotación dual de llaves JWKS `RS256` (`<= 90 días`) respaldado por
 * AlloyDB (`llave_jwks_rotacion` filtrado por `servicio_emisor = 'SSO_OIDC'`) y
 * Google Secret Manager (`T040`).
 */
export class AlloyDbAndSecretManagerJwksAdapter implements IJwksKeyStorePort {
  private readonly secretResolverFn: SecretPrivateKeyResolverFn;
  private readonly privateKeyCache = new Map<string, KeyLike>();
  private readonly publicKeyCache = new Map<string, KeyLike>();

  constructor(
    private readonly db: SqlQueryExecutor,
    private readonly logger: StructuredLogger,
    options: AlloyDbAndSecretManagerJwksOptions = {},
  ) {
    if (options.secretResolverFn) {
      this.secretResolverFn = options.secretResolverFn;
    } else {
      const smClient = new SecretManagerServiceClient();
      this.secretResolverFn = async (secretManagerVersion: string): Promise<string> => {
        const [version] = await smClient.accessSecretVersion({
          name: secretManagerVersion,
        });
        const payload = version.payload?.data
          ? Buffer.from(version.payload.data).toString('utf8')
          : '';
        if (!payload.trim()) {
          throw new Error(
            `Secret Manager devolvió payload vacío para ${secretManagerVersion}`,
          );
        }
        return payload;
      };
    }
  }

  public async getPublishedPublicKeysForSsoOidc(): Promise<{
    activeKid: string | null;
    keys: PublicRsaJwk[];
    metadata: LlaveJwksRotacion[];
  }> {
    const tableJwks = quotePipIdentifier('llave_jwks_rotacion');
    const result = await this.db.query<LlaveJwksRow>(
      `SELECT
         kid,
         servicio_emisor,
         algoritmo,
         secret_manager_version,
         public_jwk_json,
         estado_llave,
         activada_en,
         expira_rotacion_en,
         retirada_en
       FROM ${tableJwks}
       WHERE servicio_emisor = $1
         AND estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')
       ORDER BY
         CASE WHEN estado_llave = 'ACTIVA_FIRMA' THEN 0 ELSE 1 END ASC,
         activada_en DESC`,
      [SERVICIO_EMISOR_SSO_OIDC],
    );

    const metadata: LlaveJwksRotacion[] = result.rows.map((row) => ({
      kid: row.kid,
      servicioEmisor: row.servicio_emisor,
      algoritmo: row.algoritmo,
      secretManagerVersion: row.secret_manager_version,
      publicJwkJson: parsePublicJwk(row.public_jwk_json),
      estadoLlave: row.estado_llave,
      activadaEn: new Date(row.activada_en),
      expiraRotacionEn: new Date(row.expira_rotacion_en),
      retiradaEn: row.retirada_en ? new Date(row.retirada_en) : null,
    }));

    const activeEntry =
      metadata.find((item) => item.estadoLlave === 'ACTIVA_FIRMA') ?? null;
    const keys = metadata.map((item) => item.publicJwkJson);

    return {
      activeKid: activeEntry?.kid ?? null,
      keys,
      metadata,
    };
  }

  public async signIdToken(claims: MinedecIdTokenClaims): Promise<{
    idTokenJwt: string;
    kid: string;
  }> {
    const { activeKey, activeKid } = await this.resolveActiveSigningKey();

    const payload: Record<string, unknown> = {
      sub: claims.sub,
      sid: claims.sid,
      tipo_identificacion: claims.tipo_identificacion,
      numero_identificacion: claims.numero_identificacion,
      nombre_completo: claims.nombre_completo,
      email: claims.email,
      email_verified: claims.email_verified,
      hd: claims.hd,
    };
    if (claims.auth_time !== undefined) {
      payload.auth_time = claims.auth_time;
    }
    if (claims.nonce) {
      payload.nonce = claims.nonce;
    }

    const idTokenJwt = await new SignJWT(payload)
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        kid: activeKid,
      })
      .setIssuer(claims.iss)
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(claims.iat)
      .setExpirationTime(claims.exp)
      .sign(activeKey);

    return {
      idTokenJwt,
      kid: activeKid,
    };
  }

  public async signBackchannelLogoutToken(
    claims: Record<string, unknown>,
  ): Promise<{
    logoutTokenJwt: string;
    kid: string;
  }> {
    const { activeKey, activeKid } = await this.resolveActiveSigningKey();

    const iss = String(claims.iss ?? '');
    const sub = String(claims.sub ?? '');
    const aud = String(claims.aud ?? '');
    const iat = Number(claims.iat ?? Math.floor(Date.now() / 1000));
    const exp = Number(claims.exp ?? iat + 120);
    const jti = String(claims.jti ?? '');

    const logoutTokenJwt = await new SignJWT({
      sid: claims.sid,
      events: claims.events,
    })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'logout+jwt',
        kid: activeKid,
      })
      .setIssuer(iss)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(jti)
      .sign(activeKey);

    return {
      logoutTokenJwt,
      kid: activeKid,
    };
  }

  public async verifySsoOidcIdTokenHint(idTokenHint: string): Promise<{
    sub: string;
    sid?: string;
    aud: string;
  } | null> {
    try {
      const header = decodeProtectedHeader(idTokenHint);
      if (header.alg !== 'RS256' || !header.kid) {
        return null;
      }

      const published = await this.getPublishedPublicKeysForSsoOidc();
      const targetJwk = published.keys.find((k) => k.kid === header.kid);
      if (!targetJwk) {
        return null;
      }

      const publicKey = await this.resolvePublicKey(targetJwk);
      const { payload } = await jwtVerify(idTokenHint, publicKey, {
        algorithms: ['RS256'],
      });

      if (typeof payload.sub !== 'string' || !payload.sub) {
        return null;
      }
      const audValue = Array.isArray(payload.aud)
        ? String(payload.aud[0] ?? '')
        : String(payload.aud ?? '');
      if (!audValue) {
        return null;
      }

      return {
        sub: payload.sub,
        sid: typeof payload.sid === 'string' ? payload.sid : undefined,
        aud: audValue,
      };
    } catch {
      return null;
    }
  }

  public async rotateSsoOidcSigningKey(params: {
    newKid: string;
    secretManagerVersion: string;
    publicJwk: PublicRsaJwk;
    retireExpiredGraceKeys?: boolean;
  }): Promise<{
    activeKid: string;
    publishedKids: string[];
  }> {
    const tableJwks = quotePipIdentifier('llave_jwks_rotacion');
    const retireExpired = params.retireExpiredGraceKeys ?? true;

    const runQueries = async (tx: SqlQueryExecutor): Promise<void> => {
      if (retireExpired) {
        await tx.query(
          `UPDATE ${tableJwks}
           SET estado_llave = 'RETIRADA',
               retirada_en = NOW()
           WHERE servicio_emisor = $1
             AND estado_llave = 'GRACIA_VERIFICACION'
             AND expira_rotacion_en <= NOW()`,
          [SERVICIO_EMISOR_SSO_OIDC],
        );
      }

      await tx.query(
        `UPDATE ${tableJwks}
         SET estado_llave = 'GRACIA_VERIFICACION'
         WHERE servicio_emisor = $1
           AND estado_llave = 'ACTIVA_FIRMA'
           AND kid <> $2`,
        [SERVICIO_EMISOR_SSO_OIDC, params.newKid],
      );

      await tx.query(
        `INSERT INTO ${tableJwks} (
           kid,
           servicio_emisor,
           algoritmo,
           secret_manager_version,
           public_jwk_json,
           estado_llave,
           activada_en,
           expira_rotacion_en
         ) VALUES (
           $1,
           $2,
           'RS256',
           $3,
           $4::jsonb,
           'ACTIVA_FIRMA',
           NOW(),
           NOW() + INTERVAL '90 days'
         )
         ON CONFLICT (kid) DO UPDATE
         SET servicio_emisor = EXCLUDED.servicio_emisor,
             secret_manager_version = EXCLUDED.secret_manager_version,
             public_jwk_json = EXCLUDED.public_jwk_json,
             estado_llave = 'ACTIVA_FIRMA',
             activada_en = NOW(),
             expira_rotacion_en = NOW() + INTERVAL '90 days',
             retirada_en = NULL`,
        [
          params.newKid,
          SERVICIO_EMISOR_SSO_OIDC,
          params.secretManagerVersion,
          JSON.stringify(params.publicJwk),
        ],
      );
    };

    const maybeTxManager = this.db as SqlQueryExecutor & {
      withTransaction?: <T>(fn: (tx: SqlQueryExecutor) => Promise<T>) => Promise<T>;
    };

    if (typeof maybeTxManager.withTransaction === 'function') {
      await maybeTxManager.withTransaction(runQueries);
    } else {
      await runQueries(this.db);
    }

    this.privateKeyCache.clear();
    this.publicKeyCache.clear();

    const published = await this.getPublishedPublicKeysForSsoOidc();
    this.logger.info('Rotación de llave JWKS RS256 de SSO_OIDC completada', {
      activeKid: published.activeKid ?? params.newKid,
      publishedCount: published.keys.length,
    });

    return {
      activeKid: published.activeKid ?? params.newKid,
      publishedKids: published.keys.map((k) => k.kid),
    };
  }

  public async revokeOrRetireSsoOidcSigningKey(params: {
    kid: string;
    targetState: Extract<EstadoLlaveJwks, 'RETIRADA' | 'REVOCADA'>;
    reason: string;
  }): Promise<{
    activeKid: string | null;
    publishedKids: string[];
  }> {
    const tableJwks = quotePipIdentifier('llave_jwks_rotacion');
    await this.db.query(
      `UPDATE ${tableJwks}
       SET estado_llave = $1,
           retirada_en = NOW()
       WHERE kid = $2
         AND servicio_emisor = $3`,
      [params.targetState, params.kid, SERVICIO_EMISOR_SSO_OIDC],
    );

    this.privateKeyCache.delete(params.kid);
    this.publicKeyCache.delete(params.kid);

    const published = await this.getPublishedPublicKeysForSsoOidc();
    this.logger.warn('Llave JWKS RS256 de SSO_OIDC retirada o revocada', {
      kid: params.kid,
      targetState: params.targetState,
      reason: params.reason,
      activeKid: published.activeKid,
    });

    return {
      activeKid: published.activeKid,
      publishedKids: published.keys.map((k) => k.kid),
    };
  }

  private async resolveActiveSigningKey(): Promise<{
    activeKey: KeyLike;
    activeKid: string;
  }> {
    const published = await this.getPublishedPublicKeysForSsoOidc();
    const activeMeta = published.metadata.find(
      (m) => m.estadoLlave === 'ACTIVA_FIRMA',
    );
    if (!activeMeta) {
      throw new Error(
        'No existe llave JWKS RS256 en estado ACTIVA_FIRMA para servicio_emisor = SSO_OIDC',
      );
    }

    const cached = this.privateKeyCache.get(activeMeta.kid);
    if (cached) {
      return {
        activeKey: cached,
        activeKid: activeMeta.kid,
      };
    }

    const rawSecret = await this.secretResolverFn(
      activeMeta.secretManagerVersion,
      activeMeta.kid,
    );
    const trimmed = rawSecret.trim();

    let privateKey: KeyLike;
    if (trimmed.startsWith('{')) {
      const parsedJwk = JSON.parse(trimmed) as JWK;
      privateKey = (await importJWK(parsedJwk, 'RS256')) as KeyLike;
    } else {
      privateKey = await importPKCS8(trimmed, 'RS256');
    }

    this.privateKeyCache.set(activeMeta.kid, privateKey);
    return {
      activeKey: privateKey,
      activeKid: activeMeta.kid,
    };
  }

  private async resolvePublicKey(jwk: PublicRsaJwk): Promise<KeyLike> {
    const cached = this.publicKeyCache.get(jwk.kid);
    if (cached) {
      return cached;
    }
    const key = (await importJWK(jwk as unknown as JWK, 'RS256')) as KeyLike;
    this.publicKeyCache.set(jwk.kid, key);
    return key;
  }
}
