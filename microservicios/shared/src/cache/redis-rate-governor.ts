import {
  enforceHardMaxTtlSeconds,
  InMemoryRedisCacheClient,
  type KeyValueCacheClient,
} from './redis-client';

export const GOOGLE_OFFICIAL_GWS_RPS = 30;
export const HARD_MAX_GWS_RPS = 28;
export const DEFAULT_RESERVED_HIGH_PRIORITY_RPS = 5;
export const RATE_LIMIT_KEY_TTL_SECONDS = 5;
export const HIGH_WATERMARK_PENDING_EVENTS = 100;
export const HIGH_WATERMARK_MAX_AGE_SECONDS = 10;
export const LOW_WATERMARK_RESTORE_EVENTS = 20;

export type GwsTrafficPriorityLane = 'ALTA_PRIORIDAD' | 'BATCH';

export type GwsOperationCategory =
  | 'REGISTRO_CALIENTE'
  | 'EVENTO_INCREMENTAL'
  | 'REALTIME_INCREMENTAL'
  | 'BARRIDO_DELTA'
  | 'CONCILIACION_MASIVA'
  | 'HOT_REGISTRATION'
  | 'INCREMENTAL'
  | 'BATCH_RECONCILIATION';

export type SyncDispatchMode = 'INDIVIDUAL_GET' | 'LOTE_LIST_500';

export function evaluateBatchSwitchHysteresis(params: {
  currentMode: SyncDispatchMode;
  pendingEventsCount: number;
  oldestPendingAgeSeconds?: number;
  oldestUnackedMessageAgeSeconds?: number;
  highWatermarkPendingEvents?: number;
  highWatermarkMaxAgeSeconds?: number;
  lowWatermarkRestoreEvents?: number;
}): {
  nextMode: SyncDispatchMode;
  currentMode: SyncDispatchMode;
  recommendedMode: SyncDispatchMode;
  switched: boolean;
  transitioned: boolean;
  reason: string;
} {
  const highCount = params.highWatermarkPendingEvents ?? HIGH_WATERMARK_PENDING_EVENTS;
  const highAge = params.highWatermarkMaxAgeSeconds ?? HIGH_WATERMARK_MAX_AGE_SECONDS;
  const lowCount = params.lowWatermarkRestoreEvents ?? LOW_WATERMARK_RESTORE_EVENTS;
  const ageSeconds =
    params.oldestPendingAgeSeconds ?? params.oldestUnackedMessageAgeSeconds ?? 0;

  let nextMode = params.currentMode;
  let reason = 'MANTENIDO_EN_BANDA_DEADBAND';

  if (params.pendingEventsCount >= highCount || ageSeconds > highAge) {
    nextMode = 'LOTE_LIST_500';
    reason =
      params.pendingEventsCount >= highCount
        ? `COLA_ALTA_${params.pendingEventsCount}_EVENTOS`
        : `ANTIGUEDAD_ALTA_${ageSeconds}S`;
  } else if (params.pendingEventsCount < lowCount) {
    nextMode = 'INDIVIDUAL_GET';
    reason = `COLA_DRENADA_${params.pendingEventsCount}_EVENTOS`;
  }

  return {
    nextMode,
    currentMode: nextMode,
    recommendedMode: nextMode,
    switched: nextMode !== params.currentMode,
    transitioned: nextMode !== params.currentMode,
    reason,
  };
}

export function resolveTrafficLaneForCategory(
  category: GwsOperationCategory | GwsTrafficPriorityLane,
): GwsTrafficPriorityLane {
  if (
    category === 'ALTA_PRIORIDAD' ||
    category === 'REGISTRO_CALIENTE' ||
    category === 'EVENTO_INCREMENTAL' ||
    category === 'REALTIME_INCREMENTAL' ||
    category === 'HOT_REGISTRATION' ||
    category === 'INCREMENTAL'
  ) {
    return 'ALTA_PRIORIDAD';
  }
  return 'BATCH';
}

export interface RateGovernorSlotResult {
  acquired: boolean;
  lane: GwsTrafficPriorityLane;
  currentSecondCount: number;
  laneLimitPerSecond: number;
  waitedMs: number;
  retryAttempts: number;
}

