import { randomUUID } from 'crypto';
import {
  AMIE_CODE_REGEX,
  CIRCUITO_CODE_REGEX,
  DatabaseTransactionManager,
  DISTRITO_CODE_REGEX,
  NivelEstructuraOrganizacional,
  ZONA_CODE_REGEX,
} from '@minedec/shared';
import {
  DomainRuleError,
  EntityNotFoundDomainError,
} from '../domain/entities/identity-entities';
import {
  AsignacionContextoRepositoryPort,
  AuditLogPort,
  CacheInvalidationPublisherPort,
  CatalogoTerritorioSedeRepositoryPort,
  CuentaInstitucionalRepositoryPort,
  IdentityCachePort,
  PersonaIdentidadRepositoryPort,
} from '../domain/ports';
import { AsignacionContexto } from '../domain/services/multisede-and-transition.service';

export interface CreateContextAssignmentCommand {
  numeroIdentificacion: string;
  nivelEstructura: NivelEstructuraOrganizacional;
  viceministerio?: 'EDUCACION' | 'DEPORTE' | 'CULTURA' | 'GESTION_EDUCATIVA' | 'NO_APLICA';
  codigoZona: string;
  codigoDistrito?: string | null;
  codigoCircuito?: string | null;
  codigoAmie?: string | null;
  codigoDependenciaAdmin?: string | null;
  cargoFuncion?: string | null;
  motivoAsignacion: string;
  actorIdentificacion?: string;
}

export interface ContextAssignmentViewDto {
  asignacionId: string;
  origenDatos: 'GWS_PRIMARIO' | 'PAP_DELEGADO';
  esSedePrimaria: boolean;
  nivelEstructura: NivelEstructuraOrganizacional;
  codigoZona: string;
  codigoDistrito: string | null;
  codigoCircuito: string | null;
  codigoAmie: string | null;
  codigoDependenciaAdmin: string | null;
  activo: boolean;
}

export class ManageMultisedeContextUseCase {
  public constructor(
    private readonly txManager: DatabaseTransactionManager,
    private readonly personaRepository: PersonaIdentidadRepositoryPort,
    private readonly cuentaRepository: CuentaInstitucionalRepositoryPort,
    private readonly sedeRepository: CatalogoTerritorioSedeRepositoryPort,
    private readonly contextRepository: AsignacionContextoRepositoryPort,
    private readonly cachePort: IdentityCachePort,
    private readonly cacheInvalidationPublisher: CacheInvalidationPublisherPort,
    private readonly auditLogPort: AuditLogPort,
  ) {}

