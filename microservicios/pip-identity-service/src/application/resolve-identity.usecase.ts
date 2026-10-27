import { randomUUID } from 'crypto';
import {
  buildProvisionalTempIdentifier,
  DatabaseTransactionManager,
  evaluateTemporalValidity,
  PipMetricsCollector,
  PROVISIONAL_TEMP_ID_REGEX,
  TipoIdentificacionPersona,
} from '@minedec/shared';
import {
  CuentaInstitucional,
  DominioInstitucional,
  EntityNotFoundDomainError,
  EstadoPersonaIdentidad,
  EstadoSincronizacionCuenta,
  extractDomainFromEmail,
  FailCloseForbiddenAccessError,
  NivelAccesoEfectivo,
  PersonaIdentidad,
  resolveOrGenerateIdInterno,
} from '../domain/entities/identity-entities';
import {
  AnomaliaIdentidadRepositoryPort,
  AsignacionContextoRepositoryPort,
  AuditLogPort,
  CuentaInstitucionalRepositoryPort,
  DominioInstitucionalRepositoryPort,
  IdentityCachePort,
  PersonaIdentidadRepositoryPort,
  PrioritySyncQueuePort,
  ProjectedUnifiedIdentity,
} from '../domain/ports';
import {
  AnomaliaIdentidad,
  AnomalyLifecycleService,
} from '../domain/services/anomaly-lifecycle.service';
import { IdentityUnificationService } from '../domain/services/identity-unification.service';
import { AsignacionContexto } from '../domain/services/multisede-and-transition.service';
import { ContextAssignmentViewDto } from './manage-multisede-context.usecase';

export interface ResolveIdentityCommand {
  googleSubId: string;
  emailPrincipal: string;
  nombreCompleto: string;
  idInterno?: string | null;
  tipoIdentificacion?: TipoIdentificacionPersona | null;
  numeroIdentificacion?: string | null;
  traceId?: string;
}

export interface ResolvedIdentityResponseDto {
  idInterno: string;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  codigoMinedecAnterior: string | null;
  nombreCompleto: string;
  estadoPersona: EstadoPersonaIdentidad;
  nivelAccesoEfectivo: NivelAccesoEfectivo;
  cuentaActiva: {
    cuentaId: string;
    emailPrincipal: string;
    dominio: string;
    tipoUsuario: string | null;
    subtipoUsuario: string | null;
    estadoSincronizacion: EstadoSincronizacionCuenta;
  };
  contextosActivos: ContextAssignmentViewDto[];
  prioritySyncQueued: boolean;
}

export interface ResolveIdentityOutcome {
  statusCode: 200 | 202;
  response: ResolvedIdentityResponseDto;
}

export interface UnifiedIdentityAdminViewDto {
  idInterno: string;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  codigoMinedecAnterior: string | null;
  nombreCompleto: string;
  fechaNacimiento: string | null;
  estadoPersona: EstadoPersonaIdentidad;
  cuentasInstitucionales: Array<{
    cuentaId: string;
    emailPrincipal: string;
    dominio: string;
    tipoUsuario: string | null;
    subtipoUsuario: string | null;
    suspendedEnGws: boolean;
    estadoSincronizacion: EstadoSincronizacionCuenta;
  }>;
  contextosAsignados: ContextAssignmentViewDto[];
}

export class ResolveIdentityUseCase {
  public constructor(
    private readonly txManager: DatabaseTransactionManager,
    private readonly personaRepository: PersonaIdentidadRepositoryPort,
    private readonly cuentaRepository: CuentaInstitucionalRepositoryPort,
    private readonly dominioRepository: DominioInstitucionalRepositoryPort,
    private readonly contextRepository: AsignacionContextoRepositoryPort,
    private readonly anomalyRepository: AnomaliaIdentidadRepositoryPort,
    private readonly cachePort: IdentityCachePort,
    private readonly prioritySyncQueuePort: PrioritySyncQueuePort,
    private readonly auditLogPort: AuditLogPort,
    private readonly unificationService: IdentityUnificationService,
    private readonly anomalyService: AnomalyLifecycleService,
    private readonly metrics: PipMetricsCollector,
  ) {}

