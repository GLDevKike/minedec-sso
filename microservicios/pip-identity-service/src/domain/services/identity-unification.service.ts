import { randomUUID } from 'crypto';
import {
  MinedecPerfilInput,
  NivelEstructuraOrganizacional,
  normalizeCodigoZona,
  parseZonaDistritoCircuito,
  TipoIdentificacionPersona,
  TipoUsuarioPoblacion,
  validateCodigoAmie,
} from '@minedec/shared';
import {
  CatalogoTerritorioSede,
  DominioInstitucional,
  extractDomainFromEmail,
  PersonaIdentidad,
  resolveOrGenerateIdInterno,
} from '../entities/identity-entities';
import {
  AsignacionContexto,
  MultisedeAndTransitionService,
} from './multisede-and-transition.service';

export interface UnifyPersonaOutcome {
  persona: PersonaIdentidad;
  provisionalPersonaToDeactivate: PersonaIdentidad | null;
  transitionedFromCodigoMinedec: boolean;
  previousCodigoMinedec: string | null;
  relinkedFromProvisionalIdInterno: string | null;
  collisionDetected: {
    detected: boolean;
    conflictingIdInterno?: string;
    detail?: string;
  };
}

export class IdentityUnificationService {
  private readonly transitionService: MultisedeAndTransitionService;

  public constructor(transitionService?: MultisedeAndTransitionService) {
    this.transitionService = transitionService ?? new MultisedeAndTransitionService();
  }