export interface TryAcquireBucketResult {
  allowed: boolean;
  currentGlobalRps: number;
  currentBucketRps: number;
  allocatedLimitRps: number;
  hardCeilingRps: number;
  retryAfterMs: number;
}

export interface RateGovernorStatusSnapshot {
  googleOfficialLimitRps: number;
  minedecHardCeilingRps: number;
  maxGlobalPerSecond: number;
  maxBatchPerSecond: number;
  minRealtimeReservedPerSecond: number;
  batchJobActive: boolean;
  priorityHotRegReservedRps: number;
  incrementalAllocatedRps: number;
  batchJobAllocatedRps: number;
  currentGlobalUsedRps: number;
  currentDispatchMode: SyncDispatchMode;
  highWatermarkPendingEvents: number;
  highWatermarkMaxAgeSeconds: number;
  lowWatermarkRestoreEvents: number;
}

export interface DistributedRateGovernorPort {
  tryAcquireSlot(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
  ): Promise<RateGovernorSlotResult>;
  acquireSlot(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
  ): Promise<RateGovernorSlotResult>;
  executeWithRateLimit<T>(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface RedisDistributedRateGovernorOptions {
  maxRequestsPerSecond?: number;
  maxTotalPerSecond?: number;
  reservedHighPrioritySlotsPerSecond?: number;
  minRealtimeReservedPerSecond?: number;
  maxBatchWhenRealtimeActivePerSecond?: number;
  maxWaitAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  nowMsProvider?: () => number;
  sleepProvider?: (ms: number) => Promise<void>;
  jitterProvider?: () => number;
  onThrottleEvent?: (lane: GwsTrafficPriorityLane, reason: 'LOCAL_QUOTA' | 'GWS_429_503') => void;
}

export function isRetryableGwsQuotaOrTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const errObj = error as Record<string, unknown>;
  const status =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.statusCode === 'number'
        ? errObj.statusCode
        : typeof errObj.code === 'number'
          ? errObj.code
          : undefined;
  if (status === 429 || status === 503) {
    return true;
  }
  const message = typeof errObj.message === 'string' ? errObj.message : '';
  return /(429|503|rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError|service unavailable)/i.test(
    message,
  );
}

/**
 * Gobernador de tasa distribuido sobre Memorystore for Redis (`<= 28 req/s` hacia Google Admin Directory API)
 * compartido entre `sa-sync` (Cloud Run Service) y `sa-sync-job` (Cloud Run Job).
 * Reserva capacidad prioritaria para `REGISTRO_CALIENTE` y `EVENTO_INCREMENTAL` frente a `BATCH` (`FR-013`).
 */
export class RedisDistributedRateGovernor implements DistributedRateGovernorPort {
  private readonly cacheClient: KeyValueCacheClient;
  private readonly maxRequestsPerSecond: number;
  private readonly reservedHighPrioritySlots: number;
  private readonly maxWaitAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly nowMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;
  private readonly onThrottleEvent?: (
    lane: GwsTrafficPriorityLane,
    reason: 'LOCAL_QUOTA' | 'GWS_429_503',
  ) => void;
  private batchJobActiveState = false;
  private currentDispatchModeState: SyncDispatchMode = 'INDIVIDUAL_GET';

