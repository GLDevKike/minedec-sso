import crypto from 'node:crypto';
import type { SqlQueryExecutor } from './postgres-client';

export interface AdvisoryLockAcquisitionResult {
  acquired: boolean;
  lockKeyBigint: string;
  lockKey: string;
  partitionIdentifier: string;
}

export interface PartitionAdvisoryLockPort {
  computeLockKeyBigint(partitionIdentifier: string): string;
  tryAcquireLock(
    partitionIdentifier: string,
    executor?: SqlQueryExecutor,
  ): Promise<AdvisoryLockAcquisitionResult>;
  releaseLock(partitionIdentifier: string, executor?: SqlQueryExecutor): Promise<boolean>;
  withPartitionLock<T>(
    partitionIdentifier: string,
    work: (lockKeyBigint: string) => Promise<T>,
    executor?: SqlQueryExecutor,
  ): Promise<
    | { executed: true; acquired: true; lockKeyBigint: string; result: T }
    | { executed: false; acquired: false; lockKeyBigint: string; result?: undefined }
  >;
}

/**
 * Calcula una llave entera de 64 bits con signo (`BIGINT` compatible con PostgreSQL `pg_try_advisory_lock`)
 * de forma determinística a partir del identificador de partición `"{dominio}:{unidadOrganizativa}:{fechaCiclo}"`.
 */
export function computePartitionAdvisoryLockKey(
  partitionOrDominio: string,
  orgUnitPath?: string,
  tipoProceso?: string,
): string {
  const combined =
    orgUnitPath !== undefined || tipoProceso !== undefined
      ? `${partitionOrDominio.trim().toLowerCase()}:${(orgUnitPath ?? '/').trim()}:${(tipoProceso ?? 'BARRIDO_DELTA_DIARIO').trim()}`
      : partitionOrDominio.trim();
  if (!combined) {
    throw new Error('[ADVISORY_LOCK] partitionIdentifier no puede ser vacío.');
  }
  const digest = crypto.createHash('sha256').update(combined, 'utf8').digest();
  // Leemos los primeros 8 bytes como entero positivo de 63 bits para evitar desbordamiento en PostgreSQL BIGINT
  const raw64 = digest.readBigUInt64BE(0);
  const positive63Bit = raw64 & BigInt('0x7fffffffffffffff');
  return positive63Bit.toString(10);
}

/**
 * Determina si el latido (`heartbeat_en`) de una partición en ejecución ha expirado (`> timeoutMinutes`, por defecto 15 min)
 * permitiendo su reclamación segura desde el último `next_page_token` (`FR-011`, `FR-012`).
 */
export function isPartitionHeartbeatOrphaned(
  heartbeatEn: string | Date | null | undefined,
  timeoutMinutes = 15,
  now = new Date(),
): boolean {
  if (!heartbeatEn) {
    return true;
  }
  const heartbeatDate = heartbeatEn instanceof Date ? heartbeatEn : new Date(heartbeatEn);
  if (Number.isNaN(heartbeatDate.getTime())) {
    return true;
  }
  const elapsedMs = now.getTime() - heartbeatDate.getTime();
  return elapsedMs > timeoutMinutes * 60 * 1000;
}

/**
 * Gestor de bloqueos consultivos (`pg_try_advisory_lock` / `pg_advisory_unlock`) en AlloyDB for PostgreSQL 16
 * para coordinación sin colisiones entre workers paralelos del Job de Conciliación (`FR-011`, `FR-012`).
 */
export class AlloyDbAdvisoryLockManager implements PartitionAdvisoryLockPort {
  constructor(private readonly defaultExecutor?: SqlQueryExecutor) {}

  public computeLockKeyBigint(
    partitionOrDominio: string,
    orgUnitPath?: string,
    tipoProceso?: string,
  ): string {
    return computePartitionAdvisoryLockKey(partitionOrDominio, orgUnitPath, tipoProceso);
  }

