import { SyncQuotaGovernor, hashPayloadGws } from '@minedec/shared';
import {
  IGoogleDirectoryReadOnlyPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

export interface DeltaSweepInput {
  ventanaMinutos?: number;
  solapamientoSegundos?: number;
  dominios?: string[];
  traceId: string;
}

export interface DeltaSweepOutput {
  dominiosBarridos: string[];
  dominiosEvaluados: string[];
  cuentasEvaluadas: number;
  cuentasInspeccionadas: number;
  cuentasActualizadas: number;
  cuentasOmitidasHash: number;
}

/**
 * Caso de uso `ExecuteDeltaSweepUseCase` (`T026` / US1):
 * Ejecuta el barrido incremental delta cada 2 minutos por los dominios activos en
 * `dominio_institucional` (`D-21`) para recuperar eventos que el pipeline de auditoría
 * de Google Workspace no haya entregado a tiempo por Pub/Sub.
 */
export class ExecuteDeltaSweepUseCase {
  constructor(
    private readonly gwsPort: IGoogleDirectoryReadOnlyPort,
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
    private readonly quotaGovernor: SyncQuotaGovernor,
  ) {}

  public async execute(input: DeltaSweepInput): Promise<DeltaSweepOutput> {
    const activeDomains = await this.syncIdentityRepo.listActiveDomains();
    const targetDomains =
      input.dominios && input.dominios.length > 0
        ? input.dominios
            .map((d) => d.toLowerCase())
            .filter((d) => activeDomains.includes(d))
        : activeDomains;

    let cuentasEvaluadas = 0;
    let cuentasActualizadas = 0;
    let cuentasOmitidasHash = 0;
    const dominiosBarridos: string[] = [];

    for (const dominio of targetDomains) {
      const quotaDecision = await this.quotaGovernor.tryAcquire('INCREMENTAL', 1);
      if (!quotaDecision.allowed) {
        break;
      }

      dominiosBarridos.push(dominio);
      const page = await this.gwsPort.listUsersReadOnly(
        {
          domain: dominio,
          maxResults: 500,
        },
        input.traceId,
      );

      for (const user of page.users) {
        cuentasEvaluadas++;
        const computedHash = hashPayloadGws(user);
        const existingMeta = await this.syncIdentityRepo.findAccountSyncMetadata(
          user.id,
          user.primaryEmail,
        );

        if (existingMeta && existingMeta.hashPayloadGws === computedHash) {
          cuentasOmitidasHash++;
          continue;
        }

        const res = await this.syncIdentityRepo.upsertSyncedIdentity({
          idEventoExterno: `DELTA_SWEEP:${dominio}:${user.id}:${Date.now()}`,
          gwsUser: user,
          hashPayloadGws: computedHash,
          origenCanal: 'SYNC_INCREMENTAL',
          modoDespacho: 'LOTE_LIST_500',
          traceId: input.traceId,
        });

        if (res.outcome === 'SIN_CAMBIOS_HASH') {
          cuentasOmitidasHash++;
        } else {
          cuentasActualizadas++;
          await this.cacheInvalidator.invalidateAccountScope({
            idInternoPersona: res.idInternoPersona,
            cuentaId: res.cuentaId,
            googleSubId: res.googleSubId,
            emailPrincipal: res.emailPrincipal,
            motivo: 'DELTA_SWEEP_2MIN',
            traceId: input.traceId,
          });
        }
      }
    }

    return {
      dominiosBarridos,
      dominiosEvaluados: dominiosBarridos,
      cuentasEvaluadas,
      cuentasInspeccionadas: cuentasEvaluadas,
      cuentasActualizadas,
      cuentasOmitidasHash,
    };
  }
}
