export type AnomalyAccessEffectMetric = 'BLOQUEANTE' | 'RESTRINGIDA';

export interface PipMetricsSnapshot {
  resolveCount: number;
  cacheInvalidationsCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  hotRegistrationsTotal: number;
  activeAnomaliesByEffect: Record<AnomalyAccessEffectMetric, number>;
  syncEventsProcessedTotal: number;
  syncEventsSkippedUnchangedHashTotal: number;
  syncDlqPendingGauge: number;
  gwsRateGovernorBackoffTotal: number;
  reconciliationPagesCompletedTotal: number;
  orphanAccountsSuspendedTotal: number;
}

export class PipObservabilityMetricsCollector {
  private resolveRequestsCount = 0;
  private cacheInvalidationsCount = 0;
  private cacheHitsCount = 0;
  private cacheMissesCount = 0;
  private hotRegistrationsCount = 0;
  private readonly activeAnomalies: Record<AnomalyAccessEffectMetric, number> = {
    BLOQUEANTE: 0,
    RESTRINGIDA: 0,
  };
  private syncEventsProcessedCount = 0;
  private syncEventsSkippedUnchangedHashCount = 0;
  private syncDlqPendingCount = 0;
  private gwsRateGovernorBackoffCount = 0;
  private reconciliationPagesCompletedCount = 0;
  private orphanAccountsSuspendedCount = 0;

  public recordResolveRequest(): void {
    this.resolveRequestsCount += 1;
  }

  public recordCacheHit(): void {
    this.cacheHitsCount += 1;
  }

  public recordCacheMiss(): void {
    this.cacheMissesCount += 1;
  }

  public recordHotRegistration(): void {
    this.hotRegistrationsCount += 1;
  }

  public incrementActiveAnomaly(effect: AnomalyAccessEffectMetric): void {
    this.activeAnomalies[effect] += 1;
  }

  public decrementActiveAnomaly(effect: AnomalyAccessEffectMetric): void {
    this.activeAnomalies[effect] = Math.max(0, this.activeAnomalies[effect] - 1);
  }

  public setActiveAnomaliesCount(effect: AnomalyAccessEffectMetric, count: number): void {
    this.activeAnomalies[effect] = Math.max(0, Math.trunc(count));
  }

  public recordAnomalyResolved(
    _source: 'AUTO_SYNC_GWS' | 'MANUAL_ADMIN' = 'MANUAL_ADMIN',
    effect: AnomalyAccessEffectMetric = 'RESTRINGIDA',
  ): void {
    this.decrementActiveAnomaly(effect);
  }

  public recordSyncEventProcessed(_outcome?: string): void {
    this.syncEventsProcessedCount += 1;
  }

  public recordSyncSkippedUnchangedHash(): void {
    this.syncEventsSkippedUnchangedHashCount += 1;
  }

  public setSyncDlqPendingCount(count: number): void {
    this.syncDlqPendingCount = Math.max(0, Math.trunc(count));
  }

  public setSyncDlqPendingRecords(count: number): void {
    this.setSyncDlqPendingCount(count);
  }

  public recordCacheInvalidation(): void {
    this.cacheInvalidationsCount += 1;
  }

  public incrementSyncDlqPending(): void {
    this.syncDlqPendingCount += 1;
  }

  public decrementSyncDlqPending(): void {
    this.syncDlqPendingCount = Math.max(0, this.syncDlqPendingCount - 1);
  }

  public recordGwsRateGovernorBackoff(): void {
    this.gwsRateGovernorBackoffCount += 1;
  }

  public recordReconciliationPageCompleted(): void {
    this.reconciliationPagesCompletedCount += 1;
  }

  public recordOrphanAccountSuspended(count = 1): void {
    this.orphanAccountsSuspendedCount += Math.max(0, Math.trunc(count));
  }

  public getSnapshot(): PipMetricsSnapshot {
    const totalCacheLookups = this.cacheHitsCount + this.cacheMissesCount;
    const cacheHitRatio =
      totalCacheLookups === 0 ? 0 : Number((this.cacheHitsCount / totalCacheLookups).toFixed(4));

    return {
      resolveCount: this.resolveRequestsCount,
      cacheInvalidationsCount: this.cacheInvalidationsCount,
      cacheHits: this.cacheHitsCount,
      cacheMisses: this.cacheMissesCount,
      cacheHitRatio,
      hotRegistrationsTotal: this.hotRegistrationsCount,
      activeAnomaliesByEffect: { ...this.activeAnomalies },
      syncEventsProcessedTotal: this.syncEventsProcessedCount,
      syncEventsSkippedUnchangedHashTotal: this.syncEventsSkippedUnchangedHashCount,
      syncDlqPendingGauge: this.syncDlqPendingCount,
      gwsRateGovernorBackoffTotal: this.gwsRateGovernorBackoffCount,
      reconciliationPagesCompletedTotal: this.reconciliationPagesCompletedCount,
      orphanAccountsSuspendedTotal: this.orphanAccountsSuspendedCount,
    };
  }

  public reset(): void {
    this.resolveRequestsCount = 0;
    this.cacheInvalidationsCount = 0;
    this.cacheHitsCount = 0;
    this.cacheMissesCount = 0;
    this.hotRegistrationsCount = 0;
    this.activeAnomalies.BLOQUEANTE = 0;
    this.activeAnomalies.RESTRINGIDA = 0;
    this.syncEventsProcessedCount = 0;
    this.syncEventsSkippedUnchangedHashCount = 0;
    this.syncDlqPendingCount = 0;
    this.gwsRateGovernorBackoffCount = 0;
    this.reconciliationPagesCompletedCount = 0;
    this.orphanAccountsSuspendedCount = 0;
  }
}

export const pipMetrics = new PipObservabilityMetricsCollector();
export { PipObservabilityMetricsCollector as PipMetricsCollector };

