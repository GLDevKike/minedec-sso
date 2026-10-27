/**
 * Repositorio AlloyDB de Llaves JWKS del Motor PDP (`AlloyDbPdpJwksKeyRepository`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios IV, VI, IX y XIII):
 * - Aislamiento criptográfico estricto: filtra e inserta exclusivamente `servicio_emisor = 'MOTOR_PDP'`,
 *   sin exponer ni mezclar jamás llaves de `SSO_OIDC`.
 * - Ventana de gracia dual (`ACTIVA_FIRMA` -> `GRACIA_VERIFICACION`) con rotación `<= 90 días`
 *   y revocación inmediata de emergencia (`< 1 h`).
 */

import { SqlQueryExecutor, assertSafeSqlIdentifier } from '@minedec/shared';
import {
  PdpKeyState,
  PdpSigningKeyRecord,
  PublicJwkEntry,
} from '../../../domain/entities/pdp-domain.entities';
import { PdpJwksKeyRepositoryPort } from '../../../domain/ports/pdp.ports';

interface LlaveJwksRow {
  kid: string;
  servicio_emisor: 'MOTOR_PDP' | 'SSO_OIDC';
  algoritmo: 'RS256';
  secret_manager_version: string;
  public_jwk_json: PublicJwkEntry | string;
  estado_llave: PdpKeyState;
  activada_en: string | Date;
  expira_rotacion_en: string | Date;
  retirada_en: string | Date | null;
}

export class AlloyDbPdpJwksKeyRepository implements PdpJwksKeyRepositoryPort {
  private readonly inMemoryKeys = new Map<
    string,
    PdpSigningKeyRecord & { servicio_emisor_raw?: string }
  >();

  constructor(private readonly db?: SqlQueryExecutor) {
    assertSafeSqlIdentifier('llave_jwks_rotacion');
    assertSafeSqlIdentifier('servicio_emisor');
    assertSafeSqlIdentifier('estado_llave');
    assertSafeSqlIdentifier('public_jwk_json');
  }

  public registerInMemoryKey(
    record: PdpSigningKeyRecord & {
      servicio_emisor_raw?: 'MOTOR_PDP' | 'SSO_OIDC';
    },
  ): void {
    this.inMemoryKeys.set(record.kid, record);
  }

  public clearInMemoryKeys(): void {
    this.inMemoryKeys.clear();
  }

  public async listActiveAndGraceKeys(): Promise<PdpSigningKeyRecord[]> {
    const inMemoryMatching = Array.from(this.inMemoryKeys.values())
      .filter(
        (k) =>
          (k.servicio_emisor_raw ?? k.servicio_emisor) === 'MOTOR_PDP' &&
          (k.estado_llave === 'ACTIVA_FIRMA' ||
            k.estado_llave === 'GRACIA_VERIFICACION'),
      )
      .sort((a, b) => {
        if (a.estado_llave === b.estado_llave) {
          return b.activada_en.getTime() - a.activada_en.getTime();
        }
        return a.estado_llave === 'ACTIVA_FIRMA' ? -1 : 1;
      });

    if (!this.db) {
      return inMemoryMatching;
    }

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
       FROM llave_jwks_rotacion
       WHERE servicio_emisor = $1
         AND estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')
       ORDER BY
         CASE WHEN estado_llave = 'ACTIVA_FIRMA' THEN 0 ELSE 1 END ASC,
         activada_en DESC`,
      ['MOTOR_PDP'],
    );

    if (result.rows.length > 0) {
      return result.rows.map((r) => this.mapRow(r));
    }

    return inMemoryMatching;
  }

  public async getActiveSigningKey(): Promise<PdpSigningKeyRecord | null> {
    const inMemoryActive =
      Array.from(this.inMemoryKeys.values()).find(
        (k) =>
          (k.servicio_emisor_raw ?? k.servicio_emisor) === 'MOTOR_PDP' &&
          k.estado_llave === 'ACTIVA_FIRMA',
      ) ?? null;

    if (!this.db) {
      return inMemoryActive;
    }

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
       FROM llave_jwks_rotacion
       WHERE servicio_emisor = $1
         AND estado_llave = 'ACTIVA_FIRMA'
       ORDER BY activada_en DESC
       LIMIT 1`,
      ['MOTOR_PDP'],
    );