  constructor(
    cacheClient?: KeyValueCacheClient,
    options?: RedisDistributedRateGovernorOptions,
  ) {
    this.cacheClient = cacheClient ?? new InMemoryRedisCacheClient();
    const requestedMax =
      options?.maxRequestsPerSecond ?? options?.maxTotalPerSecond ?? HARD_MAX_GWS_RPS;
    if (!Number.isFinite(requestedMax) || requestedMax <= 0 || requestedMax > HARD_MAX_GWS_RPS) {
      throw new Error(
        `[GWS_RATE_GOVERNOR] El techo máximo permitido por Constitución y FR-013 es <= ${HARD_MAX_GWS_RPS} req/s (recibido: ${requestedMax}).`,
      );
    }
    this.maxRequestsPerSecond = Math.floor(requestedMax);
    const requestedReserved =
      options?.reservedHighPrioritySlotsPerSecond ??
      options?.minRealtimeReservedPerSecond ??
      (options?.maxBatchWhenRealtimeActivePerSecond !== undefined
        ? this.maxRequestsPerSecond - options.maxBatchWhenRealtimeActivePerSecond
        : Math.min(DEFAULT_RESERVED_HIGH_PRIORITY_RPS, Math.floor(this.maxRequestsPerSecond / 2)));
    if (requestedReserved < 0 || requestedReserved >= this.maxRequestsPerSecond) {
      throw new Error(
        `[GWS_RATE_GOVERNOR] Los slots reservados de alta prioridad deben ser >= 0 y < ${this.maxRequestsPerSecond}.`,
      );
    }
    this.reservedHighPrioritySlots = Math.floor(requestedReserved);
    this.maxWaitAttempts = options?.maxWaitAttempts ?? 6;
    this.baseBackoffMs = options?.baseBackoffMs ?? 120;
    this.maxBackoffMs = options?.maxBackoffMs ?? 2000;
    this.nowMs = options?.nowMsProvider ?? (() => Date.now());
    this.sleep =
      options?.sleepProvider ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.jitter = options?.jitterProvider ?? (() => Math.random());
    this.onThrottleEvent = options?.onThrottleEvent;
  }

  public getLaneLimitPerSecond(lane: GwsTrafficPriorityLane): number {
    return lane === 'ALTA_PRIORIDAD'
      ? this.maxRequestsPerSecond
      : this.maxRequestsPerSecond - this.reservedHighPrioritySlots;
  }

  public getAllocatedLimitForBucket(
    bucket: GwsOperationCategory | GwsTrafficPriorityLane,
  ): number {
    if (
      bucket === 'HOT_REGISTRATION' ||
      bucket === 'REGISTRO_CALIENTE' ||
      bucket === 'REALTIME_INCREMENTAL'
    ) {
      return this.maxRequestsPerSecond;
    }
    if (bucket === 'INCREMENTAL' || bucket === 'EVENTO_INCREMENTAL') {
      return this.batchJobActiveState
        ? Math.min(13, this.maxRequestsPerSecond - this.reservedHighPrioritySlots)
        : Math.max(1, this.maxRequestsPerSecond - this.reservedHighPrioritySlots);
    }
    if (
      bucket === 'BATCH_RECONCILIATION' ||
      bucket === 'CONCILIACION_MASIVA' ||
      bucket === 'BARRIDO_DELTA' ||
      bucket === 'BATCH'
    ) {
      return Math.max(1, this.maxRequestsPerSecond - this.reservedHighPrioritySlots);
    }
    return this.getLaneLimitPerSecond(resolveTrafficLaneForCategory(bucket));
  }

  private async incrementSecondCounter(redisKey: string): Promise<number> {
    const safeTtl = enforceHardMaxTtlSeconds(RATE_LIMIT_KEY_TTL_SECONDS);
    if (typeof this.cacheClient.incrWithTtl === 'function') {
      return this.cacheClient.incrWithTtl(redisKey, safeTtl);
    }
    const existing = await this.cacheClient.get(redisKey);
    const nextCount = (existing ? Number(existing) || 0 : 0) + 1;
    await this.cacheClient.setWithTtl(redisKey, String(nextCount), safeTtl);
    return nextCount;
  }

