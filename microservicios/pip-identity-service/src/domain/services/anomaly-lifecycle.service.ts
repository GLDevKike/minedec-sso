import { randomUUID } from 'crypto';
import {
  CodigoCausalAnomalia,
  DetectedProfileAnomaly,
  EfectoAccesoAnomalia,
} from '@minedec/shared';
import {
  DomainRuleError,
  EstadoPersonaIdentidad,
  EstadoSincronizacionCuenta,
  NivelAccesoEfectivo,
} from '../entities/identity-entities';

export type EstadoAnomalia =
  | 'ABIERTA'
  | 'EN_REVISION'
  | 'LISTA_PARA_CERRAR'
  | 'RESUELTA'
  | 'DESCARTADA';

export type OrigenResolucionAnomalia = 'AUTO_SINCRONIZACION' | 'MANUAL_ADMIN';

export interface AnomaliaIdentidad {
  anomaliaId: string;
  anomaliaAnteriorId: string | null;
  idInterno: string | null;
  cuentaId: string | null;
  googleSubId: string;
  emailPrincipal: string;
  dominio: string;
  codigoCausal: CodigoCausalAnomalia;
  efectoAcceso: EfectoAccesoAnomalia;
  estadoAnomalia: EstadoAnomalia;
  origenResolucion: OrigenResolucionAnomalia | null;
  resueltaPorIdentificacion: string | null;
  motivoResolucion: string | null;
  valorAnterior: Record<string, unknown> | null;
  valorNuevo: Record<string, unknown> | null;
  detalleTecnico: string;
  detectadaEn: string;
  resueltaEn: string | null;
}

export interface AnomalyReconciliationResult {
  newAnomaliesToInsert: AnomaliaIdentidad[];
  existingAnomaliesToUpdate: AnomaliaIdentidad[];
  activeAnomaliesAfterSync: AnomaliaIdentidad[];
}

export class AnomalyLifecycleService {
  public getAccessEffectForCausal(codigoCausal: CodigoCausalAnomalia): EfectoAccesoAnomalia {
    switch (codigoCausal) {
      case 'SIN_IDENTIFICACION_VALIDA':
      case 'COLISION_IDENTIFICADOR':
      case 'VIGENCIA_INVALIDA':
        return 'BLOQUEANTE';
      case 'ATRIBUTO_OBLIGATORIO_FALTANTE':
      case 'FORMATO_AMIE_INVALIDO':
        return 'RESTRINGIDA';
    }
  }

  public isActiveState(estado: EstadoAnomalia): boolean {
    return (
      estado === 'ABIERTA' || estado === 'EN_REVISION' || estado === 'LISTA_PARA_CERRAR'
    );
  }

