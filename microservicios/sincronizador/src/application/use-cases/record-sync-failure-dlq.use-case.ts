import crypto from 'node:crypto';
import {
  AuditEventWriter,
  DatabaseTransactionManager,
  SyncDiagnosticBuilder,
  pipMetrics,
  sanitizeTechnicalErrorMessage,
} from '@minedec/shared';
import { RegistroFalloSincronizacion } from '../../domain/entities/sync-entities';
import { IDlqRepositoryPort } from '../../domain/ports/sync-ports';

export interface RecordSyncFailureInput {
  idEventoExterno: string;
  origenCanal:
    | 'PUBSUB_AUDIT_LOG'
    | 'CLOUD_TASKS_PRIORITY'
    | 'BARRIDO_DELTA_2MIN'
    | 'CONCILIACION_MASIVA';
  googleSubId?: string | null;
  emailPrincipal?: string | null;
  dominio?: string | null;
  tipoEvento: string;
  timestampEventoGws: string;
  payloadOriginal: Record<string, unknown>;
  intentosRealizados?: number;
  ultimoBackoffMs?: number;
  codigoError: string;
  httpStatusGws?: number | null;
  detalleErrorTecnico: string;
  traceId: string;
}

/**
 * Caso de uso para persistir en `registro_fallo_sincronizacion` (`DLQ`) un evento que agotó
 * los 5 intentos con retroceso exponencial o sufrió un error de datos no recuperable,
 * generando automáticamente el diagnóstico explicativo en español de 4 partes y auditando
 * el evento (`T058` / US5).
 */
export class RecordSyncFailureDlqUseCase {
  constructor(
    private readonly dlqRepo: IDlqRepositoryPort,
    private readonly txManager?: DatabaseTransactionManager,
    private readonly auditWriter?: AuditEventWriter,
  ) {}

  public async execute(input: RecordSyncFailureInput): Promise<RegistroFalloSincronizacion> {
    const nowIso = new Date().toISOString();
    const safeError = sanitizeTechnicalErrorMessage(input.detalleErrorTecnico);
    const pendingBefore = await this.dlqRepo.countPendingDlq();

    const diagnostico = SyncDiagnosticBuilder.build({
      escenario:
        input.httpStatusGws === 429 || input.httpStatusGws === 503
          ? 'DLQ_EVENT_EXHAUSTED'
          : 'INVALID_GWS_PAYLOAD',
      dominio: input.dominio ?? undefined,
      googleUserId: input.googleSubId ?? input.emailPrincipal ?? undefined,
      idEventoExterno: input.idEventoExterno,
      httpStatusGws: input.httpStatusGws,
      intentosRealizados: input.intentosRealizados ?? 5,
      pendientesDlq: pendingBefore + 1,
      detalleError: safeError,
    });

    const record: RegistroFalloSincronizacion = {
      dlqId: crypto.randomUUID(),
      idEventoExterno: input.idEventoExterno,
      origenCanal: input.origenCanal,
      googleSubId: input.googleSubId ?? null,
      emailPrincipal: input.emailPrincipal ?? null,
      dominio: input.dominio ?? null,
      tipoEvento: input.tipoEvento,
      timestampEventoGws: input.timestampEventoGws,
      payloadOriginal: {
        ...input.payloadOriginal,
        timestampEventoGws: input.timestampEventoGws,
        ultimoBackoffMs: input.ultimoBackoffMs ?? 16000,
        httpStatusGws: input.httpStatusGws ?? null,
      },
      intentosRealizados: input.intentosRealizados ?? 5,
      ultimoBackoffMs: input.ultimoBackoffMs ?? 16000,
      codigoError: input.codigoError,
      httpStatusGws: input.httpStatusGws ?? null,
      detalleErrorTecnico: safeError,
      diagnosticoLenguajeNatural: diagnostico.resumenEjecutivo,
      accionRecomendada: diagnostico.accionRecomendada,
      estadoDlq: 'PENDIENTE_REVISION',
      resueltoPorIdentificacion: null,
      motivoResolucion: null,
      creadoEn: nowIso,
      actualizadoEn: nowIso,
      resueltoEn: null,
    };

    const saved = await this.dlqRepo.upsertDlqFailure(record);
    pipMetrics.setSyncDlqPendingRecords(pendingBefore + 1);

    if (this.txManager && this.auditWriter) {
      await this.txManager.withTransaction(async (tx) => {
        await this.auditWriter!.appendEvent(tx, {
          tipoEvento: 'EVENTO_DLQ_REGISTRADO',
          actorSub: 'sa-sync',
          origenCanal: 'SYNC_INCREMENTAL',
          resumenCambio: `Evento ${input.idEventoExterno} derivado a DLQ tras ${record.intentosRealizados} intentos (${input.codigoError})`,
          datosPrevios: null,
          datosNuevos: {
            dlqId: saved.dlqId,
            idEventoExterno: saved.idEventoExterno,
            codigoError: saved.codigoError,
            diagnostico: diagnostico,
          },
          traceId: input.traceId,
        });
      });
    }

    return saved;
  }
}