  public async tryAcquireSlot(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
  ): Promise<RateGovernorSlotResult> {
    const lane = resolveTrafficLaneForCategory(categoryOrLane);
    const laneLimit = this.getLaneLimitPerSecond(lane);
    const epochSecond = Math.floor(this.nowMs() / 1000);
    const globalKey = `ratelimit:gws:directory:${epochSecond}`;

    if (lane === 'BATCH') {
      const currentRaw = await this.cacheClient.get(globalKey);
      const currentCount = currentRaw ? Number(currentRaw) || 0 : 0;
      if (currentCount >= laneLimit) {
        this.onThrottleEvent?.(lane, 'LOCAL_QUOTA');
        return {
          acquired: false,
          lane,
          currentSecondCount: currentCount,
          laneLimitPerSecond: laneLimit,
          waitedMs: 0,
          retryAttempts: 0,
        };
      }
    }

    const incrementedCount = await this.incrementSecondCounter(globalKey);
    if (incrementedCount > laneLimit) {
      this.onThrottleEvent?.(lane, 'LOCAL_QUOTA');
      return {
        acquired: false,
        lane,
        currentSecondCount: incrementedCount,
        laneLimitPerSecond: laneLimit,
        waitedMs: 0,
        retryAttempts: 0,
      };
    }

    return {
      acquired: true,
      lane,
      currentSecondCount: incrementedCount,
      laneLimitPerSecond: laneLimit,
      waitedMs: 0,
      retryAttempts: 0,
    };
  }

  public async tryAcquire(
    bucket: GwsOperationCategory | GwsTrafficPriorityLane,
    count = 1,
  ): Promise<TryAcquireBucketResult> {
    const epochSecond = Math.floor(this.nowMs() / 1000);
    const globalKey = `ratelimit:gws:directory:${epochSecond}`;
    const bucketKey = `ratelimit:gws:bucket:${bucket}:${epochSecond}`;
    const allocatedLimitRps = this.getAllocatedLimitForBucket(bucket);

    const currentGlobalRaw = await this.cacheClient.get(globalKey);
    const currentGlobal = currentGlobalRaw ? Number(currentGlobalRaw) || 0 : 0;
    const currentBucketRaw = await this.cacheClient.get(bucketKey);
    const currentBucket = currentBucketRaw ? Number(currentBucketRaw) || 0 : 0;

    if (
      currentGlobal + count > this.maxRequestsPerSecond ||
      currentBucket + count > allocatedLimitRps
    ) {
      const lane = resolveTrafficLaneForCategory(bucket);
      this.onThrottleEvent?.(lane, 'LOCAL_QUOTA');
      return {
        allowed: false,
        currentGlobalRps: currentGlobal,
        currentBucketRps: currentBucket,
        allocatedLimitRps,
        hardCeilingRps: this.maxRequestsPerSecond,
        retryAfterMs: this.computeBackoffDelayMs(0),
      };
    }

    let nextGlobal = currentGlobal;
    let nextBucket = currentBucket;
    for (let i = 0; i < Math.max(1, count); i += 1) {
      nextGlobal = await this.incrementSecondCounter(globalKey);
      nextBucket = await this.incrementSecondCounter(bucketKey);
    }

    return {
      allowed: true,
      currentGlobalRps: nextGlobal,
      currentBucketRps: nextBucket,
      allocatedLimitRps,
      hardCeilingRps: this.maxRequestsPerSecond,
      retryAfterMs: 0,
    };
  }

  public async acquireQuotaSlot(
    bucket: GwsOperationCategory | GwsTrafficPriorityLane,
  ): Promise<RateGovernorSlotResult> {
    return this.acquireSlot(bucket);
  }

  public async setBatchJobActive(active: boolean): Promise<void> {
    this.batchJobActiveState = Boolean(active);
    await this.cacheClient.setWithTtl(
      'ratelimit:gws:batch_job_active',
      this.batchJobActiveState ? '1' : '0',
      300,
    );
  }

  public async setBatchModeActive(active: boolean): Promise<void> {
    return this.setBatchJobActive(active);
  }

  public async evaluateBatchSwitchHysteresis(params: {
    pendingEventsCount: number;
    oldestPendingAgeSeconds: number;
  }): Promise<{ currentMode: SyncDispatchMode; switched: boolean }> {
    const previousMode = this.currentDispatchModeState;
    if (
      params.pendingEventsCount >= HIGH_WATERMARK_PENDING_EVENTS ||
      params.oldestPendingAgeSeconds > HIGH_WATERMARK_MAX_AGE_SECONDS
    ) {
      this.currentDispatchModeState = 'LOTE_LIST_500';
    } else if (params.pendingEventsCount < LOW_WATERMARK_RESTORE_EVENTS) {
      this.currentDispatchModeState = 'INDIVIDUAL_GET';
    }
    const switched = previousMode !== this.currentDispatchModeState;
    await this.cacheClient.setWithTtl(
      'ratelimit:gws:dispatch_mode',
      this.currentDispatchModeState,
      300,
    );
    return {
      currentMode: this.currentDispatchModeState,
      switched,
    };
  }

