import { randomUUID } from 'crypto';
import {
  buildProvisionalTempIdentifier,
  CodigoCausalAnomalia,
  DatabaseTransactionManager,
  DEFAULT_GRADO_CURSO_DERIVATION_MAP,
  DEFAULT_TEMPORAL_SUBTIPOS,
  DetectedProfileAnomaly,
  evaluateMinedecPerfilMatrix,
  PipMetricsCollector,
  PROVISIONAL_TEMP_ID_REGEX,
  SqlQueryExecutor,
  TipoIdentificacionPersona,
  UpsertWorkspaceAccountInput,
} from '@minedec/shared';
import {
  CuentaInstitucional,
  DominioInstitucional,
  EstadoPersonaIdentidad,
  EstadoSincronizacionCuenta,
  extractDomainFromEmail,
  IdentifierCollisionConflictError,
  PersonaIdentidad,
} from '../domain/entities/identity-entities';
import {
  AnomaliaIdentidadRepositoryPort,
  AsignacionContextoRepositoryPort,
  AuditLogPort,
  CacheInvalidationPublisherPort,
  CatalogoAtributoRepositoryPort,
  CatalogoTerritorioSedeRepositoryPort,
  CuentaInstitucionalRepositoryPort,
  DominioInstitucionalRepositoryPort,
  IdentityCacheInvalidationKeys,
  IdentityCachePort,
  PersonaIdentidadRepositoryPort,
} from '../domain/ports';
import {
  AnomaliaIdentidad,
  AnomalyLifecycleService,
} from '../domain/services/anomaly-lifecycle.service';
import { CatalogDerivationService } from '../domain/services/catalog-derivation.service';
import { IdentityUnificationService } from '../domain/services/identity-unification.service';
import { MultisedeAndTransitionService } from '../domain/services/multisede-and-transition.service';

export interface UpsertWorkspaceAccountResult {
  idInterno: string;
  cuentaId: string;
  estadoPersona: EstadoPersonaIdentidad;
  estadoSincronizacion: EstadoSincronizacionCuenta;
  transitionedFromCodigoMinedec: boolean;
  cacheInvalidated: boolean;
  anomaliasAbiertas: AnomaliaIdentidad[];
  anomaliasResueltasAutomaticamente: string[];
}

const DEFAULT_TENANT_CUSTOMER_ID = 'C01MINEDEC01';

export class UpsertDirectoryIdentityUseCase {
  public constructor(
    private readonly txManager: DatabaseTransactionManager,
    private readonly personaRepo: PersonaIdentidadRepositoryPort,
    private readonly cuentaRepo: CuentaInstitucionalRepositoryPort,
    private readonly dominioRepo: DominioInstitucionalRepositoryPort,
    private readonly sedeRepo: CatalogoTerritorioSedeRepositoryPort,
    private readonly contextRepo: AsignacionContextoRepositoryPort,
    private readonly anomalyRepo: AnomaliaIdentidadRepositoryPort,
    private readonly catalogRepo: CatalogoAtributoRepositoryPort,
    private readonly identityCache: IdentityCachePort,
    private readonly cachePublisher: CacheInvalidationPublisherPort,
    private readonly auditLog: AuditLogPort,
    private readonly unificationService: IdentityUnificationService = new IdentityUnificationService(),
    private readonly catalogDerivationService: CatalogDerivationService = new CatalogDerivationService(),
    _multisedeService: MultisedeAndTransitionService = new MultisedeAndTransitionService(),
    private readonly anomalyService: AnomalyLifecycleService = new AnomalyLifecycleService(),
    _metrics?: PipMetricsCollector,
  ) {}