  public async tryAcquireLock(
    partitionIdentifier: string,
    executor?: SqlQueryExecutor,
  ): Promise<AdvisoryLockAcquisitionResult> {
    const lockKeyBigint = this.computeLockKeyBigint(partitionIdentifier);
    const db = executor ?? this.defaultExecutor;
    if (!db) {
      return {
        acquired: true,
        lockKeyBigint,
        lockKey: lockKeyBigint,
        partitionIdentifier,
      };
    }
    const res = await db.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [lockKeyBigint],
    );
    const acquired = Boolean(res.rows[0]?.acquired);
    return {
      acquired,
      lockKeyBigint,
      lockKey: lockKeyBigint,
      partitionIdentifier,
    };
  }

  public async tryAcquirePartitionLock(
    dominio: string,
    orgUnitPath: string,
    tipoProceso = 'BARRIDO_DELTA_DIARIO',
    executor?: SqlQueryExecutor,
  ): Promise<AdvisoryLockAcquisitionResult> {
    const partitionIdentifier = `${dominio.trim().toLowerCase()}:${orgUnitPath.trim() || '/'}:${tipoProceso}`;
    return this.tryAcquireLock(partitionIdentifier, executor);
  }

  public async releaseLock(
    partitionIdentifier: string,
    executor?: SqlQueryExecutor,
  ): Promise<boolean> {
    const lockKeyBigint = this.computeLockKeyBigint(partitionIdentifier);
    const db = executor ?? this.defaultExecutor;
    if (!db) {
      return true;
    }
    const res = await db.query<{ released: boolean }>(
      'SELECT pg_advisory_unlock($1::bigint) AS released',
      [lockKeyBigint],
    );
    return Boolean(res.rows[0]?.released);
  }

  public async releasePartitionLock(
    dominio: string,
    orgUnitPath: string,
    tipoProceso = 'BARRIDO_DELTA_DIARIO',
    executor?: SqlQueryExecutor,
  ): Promise<boolean> {
    const partitionIdentifier = `${dominio.trim().toLowerCase()}:${orgUnitPath.trim() || '/'}:${tipoProceso}`;
    return this.releaseLock(partitionIdentifier, executor);
  }

  public async withPartitionLock<T>(
    partitionOrDominio: string,
    workOrOrgUnitPath: ((lockKeyBigint: string) => Promise<T>) | string,
    executorOrTipoProceso?: SqlQueryExecutor | string,
    maybeWork?: (lockKeyBigint: string) => Promise<T>,
    maybeExecutor?: SqlQueryExecutor,
  ): Promise<
    | { executed: true; acquired: true; lockKeyBigint: string; result: T }
    | { executed: false; acquired: false; lockKeyBigint: string; result?: undefined }
  > {
    let partitionIdentifier: string;
    let workFn: (lockKeyBigint: string) => Promise<T>;
    let executor: SqlQueryExecutor | undefined;

    if (typeof workOrOrgUnitPath === 'function') {
      partitionIdentifier = partitionOrDominio;
      workFn = workOrOrgUnitPath;
      executor = executorOrTipoProceso as SqlQueryExecutor | undefined;
    } else {
      const orgUnitPath = workOrOrgUnitPath;
      const tipoProceso =
        typeof executorOrTipoProceso === 'string'
          ? executorOrTipoProceso
          : 'BARRIDO_DELTA_DIARIO';
      partitionIdentifier = `${partitionOrDominio.trim().toLowerCase()}:${orgUnitPath.trim() || '/'}:${tipoProceso}`;
      if (typeof maybeWork !== 'function') {
        throw new Error('[ADVISORY_LOCK] Se requiere función work en withPartitionLock.');
      }
      workFn = maybeWork;
      executor = maybeExecutor;
    }

    const lockRes = await this.tryAcquireLock(partitionIdentifier, executor);
    if (!lockRes.acquired) {
      return {
        executed: false,
        acquired: false,
        lockKeyBigint: lockRes.lockKeyBigint,
      };
    }

    try {
      const result = await workFn(lockRes.lockKeyBigint);
      return {
        executed: true,
        acquired: true,
        lockKeyBigint: lockRes.lockKeyBigint,
        result,
      };
    } finally {
      await this.releaseLock(partitionIdentifier, executor).catch(() => false);
    }
  }
}

export {
  AlloyDbAdvisoryLockManager as AdvisoryLockManager,
  AlloyDbAdvisoryLockManager as PartitionAdvisoryLock,
  computePartitionAdvisoryLockKey as derivePartitionAdvisoryLockKey,
};