  public async resolveOrHotRegisterIdentity(
    command: ResolveIdentityCommand,
  ): Promise<ResolveIdentityOutcome> {
    const googleSubId = command.googleSubId.trim();
    const emailPrincipal = command.emailPrincipal.trim().toLowerCase();
    const nombreCompleto = command.nombreCompleto.trim();

    // 1. Intento de resolución desde Redis L2 (1 salto)
    let cachedProjection = await this.cachePort.getByGoogleSubId(googleSubId);
    if (!cachedProjection) {
      cachedProjection = await this.cachePort.getByEmail(emailPrincipal);
    }

    if (cachedProjection) {
      this.metrics.recordCacheHit();
      const cuentaActiva = this.selectActiveAccount(
        cachedProjection.cuentas,
        googleSubId,
        emailPrincipal,
      );
      this.enforceFailCloseGuard(cachedProjection, cuentaActiva);
      this.metrics.recordResolveRequest();
      return {
        statusCode: 200,
        response: this.toResolvedDto(cachedProjection, cuentaActiva, false),
      };
    }

    this.metrics.recordCacheMiss();

    // 2. Búsqueda en AlloyDB (PIP primario)
    let existingAccount = await this.cuentaRepository.findByGoogleSubId(googleSubId);
    if (!existingAccount) {
      existingAccount = await this.cuentaRepository.findByEmailPrincipal(emailPrincipal);
    }

    if (existingAccount) {
      const projection = await this.buildProjectionFromDatabase(
        existingAccount.idInterno,
        existingAccount,
      );
      this.enforceFailCloseGuard(projection, existingAccount);
      await this.cachePort.putProjectedIdentity(projection);
      this.metrics.recordResolveRequest();
      return {
        statusCode: 200,
        response: this.toResolvedDto(projection, existingAccount, false),
      };
    }

    // 3. Registro en Caliente (REGISTRO_CALIENTE / JIT Provisional, FR-009 / US4)
    // Cero llamadas salientes a Google Workspace.
    const nowIso = new Date().toISOString();
    const dominio = extractDomainFromEmail(emailPrincipal);

    const hotRegResult = await this.txManager.withTransaction(async (tx) => {
      let dominioConfig = await this.dominioRepository.findByDomain(dominio, tx);
      if (!dominioConfig) {
        const defaultDomain: DominioInstitucional = {
          dominio,
          googleCustomerId: 'C01MINEDEC01',
          tipoPoblacion: 'MIXTO',
          esSubdominio: dominio.split('.').length > 3,
          activo: true,
        };
        dominioConfig = await this.dominioRepository.upsert(defaultDomain, tx);
      }

      const inferredTipoUsuario =
        this.unificationService.inferDefaultUserTypeFromDomain(dominioConfig, emailPrincipal);

      // Evitar colisión si ya se creó el registro provisional en paralelo
      const provisionalDoc = buildProvisionalTempIdentifier(googleSubId);
      const existingProvisionalPersona =
        await this.personaRepository.findByNumeroIdentificacionOnly(provisionalDoc, tx);

      const provisionalPersona: PersonaIdentidad = existingProvisionalPersona ?? {
        idInterno: resolveOrGenerateIdInterno(command.idInterno),
        tipoIdentificacion: 'CODIGO_MINEDEC',
        numeroIdentificacion: provisionalDoc,
        codigoMinedecAnterior: null,
        nombreCompleto,
        fechaNacimiento: null,
        representanteLegalCedula: null,
        estadoPersona: 'PENDIENTE_IDENTIFICACION',
        creadoEn: nowIso,
        actualizadoEn: nowIso,
      };

      const savedPersona = await this.personaRepository.upsert(provisionalPersona, tx);

      const provisionalAccount: CuentaInstitucional = {
        cuentaId: randomUUID(),
        idInterno: savedPersona.idInterno,
        googleSubId,
        emailPrincipal,
        dominio,
        orgUnitPath: '/',
        givenName: null,
        familyName: null,
        tipoUsuario: inferredTipoUsuario,
        subtipoUsuario: null,
        cargoFuncion: null,
        gradoCurso: null,
        nivelAcademicoDerivado: null,
        docenteMultisede: false,
        fechaInicioVigencia: null,
        fechaFinVigencia: null,
        suspendedEnGws: false,
        estadoSincronizacion: 'REGISTRO_CALIENTE',
        origenUltimaSincronizacion: 'REGISTRO_CALIENTE_PRIORITARIO',
        ultimaSincronizacionEn: nowIso,
        creadoEn: nowIso,
        actualizadoEn: nowIso,
      };

      const savedAccount = await this.cuentaRepository.upsert(provisionalAccount, tx);

      await this.auditLogPort.recordEvent(
        {
          tipoEvento: 'REGISTRO_CALIENTE_PROVISIONAL',
          idInterno: savedPersona.idInterno,
          cuentaId: savedAccount.cuentaId,
          actorIdentificacion: googleSubId,
          origenComponente: 'PDP_MOTOR',
          payloadEvento: {
            googleSubId,
            emailPrincipal,
            dominio,
            provisionalNumeroIdentificacion: savedPersona.numeroIdentificacion,
            estadoPersona: savedPersona.estadoPersona,
            estadoSincronizacion: savedAccount.estadoSincronizacion,
          },
        },
        tx,
      );

      return {
        savedPersona,
        savedAccount,
      };
    });

    await this.prioritySyncQueuePort.enqueuePriorityAccountSync({
      googleSubId,
      emailPrincipal,
      dominio,
      provisionalIdInterno: hotRegResult.savedPersona.idInterno,
      requestedAt: nowIso,
    });

    const provisionalProjection: ProjectedUnifiedIdentity = {
      persona: hotRegResult.savedPersona,
      cuentas: [hotRegResult.savedAccount],
      contextosActivos: [],
      anomaliasActivas: [],
      nivelAccesoEfectivo: 'RESTRINGIDA_SOLO_AUTENTICADA',
      cachedAt: nowIso,
    };

    await this.cachePort.putProjectedIdentity(provisionalProjection);
    this.metrics.recordHotRegistration();
    this.metrics.recordResolveRequest();

    return {
      statusCode: 202,
      response: this.toResolvedDto(provisionalProjection, hotRegResult.savedAccount, true),
    };
  }

