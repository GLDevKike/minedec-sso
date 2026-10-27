import {
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

export interface AccountLifecycleChangeInput {
  googleSubId: string;
  emailPrincipal?: string | null;
  tipoCambio?: 'CUENTA_SUSPENDIDA_GWS' | 'CUENTA_ELIMINADA_GWS' | 'CUENTA_REACTIVADA_GWS';
  tipoEvento?: 'SUSPEND_USER' | 'DELETE_USER' | 'UNSUSPEND_USER';
  origenCanal?: 'SYNC_INCREMENTAL' | 'SYNC_BATCH_JOB';
  motivo?: string;
  traceId: string;
}

export interface AccountLifecycleChangeOutput {
  found: boolean;
  applied: boolean;
  idInternoPersona?: string;
  cuentaId?: string;
  estadoPersonaResultante?: string;
  estadoCuentaResultante?: string;
  remainingActiveAccountsCount: number;
  cacheInvalidated: boolean;
}

/**
 * Servicio de aplicación para la Baja Lógica Diferenciada en Dos Niveles (Nivel 1: Baja de Cuenta) (`T033` / US2):
 * 1. La suspensión (`SUSPENDIDA_GWS`) o eliminación (`ELIMINADA_GWS`) de una `CuentaInstitucional`
 *    revoca únicamente esa cuenta e invalida su caché L2 en `< 5 s` p95 (`<= 300 s` límite duro).
 * 2. Si la `PersonaIdentidad` conserva al menos otra cuenta institucional activa (`remainingActiveAccountsCount > 0`),
 *    su `estado_persona` permanece en `ACTIVA` y las demás cuentas no sufren interrupción.
 * 3. Solo cuando quedan `0` cuentas activas para esa persona, `PersonaIdentidad.estado_persona` pasa a `INACTIVA`.
 */
export class HandleAccountLifecycleChangeUseCase {
  constructor(
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
  ) {}

  public async execute(
    input: AccountLifecycleChangeInput,
  ): Promise<AccountLifecycleChangeOutput> {
    const resolvedTipoCambio =
      input.tipoCambio ??
      (input.tipoEvento === 'DELETE_USER'
        ? 'CUENTA_ELIMINADA_GWS'
        : input.tipoEvento === 'UNSUSPEND_USER'
          ? 'CUENTA_REACTIVADA_GWS'
          : 'CUENTA_SUSPENDIDA_GWS');

    const nuevoEstadoCuenta =
      resolvedTipoCambio === 'CUENTA_ELIMINADA_GWS'
        ? 'ELIMINADA_GWS'
        : resolvedTipoCambio === 'CUENTA_SUSPENDIDA_GWS'
          ? 'SUSPENDIDA_GWS'
          : 'SINCRONIZADA';

    const repoResult = await this.syncIdentityRepo.applyAccountLifecycleChange({
      googleSubId: input.googleSubId,
      emailPrincipal: input.emailPrincipal,
      nuevoEstadoCuenta,
      motivo:
        input.motivo ??
        `Evento de ciclo de vida de cuenta desde Google Workspace: ${resolvedTipoCambio}`,
      origenCanal: input.origenCanal ?? 'SYNC_INCREMENTAL',
      traceId: input.traceId,
    });

    if (
      !repoResult.found ||
      !repoResult.idInternoPersona ||
      !repoResult.cuentaId ||
      !repoResult.emailPrincipal
    ) {
      return {
        found: false,
        applied: false,
        remainingActiveAccountsCount: 0,
        cacheInvalidated: false,
      };
    }

    const invalidation = await this.cacheInvalidator.invalidateAccountScope({
      idInternoPersona: repoResult.idInternoPersona,
      cuentaId: repoResult.cuentaId,
      googleSubId: repoResult.googleSubId,
      emailPrincipal: repoResult.emailPrincipal,
      motivo: resolvedTipoCambio,
      traceId: input.traceId,
    });

    return {
      found: true,
      applied: true,
      idInternoPersona: repoResult.idInternoPersona,
      cuentaId: repoResult.cuentaId,
      estadoPersonaResultante: repoResult.estadoPersonaResultante,
      estadoCuentaResultante: repoResult.estadoCuentaResultante,
      remainingActiveAccountsCount: repoResult.remainingActiveAccountsCount,
      cacheInvalidated: invalidation.invalidatedKeysCount >= 0,
    };
  }
}
