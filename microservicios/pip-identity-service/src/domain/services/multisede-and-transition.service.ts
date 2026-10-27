import {
  NivelEstructuraOrganizacional,
  PROVISIONAL_TEMP_ID_REGEX,
  TipoIdentificacionPersona,
  validateEcuadorianCedula,
} from '@minedec/shared';
import {
  CatalogoTerritorioSede,
  CedulaImmutabilityConflictError,
  DomainRuleError,
  IdentifierCollisionConflictError,
  PersonaIdentidad,
} from '../entities/identity-entities';

export type OrigenDatosContexto = 'GWS_PRIMARIO' | 'PAP_DELEGADO';

export interface AsignacionContexto {
  asignacionId: string;
  idInterno: string;
  cuentaId: string | null;
  origenDatos: OrigenDatosContexto;
  esSedePrimaria: boolean;
  nivelEstructura: NivelEstructuraOrganizacional;
  viceministerio: 'EDUCACION' | 'DEPORTE' | 'CULTURA' | 'GESTION_EDUCATIVA' | 'NO_APLICA';
  codigoZona: string;
  codigoDistrito: string | null;
  codigoCircuito: string | null;
  codigoAmie: string | null;
  codigoDependenciaAdmin: string | null;
  regimenEscolar: 'COSTA_GALAPAGOS' | 'SIERRA_AMAZONIA' | 'NO_APLICA';
  modalidadEducativa: 'PRESENCIAL' | 'SEMIPRESENCIAL' | 'A_DISTANCIA' | 'VIRTUAL' | 'NO_APLICA';
  jornada: 'MATUTINA' | 'VESPERTINA' | 'NOCTURNA' | 'INTENSIVA' | 'NO_APLICA';
  activo: boolean;
  asignadoPorIdentificacion: string | null;
  motivoAsignacion: string | null;
  creadoEn: string;
  actualizadoEn: string;
  sedeDetalle?: CatalogoTerritorioSede | null;
}

export type TransitionEvaluationOutcome =
  | {
      action: 'NO_CHANGE';
      persona: PersonaIdentidad;
      transitionedFromCodigoMinedec: false;
    }
  | {
      action: 'TRANSITION_CODIGO_TO_CEDULA';
      persona: PersonaIdentidad;
      previousCodigoMinedec: string;
      transitionedFromCodigoMinedec: true;
    }
  | {
      action: 'PROMOTE_PROVISIONAL_IN_PLACE';
      persona: PersonaIdentidad;
      previousProvisionalCode: string;
      transitionedFromCodigoMinedec: false;
    }
  | {
      action: 'RELINK_PROVISIONAL_TO_EXISTING';
      targetPersona: PersonaIdentidad;
      provisionalPersonaToDeactivate: PersonaIdentidad;
      transitionedFromCodigoMinedec: false;
    };

export interface MultisedeSyncPlan {
  preservedDelegatedAssignments: AsignacionContexto[];
  deactivatedDelegatedAssignments: AsignacionContexto[];
}