  public async getUnifiedIdentityByIdentification(
    numeroIdentificacion: string,
    tipoIdentificacion?: TipoIdentificacionPersona,
  ): Promise<UnifiedIdentityAdminViewDto> {
    const normalizedNumero = numeroIdentificacion.trim().toUpperCase();

    if (tipoIdentificacion) {
      const cached = await this.cachePort.getByDocument(tipoIdentificacion, normalizedNumero);
      if (cached) {
        return this.toAdminViewDto(cached.persona, cached.cuentas, cached.contextosActivos);
      }
    }

    const persona = tipoIdentificacion
      ? await this.personaRepository.findByDocument(tipoIdentificacion, normalizedNumero)
      : await this.personaRepository.findByNumeroIdentificacionOnly(normalizedNumero);

    if (!persona) {
      throw new EntityNotFoundDomainError(
        `No se encontró una PersonaIdentidad para la identificación '${normalizedNumero}'.`,
        'IDENTITY_NOT_FOUND',
      );
    }

    const cuentas = await this.cuentaRepository.findAllByIdInterno(persona.idInterno);
    const contextosActivos = await this.contextRepository.findActiveByIdInterno(persona.idInterno);

    return this.toAdminViewDto(persona, cuentas, contextosActivos);
  }

  private async buildProjectionFromDatabase(
    idInterno: string,
    activeAccount: CuentaInstitucional,
  ): Promise<ProjectedUnifiedIdentity> {
    const persona = await this.personaRepository.findByIdInterno(idInterno);
    if (!persona) {
      throw new EntityNotFoundDomainError(
        `PersonaIdentidad '${idInterno}' no encontrada en AlloyDB.`,
        'IDENTITY_NOT_FOUND',
      );
    }

    const cuentas = await this.cuentaRepository.findAllByIdInterno(idInterno);
    const contextosActivos = await this.contextRepository.findActiveByIdInterno(idInterno);
    const anomaliesByPersona = await this.anomalyRepository.findActiveByIdInterno(idInterno);
    const anomaliesBySub = await this.anomalyRepository.findActiveByGoogleSubId(
      activeAccount.googleSubId,
    );

    const anomalyMap = new Map<string, AnomaliaIdentidad>();
    for (const a of [...anomaliesByPersona, ...anomaliesBySub]) {
      anomalyMap.set(a.anomaliaId, a);
    }
    const anomaliasActivas = Array.from(anomalyMap.values());

    const temporalEval = evaluateTemporalValidity(
      activeAccount.fechaInicioVigencia,
      activeAccount.fechaFinVigencia,
    );
    const isProvisional =
      persona.estadoPersona === 'PENDIENTE_IDENTIFICACION' ||
      PROVISIONAL_TEMP_ID_REGEX.test(persona.numeroIdentificacion);

    const effective = this.anomalyService.computeEffectiveStates({
      suspendedEnGws:
        activeAccount.suspendedEnGws ||
        activeAccount.estadoSincronizacion === 'SUSPENDIDA_GWS',
      vigenciaExpirada:
        temporalEval.isExpired ||
        activeAccount.estadoSincronizacion === 'VIGENCIA_VENCIDA',
      isProvisionalPendingIdentification: isProvisional,
      activeAnomalies: anomaliasActivas,
    });

    return {
      persona: {
        ...persona,
        estadoPersona: effective.estadoPersona,
      },
      cuentas: cuentas.map((c) =>
        c.cuentaId === activeAccount.cuentaId
          ? { ...c, estadoSincronizacion: effective.estadoSincronizacion }
          : c,
      ),
      contextosActivos,
      anomaliasActivas,
      nivelAccesoEfectivo: effective.nivelAccesoEfectivo,
      cachedAt: new Date().toISOString(),
    };
  }