  public async assignComplementaryContext(
    command: CreateContextAssignmentCommand,
  ): Promise<ContextAssignmentViewDto> {
    const normalizedNumero = command.numeroIdentificacion.trim().toUpperCase();
    const codigoZona = command.codigoZona.trim().toUpperCase();
    const codigoDistrito = command.codigoDistrito ? command.codigoDistrito.trim().toUpperCase() : null;
    const codigoCircuito = command.codigoCircuito ? command.codigoCircuito.trim().toUpperCase() : null;
    const codigoAmie = command.codigoAmie ? command.codigoAmie.trim().toUpperCase() : null;
    const codigoDependenciaAdmin = command.codigoDependenciaAdmin
      ? command.codigoDependenciaAdmin.trim().toUpperCase()
      : null;
    const motivoAsignacion = command.motivoAsignacion.trim();

    if (!ZONA_CODE_REGEX.test(codigoZona)) {
      throw new DomainRuleError(
        `El código de zona '${codigoZona}' no cumple el patrón territorial del MINEDEC.`,
        'INVALID_CODIGO_ZONA',
        400,
      );
    }

    if (codigoDistrito && !DISTRITO_CODE_REGEX.test(codigoDistrito)) {
      throw new DomainRuleError(
        `El código de distrito '${codigoDistrito}' no cumple el patrón territorial del MINEDEC.`,
        'INVALID_CODIGO_DISTRITO',
        400,
      );
    }

    if (codigoCircuito && !CIRCUITO_CODE_REGEX.test(codigoCircuito)) {
      throw new DomainRuleError(
        `El código de circuito '${codigoCircuito}' no cumple el patrón territorial del MINEDEC.`,
        'INVALID_CODIGO_CIRCUITO',
        400,
      );
    }

    if (command.nivelEstructura === 'INSTITUCION_EDUCATIVA' && !codigoAmie) {
      throw new DomainRuleError(
        'Para el nivel de estructura INSTITUCION_EDUCATIVA es obligatorio proporcionar codigoAmie.',
        'MISSING_CODIGO_AMIE',
        400,
      );
    }

    if (codigoAmie && !AMIE_CODE_REGEX.test(codigoAmie)) {
      throw new DomainRuleError(
        `El código AMIE '${codigoAmie}' no cumple el patrón oficial de 8 caracteres.`,
        'INVALID_CODIGO_AMIE',
        400,
      );
    }

    if (motivoAsignacion.length < 5) {
      throw new DomainRuleError(
        'El motivo de asignación delegada es obligatorio (mínimo 5 caracteres).',
        'INVALID_MOTIVO_ASIGNACION',
        400,
      );
    }

    const nowIso = new Date().toISOString();
    const actor = command.actorIdentificacion ?? 'PAP_ADMIN_SYSTEM';

    const txResult = await this.txManager.withTransaction(async (tx) => {
      const persona = await this.personaRepository.findByNumeroIdentificacionOnly(
        normalizedNumero,
        tx,
      );
      if (!persona) {
        throw new EntityNotFoundDomainError(
          `No existe una PersonaIdentidad registrada con numeroIdentificacion '${normalizedNumero}'.`,
          'IDENTITY_NOT_FOUND',
        );
      }

      const sedeCatalogo = codigoAmie
        ? await this.sedeRepository.findByCodigoAmie(codigoAmie, tx)
        : null;

      if (codigoAmie && (!sedeCatalogo || !sedeCatalogo.activo)) {
        throw new DomainRuleError(
          `El código AMIE '${codigoAmie}' no existe o se encuentra inactivo en el catálogo maestro de sedes del MINEDEC.`,
          'AMIE_NOT_FOUND_IN_CATALOG',
          400,
        );
      }

      const accounts = await this.cuentaRepository.findAllByIdInterno(persona.idInterno, tx);
      if (
        accounts.some((c) => c.tipoUsuario === 'DOCENTE') &&
        !accounts.some((c) => c.docenteMultisede)
      ) {
        throw new DomainRuleError(
          'No se permite asignar sedes complementarias (PAP_DELEGADO) cuando docenteMultisede = false.',
          'MULTISEDE_NOT_ENABLED',
          422,
        );
      }
      const docenteOrPrimaryAccount =
        accounts.find((c) => c.docenteMultisede) ?? accounts[0] ?? null;

      const assignmentToInsert: AsignacionContexto = {
        asignacionId: randomUUID(),
        idInterno: persona.idInterno,
        cuentaId: docenteOrPrimaryAccount ? docenteOrPrimaryAccount.cuentaId : null,
        origenDatos: 'PAP_DELEGADO',
        esSedePrimaria: false,
        nivelEstructura: command.nivelEstructura,
        viceministerio: command.viceministerio ?? 'EDUCACION',
        codigoZona: sedeCatalogo?.codigoZona ?? codigoZona,
        codigoDistrito: codigoDistrito ?? sedeCatalogo?.codigoDistrito ?? null,
        codigoCircuito: codigoCircuito ?? sedeCatalogo?.codigoCircuito ?? null,
        codigoAmie,
        codigoDependenciaAdmin,
        regimenEscolar: sedeCatalogo?.regimenEscolar ?? 'NO_APLICA',
        modalidadEducativa: sedeCatalogo?.modalidadEducativa ?? 'NO_APLICA',
        jornada: sedeCatalogo?.jornada ?? 'NO_APLICA',
        activo: true,
        asignadoPorIdentificacion: actor,
        motivoAsignacion,
        creadoEn: nowIso,
        actualizadoEn: nowIso,
        sedeDetalle: sedeCatalogo,
      };

      const savedAssignment = await this.contextRepository.insertDelegatedAssignment(
        assignmentToInsert,
        tx,
      );

      await this.auditLogPort.recordEvent(
        {
          tipoEvento: 'ASIGNACION_CONTEXTO_MODIFICADA',
          idInterno: persona.idInterno,
          cuentaId: savedAssignment.cuentaId,
          actorIdentificacion: actor,
          origenComponente: 'PAP_ADMIN',
          payloadEvento: {
            asignacionId: savedAssignment.asignacionId,
            origenDatos: savedAssignment.origenDatos,
            nivelEstructura: savedAssignment.nivelEstructura,
            codigoZona: savedAssignment.codigoZona,
            codigoDistrito: savedAssignment.codigoDistrito,
            codigoCircuito: savedAssignment.codigoCircuito,
            codigoAmie: savedAssignment.codigoAmie,
            codigoDependenciaAdmin: savedAssignment.codigoDependenciaAdmin,
            motivoAsignacion: savedAssignment.motivoAsignacion,
          },
        },
        tx,
      );

      return {
        persona,
        accounts,
        savedAssignment,
      };
    });

    const identifiers = [
      {
        tipoIdentificacion: txResult.persona.tipoIdentificacion,
        numeroIdentificacion: txResult.persona.numeroIdentificacion,
      },
    ];
    if (txResult.persona.codigoMinedecAnterior) {
      identifiers.push({
        tipoIdentificacion: 'CODIGO_MINEDEC',
        numeroIdentificacion: txResult.persona.codigoMinedecAnterior,
      });
    }

    const keysUnlinkedCount = await this.cachePort.invalidateIdentityKeys({
      idInterno: txResult.persona.idInterno,
      identifiers,
      emails: txResult.accounts.map((a) => a.emailPrincipal),
      googleSubIds: txResult.accounts.map((a) => a.googleSubId),
    });

    await this.cacheInvalidationPublisher.publishInvalidationEvent({
      eventId: randomUUID(),
      occurredAt: nowIso,
      reason: 'PAP_DELEGATED_CONTEXT_ASSIGNED',
      idInterno: txResult.persona.idInterno,
      keysUnlinkedCount,
      identifiers: identifiers.map((i) => `${i.tipoIdentificacion}:${i.numeroIdentificacion}`),
      emails: txResult.accounts.map((a) => a.emailPrincipal),
      googleSubIds: txResult.accounts.map((a) => a.googleSubId),
    });

    return {
      asignacionId: txResult.savedAssignment.asignacionId,
      origenDatos: txResult.savedAssignment.origenDatos,
      esSedePrimaria: txResult.savedAssignment.esSedePrimaria,
      nivelEstructura: txResult.savedAssignment.nivelEstructura,
      codigoZona: txResult.savedAssignment.codigoZona,
      codigoDistrito: txResult.savedAssignment.codigoDistrito,
      codigoCircuito: txResult.savedAssignment.codigoCircuito,
      codigoAmie: txResult.savedAssignment.codigoAmie,
      codigoDependenciaAdmin: txResult.savedAssignment.codigoDependenciaAdmin,
      activo: txResult.savedAssignment.activo,
    };
  }
}
