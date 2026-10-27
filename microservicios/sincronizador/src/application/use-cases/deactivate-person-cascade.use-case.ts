import {
  DeactivatePersonCascadeParams,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../domain/ports/sync-ports';

export interface DeactivatePersonCascadeOutput {
  idInterno: string;
  estadoPersona: 'INACTIVA' | 'BLOQUEADA_ANOMALIA';
  cuentasDesactivadas: number;
  cuentasDesactivadasCount: number;
  subdominiosAfectados: string[];
  cacheInvalidated: boolean;
}

/**
 * Caso de uso para la Baja Lógica Diferenciada en Dos Niveles (Nivel 2: Desactivación de Persona Raíz) (`T034` / US2):
 * Desactiva directamente la `PersonaIdentidad` (`INACTIVA` o `BLOQUEADA_ANOMALIA`), propaga la
 * suspensión en cascada a todas sus `CuentaInstitucional` en todos los subdominios e invalida
 * en cascada la caché L2 en Memorystore Redis + Pub/Sub en `< 5 s` p95 (`<= 300 s` límite duro).
 */
export class DeactivatePersonCascadeUseCase {
  constructor(
    private readonly syncIdentityRepo: ISyncIdentityRepositoryPort,
    private readonly cacheInvalidator: ISyncCacheInvalidatorPort,
  ) {}

  public async execute(
    params: DeactivatePersonCascadeParams,
  ): Promise<DeactivatePersonCascadeOutput | null> {
    const result = await this.syncIdentityRepo.deactivatePersonCascade(params);
    if (!result) {
      return null;
    }

    const invalidation = await this.cacheInvalidator.invalidatePersonCascadeScope({
      idInternoPersona: result.idInterno,
      tipoIdentificacion: result.tipoIdentificacion,
      numeroIdentificacion: result.numeroIdentificacion,
      cuentas: result.cuentasDesactivadas,
      motivo: `PERSONA_DESACTIVADA_CASCADA:${params.motivoDesactivacion}`,
      traceId: params.traceId,
    });

    return {
      idInterno: result.idInterno,
      estadoPersona: result.estadoPersona,
      cuentasDesactivadas: result.cuentasDesactivadas.length,
      cuentasDesactivadasCount: result.cuentasDesactivadas.length,
      subdominiosAfectados: result.subdominiosAfectados,
      cacheInvalidated: invalidation.invalidatedKeysCount >= 0,
    };
  }
}