  public async getStatusSnapshot(): Promise<RateGovernorStatusSnapshot> {
    const epochSecond = Math.floor(this.nowMs() / 1000);
    const globalKey = `ratelimit:gws:directory:${epochSecond}`;
    const currentRaw = await this.cacheClient.get(globalKey);
    const currentGlobalUsedRps = currentRaw ? Number(currentRaw) || 0 : 0;

    return {
      googleOfficialLimitRps: GOOGLE_OFFICIAL_GWS_RPS,
      minedecHardCeilingRps: this.maxRequestsPerSecond,
      maxGlobalPerSecond: this.maxRequestsPerSecond,
      maxBatchPerSecond: this.maxRequestsPerSecond - this.reservedHighPrioritySlots,
      minRealtimeReservedPerSecond: this.reservedHighPrioritySlots,
      batchJobActive: this.batchJobActiveState,
      priorityHotRegReservedRps: this.reservedHighPrioritySlots,
      incrementalAllocatedRps: this.batchJobActiveState
        ? 13
        : this.maxRequestsPerSecond - this.reservedHighPrioritySlots,
      batchJobAllocatedRps: this.batchJobActiveState ? 10 : 0,
      currentGlobalUsedRps,
      currentDispatchMode: this.currentDispatchModeState,
      highWatermarkPendingEvents: HIGH_WATERMARK_PENDING_EVENTS,
      highWatermarkMaxAgeSeconds: HIGH_WATERMARK_MAX_AGE_SECONDS,
      lowWatermarkRestoreEvents: LOW_WATERMARK_RESTORE_EVENTS,
    };
  }

  public computeBackoffDelayMs(attemptIndex: number): number {
    const exp = Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, attemptIndex));
    const jitterFactor = 0.5 + 0.5 * Math.max(0, Math.min(1, this.jitter()));
    return Math.max(10, Math.round(exp * jitterFactor));
  }

  public async acquireSlot(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
  ): Promise<RateGovernorSlotResult> {
    const lane = resolveTrafficLaneForCategory(categoryOrLane);
    let totalWaitedMs = 0;

    for (let attempt = 0; attempt <= this.maxWaitAttempts; attempt += 1) {
      const res = await this.tryAcquireSlot(lane);
      if (res.acquired) {
        return {
          ...res,
          waitedMs: totalWaitedMs,
          retryAttempts: attempt,
        };
      }
      if (attempt === this.maxWaitAttempts) {
        break;
      }
      const delayMs = this.computeBackoffDelayMs(attempt);
      totalWaitedMs += delayMs;
      await this.sleep(delayMs);
    }

    throw new Error(
      `[GWS_RATE_LIMIT_EXHAUSTED] No se pudo adquirir slot de cuota Google Admin SDK en carril ${lane} tras ${this.maxWaitAttempts + 1} intentos (límite carril: ${this.getLaneLimitPerSecond(lane)} req/s).`,
    );
  }

  public async executeWithRateLimit<T>(
    categoryOrLane: GwsOperationCategory | GwsTrafficPriorityLane,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lane = resolveTrafficLaneForCategory(categoryOrLane);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxWaitAttempts; attempt += 1) {
      await this.acquireSlot(lane);
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableGwsQuotaOrTransientError(error) || attempt === this.maxWaitAttempts) {
          throw error;
        }
        this.onThrottleEvent?.(lane, 'GWS_429_503');
        const delayMs = this.computeBackoffDelayMs(attempt);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }
}

export {
  InMemoryRedisCacheClient as InMemoryRateGovernorStore,
  RedisDistributedRateGovernor as RedisRateGovernor,
  RedisDistributedRateGovernor as SyncQuotaGovernor,
};