  public async execute(
    input: UpsertWorkspaceAccountInput,
    actorIdentificacion = 'SYSTEM_GWS_SYNC',
  ): Promise<UpsertWorkspaceAccountResult> {
    const nowIso = new Date().toISOString();
    const emailPrincipal = input.emailPrincipal.trim().toLowerCase();
    const dominioName = extractDomainFromEmail(emailPrincipal);

    let collisionErrorToRethrow: IdentifierCollisionConflictError | null = null;
    let cacheInvalidationKeys: IdentityCacheInvalidationKeys | null = null;

    const txOutcome = await this.txManager.withTransaction(async (tx: SqlQueryExecutor) => {
      // 1. Asegurar que el subdominio exista en el único tenant de Google Workspace (D-21)
      let dominioEntity = await this.dominioRepo.findByDomain(dominioName, tx);
      if (!dominioEntity) {
        const inferredPop = this.unificationService.inferPopulationFromDomain(
          emailPrincipal,
          null,
        );
        const defaultDominio: DominioInstitucional = {
          dominio: dominioName,
          googleCustomerId: DEFAULT_TENANT_CUSTOMER_ID,
          tipoPoblacion: inferredPop === 'EXTERNO' ? 'MIXTO' : inferredPop,
          esSubdominio: dominioName !== 'educacion.gob.ec',
          activo: true,
        };
        dominioEntity = await this.dominioRepo.upsert(defaultDominio, tx);
      }

      // 2. Cargar catálogos parametrizables activos (D-03 + FO-DNTIC-20) y homologar el perfil de entrada
      const groupedCatalogs = await this.catalogRepo.listAllActiveGrouped(tx);
      const homologation = this.catalogDerivationService.homologatePerfilInput(
        input.minedecPerfil,
        groupedCatalogs,
      );
      const normalizedPerfil = homologation.normalizedPerfil;

      // Construir mapa dinámico de derivación gradoCurso -> nivelAcademico y subtipos temporales desde catálogo vivo
      const dynamicDerivationMap: Record<string, string> = {
        ...DEFAULT_GRADO_CURSO_DERIVATION_MAP,
      };
      for (const gradoEntry of groupedCatalogs.GRADO_CURSO ?? []) {
        if (gradoEntry.activo && gradoEntry.nivelAcademicoDerivado) {
          dynamicDerivationMap[gradoEntry.codigoValor.toUpperCase()] =
            gradoEntry.nivelAcademicoDerivado.toUpperCase();
        }
      }

      const dynamicTemporalSubtipos = new Set<string>(DEFAULT_TEMPORAL_SUBTIPOS);
      for (const subEntry of groupedCatalogs.SUBTIPO_USUARIO ?? []) {
        if (subEntry.activo) {
          if (subEntry.requiereVigenciaTemporal) {
            dynamicTemporalSubtipos.add(subEntry.codigoValor.toUpperCase());
          } else {
            dynamicTemporalSubtipos.delete(subEntry.codigoValor.toUpperCase());
          }
        }
      }

      // 3. Evaluar la matriz de 21 atributos y reglas de obligatoriedad/edad/vigencia/AMIE
      const matrixEvaluation = evaluateMinedecPerfilMatrix(normalizedPerfil, {
        gradoCursoDerivationMap: dynamicDerivationMap,
        temporalSubtiposSet: dynamicTemporalSubtipos,
      });

      const detectedAnomalies: DetectedProfileAnomaly[] = [
        ...matrixEvaluation.anomaliasDetectadas,
      ];

      // Si el catálogo rechazó valores o combinación jerárquica tipoUsuario -> subtipoUsuario, registrar anomalía
      if (homologation.invalidCatalogValues.length > 0) {
        const invalidAttrs = homologation.invalidCatalogValues.map((v) => v.attribute);
        const invalidReasons = homologation.invalidCatalogValues
          .map((v) => v.reason)
          .join(' | ');
        const existingMissingIdx = detectedAnomalies.findIndex(
          (a) => a.codigoCausal === 'ATRIBUTO_OBLIGATORIO_FALTANTE',
        );
        if (existingMissingIdx >= 0) {
          const current = detectedAnomalies[existingMissingIdx]!;
          detectedAnomalies[existingMissingIdx] = {
            ...current,
            detalleTecnico: `${current.detalleTecnico} ${invalidReasons}`,
            atributosFaltantes: Array.from(
              new Set([...(current.atributosFaltantes ?? []), ...invalidAttrs]),
            ),
          };
        } else {
          detectedAnomalies.push({
            codigoCausal: 'ATRIBUTO_OBLIGATORIO_FALTANTE',
            efectoAcceso: 'RESTRINGIDA',
            detalleTecnico: invalidReasons,
            atributosFaltantes: invalidAttrs,
          });
        }
      }

      // 4. Buscar CuentaInstitucional y PersonaIdentidad existentes
      const existingCuenta =
        (await this.cuentaRepo.findByGoogleSubId(input.googleSubId, tx)) ??
        (await this.cuentaRepo.findByEmailPrincipal(emailPrincipal, tx));

      const existingAccountPersona = existingCuenta
        ? await this.personaRepo.findByIdInterno(existingCuenta.idInterno, tx)
        : null;

      let existingPersonaByDocument: PersonaIdentidad | null = null;
      if (
        matrixEvaluation.validDocument &&
        matrixEvaluation.tipoIdentificacionNormalizado &&
        matrixEvaluation.numeroIdentificacionNormalizado
      ) {
        existingPersonaByDocument =
          (await this.personaRepo.findByDocument(
            matrixEvaluation.tipoIdentificacionNormalizado,
            matrixEvaluation.numeroIdentificacionNormalizado,
            tx,
          )) ??
          (await this.personaRepo.findByNumeroIdentificacionOnly(
            matrixEvaluation.numeroIdentificacionNormalizado,
            tx,
          ));
      }

      const incomingIdInterno = normalizedPerfil.idInterno ?? null;
      const existingPersonaByIncomingIdInterno = incomingIdInterno
        ? await this.personaRepo.findByIdInterno(incomingIdInterno, tx)
        : null;

      // 5. Resolver o unificar PersonaIdentidad (Nivel 1)
      let targetPersona: PersonaIdentidad;
      let transitionedFromCodigoMinedec = false;
      let previousCodigoMinedec: string | null = null;
      let provisionalPersonaToDeactivate: PersonaIdentidad | null = null;
      let relinkedFromProvisionalIdInterno: string | null = null;

      if (
        matrixEvaluation.validDocument &&
        matrixEvaluation.tipoIdentificacionNormalizado &&
        matrixEvaluation.numeroIdentificacionNormalizado
      ) {
        try {
          const unifyOutcome = this.unificationService.resolveOrUnifyPersonaIdentidad({
            existingAccountPersona,
            existingPersonaByDocument,
            existingPersonaByIncomingIdInterno,
            incomingIdInterno,
            tipoIdentificacion: matrixEvaluation.tipoIdentificacionNormalizado,
            numeroIdentificacion: matrixEvaluation.numeroIdentificacionNormalizado,
            nombreCompleto: input.nombreCompleto,
            fechaNacimiento: normalizedPerfil.fechaNacimiento ?? null,
            representanteLegalCedula: normalizedPerfil.representanteLegalCedula ?? null,
            nowIso,
          });

          targetPersona = unifyOutcome.persona;
          transitionedFromCodigoMinedec = unifyOutcome.transitionedFromCodigoMinedec;
          previousCodigoMinedec = unifyOutcome.previousCodigoMinedec;
          provisionalPersonaToDeactivate = unifyOutcome.provisionalPersonaToDeactivate;
          relinkedFromProvisionalIdInterno = unifyOutcome.relinkedFromProvisionalIdInterno;

          if (unifyOutcome.collisionDetected.detected) {
            collisionErrorToRethrow = new IdentifierCollisionConflictError(
              matrixEvaluation.numeroIdentificacionNormalizado,
              unifyOutcome.collisionDetected.conflictingIdInterno ?? targetPersona.idInterno,
              incomingIdInterno ?? targetPersona.idInterno,
            );
            const fallbackTempNumber = buildProvisionalTempIdentifier(
              input.googleSubId,
            ).toUpperCase();
            targetPersona = existingAccountPersona
              ? {
                  ...existingAccountPersona,
                  estadoPersona: 'BLOQUEADA_ANOMALIA',
                  actualizadoEn: nowIso,
                }
              : {
                  idInterno: incomingIdInterno ?? randomUUID(),
                  tipoIdentificacion: 'CODIGO_MINEDEC',
                  numeroIdentificacion: fallbackTempNumber,
                  codigoMinedecAnterior: null,
                  nombreCompleto: input.nombreCompleto.trim(),
                  fechaNacimiento: normalizedPerfil.fechaNacimiento ?? null,
                  representanteLegalCedula: normalizedPerfil.representanteLegalCedula ?? null,
                  estadoPersona: 'BLOQUEADA_ANOMALIA',
                  creadoEn: nowIso,
                  actualizadoEn: nowIso,
                };
            detectedAnomalies.push({
              codigoCausal: 'COLISION_IDENTIFICADOR',
              efectoAcceso: 'BLOQUEANTE',
              detalleTecnico:
                unifyOutcome.collisionDetected.detail ??
                `Colisión de identificador para ${matrixEvaluation.numeroIdentificacionNormalizado}.`,
            });
          }
        } catch (err) {
          if (err instanceof IdentifierCollisionConflictError && existingAccountPersona) {
            // Caso FR-011: transición CODIGO_MINEDEC -> CEDULA hacia una CEDULA que ya pertenece a otro idInterno.
            // Preservamos la identidad actual sin fusionar, abrimos la anomalía COLISION_IDENTIFICADOR (BLOQUEANTE)
            // y relanzamos 409 Conflict después de confirmar la transacción.
            collisionErrorToRethrow = err;
            targetPersona = {
              ...existingAccountPersona,
              estadoPersona: 'BLOQUEADA_ANOMALIA',
              actualizadoEn: nowIso,
            };
            detectedAnomalies.push({
              codigoCausal: 'COLISION_IDENTIFICADOR',
              efectoAcceso: 'BLOQUEANTE',
              detalleTecnico: err.message,
            });
          } else {
            throw err;
          }
        }
      } else {
        // Documento inválido o ausente (ej. RUC societario o cédula con Módulo 10 inválido)
        if (existingAccountPersona) {
          targetPersona = {
            ...existingAccountPersona,
            nombreCompleto: input.nombreCompleto.trim() || existingAccountPersona.nombreCompleto,
            estadoPersona: 'BLOQUEADA_ANOMALIA',
            actualizadoEn: nowIso,
          };
        } else {
          const fallbackTempNumber = buildProvisionalTempIdentifier(
            input.googleSubId,
          ).toUpperCase();
          targetPersona = {
            idInterno: incomingIdInterno ?? randomUUID(),
            tipoIdentificacion: 'CODIGO_MINEDEC',
            numeroIdentificacion: fallbackTempNumber,
            codigoMinedecAnterior: null,
            nombreCompleto: input.nombreCompleto.trim(),
            fechaNacimiento: normalizedPerfil.fechaNacimiento ?? null,
            representanteLegalCedula: normalizedPerfil.representanteLegalCedula ?? null,
            estadoPersona: 'BLOQUEADA_ANOMALIA',
            creadoEn: nowIso,
            actualizadoEn: nowIso,
          };
        }
      }

      // Persistir la PersonaIdentidad objetivo
      targetPersona = await this.personaRepo.upsert(targetPersona, tx);

      // 6. Construir y persistir CuentaInstitucional (Nivel 2)
      const inferredPopulation = this.unificationService.inferPopulationFromDomain(
        emailPrincipal,
        dominioEntity,
      );
      const tipoUsuarioEfectivo = (normalizedPerfil.tipoUsuario?.toUpperCase() ||
        existingCuenta?.tipoUsuario ||
        inferredPopulation) as CuentaInstitucional['tipoUsuario'];

      const cuentaToSave: CuentaInstitucional = {
        cuentaId: existingCuenta?.cuentaId ?? randomUUID(),
        idInterno: targetPersona.idInterno,
        googleSubId: input.googleSubId.trim(),
        emailPrincipal,
        dominio: dominioName,
        orgUnitPath: input.orgUnitPath.trim(),
        givenName: input.givenName ?? existingCuenta?.givenName ?? null,
        familyName: input.familyName ?? existingCuenta?.familyName ?? null,
        tipoUsuario: tipoUsuarioEfectivo,
        subtipoUsuario:
          normalizedPerfil.subtipoUsuario?.toUpperCase() ??
          existingCuenta?.subtipoUsuario ??
          null,
        cargoFuncion:
          normalizedPerfil.cargoFuncion?.toUpperCase() ?? existingCuenta?.cargoFuncion ?? null,
        gradoCurso:
          normalizedPerfil.gradoCurso?.toUpperCase() ?? existingCuenta?.gradoCurso ?? null,
        nivelAcademicoDerivado:
          matrixEvaluation.nivelAcademicoDerivado ??
          existingCuenta?.nivelAcademicoDerivado ??
          null,
        docenteMultisede:
          typeof normalizedPerfil.docenteMultisede === 'boolean'
            ? normalizedPerfil.docenteMultisede
            : (existingCuenta?.docenteMultisede ?? false),
        fechaInicioVigencia:
          normalizedPerfil.fechaInicioVigencia ?? existingCuenta?.fechaInicioVigencia ?? null,
        fechaFinVigencia:
          normalizedPerfil.fechaFinVigencia ?? existingCuenta?.fechaFinVigencia ?? null,
        suspendedEnGws: input.suspendedEnGws,
        estadoSincronizacion: 'SINCRONIZADA',
        origenUltimaSincronizacion: input.origenSincronizacion,
        ultimaSincronizacionEn: nowIso,
        creadoEn: existingCuenta?.creadoEn ?? nowIso,
        actualizadoEn: nowIso,
      };

      let savedCuenta = await this.cuentaRepo.upsert(cuentaToSave, tx);

      // Si hubo re-vinculación desde una PersonaIdentidad provisional (REGISTRO_CALIENTE -> existente),
      // migrar asignaciones y desactivar la identidad provisional huérfana
      if (provisionalPersonaToDeactivate && relinkedFromProvisionalIdInterno) {
        await this.contextRepo.relinkAssignmentsToPersona(
          relinkedFromProvisionalIdInterno,
          targetPersona.idInterno,
          tx,
        );
        await this.personaRepo.updateEstadoPersona(
          relinkedFromProvisionalIdInterno,
          'INACTIVA',
          tx,
        );
      }

      // 7. Reconciliar Anomalías de la Cuenta (auto-resolución vs LISTA_PARA_CERRAR vs recurrencia)
      const currentActiveAnomalies = await this.anomalyRepo.findActiveByGoogleSubId(
        input.googleSubId,
        tx,
      );

      const allCausals: CodigoCausalAnomalia[] = [
        'SIN_IDENTIFICACION_VALIDA',
        'COLISION_IDENTIFICADOR',
        'VIGENCIA_INVALIDA',
        'ATRIBUTO_OBLIGATORIO_FALTANTE',
        'FORMATO_AMIE_INVALIDO',
      ];
      const lastResolvedByCausal: Partial<Record<CodigoCausalAnomalia, AnomaliaIdentidad>> = {};
      for (const causal of allCausals) {
        const lastResolved = await this.anomalyRepo.findLatestResolvedByGoogleSubIdAndCausal(
          input.googleSubId,
          causal,
          tx,
        );
        if (lastResolved) {
          lastResolvedByCausal[causal] = lastResolved;
        }
      }

      const previousSnapshot: Record<string, unknown> | null = existingCuenta
        ? {
            idInterno: existingAccountPersona?.idInterno ?? existingCuenta.idInterno,
            tipoIdentificacion: existingAccountPersona?.tipoIdentificacion ?? null,
            numeroIdentificacion: existingAccountPersona?.numeroIdentificacion ?? null,
            tipoUsuario: existingCuenta.tipoUsuario,
            subtipoUsuario: existingCuenta.subtipoUsuario,
            cargoFuncion: existingCuenta.cargoFuncion,
            gradoCurso: existingCuenta.gradoCurso,
            nivelAcademicoDerivado: existingCuenta.nivelAcademicoDerivado,
            docenteMultisede: existingCuenta.docenteMultisede,
            fechaInicioVigencia: existingCuenta.fechaInicioVigencia,
            fechaFinVigencia: existingCuenta.fechaFinVigencia,
          }
        : null;

      const currentSnapshot: Record<string, unknown> = {
        idInterno: targetPersona.idInterno,
        tipoIdentificacion: targetPersona.tipoIdentificacion,
        numeroIdentificacion: targetPersona.numeroIdentificacion,
        ...normalizedPerfil,
      };

      const reconciliation = this.anomalyService.reconcileAccountAnomalies({
        googleSubId: input.googleSubId,
        emailPrincipal,
        dominio: dominioName,
        idInterno: targetPersona.idInterno,
        cuentaId: savedCuenta.cuentaId,
        detectedAnomalies,
        currentActiveAnomalies,
        lastResolvedByCausal,
        previousSnapshot,
        currentSnapshot,
        nowIso,
      });

      for (const toUpdate of reconciliation.existingAnomaliesToUpdate) {
        await this.anomalyRepo.update(toUpdate, tx);
        if (toUpdate.estadoAnomalia === 'RESUELTA') {
          await this.auditLog.recordEvent(
            {
              tipoEvento: 'ANOMALIA_AUTO_RESUELTA',
              idInterno: targetPersona.idInterno,
              cuentaId: savedCuenta.cuentaId,
              actorIdentificacion,
              origenComponente: 'SINCRONIZADOR_GWS',
              payloadEvento: {
                anomaliaId: toUpdate.anomaliaId,
                codigoCausal: toUpdate.codigoCausal,
                origenResolucion: toUpdate.origenResolucion,
              },
            },
            tx,
          );
        }
      }

      for (const toInsert of reconciliation.newAnomaliesToInsert) {
        await this.anomalyRepo.insert(toInsert, tx);
        await this.auditLog.recordEvent(
          {
            tipoEvento: 'ANOMALIA_ABIERTA',
            idInterno: targetPersona.idInterno,
            cuentaId: savedCuenta.cuentaId,
            actorIdentificacion,
            origenComponente: 'SINCRONIZADOR_GWS',
            payloadEvento: {
              anomaliaId: toInsert.anomaliaId,
              anomaliaAnteriorId: toInsert.anomaliaAnteriorId,
              codigoCausal: toInsert.codigoCausal,
              efectoAcceso: toInsert.efectoAcceso,
              detalleTecnico: toInsert.detalleTecnico,
            },
          },
          tx,
        );
      }

      // 8. Calcular estado efectivo de PersonaIdentidad y CuentaInstitucional
      const allActivePersonAnomalies = await this.anomalyRepo.findActiveByIdInterno(
        targetPersona.idInterno,
        tx,
      );
      const mergedActiveAnomalies = [
        ...reconciliation.activeAnomaliesAfterSync,
        ...allActivePersonAnomalies.filter(
          (pa) =>
            !reconciliation.activeAnomaliesAfterSync.some(
              (ca) => ca.anomaliaId === pa.anomaliaId,
            ),
        ),
      ];

      const isProvisional = PROVISIONAL_TEMP_ID_REGEX.test(targetPersona.numeroIdentificacion);
      const effectiveStates = this.anomalyService.computeEffectiveStates({
        suspendedEnGws: input.suspendedEnGws,
        vigenciaExpirada: matrixEvaluation.vigenciaExpirada,
        isProvisionalPendingIdentification: isProvisional,
        activeAnomalies: mergedActiveAnomalies,
      });

      if (targetPersona.estadoPersona !== effectiveStates.estadoPersona) {
        targetPersona = {
          ...targetPersona,
          estadoPersona: effectiveStates.estadoPersona,
          actualizadoEn: nowIso,
        };
        await this.personaRepo.updateEstadoPersona(
          targetPersona.idInterno,
          targetPersona.estadoPersona,
          tx,
        );
      }

      if (savedCuenta.estadoSincronizacion !== effectiveStates.estadoSincronizacion) {
        savedCuenta = await this.cuentaRepo.upsert(
          {
            ...savedCuenta,
            estadoSincronizacion: effectiveStates.estadoSincronizacion,
            actualizadoEn: nowIso,
          },
          tx,
        );
      }

      // 9. Gestionar Asignación de Contexto Primaria (GWS_PRIMARIO) y Regla Multisede (FR-010)
      const amieCode = normalizedPerfil.codigoInstitucion?.trim().toUpperCase() || null;
      const sedeCatalogo = amieCode
        ? await this.sedeRepo.findByCodigoAmie(amieCode, tx)
        : null;

      const existingPrimaryContext = await this.contextRepo.findPrimaryByCuentaId(
        savedCuenta.cuentaId,
        tx,
      );
      const primaryAssignment = this.unificationService.buildPrimaryContextAssignment({
        existingPrimaryAssignment: existingPrimaryContext,
        idInterno: targetPersona.idInterno,
        cuentaId: savedCuenta.cuentaId,
        perfil: normalizedPerfil,
        sedeCatalogo,
        nowIso,
      });

      if (primaryAssignment) {
        await this.contextRepo.upsertPrimaryAssignment(primaryAssignment, tx);
      }

      // Si docenteMultisede pasó a false, desactivar sedes complementarias (PAP_DELEGADO)
      if (
        savedCuenta.tipoUsuario === 'DOCENTE' &&
        savedCuenta.docenteMultisede === false
      ) {
        const deactivated = await this.contextRepo.deactivateDelegatedAssignmentsByIdInterno(
          targetPersona.idInterno,
          savedCuenta.cuentaId,
          tx,
        );
        if (deactivated.length > 0) {
          await this.auditLog.recordEvent(
            {
              tipoEvento: 'ASIGNACION_CONTEXTO_MODIFICADA',
              idInterno: targetPersona.idInterno,
              cuentaId: savedCuenta.cuentaId,
              actorIdentificacion,
              origenComponente: 'SINCRONIZADOR_GWS',
              payloadEvento: {
                motivo: 'Desactivación automática de sedes complementarias por docenteMultisede = false',
                desactivadasCount: deactivated.length,
                amiesDesactivados: deactivated.map((d) => d.codigoAmie),
              },
            },
            tx,
          );
        }
      }

      // 10. Registrar eventos de auditoría de identidad y transición CODIGO_MINEDEC -> CEDULA
      if (transitionedFromCodigoMinedec && previousCodigoMinedec) {
        await this.auditLog.recordEvent(
          {
            tipoEvento: 'TRANSICION_CODIGO_A_CEDULA',
            idInterno: targetPersona.idInterno,
            cuentaId: savedCuenta.cuentaId,
            actorIdentificacion,
            origenComponente: 'SINCRONIZADOR_GWS',
            payloadEvento: {
              codigoMinedecAnterior: previousCodigoMinedec,
              nuevaCedula: targetPersona.numeroIdentificacion,
              idInternoPreservado: targetPersona.idInterno,
            },
          },
          tx,
        );
      }

      await this.auditLog.recordEvent(
        {
          tipoEvento: existingCuenta ? 'IDENTIDAD_ACTUALIZADA' : 'IDENTIDAD_CREADA',
          idInterno: targetPersona.idInterno,
          cuentaId: savedCuenta.cuentaId,
          actorIdentificacion,
          origenComponente: 'SINCRONIZADOR_GWS',
          payloadEvento: {
            emailPrincipal,
            dominio: dominioName,
            googleSubId: input.googleSubId,
            tipoIdentificacion: targetPersona.tipoIdentificacion,
            numeroIdentificacion: targetPersona.numeroIdentificacion,
            estadoPersona: targetPersona.estadoPersona,
            estadoSincronizacion: savedCuenta.estadoSincronizacion,
            normalizedFromNaturalPersonRuc: matrixEvaluation.normalizedFromNaturalPersonRuc,
            nivelAcademicoDerivado: savedCuenta.nivelAcademicoDerivado,
            nivelAcademicoSobrescrito: matrixEvaluation.nivelAcademicoSobrescritoPorGradoCurso,
          },
        },
        tx,
      );

      // 11. Preparar todas las llaves para invalidación atómica en Redis L2 (< 5 s)
      const allPersonAccounts = await this.cuentaRepo.findAllByIdInterno(
        targetPersona.idInterno,
        tx,
      );
      const identifiersToInvalidate: Array<{
        tipoIdentificacion: TipoIdentificacionPersona;
        numeroIdentificacion: string;
      }> = [
        {
          tipoIdentificacion: targetPersona.tipoIdentificacion,
          numeroIdentificacion: targetPersona.numeroIdentificacion,
        },
      ];

      if (previousCodigoMinedec) {
        identifiersToInvalidate.push({
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: previousCodigoMinedec,
        });
      }
      if (targetPersona.codigoMinedecAnterior) {
        identifiersToInvalidate.push({
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: targetPersona.codigoMinedecAnterior,
        });
      }
      if (provisionalPersonaToDeactivate) {
        identifiersToInvalidate.push({
          tipoIdentificacion: provisionalPersonaToDeactivate.tipoIdentificacion,
          numeroIdentificacion: provisionalPersonaToDeactivate.numeroIdentificacion,
        });
      }

      cacheInvalidationKeys = {
        idInterno: targetPersona.idInterno,
        previousIdInterno: relinkedFromProvisionalIdInterno,
        identifiers: identifiersToInvalidate,
        emails: Array.from(
          new Set([emailPrincipal, ...allPersonAccounts.map((a) => a.emailPrincipal)]),
        ),
        googleSubIds: Array.from(
          new Set([input.googleSubId, ...allPersonAccounts.map((a) => a.googleSubId)]),
        ),
      };

      return {
        idInterno: targetPersona.idInterno,
        cuentaId: savedCuenta.cuentaId,
        estadoPersona: targetPersona.estadoPersona,
        estadoSincronizacion: savedCuenta.estadoSincronizacion,
        transitionedFromCodigoMinedec,
        anomaliasAbiertas: mergedActiveAnomalies,
        anomaliasResueltasAutomaticamente: reconciliation.existingAnomaliesToUpdate
          .filter((a) => a.estadoAnomalia === 'RESUELTA')
          .map((a) => a.anomaliaId),
      };
    });

    // 12. Invalidar caché Redis L2 y publicar evento en Cloud Pub/Sub (< 5 s)
    let cacheInvalidated = false;
    if (cacheInvalidationKeys) {
      const keysToPurge: IdentityCacheInvalidationKeys = cacheInvalidationKeys;
      const unlinkedCount = await this.identityCache.invalidateIdentityKeys(keysToPurge);
      cacheInvalidated = true;
      await this.cachePublisher.publishInvalidationEvent({
        eventId: randomUUID(),
        occurredAt: nowIso,
        reason: txOutcome.transitionedFromCodigoMinedec
          ? 'TRANSICION_CODIGO_A_CEDULA'
          : 'IDENTITY_UPSERT',
        idInterno: txOutcome.idInterno,
        keysUnlinkedCount: unlinkedCount,
        identifiers: keysToPurge.identifiers.map(
          (i) => `${i.tipoIdentificacion}:${i.numeroIdentificacion}`,
        ),
        emails: keysToPurge.emails,
        googleSubIds: keysToPurge.googleSubIds,
      });
    }

    if (collisionErrorToRethrow) {
      throw collisionErrorToRethrow;
    }

    return {
      ...txOutcome,
      cacheInvalidated,
    };
  }
}
