import { SyncQuotaGovernor, hashPayloadGws } from '@minedec/shared';
import { ResultadoSincronizacionCuenta } from '../../domain/entities/sync-entities';
import {
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

export interface ReconcileHotRegistrationInput {
  idEventoExterno: string;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  solicitadoEn?: string;
  traceId: string;
}

export interface ReconcileHotRegistrationOutput extends ResultadoSincronizacionCuenta {
  action: 'PROMOTED_IN_PLACE' | 'MERGED_INTO_EXISTING' | 'KEPT_PENDING_NO_VALID_ID';
  idInternoProvisionalEliminado?: string;
}

/**
 * Caso de uso `ReconcileHotRegistrationUseCase` (`T040` / US3):
 * Reconcilia en carril prioritario reservado (`sync-priority-hot-reg-queue`, `<= 5 req/s`,
 * SLA `< 10 s` p95 y `< 15 s` p99) una identidad provisional creada en caliente (`REGISTRO_CALIENTE`):
 * 1. Promoción In-Place a `ACTIVA` cuando el documento oficial no existe previamente.
 * 2. Fusión / Re-vinculación Atómica cuando el documento oficial ya pertenece a una `PersonaIdentidad`
 *    consolidada existente (eliminando el registro provisional huérfano dentro de la misma transacción
 *    y auditando `REGISTRO_CALIENTE_UNIFICADO`).
 * 3. Si carece de `MINEDEC_Perfil` válido, mantiene `PENDIENTE_CONCILIACION` con motivo `SIN_IDENTIFICACION_VALIDA`.
 */
export class ReconcileHotRegistrationUseCase {
  constructor(
    private readonly gwsPort: IGoogleDirectoryReadOnlyPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly processedEventRepo: IProcessedEventRepositoryPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
  ) {}

  public async execute(
    input: ReconcileHotRegistrationInput,
  ): Promise<ReconcileHotRegistrationOutput> {
    // 1. Consumir del carril prioritario reservado (<= 5 req/s)
    const quotaDecision = await this.quotaGovernor.tryAcquire('HOT_REGISTRATION', 1);
    if (!quotaDecision.allowed) {
      const err = new Error(
        `Carril prioritario de REGISTRO_CALIENTE agotado (${quotaDecision.currentBucketRps}/${quotaDecision.allocatedLimitRps} req/s). Retry-After: ${Math.ceil(quotaDecision.retryAfterMs / 1000)}s`,
      ) as Error & { httpStatus?: number; retryAfterSeconds?: number };
      err.httpStatus = 429;
      err.retryAfterSeconds = Math.max(1, Math.ceil(quotaDecision.retryAfterMs / 1000));
      throw err;
    }

    // 2. Consultar Google Workspace en modo solo lectura
    const gwsUser = await this.gwsPort.getUserReadOnly(
      input.googleSubId || input.emailPrincipal,
      input.traceId,
    );
    const computedHash = gwsUser ? hashPayloadGws(gwsUser) : null;

    // 3. Ejecutar promoción in-place, fusión atómica o retención por SIN_IDENTIFICACION_VALIDA
    const reconcileRes = await this.syncIdentityRepo.reconcileOrMergeHotIdentity({
      idEventoExterno: input.idEventoExterno,
      googleSubId: input.googleSubId,
      emailPrincipal: input.emailPrincipal,
      dominio: input.dominio,
      gwsUser,
      hashPayloadGws: computedHash,
      traceId: input.traceId,
    });

    // 4. Invalidar caché L2 en Memorystore Redis (< 5 s p95)
    const inv = await this.cacheInvalidator.invalidateAccountScope({
      idInternoPersona: reconcileRes.idInternoDefinitivo,
      cuentaId: reconcileRes.cuentaId,
      googleSubId: input.googleSubId,
      emailPrincipal: input.emailPrincipal,
      motivo: `HOT_REGISTRATION_${reconcileRes.action}`,
      traceId: input.traceId,
    });

    await this.processedEventRepo.recordProcessedEvent({
      idEventoExterno: input.idEventoExterno,
      googleSubId: input.googleSubId,
      emailPrincipal: input.emailPrincipal,
      dominio: input.dominio,
      tipoEvento: 'HOT_REGISTRATION_RECONCILE',
      timestampEventoGws: input.solicitadoEn ?? new Date().toISOString(),
      origenCanal: 'CLOUD_TASKS_PRIORITY',
      modoDespacho: 'FETCH_BY_SUB',
      resultado: 'PROCESADO',
      hashPayloadGws: computedHash,
      procesadoEn: new Date().toISOString(),
    });

    return {
      idEventoExterno: input.idEventoExterno,
      action: reconcileRes.action,
      idInternoProvisionalEliminado: reconcileRes.idInternoProvisionalEliminado,
      resultado:
        reconcileRes.action === 'KEPT_PENDING_NO_VALID_ID'
          ? 'ANOMALIA_REGISTRADA'
          : 'APLICADO',
      modoDespacho: 'INDIVIDUAL_GET',
      cuentasProcesadasEnLote: 1,
      idInternoPersona: reconcileRes.idInternoDefinitivo,
      cuentaId: reconcileRes.cuentaId,
      estadoPersonaResultante: reconcileRes.estadoPersona,
      estadoCuentaResultante: reconcileRes.estadoCuenta,
      cacheInvalidated: inv.invalidatedKeysCount >= 0,
      anomaliasGeneradasIds: reconcileRes.anomaliaId ? [reconcileRes.anomaliaId] : [],
    };
  }
}