export class MultisedeAndTransitionService {
  /**
   * Evalúa la transición documental unidireccional CODIGO_MINEDEC -> CEDULA,
   * la promoción/re-vinculación de identidades provisionales (PENDIENTE_IDENTIFICACION)
   * y protege el invariante constitucional de inmutabilidad estricta de CEDULA (Principio X.2).
   */
  public evaluateIdentityDocumentTransition(params: {
    existingPersona: PersonaIdentidad;
    incomingTipo: TipoIdentificacionPersona;
    incomingNumero: string;
    collidingPersonaByDocument: PersonaIdentidad | null;
    nowIso?: string;
  }): TransitionEvaluationOutcome {
    const {
      existingPersona,
      incomingTipo,
      incomingNumero,
      collidingPersonaByDocument,
      nowIso = new Date().toISOString(),
    } = params;

    const isProvisional =
      existingPersona.estadoPersona === 'PENDIENTE_IDENTIFICACION' ||
      PROVISIONAL_TEMP_ID_REGEX.test(existingPersona.numeroIdentificacion);

    // Caso 1: La persona actual es provisional (creada en REGISTRO_CALIENTE con TEMP-*)
    if (isProvisional) {
      if (
        collidingPersonaByDocument &&
        collidingPersonaByDocument.idInterno !== existingPersona.idInterno
      ) {
        return {
          action: 'RELINK_PROVISIONAL_TO_EXISTING',
          targetPersona: collidingPersonaByDocument,
          provisionalPersonaToDeactivate: {
            ...existingPersona,
            estadoPersona: 'INACTIVA',
            actualizadoEn: nowIso,
          },
          transitionedFromCodigoMinedec: false,
        };
      }

      return {
        action: 'PROMOTE_PROVISIONAL_IN_PLACE',
        persona: {
          ...existingPersona,
          tipoIdentificacion: incomingTipo,
          numeroIdentificacion: incomingNumero,
          estadoPersona: 'ACTIVA',
          actualizadoEn: nowIso,
        },
        previousProvisionalCode: existingPersona.numeroIdentificacion,
        transitionedFromCodigoMinedec: false,
      };
    }

    // Caso 2: La persona ya tiene una CEDULA consolidada -> estrictamente inmutable (Principio X.2)
    if (existingPersona.tipoIdentificacion === 'CEDULA') {
      if (
        incomingTipo === 'CEDULA' &&
        incomingNumero === existingPersona.numeroIdentificacion
      ) {
        return {
          action: 'NO_CHANGE',
          persona: existingPersona,
          transitionedFromCodigoMinedec: false,
        };
      }
      throw new CedulaImmutabilityConflictError(
        existingPersona.idInterno,
        existingPersona.numeroIdentificacion,
        `${incomingTipo}:${incomingNumero}`,
      );
    }

    // Caso 3: El documento entrante es idéntico al actual (CODIGO_MINEDEC o PASAPORTE sin cambio)
    if (
      existingPersona.tipoIdentificacion === incomingTipo &&
      existingPersona.numeroIdentificacion === incomingNumero
    ) {
      return {
        action: 'NO_CHANGE',
        persona: existingPersona,
        transitionedFromCodigoMinedec: false,
      };
    }

    // Caso 4: Única transición documental permitida: CODIGO_MINEDEC -> CEDULA
    if (existingPersona.tipoIdentificacion === 'CODIGO_MINEDEC' && incomingTipo === 'CEDULA') {
      if (!validateEcuadorianCedula(incomingNumero)) {
        throw new DomainRuleError(
          `La nueva cédula '${incomingNumero}' para transición desde CODIGO_MINEDEC no supera el algoritmo Módulo 10.`,
          'INVALID_CEDULA_FOR_TRANSITION',
          400,
        );
      }

      if (
        collidingPersonaByDocument &&
        collidingPersonaByDocument.idInterno !== existingPersona.idInterno
      ) {
        throw new IdentifierCollisionConflictError(
          incomingNumero,
          collidingPersonaByDocument.idInterno,
          existingPersona.idInterno,
        );
      }

      const previousCode = existingPersona.numeroIdentificacion;
      return {
        action: 'TRANSITION_CODIGO_TO_CEDULA',
        persona: {
          ...existingPersona,
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: incomingNumero,
          codigoMinedecAnterior: existingPersona.codigoMinedecAnterior ?? previousCode,
          actualizadoEn: nowIso,
        },
        previousCodigoMinedec: previousCode,
        transitionedFromCodigoMinedec: true,
      };
    }

    // Cualquier otra mutación documental (ej. PASAPORTE -> CODIGO_MINEDEC o cambio de PASAPORTE sin flujo habilitado)
    throw new DomainRuleError(
      `Transición documental no permitida desde ${existingPersona.tipoIdentificacion} (${existingPersona.numeroIdentificacion}) hacia ${incomingTipo} (${incomingNumero}). Solo se permite la transición unidireccional CODIGO_MINEDEC -> CEDULA.`,
      'UNSUPPORTED_DOCUMENT_TRANSITION',
      409,
    );
  }

  /**
   * Determina qué asignaciones delegadas (PAP_DELEGADO) deben preservarse intactas
   * y cuáles deben desactivarse cuando docenteMultisede pasa de true a false (FR-008).
   */
  public evaluateMultisedeDelegatedAssignments(
    existingAssignments: readonly AsignacionContexto[],
    docenteMultisede: boolean,
    nowIso = new Date().toISOString(),
  ): MultisedeSyncPlan {
    const delegatedActive = existingAssignments.filter(
      (a) => a.origenDatos === 'PAP_DELEGADO' && a.activo,
    );

    if (docenteMultisede) {
      return {
        preservedDelegatedAssignments: delegatedActive,
        deactivatedDelegatedAssignments: [],
      };
    }

    return {
      preservedDelegatedAssignments: [],
      deactivatedDelegatedAssignments: delegatedActive.map((a) => ({
        ...a,
        activo: false,
        actualizadoEn: nowIso,
      })),
    };
  }
}
