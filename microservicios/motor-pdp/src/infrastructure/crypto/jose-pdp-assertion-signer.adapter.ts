/**
 * Adaptador Criptográfico RS256 (`jose` + Secret Manager) — `motor-pdp` (`T022`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, IX y XIV):
 * - Firma de `assertion_jwt` (`X-Minedec-Assertion`, TTL <= 60s) y tokens M2M (`TTL <= 3600s`) con `RS256`.
 * - Integración con `PdpJwksKeyRepositoryPort` (`servicio_emisor = 'MOTOR_PDP'`) y Google Secret Manager.
 * - Ventana de gracia dual: firma exclusivamente con `ACTIVA_FIRMA` y verifica con `ACTIVA_FIRMA` + `GRACIA_VERIFICACION`.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { StructuredLogger } from '@minedec/shared';
import {
  decodeProtectedHeader,
  exportJWK,
  importJWK,
  importPKCS8,
  JWK,
  jwtVerify,
  KeyLike,
  SignJWT,
} from 'jose';
import {
  M2mClientType,
  M2mTokenClaims,
  PublicJwkEntry,
} from '../../domain/entities/pdp-domain.entities';
import {
  PdpFailCloseUnavailableError,
  PdpUnauthorizedM2mError,
} from '../../domain/errors/pdp-domain.errors';
import {
  AssertionSigningInput,
  PdpAssertionSignerPort,
  PdpJwksKeyRepositoryPort,
} from '../../domain/ports/pdp.ports';
import { MotorPdpEnvConfig } from '../http/schemas/pdp-zod.schemas';

export type PdpSecretPrivateKeyResolverFn = (
  secretManagerVersion: string,
  kid: string,
) => Promise<string>;

export interface JosePdpAssertionSignerOptions {
  secretResolverFn?: PdpSecretPrivateKeyResolverFn;
}

export class JosePdpAssertionSignerAdapter implements PdpAssertionSignerPort {
  private readonly secretResolverFn: PdpSecretPrivateKeyResolverFn;
  private readonly privateKeyCache = new Map<string, KeyLike>();
  private readonly publicKeyCache = new Map<string, KeyLike>();
  private readonly localPrivatePemStore = new Map<string, string>();
  private fallbackKeyPair?: {
    kid: string;
    privateKey: KeyLike;
    publicKey: KeyLike;
    publicJwk: PublicJwkEntry;
  };

  constructor(
    private readonly jwksRepository: PdpJwksKeyRepositoryPort,
    private readonly envConfig: MotorPdpEnvConfig,
    private readonly logger: StructuredLogger,
    options: JosePdpAssertionSignerOptions = {},
  ) {
    if (options.secretResolverFn) {
      this.secretResolverFn = options.secretResolverFn;
    } else {
      const smClient = new SecretManagerServiceClient();
      this.secretResolverFn = async (
        secretManagerVersion: string,
        kid: string,
      ): Promise<string> => {
        const localPem = this.localPrivatePemStore.get(kid);
        if (localPem) {
          return localPem;
        }
        const envPem = process.env.PDP_SIGNING_PRIVATE_KEY_PEM;
        if (envPem && envPem.trim().length > 0) {
          return envPem;
        }
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

  public async signAssertionJwt(input: AssertionSigningInput): Promise<string> {
    const { activeKey, activeKid } = await this.resolveActiveSigningKey();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expEpoch = nowEpoch + this.envConfig.ASSERTION_JWT_TTL_SECONDS;

    return new SignJWT({
      email: input.emailPrincipal,
      tipo_identificacion: input.tipoIdentificacion,
      numero_identificacion: input.numeroIdentificacion,
      codigo_aplicacion: input.codigoAplicacion,
      roles: input.roles,
      permisos: input.permisos,
      permisos_crud: input.permisosCrud,
      contexto_territorial: input.contextoTerritorial,
    })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        kid: activeKid,
      })
      .setIssuer(this.envConfig.PDP_ISSUER_URL)
      .setSubject(input.idInterno)
      .setAudience([input.uuidAplicacion, input.codigoAplicacion])
      .setIssuedAt(nowEpoch)
      .setExpirationTime(expEpoch)
      .setJti(input.requestId || randomUUID())
      .sign(activeKey);
  }

  public buildInjectedHeaders(
    input: AssertionSigningInput,
    assertionJwt: string,
  ): Record<string, string> {
    const crudFlags = [
      input.permisosCrud.puede_crear ? 'C' : '',
      input.permisosCrud.puede_leer ? 'R' : '',
      input.permisosCrud.puede_editar ? 'U' : '',
      input.permisosCrud.puede_eliminar ? 'D' : '',
    ].join('');

    const requestId = input.requestId ?? '';

    return {
      // 11 Cabeceras Oficiales C2-50 Tabla 8 / C2-59 Tabla 8
      'X-Minedec-Identificacion': input.numeroIdentificacion,
      'X-Minedec-Tipo-Identificacion': input.tipoIdentificacion,
      'X-Minedec-Email': input.emailPrincipal,
      'X-Minedec-Roles': input.roles.join(','),
      'X-Minedec-AMIE': input.contextoTerritorial.amie_titular,
      'X-Minedec-AMIEs': input.contextoTerritorial.amies_asignados.join(','),
      'X-Minedec-Jurisdiccion': `${input.contextoTerritorial.nivel_jurisdiccion}:${input.contextoTerritorial.codigo_jurisdiccion}`,
      'X-Minedec-Zona': input.contextoTerritorial.zona,
      'X-Minedec-Distrito': input.contextoTerritorial.distrito,
      'X-Minedec-Request-Id': requestId,
      'X-Minedec-Assertion': assertionJwt,
      // Alias descriptivos compatibles con integraciones PEP
      'X-Minedec-User-Email': input.emailPrincipal,
      'X-Minedec-User-Id': input.numeroIdentificacion,
      'X-Minedec-User-Id-Type': input.tipoIdentificacion,
      'X-Minedec-Identification-Type': input.tipoIdentificacion,
      'X-Minedec-Permissions': input.permisos.join(','),
      'X-Minedec-Crud': crudFlags,
      'X-Minedec-Amie': input.contextoTerritorial.amie_titular,
      'X-Minedec-Amie-Titular': input.contextoTerritorial.amie_titular,
      'X-Minedec-Amies-Asignados':
        input.contextoTerritorial.amies_asignados.join(','),
      'X-Minedec-Jurisdiction': input.contextoTerritorial.codigo_jurisdiccion,
    };
  }

  public async signM2mAccessToken(params: {
    clientId: string;
    tipoCliente: M2mClientType;
    aplicacionId: string | null;
    scope: string;
    ttlSeconds?: number;
  }): Promise<{ accessToken: string; expiresIn: number }> {
    const { activeKey, activeKid } = await this.resolveActiveSigningKey();
    const expiresIn = params.ttlSeconds ?? this.envConfig.M2M_TOKEN_TTL_SECONDS;
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expEpoch = nowEpoch + expiresIn;

    const accessToken = await new SignJWT({
      client_id: params.clientId,
      tipo_cliente: params.tipoCliente,
      aplicacion_id: params.aplicacionId,
      scope: params.scope,
    })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'at+jwt',
        kid: activeKid,
      })
      .setIssuer(this.envConfig.PDP_ISSUER_URL)
      .setSubject(params.clientId)
      .setAudience(this.envConfig.PDP_ISSUER_URL)
      .setIssuedAt(nowEpoch)
      .setExpirationTime(expEpoch)
      .setJti(randomUUID())
      .sign(activeKey);

    return { accessToken, expiresIn };
  }

  public async verifyM2mAccessToken(token: string): Promise<M2mTokenClaims> {
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256' || !header.kid) {
        throw new PdpUnauthorizedM2mError(
          'Encabezado JWT M2M inválido o sin kid RS256',
        );
      }

      const publishedKeys =
        await this.jwksRepository.listActiveAndGraceKeys();
      const matchingRecord = publishedKeys.find((k) => k.kid === header.kid);

      let publicKey: KeyLike | undefined;
      if (matchingRecord) {
        publicKey = await this.resolvePublicKey(matchingRecord.public_jwk_json);
      } else if (
        this.fallbackKeyPair &&
        this.fallbackKeyPair.kid === header.kid &&
        publishedKeys.length === 0
      ) {
        publicKey = this.fallbackKeyPair.publicKey;
      }

      if (!publicKey) {
        throw new PdpUnauthorizedM2mError(
          `Llave de firma JWKS (${header.kid}) no reconocida o revocada`,
        );
      }

      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: this.envConfig.PDP_ISSUER_URL,
        audience: this.envConfig.PDP_ISSUER_URL,
      });

      const clientId =
        typeof payload.client_id === 'string'
          ? payload.client_id
          : typeof payload.sub === 'string'
            ? payload.sub
            : '';
      const tipoCliente = payload.tipo_cliente as M2mClientType | undefined;

      if (
        !clientId ||
        (tipoCliente !== 'APLICACION_PATRON_1' &&
          tipoCliente !== 'PEP_PATRON_2')
      ) {
        throw new PdpUnauthorizedM2mError('Claims de token M2M incompletos');
      }

      return {
        sub: String(payload.sub ?? clientId),
        client_id: clientId,
        tipo_cliente: tipoCliente,
        aplicacion_id:
          typeof payload.aplicacion_id === 'string'
            ? payload.aplicacion_id
            : null,
        scope: typeof payload.scope === 'string' ? payload.scope : 'pdp:evaluate',
        iss: String(payload.iss ?? this.envConfig.PDP_ISSUER_URL),
        aud: Array.isArray(payload.aud)
          ? String(payload.aud[0])
          : String(payload.aud ?? this.envConfig.PDP_ISSUER_URL),
        iat: Number(payload.iat ?? 0),
        exp: Number(payload.exp ?? 0),
      };
    } catch (error) {
      if (error instanceof PdpUnauthorizedM2mError) {
        throw error;
      }
      throw new PdpUnauthorizedM2mError(
        'Token Bearer M2M inválido, expirado o con firma no verificable',
      );
    }
  }

  public async generateAndRotateKeyPair(params?: {
    kid?: string;
    secretManagerVersion?: string;
  }): Promise<{ kid_activo: string; kid_gracia: string | null }> {
    const newKid =
      params?.kid ??
      `pdp-rs256-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const secretManagerVersion =
      params?.secretManagerVersion ??
      `projects/${this.envConfig.GCP_PROJECT_ID}/secrets/minedec-pdp-jwt-signing-key/versions/latest`;

    const generated = await this.createRsa2048KeyMaterial(newKid);
    this.localPrivatePemStore.set(newKid, generated.privatePem);
    this.privateKeyCache.set(newKid, generated.privateKey);
    this.publicKeyCache.set(newKid, generated.publicKey);

    const rotation = await this.jwksRepository.rotateSigningKey({
      newKid,
      secretManagerVersion,
      publicJwk: generated.publicJwk,
      expiresInDays: 90,
    });

    this.logger.info('Rotación de llave JWKS RS256 de MOTOR_PDP ejecutada', {
      kid_activo: rotation.kid_activo,
      kid_gracia: rotation.kid_gracia,
    });

    return rotation;
  }

  private async resolveActiveSigningKey(): Promise<{
    activeKey: KeyLike;
    activeKid: string;
  }> {
    let activeRecord;
    try {
      activeRecord = await this.jwksRepository.getActiveSigningKey();
    } catch (err) {
      this.logger.error(
        'Fallo al consultar llave activa MOTOR_PDP en AlloyDB',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      throw new PdpFailCloseUnavailableError(
        'Indisponibilidad de catálogo JWKS en AlloyDB (Fail-Close)',
      );
    }

    if (!activeRecord) {
      if (this.envConfig.NODE_ENV !== 'production') {
        const ephemeral = await this.ensureEphemeralFallbackKey();
        try {
          await this.jwksRepository.rotateSigningKey({
            newKid: ephemeral.kid,
            secretManagerVersion: `projects/${this.envConfig.GCP_PROJECT_ID}/secrets/minedec-pdp-jwt-signing-key/versions/latest`,
            publicJwk: ephemeral.publicJwk,
            expiresInDays: 90,
          });
        } catch {
          // Si el repositorio subyacente es solo de lectura o simulado, continúa con la llave en memoria
        }
        return {
          activeKey: ephemeral.privateKey,
          activeKid: ephemeral.kid,
        };
      }
      throw new PdpFailCloseUnavailableError(
        'No existe llave JWKS en estado ACTIVA_FIRMA para servicio_emisor = MOTOR_PDP',
      );
    }

    const cached = this.privateKeyCache.get(activeRecord.kid);
    if (cached) {
      return {
        activeKey: cached,
        activeKid: activeRecord.kid,
      };
    }

    try {
      const rawSecret = await this.secretResolverFn(
        activeRecord.secret_manager_version,
        activeRecord.kid,
      );
      const trimmed = rawSecret.trim();
      let privateKey: KeyLike;
      if (trimmed.startsWith('{')) {
        const parsedJwk = JSON.parse(trimmed) as JWK;
        privateKey = (await importJWK(parsedJwk, 'RS256')) as KeyLike;
      } else {
        privateKey = await importPKCS8(trimmed, 'RS256');
      }
      this.privateKeyCache.set(activeRecord.kid, privateKey);
      return {
        activeKey: privateKey,
        activeKid: activeRecord.kid,
      };
    } catch {
      if (this.envConfig.NODE_ENV !== 'production') {
        const ephemeral = await this.ensureEphemeralFallbackKey(activeRecord.kid);
        this.privateKeyCache.set(activeRecord.kid, ephemeral.privateKey);
        this.publicKeyCache.set(activeRecord.kid, ephemeral.publicKey);
        return {
          activeKey: ephemeral.privateKey,
          activeKid: activeRecord.kid,
        };
      }
      throw new PdpFailCloseUnavailableError(
        'Fallo al obtener llave privada RS256 de Secret Manager (Fail-Close)',
      );
    }
  }

  private async resolvePublicKey(jwk: PublicJwkEntry): Promise<KeyLike> {
    const cached = this.publicKeyCache.get(jwk.kid);
    if (cached) {
      return cached;
    }
    const key = (await importJWK(jwk as unknown as JWK, 'RS256')) as KeyLike;
    this.publicKeyCache.set(jwk.kid, key);
    return key;
  }

  private async ensureEphemeralFallbackKey(preferredKid?: string): Promise<{
    kid: string;
    privateKey: KeyLike;
    publicKey: KeyLike;
    publicJwk: PublicJwkEntry;
  }> {
    const targetKid = preferredKid ?? 'pdp-rs256-local-default';
    if (this.fallbackKeyPair && this.fallbackKeyPair.kid === targetKid) {
      return this.fallbackKeyPair;
    }
    const generated = await this.createRsa2048KeyMaterial(targetKid);
    this.localPrivatePemStore.set(targetKid, generated.privatePem);
    this.fallbackKeyPair = {
      kid: targetKid,
      privateKey: generated.privateKey,
      publicKey: generated.publicKey,
      publicJwk: generated.publicJwk,
    };
    return this.fallbackKeyPair;
  }

  private async createRsa2048KeyMaterial(kid: string): Promise<{
    privatePem: string;
    privateKey: KeyLike;
    publicKey: KeyLike;
    publicJwk: PublicJwkEntry;
  }> {
    const { privateKey: nodePriv, publicKey: nodePub } = generateKeyPairSync(
      'rsa',
      {
        modulusLength: 2048,
      },
    );
    const privatePem = nodePriv
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const privateKey = await importPKCS8(privatePem, 'RS256');
    const exportedJwk = await exportJWK(nodePub);
    const publicJwk: PublicJwkEntry = {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid,
      n: String(exportedJwk.n ?? ''),
      e: String(exportedJwk.e ?? 'AQAB'),
    };
    const publicKey = (await importJWK(
      publicJwk as unknown as JWK,
      'RS256',
    )) as KeyLike;

    return {
      privatePem,
      privateKey,
      publicKey,
      publicJwk,
    };
  }
}