  /**
   * Reconcilia las anomalías detectadas en una sincronización contra las anomalías existentes de la cuenta:
   * - Si una anomalía de datos o documento (excepto COLISION_IDENTIFICADOR) desaparece, pasa a RESUELTA con AUTO_SINCRONIZACION.
   * - Si COLISION_IDENTIFICADOR desaparece en el directorio origen, pasa a LISTA_PARA_CERRAR (manteniendo bloqueo hasta cierre MANUAL_ADMIN).
   * - Si reaparece una causal previamente RESUELTA, crea un nuevo registro enlazando anomaliaAnteriorId.
   */
  public reconcileAccountAnomalies(params: {
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    idInterno: string | null;
    cuentaId: string | null;
    detectedAnomalies: readonly DetectedProfileAnomaly[];
    currentActiveAnomalies: readonly AnomaliaIdentidad[];
    lastResolvedByCausal: Readonly<Partial<Record<CodigoCausalAnomalia, AnomaliaIdentidad>>>;
    previousSnapshot: Record<string, unknown> | null;
    currentSnapshot: Record<string, unknown>;
    nowIso?: string;
  }): AnomalyReconciliationResult {
    const {
      googleSubId,
      emailPrincipal,
      dominio,
      idInterno,
      cuentaId,
      detectedAnomalies,
      currentActiveAnomalies,
      lastResolvedByCausal,
      previousSnapshot,
      currentSnapshot,
      nowIso = new Date().toISOString(),
    } = params;

    const detectedByCausal = new Map<CodigoCausalAnomalia, DetectedProfileAnomaly>();
    for (const det of detectedAnomalies) {
      detectedByCausal.set(det.codigoCausal, det);
    }

    const newAnomaliesToInsert: AnomaliaIdentidad[] = [];
    const existingAnomaliesToUpdate: AnomaliaIdentidad[] = [];
    const activeAnomaliesAfterSync: AnomaliaIdentidad[] = [];

    const handledActiveCausals = new Set<CodigoCausalAnomalia>();

    for (const active of currentActiveAnomalies) {
      const stillDetected = detectedByCausal.get(active.codigoCausal);
      handledActiveCausals.add(active.codigoCausal);

      if (stillDetected) {
        const updatedActive: AnomaliaIdentidad = {
          ...active,
          idInterno: idInterno ?? active.idInterno,
          cuentaId: cuentaId ?? active.cuentaId,
          emailPrincipal,
          dominio,
          estadoAnomalia:
            active.estadoAnomalia === 'LISTA_PARA_CERRAR' ? 'ABIERTA' : active.estadoAnomalia,
          detalleTecnico: stillDetected.detalleTecnico,
          valorNuevo: currentSnapshot,
        };
        existingAnomaliesToUpdate.push(updatedActive);
        activeAnomaliesAfterSync.push(updatedActive);
      } else if (active.codigoCausal === 'COLISION_IDENTIFICADOR') {
        // COLISION_IDENTIFICADOR nunca se auto-resuelve; pasa a LISTA_PARA_CERRAR y exige cierre MANUAL_ADMIN
        const readyToClose: AnomaliaIdentidad = {
          ...active,
          idInterno: idInterno ?? active.idInterno,
          cuentaId: cuentaId ?? active.cuentaId,
          emailPrincipal,
          dominio,
          estadoAnomalia: 'LISTA_PARA_CERRAR',
          valorNuevo: currentSnapshot,
          detalleTecnico: `${active.detalleTecnico} [Conflicto corregido en origen; pendiente de cierre MANUAL_ADMIN]`,
        };
        existingAnomaliesToUpdate.push(readyToClose);
        activeAnomaliesAfterSync.push(readyToClose);
      } else {
        // Auto-resolución de anomalías de datos corregidos en Google Workspace
        const autoResolved: AnomaliaIdentidad = {
          ...active,
          idInterno: idInterno ?? active.idInterno,
          cuentaId: cuentaId ?? active.cuentaId,
          emailPrincipal,
          dominio,
          estadoAnomalia: 'RESUELTA',
          origenResolucion: 'AUTO_SINCRONIZACION',
          motivoResolucion: 'Atributo corregido y validado automáticamente desde Google Workspace.',
          valorNuevo: currentSnapshot,
          resueltaEn: nowIso,
        };
        existingAnomaliesToUpdate.push(autoResolved);
      }
    }

    // Crear nuevas anomalías para causales que no estaban activas
    for (const [causal, detected] of detectedByCausal.entries()) {
      if (handledActiveCausals.has(causal)) {
        continue;
      }

      const previousResolved = lastResolvedByCausal[causal] ?? null;
      const newAnomaly: AnomaliaIdentidad = {
        anomaliaId: randomUUID(),
        anomaliaAnteriorId: previousResolved ? previousResolved.anomaliaId : null,
        idInterno,
        cuentaId,
        googleSubId,
        emailPrincipal,
        dominio,
        codigoCausal: causal,
        efectoAcceso: detected.efectoAcceso,
        estadoAnomalia: 'ABIERTA',
        origenResolucion: null,
        resueltaPorIdentificacion: null,
        motivoResolucion: null,
        valorAnterior: previousSnapshot,
        valorNuevo: currentSnapshot,
        detalleTecnico: detected.detalleTecnico,
        detectadaEn: nowIso,
        resueltaEn: null,
      };

      newAnomaliesToInsert.push(newAnomaly);
      activeAnomaliesAfterSync.push(newAnomaly);
    }

    return {
      newAnomaliesToInsert,
      existingAnomaliesToUpdate,
      activeAnomaliesAfterSync,
    };
  }