  private selectActiveAccount(
    cuentas: readonly CuentaInstitucional[],
    googleSubId: string,
    emailPrincipal: string,
  ): CuentaInstitucional {
    const bySub = cuentas.find((c) => c.googleSubId === googleSubId);
    if (bySub) {
      return bySub;
    }
    const byEmail = cuentas.find(
      (c) => c.emailPrincipal.toLowerCase() === emailPrincipal.toLowerCase(),
    );
    if (byEmail) {
      return byEmail;
    }
    if (cuentas[0]) {
      return cuentas[0];
    }
    throw new EntityNotFoundDomainError(
      'La proyección de identidad no contiene cuentas institucionales asociadas.',
      'ACCOUNT_NOT_FOUND',
    );
  }

  private enforceFailCloseGuard(
    projection: ProjectedUnifiedIdentity,
    cuentaActiva: CuentaInstitucional,
  ): void {
    if (
      cuentaActiva.suspendedEnGws ||
      cuentaActiva.estadoSincronizacion === 'SUSPENDIDA_GWS'
    ) {
      throw new FailCloseForbiddenAccessError(
        `Acceso denegado (fail-close): la cuenta institucional '${cuentaActiva.emailPrincipal}' se encuentra suspendida en Google Workspace (SUSPENDIDA_GWS).`,
        'ACCOUNT_SUSPENDED_GWS',
      );
    }

    const temporalValidity = evaluateTemporalValidity(
      cuentaActiva.fechaInicioVigencia,
      cuentaActiva.fechaFinVigencia,
    );
    if (
      temporalValidity.isExpired ||
      cuentaActiva.estadoSincronizacion === 'VIGENCIA_VENCIDA'
    ) {
      throw new FailCloseForbiddenAccessError(
        `Acceso denegado (fail-close): la cuenta institucional '${cuentaActiva.emailPrincipal}' tiene fechaFinVigencia vencida (VIGENCIA_VENCIDA).`,
        'ACCOUNT_VIGENCIA_VENCIDA',
      );
    }

    const blockingAnomaly = projection.anomaliasActivas.find(
      (a) =>
        this.anomalyService.isActiveState(a.estadoAnomalia) &&
        a.efectoAcceso === 'BLOQUEANTE',
    );
    if (
      blockingAnomaly ||
      projection.nivelAccesoEfectivo === 'BLOQUEADO' ||
      projection.persona.estadoPersona === 'BLOQUEADA_ANOMALIA' ||
      cuentaActiva.estadoSincronizacion === 'BLOQUEADA_ANOMALIA'
    ) {
      const causal = blockingAnomaly?.codigoCausal ?? 'BLOQUEADA_ANOMALIA';
      throw new FailCloseForbiddenAccessError(
        `Acceso denegado (fail-close): la identidad presenta una restricción bloqueante activa (${causal}).`,
        causal,
      );
    }
  }