    const row = result.rows[0];
    return row ? this.mapRow(row) : inMemoryActive;
  }

  public async rotateSigningKey(params: {
    newKid: string;
    secretManagerVersion: string;
    publicJwk: PublicJwkEntry;
    expiresInDays?: number;
  }): Promise<{ kid_activo: string; kid_gracia: string | null }> {
    const safeDays = Math.min(Math.max(1, params.expiresInDays ?? 90), 90);
    const now = new Date();
    const expiraRotacionEn = new Date(
      now.getTime() + safeDays * 24 * 60 * 60 * 1000,
    );

    const sanitizedPublicJwk: PublicJwkEntry = {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: params.newKid,
      n: params.publicJwk.n,
      e: params.publicJwk.e,
    };

    let previousActiveInMemoryKid: string | null = null;
    for (const [kid, record] of this.inMemoryKeys.entries()) {
      if ((record.servicio_emisor_raw ?? record.servicio_emisor) !== 'MOTOR_PDP') {
        continue;
      }
      if (record.estado_llave === 'ACTIVA_FIRMA') {
        previousActiveInMemoryKid = kid;
        this.inMemoryKeys.set(kid, {
          ...record,
          estado_llave: 'GRACIA_VERIFICACION',
        });
      }
    }

    this.inMemoryKeys.set(params.newKid, {
      kid: params.newKid,
      servicio_emisor: 'MOTOR_PDP',
      algoritmo: 'RS256',
      secret_manager_version: params.secretManagerVersion,
      public_jwk_json: sanitizedPublicJwk,
      estado_llave: 'ACTIVA_FIRMA',
      activada_en: now,
      expira_rotacion_en: expiraRotacionEn,
      retirada_en: null,
    });

    if (!this.db) {
      return {
        kid_activo: params.newKid,
        kid_gracia: previousActiveInMemoryKid,
      };
    }

    const currentActive = await this.getActiveSigningKey();
    const previousActiveKid =
      currentActive && currentActive.kid !== params.newKid
        ? currentActive.kid
        : previousActiveInMemoryKid;

    if (previousActiveKid) {
      await this.db.query(
        `UPDATE llave_jwks_rotacion
         SET estado_llave = 'GRACIA_VERIFICACION'
         WHERE kid = $1 AND servicio_emisor = 'MOTOR_PDP'`,
        [previousActiveKid],
      );
    }

    await this.db.query(
      `INSERT INTO llave_jwks_rotacion (
         kid,
         servicio_emisor,
         algoritmo,
         secret_manager_version,
         public_jwk_json,
         estado_llave,
         activada_en,
         expira_rotacion_en
       ) VALUES ($1, 'MOTOR_PDP', 'RS256', $2, $3::jsonb, 'ACTIVA_FIRMA', $4, $5)
       ON CONFLICT (kid) DO UPDATE
       SET secret_manager_version = EXCLUDED.secret_manager_version,
           public_jwk_json = EXCLUDED.public_jwk_json,
           estado_llave = 'ACTIVA_FIRMA',
           activada_en = EXCLUDED.activada_en,
           expira_rotacion_en = EXCLUDED.expira_rotacion_en`,
      [
        params.newKid,
        params.secretManagerVersion,
        JSON.stringify(sanitizedPublicJwk),
        now.toISOString(),
        expiraRotacionEn.toISOString(),
      ],
    );

    return {
      kid_activo: params.newKid,
      kid_gracia: previousActiveKid,
    };
  }

  public async retireGraceKey(kid: string): Promise<{
    kid: string;
    estado_llave: 'RETIRADA';
  } | null> {
    const trimmedKid = kid.trim();

    let retiredInMemory = false;
    const existing = this.inMemoryKeys.get(trimmedKid);
    if (
      existing &&
      (existing.servicio_emisor_raw ?? existing.servicio_emisor) ===
        'MOTOR_PDP' &&
      existing.estado_llave === 'GRACIA_VERIFICACION'
    ) {
      this.inMemoryKeys.set(trimmedKid, {
        ...existing,
        estado_llave: 'RETIRADA',
        retirada_en: new Date(),
      });
      retiredInMemory = true;
    }

    if (!this.db) {
      return retiredInMemory
        ? {
            kid: trimmedKid,
            estado_llave: 'RETIRADA',
          }
        : null;
    }

    const result = await this.db.query<{ kid: string }>(
      `UPDATE llave_jwks_rotacion
       SET estado_llave = 'RETIRADA',
           retirada_en = NOW()
       WHERE kid = $1
         AND servicio_emisor = 'MOTOR_PDP'
         AND estado_llave = 'GRACIA_VERIFICACION'
       RETURNING kid`,
      [trimmedKid],
    );

    if (result.rows[0]) {
      return {
        kid: result.rows[0].kid,
        estado_llave: 'RETIRADA',
      };
    }

    return retiredInMemory
      ? {
          kid: trimmedKid,
          estado_llave: 'RETIRADA',
        }
      : null;
  }

  public async revokeKeyEmergency(kid: string): Promise<{
    kid: string;
    estado_llave: 'REVOCADA';
  } | null> {
    const trimmedKid = kid.trim();

    let revokedInMemory = false;
    const existing = this.inMemoryKeys.get(trimmedKid);
    if (
      existing &&
      (existing.servicio_emisor_raw ?? existing.servicio_emisor) === 'MOTOR_PDP'
    ) {
      this.inMemoryKeys.set(trimmedKid, {
        ...existing,
        estado_llave: 'REVOCADA',
        retirada_en: new Date(),
      });
      revokedInMemory = true;
    }

    if (!this.db) {
      return revokedInMemory
        ? {
            kid: trimmedKid,
            estado_llave: 'REVOCADA',
          }
        : null;
    }

    const result = await this.db.query<{ kid: string }>(
      `UPDATE llave_jwks_rotacion
       SET estado_llave = 'REVOCADA',
           retirada_en = NOW()
       WHERE kid = $1
         AND servicio_emisor = 'MOTOR_PDP'
       RETURNING kid`,
      [trimmedKid],
    );

    if (result.rows[0]) {
      return {
        kid: result.rows[0].kid,
        estado_llave: 'REVOCADA',
      };
    }

    return revokedInMemory
      ? {
          kid: trimmedKid,
          estado_llave: 'REVOCADA',
        }
      : null;
  }

  private mapRow(row: LlaveJwksRow): PdpSigningKeyRecord {
    const parsedJwk: PublicJwkEntry =
      typeof row.public_jwk_json === 'string'
        ? (JSON.parse(row.public_jwk_json) as PublicJwkEntry)
        : row.public_jwk_json;

    return {
      kid: row.kid,
      servicio_emisor: 'MOTOR_PDP',
      algoritmo: 'RS256',
      secret_manager_version: row.secret_manager_version,
      public_jwk_json: {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: row.kid,
        n: parsedJwk.n,
        e: parsedJwk.e,
      },
      estado_llave: row.estado_llave,
      activada_en: new Date(row.activada_en),
      expira_rotacion_en: new Date(row.expira_rotacion_en),
      retirada_en: row.retirada_en ? new Date(row.retirada_en) : null,
    };
  }
}
