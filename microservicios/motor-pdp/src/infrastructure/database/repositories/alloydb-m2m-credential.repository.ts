/**
 * Repositorio AlloyDB de Credenciales M2M (`AlloyDbM2mCredentialRepository`).
 *
 * Cumplimiento Constitucional (v2.11.0, Principios IV, VI, IX, XIII, XIV y XVI):
 * - Consultas SQL 100 % parametrizadas (`$1..$n`) con lista blanca `assertSafeSqlIdentifier`.
 * - Almacena y consulta únicamente hashes SHA-256 (`secreto_activo_hash` y `secreto_anterior_hash`),
 *   con ventana de gracia dual (`gracia_hasta`), límite constitucional de rotación (`expira_rotacion_en <= 90 días`)
 *   y revocación de emergencia inmediata (`REVOCADA`).
 */

import crypto from 'node:crypto';
import { SqlQueryExecutor, assertSafeSqlIdentifier } from '@minedec/shared';
import {
  M2mClientCredential,
  M2mClientType,
  M2mCredentialStatus,
} from '../../../domain/entities/pdp-domain.entities';
import { M2mCredentialRepositoryPort } from '../../../domain/ports/pdp.ports';

interface CredencialM2mRow {
  credencial_id: string;
  aplicacion_id: string | null;
  tipo_cliente: M2mClientType;
  client_id: string;
  secreto_activo_hash: string;
  secreto_anterior_hash: string | null;
  gracia_hasta: string | Date | null;
  expira_rotacion_en: string | Date;
  scopes_permitidos: string;
  estado_credencial: M2mCredentialStatus;
}