  private toResolvedDto(
    projection: ProjectedUnifiedIdentity,
    cuentaActiva: CuentaInstitucional,
    prioritySyncQueued: boolean,
  ): ResolvedIdentityResponseDto {
    const matchedAccount =
      projection.cuentas.find((c) => c.cuentaId === cuentaActiva.cuentaId) ?? cuentaActiva;

    return {
      idInterno: projection.persona.idInterno,
      tipoIdentificacion: projection.persona.tipoIdentificacion,
      numeroIdentificacion: projection.persona.numeroIdentificacion,
      codigoMinedecAnterior: projection.persona.codigoMinedecAnterior,
      nombreCompleto: projection.persona.nombreCompleto,
      estadoPersona: projection.persona.estadoPersona,
      nivelAccesoEfectivo: projection.nivelAccesoEfectivo,
      cuentaActiva: {
        cuentaId: matchedAccount.cuentaId,
        emailPrincipal: matchedAccount.emailPrincipal,
        dominio: matchedAccount.dominio,
        tipoUsuario: matchedAccount.tipoUsuario,
        subtipoUsuario: matchedAccount.subtipoUsuario,
        estadoSincronizacion: matchedAccount.estadoSincronizacion,
      },
      contextosActivos: projection.contextosActivos.map((ctx) => this.toContextView(ctx)),
      prioritySyncQueued,
    };
  }

  private toAdminViewDto(
    persona: PersonaIdentidad,
    cuentas: readonly CuentaInstitucional[],
    contextos: readonly AsignacionContexto[],
  ): UnifiedIdentityAdminViewDto {
    return {
      idInterno: persona.idInterno,
      tipoIdentificacion: persona.tipoIdentificacion,
      numeroIdentificacion: persona.numeroIdentificacion,
      codigoMinedecAnterior: persona.codigoMinedecAnterior,
      nombreCompleto: persona.nombreCompleto,
      fechaNacimiento: persona.fechaNacimiento,
      estadoPersona: persona.estadoPersona,
      cuentasInstitucionales: cuentas.map((c) => ({
        cuentaId: c.cuentaId,
        emailPrincipal: c.emailPrincipal,
        dominio: c.dominio,
        tipoUsuario: c.tipoUsuario,
        subtipoUsuario: c.subtipoUsuario,
        suspendedEnGws: c.suspendedEnGws,
        estadoSincronizacion: c.estadoSincronizacion,
      })),
      contextosAsignados: contextos.map((ctx) => this.toContextView(ctx)),
    };
  }

  private toContextView(ctx: AsignacionContexto): ContextAssignmentViewDto {
    return {
      asignacionId: ctx.asignacionId,
      origenDatos: ctx.origenDatos,
      esSedePrimaria: ctx.esSedePrimaria,
      nivelEstructura: ctx.nivelEstructura,
      codigoZona: ctx.codigoZona,
      codigoDistrito: ctx.codigoDistrito,
      codigoCircuito: ctx.codigoCircuito,
      codigoAmie: ctx.codigoAmie,
      codigoDependenciaAdmin: ctx.codigoDependenciaAdmin,
      activo: ctx.activo,
    };
  }
}
