import { randomUUID } from 'crypto';
import {
  DatabaseTransactionManager,
  evaluateTemporalValidity,
  PipMetricsCollector,
  PROVISIONAL_TEMP_ID_REGEX,
  TipoIdentificacionPersona,
} from '@minedec/shared';
import { EntityNotFoundDomainError } from '../domain/entities/identity-entities';
import {
  AnomaliaIdentidadRepositoryPort,
  AnomalyFilterQuery,
  AnomalyPaginatedList,
  AuditLogPort,
  CacheInvalidationPublisherPort,
  CuentaInstitucionalRepositoryPort,
  IdentityCachePort,
  PersonaIdentidadRepositoryPort,
} from '../domain/ports';
import {
  AnomaliaIdentidad,
  AnomalyLifecycleService,
} from '../domain/services/anomaly-lifecycle.service';

export interface ManualResolveAnomalyCommand {
  anomaliaId: string;
  motivoResolucion: string;
  actorIdentificacion?: string;
}

export class ManageAnomaliesUseCase {
  public constructor(
    private readonly txManager: DatabaseTransactionManager,
    private readonly anomalyRepository: AnomaliaIdentidadRepositoryPort,
    private readonly personaRepository: PersonaIdentidadRepositoryPort,
    private readonly cuentaRepository: CuentaInstitucionalRepositoryPort,
    private readonly cachePort: IdentityCachePort,
    private readonly cacheInvalidationPublisher: CacheInvalidationPublisherPort,
    private readonly auditLogPort: AuditLogPort,
    private readonly anomalyService: AnomalyLifecycleService,
    private readonly metrics: PipMetricsCollector,
  ) {}

  public async listIdentityAnomalies(
    query: AnomalyFilterQuery,
  ): Promise<AnomalyPaginatedList> {
    return this.anomalyRepository.listPaginated(query);
  }