export class AlloyDbM2mCredentialRepository
  implements M2mCredentialRepositoryPort
{
  private readonly inMemoryCredentials = new Map<string, M2mClientCredential>();

  constructor(private readonly db?: SqlQueryExecutor) {
    assertSafeSqlIdentifier('credencial_m2m');
    assertSafeSqlIdentifier('credencial_id');
    assertSafeSqlIdentifier('aplicacion_id');
    assertSafeSqlIdentifier('tipo_cliente');
    assertSafeSqlIdentifier('client_id');
    assertSafeSqlIdentifier('secreto_activo_hash');
    assertSafeSqlIdentifier('secreto_anterior_hash');
    assertSafeSqlIdentifier('gracia_hasta');
    assertSafeSqlIdentifier('expira_rotacion_en');
    assertSafeSqlIdentifier('scopes_permitidos');
    assertSafeSqlIdentifier('estado_credencial');
  }

  public registerInMemoryCredential(credential: M2mClientCredential): void {
    this.inMemoryCredentials.set(credential.client_id, credential);
  }

  public clearInMemoryCredentials(): void {
    this.inMemoryCredentials.clear();
  }

  public async findByClientId(
    clientId: string,
  ): Promise<M2mClientCredential | null> {
    const trimmed = clientId.trim();
    const mem = this.inMemoryCredentials.get(trimmed);
    if (mem) {
      return mem;
    }

    if (!this.db) {
      return null;
    }

    const result = await this.db.query<CredencialM2mRow>(
      `SELECT
         credencial_id,
         aplicacion_id,
         tipo_cliente,
         client_id,
         secreto_activo_hash,
         secreto_anterior_hash,
         gracia_hasta,
         expira_rotacion_en,
         scopes_permitidos,
         estado_credencial
       FROM credencial_m2m
       WHERE client_id = $1
       LIMIT 1`,
      [trimmed],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  public async createCredential(params: {
    credencialId?: string;
    aplicacionId: string | null;
    tipoCliente: M2mClientType;
    clientId: string;
    secretoActivoHash: string;
    scopesPermitidos?: string;
    expiresInDays?: number;
  }): Promise<M2mClientCredential> {
    const trimmedClientId = params.clientId.trim();
    const credencialId = params.credencialId ?? crypto.randomUUID();
    const safeDays = Math.min(Math.max(1, params.expiresInDays ?? 90), 90);
    const now = new Date();
    const expiraRotacionEn = new Date(
      now.getTime() + safeDays * 24 * 60 * 60 * 1000,
    );
    const scopesPermitidos = (params.scopesPermitidos ?? 'pdp:evaluate').trim();
    const normalizedHash = params.secretoActivoHash.trim().toLowerCase();

    const record: M2mClientCredential = {
      credencial_id: credencialId,
      aplicacion_id: params.aplicacionId,
      tipo_cliente: params.tipoCliente,
      client_id: trimmedClientId,
      secreto_activo_hash: normalizedHash,
      secreto_anterior_hash: null,
      gracia_hasta: null,
      expira_rotacion_en: expiraRotacionEn,
      scopes_permitidos: scopesPermitidos,
      estado_credencial: 'ACTIVA',
    };

    this.inMemoryCredentials.set(trimmedClientId, record);

    if (this.db) {
      await this.db.query(
        `INSERT INTO credencial_m2m (
           credencial_id,
           aplicacion_id,
           tipo_cliente,
           client_id,
           secreto_activo_hash,
           secreto_anterior_hash,
           gracia_hasta,
           expira_rotacion_en,
           scopes_permitidos,
           estado_credencial,
           creado_en,
           actualizado_en
         ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, 'ACTIVA', $8, $8)
         ON CONFLICT (client_id) DO UPDATE
         SET aplicacion_id = EXCLUDED.aplicacion_id,
             tipo_cliente = EXCLUDED.tipo_cliente,
             secreto_activo_hash = EXCLUDED.secreto_activo_hash,
             secreto_anterior_hash = NULL,
             gracia_hasta = NULL,
             expira_rotacion_en = EXCLUDED.expira_rotacion_en,
             scopes_permitidos = EXCLUDED.scopes_permitidos,
             estado_credencial = 'ACTIVA',
             actualizado_en = EXCLUDED.actualizado_en`,
        [
          credencialId,
          params.aplicacionId,
          params.tipoCliente,
          trimmedClientId,
          normalizedHash,
          expiraRotacionEn.toISOString(),
          scopesPermitidos,
          now.toISOString(),
        ],
      );
    }

    return record;
  }

  public async rotateCredentialSecret(params: {
    clientId: string;
    nuevoSecretoHash: string;
    graceWindowSeconds?: number;
    expiresInDays?: number;
  }): Promise<M2mClientCredential | null> {
    const trimmedClientId = params.clientId.trim();
    const existing = await this.findByClientId(trimmedClientId);
    if (!existing || existing.estado_credencial === 'REVOCADA') {
      return null;
    }

    const safeGraceSeconds = Math.min(
      Math.max(60, params.graceWindowSeconds ?? 86400),
      7 * 24 * 60 * 60,
    );
    const safeDays = Math.min(Math.max(1, params.expiresInDays ?? 90), 90);
    const now = new Date();
    const graciaHasta = new Date(now.getTime() + safeGraceSeconds * 1000);
    const expiraRotacionEn = new Date(
      now.getTime() + safeDays * 24 * 60 * 60 * 1000,
    );
    const normalizedNewHash = params.nuevoSecretoHash.trim().toLowerCase();

    const updated: M2mClientCredential = {
      ...existing,
      secreto_anterior_hash: existing.secreto_activo_hash,
      secreto_activo_hash: normalizedNewHash,
      gracia_hasta: graciaHasta,
      expira_rotacion_en: expiraRotacionEn,
      estado_credencial: 'EN_ROTACION_GRACIA',
    };

    this.inMemoryCredentials.set(trimmedClientId, updated);

    if (this.db) {
      await this.db.query(
        `UPDATE credencial_m2m
         SET secreto_anterior_hash = secreto_activo_hash,
             secreto_activo_hash = $2,
             gracia_hasta = $3,
             expira_rotacion_en = $4,
             estado_credencial = 'EN_ROTACION_GRACIA',
             actualizado_en = $5
         WHERE client_id = $1
           AND estado_credencial <> 'REVOCADA'`,
        [
          trimmedClientId,
          normalizedNewHash,
          graciaHasta.toISOString(),
          expiraRotacionEn.toISOString(),
          now.toISOString(),
        ],
      );
    }

    return updated;
  }

  public async expireGraceWindow(
    clientId: string,
  ): Promise<M2mClientCredential | null> {
    const trimmedClientId = clientId.trim();
    const existing = await this.findByClientId(trimmedClientId);
    if (!existing || existing.estado_credencial === 'REVOCADA') {
      return null;
    }

    const updated: M2mClientCredential = {
      ...existing,
      secreto_anterior_hash: null,
      gracia_hasta: null,
      estado_credencial: 'ACTIVA',
    };

    this.inMemoryCredentials.set(trimmedClientId, updated);

    if (this.db) {
      await this.db.query(
        `UPDATE credencial_m2m
         SET secreto_anterior_hash = NULL,
             gracia_hasta = NULL,
             estado_credencial = 'ACTIVA',
             actualizado_en = NOW()
         WHERE client_id = $1
           AND estado_credencial <> 'REVOCADA'`,
        [trimmedClientId],
      );
    }

    return updated;
  }

  public async revokeCredentialEmergency(
    clientId: string,
  ): Promise<M2mClientCredential | null> {
    const trimmedClientId = clientId.trim();
    const existing = await this.findByClientId(trimmedClientId);
    if (!existing) {
      return null;
    }

    const revoked: M2mClientCredential = {
      ...existing,
      secreto_anterior_hash: null,
      gracia_hasta: null,
      estado_credencial: 'REVOCADA',
    };

    this.inMemoryCredentials.set(trimmedClientId, revoked);

    if (this.db) {
      await this.db.query(
        `UPDATE credencial_m2m
         SET secreto_anterior_hash = NULL,
             gracia_hasta = NULL,
             estado_credencial = 'REVOCADA',
             actualizado_en = NOW()
         WHERE client_id = $1`,
        [trimmedClientId],
      );
    }

    return revoked;
  }

  private mapRow(row: CredencialM2mRow): M2mClientCredential {
    return {
      credencial_id: row.credencial_id,
      aplicacion_id: row.aplicacion_id,
      tipo_cliente: row.tipo_cliente,
      client_id: row.client_id,
      secreto_activo_hash: row.secreto_activo_hash.trim(),
      secreto_anterior_hash: row.secreto_anterior_hash
        ? row.secreto_anterior_hash.trim()
        : null,
      gracia_hasta: row.gracia_hasta ? new Date(row.gracia_hasta) : null,
      expira_rotacion_en: new Date(row.expira_rotacion_en),
      scopes_permitidos: row.scopes_permitidos,
      estado_credencial: row.estado_credencial,
    };
  }
}