  /**
   * Cierre manual obligatorio (MANUAL_ADMIN) por un Superadministrador de Seguridad Informática.
   */
  public resolveAnomalyManually(params: {
    anomaly: AnomaliaIdentidad;
    resueltaPorIdentificacion: string;
    motivoResolucion: string;
    nowIso?: string;
  }): AnomaliaIdentidad {
    const {
      anomaly,
      resueltaPorIdentificacion,
      motivoResolucion,
      nowIso = new Date().toISOString(),
    } = params;

    if (!this.isActiveState(anomaly.estadoAnomalia)) {
      throw new DomainRuleError(
        `La anomalía '${anomaly.anomaliaId}' ya se encuentra en estado '${anomaly.estadoAnomalia}'.`,
        'ANOMALY_ALREADY_CLOSED',
        409,
      );
    }

    const trimmedMotivo = motivoResolucion.trim();
    if (trimmedMotivo.length < 10) {
      throw new DomainRuleError(
        'El motivo de resolución manual debe tener al menos 10 caracteres.',
        'INVALID_RESOLUTION_REASON',
        400,
      );
    }

    return {
      ...anomaly,
      estadoAnomalia: 'RESUELTA',
      origenResolucion: 'MANUAL_ADMIN',
      resueltaPorIdentificacion: resueltaPorIdentificacion.trim(),
      motivoResolucion: trimmedMotivo,
      resueltaEn: nowIso,
    };
  }

  /**
   * Calcula el estado efectivo de la PersonaIdentidad, CuentaInstitucional y NivelAccesoEfectivo
   * según anomalías activas, suspensión en GWS y vigencia temporal.
   */
  public computeEffectiveStates(params: {
    suspendedEnGws: boolean;
    vigenciaExpirada: boolean;
    isProvisionalPendingIdentification: boolean;
    activeAnomalies: readonly AnomaliaIdentidad[];
  }): {
    estadoPersona: EstadoPersonaIdentidad;
    estadoSincronizacion: EstadoSincronizacionCuenta;
    nivelAccesoEfectivo: NivelAccesoEfectivo;
  } {
    const {
      suspendedEnGws,
      vigenciaExpirada,
      isProvisionalPendingIdentification,
      activeAnomalies,
    } = params;

    const hasBlockingAnomaly = activeAnomalies.some(
      (a) => this.isActiveState(a.estadoAnomalia) && a.efectoAcceso === 'BLOQUEANTE',
    );
    const hasRestrictedAnomaly = activeAnomalies.some(
      (a) => this.isActiveState(a.estadoAnomalia) && a.efectoAcceso === 'RESTRINGIDA',
    );

    if (suspendedEnGws) {
      return {
        estadoPersona: hasBlockingAnomaly ? 'BLOQUEADA_ANOMALIA' : 'INACTIVA',
        estadoSincronizacion: 'SUSPENDIDA_GWS',
        nivelAccesoEfectivo: 'BLOQUEADO',
      };
    }

    if (vigenciaExpirada) {
      return {
        estadoPersona: hasBlockingAnomaly ? 'BLOQUEADA_ANOMALIA' : 'INACTIVA',
        estadoSincronizacion: 'VIGENCIA_VENCIDA',
        nivelAccesoEfectivo: 'BLOQUEADO',
      };
    }

    if (hasBlockingAnomaly) {
      return {
        estadoPersona: 'BLOQUEADA_ANOMALIA',
        estadoSincronizacion: 'BLOQUEADA_ANOMALIA',
        nivelAccesoEfectivo: 'BLOQUEADO',
      };
    }

    if (isProvisionalPendingIdentification) {
      return {
        estadoPersona: 'PENDIENTE_IDENTIFICACION',
        estadoSincronizacion: 'REGISTRO_CALIENTE',
        nivelAccesoEfectivo: 'RESTRINGIDA_SOLO_AUTENTICADA',
      };
    }

    if (hasRestrictedAnomaly) {
      return {
        estadoPersona: 'RESTRINGIDA_ANOMALIA',
        estadoSincronizacion: 'SINCRONIZADA',
        nivelAccesoEfectivo: 'RESTRINGIDA_SOLO_AUTENTICADA',
      };
    }

    return {
      estadoPersona: 'ACTIVA',
      estadoSincronizacion: 'SINCRONIZADA',
      nivelAccesoEfectivo: 'COMPLETO',
    };
  }
}