  /**
   * Unifica o actualiza la PersonaIdentidad (Nivel 1) para una CuentaInstitucional (Nivel 2),
   * garantizando:
   * - Alcance exclusivo de personas naturales (CEDULA, PASAPORTE, CODIGO_MINEDEC).
   * - Unificación de múltiples cuentas en subdominios del tenant único bajo un mismo idInterno.
   * - Inmutabilidad estricta de CEDULA una vez consolidada (Principio X.2 Constitución v2.7.0).
   * - Transición unidireccional CODIGO_MINEDEC -> CEDULA y re-vinculación de identidades provisionales.
   */
  public resolveOrUnifyPersonaIdentidad(params: {
    existingAccountPersona: PersonaIdentidad | null;
    existingPersonaByDocument: PersonaIdentidad | null;
    existingPersonaByIncomingIdInterno: PersonaIdentidad | null;
    incomingIdInterno?: string | null;
    tipoIdentificacion: TipoIdentificacionPersona;
    numeroIdentificacion: string;
    nombreCompleto: string;
    fechaNacimiento: string | null;
    representanteLegalCedula: string | null;
    nowIso?: string;
  }): UnifyPersonaOutcome {
    const {
      existingAccountPersona,
      existingPersonaByDocument,
      existingPersonaByIncomingIdInterno,
      incomingIdInterno,
      tipoIdentificacion,
      numeroIdentificacion,
      nombreCompleto,
      fechaNacimiento,
      representanteLegalCedula,
      nowIso = new Date().toISOString(),
    } = params;

    // Caso 1: La cuenta ya estaba vinculada a una PersonaIdentidad
    if (existingAccountPersona) {
      const transitionOutcome = this.transitionService.evaluateIdentityDocumentTransition({
        existingPersona: existingAccountPersona,
        incomingTipo: tipoIdentificacion,
        incomingNumero: numeroIdentificacion,
        collidingPersonaByDocument: existingPersonaByDocument,
        nowIso,
      });

      if (transitionOutcome.action === 'RELINK_PROVISIONAL_TO_EXISTING') {
        const updatedTarget: PersonaIdentidad = {
          ...transitionOutcome.targetPersona,
          nombreCompleto: nombreCompleto.trim() || transitionOutcome.targetPersona.nombreCompleto,
          fechaNacimiento: fechaNacimiento ?? transitionOutcome.targetPersona.fechaNacimiento,
          representanteLegalCedula:
            representanteLegalCedula ?? transitionOutcome.targetPersona.representanteLegalCedula,
          actualizadoEn: nowIso,
        };
        return {
          persona: updatedTarget,
          provisionalPersonaToDeactivate: transitionOutcome.provisionalPersonaToDeactivate,
          transitionedFromCodigoMinedec: false,
          previousCodigoMinedec: null,
          relinkedFromProvisionalIdInterno:
            transitionOutcome.provisionalPersonaToDeactivate.idInterno,
          collisionDetected: { detected: false },
        };
      }

      const basePersona = transitionOutcome.persona;
      const updatedPersona: PersonaIdentidad = {
        ...basePersona,
        nombreCompleto: nombreCompleto.trim() || basePersona.nombreCompleto,
        fechaNacimiento: fechaNacimiento ?? basePersona.fechaNacimiento,
        representanteLegalCedula:
          representanteLegalCedula ?? basePersona.representanteLegalCedula,
        actualizadoEn: nowIso,
      };

      return {
        persona: updatedPersona,
        provisionalPersonaToDeactivate: null,
        transitionedFromCodigoMinedec: transitionOutcome.transitionedFromCodigoMinedec,
        previousCodigoMinedec:
          transitionOutcome.action === 'TRANSITION_CODIGO_TO_CEDULA'
            ? transitionOutcome.previousCodigoMinedec
            : null,
        relinkedFromProvisionalIdInterno: null,
        collisionDetected: { detected: false },
      };
    }

    // Caso 2: Cuenta nueva, pero ya existe una PersonaIdentidad con ese documento (Unificación multi-subdominio)
    if (existingPersonaByDocument) {
      // Verificar si el payload trajo un idInterno explícito que pertenece a OTRA persona distinta (colisión)
      if (
        incomingIdInterno &&
        incomingIdInterno.trim().toLowerCase() !==
          existingPersonaByDocument.idInterno.toLowerCase()
      ) {
        return {
          persona: existingPersonaByDocument,
          provisionalPersonaToDeactivate: null,
          transitionedFromCodigoMinedec: false,
          previousCodigoMinedec: null,
          relinkedFromProvisionalIdInterno: null,
          collisionDetected: {
            detected: true,
            conflictingIdInterno: existingPersonaByDocument.idInterno,
            detail: `Colisión de identificador: el documento ${tipoIdentificacion}:${numeroIdentificacion} pertenece a '${existingPersonaByDocument.idInterno}', pero la cuenta declara idInterno '${incomingIdInterno}'.`,
          },
        };
      }

      const unifiedPersona: PersonaIdentidad = {
        ...existingPersonaByDocument,
        nombreCompleto: nombreCompleto.trim() || existingPersonaByDocument.nombreCompleto,
        fechaNacimiento: fechaNacimiento ?? existingPersonaByDocument.fechaNacimiento,
        representanteLegalCedula:
          representanteLegalCedula ?? existingPersonaByDocument.representanteLegalCedula,
        actualizadoEn: nowIso,
      };

      return {
        persona: unifiedPersona,
        provisionalPersonaToDeactivate: null,
        transitionedFromCodigoMinedec: false,
        previousCodigoMinedec: null,
        relinkedFromProvisionalIdInterno: null,
        collisionDetected: { detected: false },
      };
    }

    // Caso 3: Cuenta nueva, pero el incomingIdInterno apunta a una PersonaIdentidad existente con otro documento
    if (existingPersonaByIncomingIdInterno) {
      const transitionOutcome = this.transitionService.evaluateIdentityDocumentTransition({
        existingPersona: existingPersonaByIncomingIdInterno,
        incomingTipo: tipoIdentificacion,
        incomingNumero: numeroIdentificacion,
        collidingPersonaByDocument: null,
        nowIso,
      });

      const baseTarget =
        transitionOutcome.action === 'RELINK_PROVISIONAL_TO_EXISTING'
          ? transitionOutcome.targetPersona
          : transitionOutcome.persona;

      const updatedPersona: PersonaIdentidad = {
        ...baseTarget,
        nombreCompleto: nombreCompleto.trim() || baseTarget.nombreCompleto,
        fechaNacimiento: fechaNacimiento ?? baseTarget.fechaNacimiento,
        representanteLegalCedula:
          representanteLegalCedula ?? baseTarget.representanteLegalCedula,
        actualizadoEn: nowIso,
      };

      return {
        persona: updatedPersona,
        provisionalPersonaToDeactivate: null,
        transitionedFromCodigoMinedec: transitionOutcome.transitionedFromCodigoMinedec,
        previousCodigoMinedec:
          transitionOutcome.action === 'TRANSITION_CODIGO_TO_CEDULA'
            ? transitionOutcome.previousCodigoMinedec
            : null,
        relinkedFromProvisionalIdInterno: null,
        collisionDetected: { detected: false },
      };
    }

    // Caso 4: Persona natural completamente nueva en el PIP
    const newIdInterno = resolveOrGenerateIdInterno(incomingIdInterno);
    const createdPersona: PersonaIdentidad = {
      idInterno: newIdInterno,
      tipoIdentificacion,
      numeroIdentificacion,
      codigoMinedecAnterior: null,
      nombreCompleto: nombreCompleto.trim(),
      fechaNacimiento,
      representanteLegalCedula,
      estadoPersona: 'ACTIVA',
      creadoEn: nowIso,
      actualizadoEn: nowIso,
    };

    return {
      persona: createdPersona,
      provisionalPersonaToDeactivate: null,
      transitionedFromCodigoMinedec: false,
      previousCodigoMinedec: null,
      relinkedFromProvisionalIdInterno: null,
      collisionDetected: { detected: false },
    };
  }