  public async resolveIdentityAnomalyManually(
    command: ManualResolveAnomalyCommand,
  ): Promise<AnomaliaIdentidad> {
    const nowIso = new Date().toISOString();
    const actor = command.actorIdentificacion ?? 'SUPERADMIN_SEGURIDAD';

    const txResult = await this.txManager.withTransaction(async (tx) => {
      const existingAnomaly = await this.anomalyRepository.findById(command.anomaliaId, tx);
      if (!existingAnomaly) {
        throw new EntityNotFoundDomainError(
          `No se encontró la anomalía con anomaliaId '${command.anomaliaId}'.`,
          'ANOMALY_NOT_FOUND',
        );
      }

      const resolvedAnomaly = this.anomalyService.resolveAnomalyManually({
        anomaly: existingAnomaly,
        resueltaPorIdentificacion: actor,
        motivoResolucion: command.motivoResolucion,
        nowIso,
      });

      const savedAnomaly = await this.anomalyRepository.update(resolvedAnomaly, tx);

      const cuenta = existingAnomaly.cuentaId
        ? await this.cuentaRepository.findByCuentaId(existingAnomaly.cuentaId, tx)
        : await this.cuentaRepository.findByGoogleSubId(existingAnomaly.googleSubId, tx);

      const targetIdInterno = existingAnomaly.idInterno ?? cuenta?.idInterno ?? null;
      const persona = targetIdInterno
        ? await this.personaRepository.findByIdInterno(targetIdInterno, tx)
        : null;

      if (persona || cuenta) {
        const activeBySub = await this.anomalyRepository.findActiveByGoogleSubId(
          existingAnomaly.googleSubId,
          tx,
        );
        const activeByPersona = persona
          ? await this.anomalyRepository.findActiveByIdInterno(persona.idInterno, tx)
          : [];

        const remainingMap = new Map<string, AnomaliaIdentidad>();
        for (const item of [...activeBySub, ...activeByPersona]) {
          if (item.anomaliaId !== savedAnomaly.anomaliaId) {
            remainingMap.set(item.anomaliaId, item);
          }
        }
        const remainingActive = Array.from(remainingMap.values());

        const temporalEval = evaluateTemporalValidity(
          cuenta?.fechaInicioVigencia,
          cuenta?.fechaFinVigencia,
        );
        const isProvisional = Boolean(
          persona &&
            (persona.estadoPersona === 'PENDIENTE_IDENTIFICACION' ||
              PROVISIONAL_TEMP_ID_REGEX.test(persona.numeroIdentificacion)),
        );

        const recalculated = this.anomalyService.computeEffectiveStates({
          suspendedEnGws: Boolean(cuenta?.suspendedEnGws),
          vigenciaExpirada: temporalEval.isExpired,
          isProvisionalPendingIdentification: isProvisional,
          activeAnomalies: remainingActive,
        });

        if (persona) {
          await this.personaRepository.updateEstadoPersona(
            persona.idInterno,
            recalculated.estadoPersona,
            tx,
          );
        }

        if (cuenta) {
          await this.cuentaRepository.upsert(
            {
              ...cuenta,
              estadoSincronizacion: recalculated.estadoSincronizacion,
              actualizadoEn: nowIso,
            },
            tx,
          );
        }
      }

      const allAccounts = persona
        ? await this.cuentaRepository.findAllByIdInterno(persona.idInterno, tx)
        : cuenta
          ? [cuenta]
          : [];

      await this.auditLogPort.recordEvent(
        {
          tipoEvento: 'ANOMALIA_RESUELTA_MANUAL',
          idInterno: persona?.idInterno ?? existingAnomaly.idInterno,
          cuentaId: cuenta?.cuentaId ?? existingAnomaly.cuentaId,
          actorIdentificacion: actor,
          origenComponente: 'PAP_ADMIN',
          payloadEvento: {
            anomaliaId: savedAnomaly.anomaliaId,
            codigoCausal: savedAnomaly.codigoCausal,
            efectoAcceso: savedAnomaly.efectoAcceso,
            origenResolucion: savedAnomaly.origenResolucion,
            motivoResolucion: savedAnomaly.motivoResolucion,
            googleSubId: savedAnomaly.googleSubId,
            emailPrincipal: savedAnomaly.emailPrincipal,
          },
        },
        tx,
      );

      return {
        savedAnomaly,
        persona,
        allAccounts,
      };
    });

    this.metrics.recordAnomalyResolved('MANUAL_ADMIN');

    const idInternoToInvalidate =
      txResult.persona?.idInterno ??
      txResult.savedAnomaly.idInterno ??
      `sub:${txResult.savedAnomaly.googleSubId}`;

    const identifiers: Array<{
      tipoIdentificacion: TipoIdentificacionPersona;
      numeroIdentificacion: string;
    }> = [];

    if (txResult.persona) {
      identifiers.push({
        tipoIdentificacion: txResult.persona.tipoIdentificacion,
        numeroIdentificacion: txResult.persona.numeroIdentificacion,
      });
      if (txResult.persona.codigoMinedecAnterior) {
        identifiers.push({
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: txResult.persona.codigoMinedecAnterior,
        });
      }
    }

    const emails = Array.from(
      new Set([
        txResult.savedAnomaly.emailPrincipal,
        ...txResult.allAccounts.map((a) => a.emailPrincipal),
      ]),
    );
    const googleSubIds = Array.from(
      new Set([
        txResult.savedAnomaly.googleSubId,
        ...txResult.allAccounts.map((a) => a.googleSubId),
      ]),
    );

    const keysUnlinkedCount = await this.cachePort.invalidateIdentityKeys({
      idInterno: idInternoToInvalidate,
      identifiers,
      emails,
      googleSubIds,
    });

    await this.cacheInvalidationPublisher.publishInvalidationEvent({
      eventId: randomUUID(),
      occurredAt: nowIso,
      reason: 'ANOMALY_RESOLVED_MANUAL_ADMIN',
      idInterno: idInternoToInvalidate,
      keysUnlinkedCount,
      identifiers: identifiers.map((i) => `${i.tipoIdentificacion}:${i.numeroIdentificacion}`),
      emails,
      googleSubIds,
    });

    return txResult.savedAnomaly;
  }
}