  /**
   * Construye la asignación de contexto primaria (GWS_PRIMARIO) en 3FN vinculada a CatalogoTerritorioSede.
   */
  public buildPrimaryContextAssignment(params: {
    existingPrimaryAssignment: AsignacionContexto | null;
    idInterno: string;
    cuentaId: string;
    perfil: MinedecPerfilInput;
    sedeCatalogo: CatalogoTerritorioSede | null;
    nowIso?: string;
  }): AsignacionContexto | null {
    const {
      existingPrimaryAssignment,
      idInterno,
      cuentaId,
      perfil,
      sedeCatalogo,
      nowIso = new Date().toISOString(),
    } = params;

    const parsedZdc = parseZonaDistritoCircuito(perfil.zonaDistritoCircuito);
    const rawAmie = perfil.codigoInstitucion?.trim().toUpperCase() || null;
    const validAmie = rawAmie && validateCodigoAmie(rawAmie) ? rawAmie : null;

    const codigoZona =
      sedeCatalogo?.codigoZona ??
      parsedZdc.codigoZona ??
      (validAmie ? normalizeCodigoZona(validAmie.slice(0, 2)) : null);

    if (!codigoZona) {
      return null;
    }

    const codigoDistrito = sedeCatalogo?.codigoDistrito ?? parsedZdc.codigoDistrito ?? null;
    const codigoCircuito = sedeCatalogo?.codigoCircuito ?? parsedZdc.codigoCircuito ?? null;

    const nivelEstructura = (perfil.nivelEstructura?.trim().toUpperCase() ||
      (validAmie ? 'INSTITUCION_EDUCATIVA' : 'ZONA')) as NivelEstructuraOrganizacional;

    const viceministerio = (perfil.viceministerio?.trim().toUpperCase() ||
      'NO_APLICA') as AsignacionContexto['viceministerio'];

    const regimenEscolar = (perfil.regimenEscolar?.trim().toUpperCase() ||
      sedeCatalogo?.regimenEscolar ||
      'NO_APLICA') as AsignacionContexto['regimenEscolar'];

    const modalidadEducativa = (perfil.modalidadEducativa?.trim().toUpperCase() ||
      sedeCatalogo?.modalidadEducativa ||
      'NO_APLICA') as AsignacionContexto['modalidadEducativa'];

    const jornada = (perfil.jornada?.trim().toUpperCase() ||
      sedeCatalogo?.jornada ||
      'NO_APLICA') as AsignacionContexto['jornada'];

    return {
      asignacionId: existingPrimaryAssignment?.asignacionId ?? randomUUID(),
      idInterno,
      cuentaId,
      origenDatos: 'GWS_PRIMARIO',
      esSedePrimaria: true,
      nivelEstructura,
      viceministerio,
      codigoZona,
      codigoDistrito,
      codigoCircuito,
      codigoAmie: sedeCatalogo ? sedeCatalogo.codigoAmie : validAmie,
      codigoDependenciaAdmin: perfil.codigoDependenciaAdmin?.trim() || null,
      regimenEscolar,
      modalidadEducativa,
      jornada,
      activo: true,
      asignadoPorIdentificacion: null,
      motivoAsignacion: 'Sincronización primaria desde Google Workspace (MINEDEC_Perfil)',
      creadoEn: existingPrimaryAssignment?.creadoEn ?? nowIso,
      actualizadoEn: nowIso,
      sedeDetalle: sedeCatalogo,
    };
  }

  /**
   * Infiere el tipoUsuario inicial para una cuenta en REGISTRO_CALIENTE según su subdominio
   * dentro del único tenant de Google Workspace (D-21).
   */
  public inferPopulationFromDomain(
    emailPrincipal: string,
    dominioEntity: DominioInstitucional | null,
  ): TipoUsuarioPoblacion {
    if (dominioEntity && dominioEntity.tipoPoblacion !== 'MIXTO') {
      return dominioEntity.tipoPoblacion;
    }

    const domain = extractDomainFromEmail(emailPrincipal);
    if (domain.startsWith('estudiante.') || domain.startsWith('estudiantes.')) {
      return 'ESTUDIANTE';
    }
    if (domain.startsWith('docentes.') || domain.startsWith('docente.')) {
      return 'DOCENTE';
    }
    return 'ADMINISTRATIVO';
  }

  public inferDefaultUserTypeFromDomain(
    dominioEntity: DominioInstitucional | null,
    emailPrincipal?: string,
  ): TipoUsuarioPoblacion {
    return this.inferPopulationFromDomain(
      emailPrincipal ?? `user@${dominioEntity?.dominio ?? 'educacion.gob.ec'}`,
      dominioEntity,
    );
  }
}

