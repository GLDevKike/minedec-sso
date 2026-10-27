import {
  buildGwsSyncIncidentDiagnostic,
  sanitizeTechnicalErrorMessage,
} from './incident-diagnostics';

/**
 * Diagnóstico operativo estructurado de 4 partes en lenguaje natural en español (Spec 002 - T012).
 */
export interface DiagnosticoOperativoSync {
  componenteAfectado: string;
  impactoOperativo: string;
  mitigacionActiva: string;
  accionRecomendada: string;
  resumenEjecutivo: string;
}

export interface SyncDiagnosticInput {
  escenario:
    | 'GWS_QUOTA_THROTTLED'
    | 'DLQ_EVENT_EXHAUSTED'
    | 'PARTITION_ORPHAN_RECOVERED'
    | 'PARTITION_CONFLICT_ACTIVE'
    | 'INVALID_GWS_PAYLOAD'
    | 'HEALTH_SUMMARY';
  dominio?: string;
  orgUnitPath?: string;
  googleUserId?: string;
  idEventoExterno?: string;
  httpStatusGws?: number | null;
  intentosRealizados?: number;
  pendientesDlq?: number;
  modoIngesta?: 'INDIVIDUAL_GET' | 'LOTE_LIST_500';
  reqPorSegundoActual?: number;
  detalleError?: string;
}

/**
 * Constructor estandarizado de diagnósticos explicativos en lenguaje natural en español
 * con estructura obligatoria de 4 partes:
 * 1. `componenteAfectado`
 * 2. `impactoOperativo`
 * 3. `mitigacionActiva`
 * 4. `accionRecomendada`
 * además de `resumenEjecutivo` (Spec 002 - T012 / US5).
 */
export class SyncDiagnosticBuilder {
  public buildPartitionLockConflictDiagnostic(params: {
    dominio: string;
    orgUnitPath: string;
    tipoProceso?: string;
    heartbeatEn?: string;
  }): DiagnosticoOperativoSync & { mensajeConsolidado: string } {
    const diag = SyncDiagnosticBuilder.build({
      escenario: 'PARTITION_CONFLICT_ACTIVE',
      dominio: params.dominio,
      orgUnitPath: params.orgUnitPath,
    });
    return {
      ...diag,
      mensajeConsolidado: diag.resumenEjecutivo,
    };
  }

  public static build(input: SyncDiagnosticInput): DiagnosticoOperativoSync {
    const safeError = input.detalleError
      ? sanitizeTechnicalErrorMessage(input.detalleError)
      : 'Sin error técnico reportado.';

    switch (input.escenario) {
      case 'GWS_QUOTA_THROTTLED': {
        const report = buildGwsSyncIncidentDiagnostic({
          scenario: 'GWS_QUOTA_THROTTLED',
          domain: input.dominio,
          httpStatusGws: input.httpStatusGws ?? 429,
          errorMessage: safeError,
        });
        const componenteAfectado = `1. Componente afectado: Integración de solo lectura con Google Workspace Admin SDK Directory API (${report.componenteAfectado}) en el dominio ${input.dominio ?? 'institucional'}.`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): ${report.impactoOperativoYSeguridad}`;
        const mitigacionActiva = `3. Mitigación activa: ${report.comoSeLevantaYRecupera}`;
        const accionRecomendada = `4. Acción recomendada: ${report.accionesRecomendadasAdministrador.join(' ')}`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }

      case 'DLQ_EVENT_EXHAUSTED': {
        const report = buildGwsSyncIncidentDiagnostic({
          scenario: 'DLQ_PENDING_ACCUMULATION',
          domain: input.dominio,
          httpStatusGws: input.httpStatusGws ?? 503,
          pendingDlqCount: input.pendientesDlq ?? 1,
          errorMessage: safeError,
        });
        const componenteAfectado = `1. Componente afectado: Sincronizador de Identidades y Bandeja DLQ (evento ${input.idEventoExterno ?? 'N/A'} del usuario ${input.googleUserId ?? 'N/A'} en ${input.dominio ?? 'dominio institucional'}).`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): El evento agotó ${input.intentosRealizados ?? 5} intentos con retroceso exponencial (HTTP ${input.httpStatusGws ?? 'N/A'}: ${safeError}). ${report.impactoOperativoYSeguridad}`;
        const mitigacionActiva = `3. Mitigación activa: El evento fue persistido en registro_fallo_sincronizacion (DLQ) con estado PENDIENTE_REPROCESO sin bloquear la cola principal ni exceder el techo de 28 req/s.`;
        const accionRecomendada = `4. Acción recomendada: Verificar la disponibilidad o los datos de origen en Google Workspace y ejecutar POST /api/v1/admin/sync/dlq/replay para reprocesar con protección automática de obsolescencia.`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }

      case 'PARTITION_ORPHAN_RECOVERED': {
        const report = buildGwsSyncIncidentDiagnostic({
          scenario: 'PARTITION_HEARTBEAT_EXPIRED',
          domain: input.dominio,
          orgUnitPath: input.orgUnitPath,
          errorMessage: safeError,
        });
        const componenteAfectado = `1. Componente afectado: Motor de Conciliación Masiva (${report.componenteAfectado}) en la partición (${input.dominio ?? 'N/A'}, ${input.orgUnitPath ?? '/'}).`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): ${report.impactoOperativoYSeguridad}`;
        const mitigacionActiva = `3. Mitigación activa: ${report.comoSeLevantaYRecupera}`;
        const accionRecomendada = `4. Acción recomendada: ${report.accionesRecomendadasAdministrador.join(' ')}`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }

      case 'PARTITION_CONFLICT_ACTIVE': {
        const componenteAfectado = `1. Componente afectado: Coordinador de Bloqueos Consultivos (pg_try_advisory_lock) en la partición (${input.dominio ?? 'N/A'}, ${input.orgUnitPath ?? '/'}).`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): La solicitud manual fue rechazada con código 409 Conflict porque otro worker mantiene la partición en estado EN_EJECUCION con latido (heartbeat_en) vigente (<= 15 minutos).`;
        const mitigacionActiva = `3. Mitigación activa: El bloqueo consultivo en AlloyDB impide colisiones concurrentes y consumo duplicado de la cuota de Google Workspace Directory API.`;
        const accionRecomendada = `4. Acción recomendada: Consultar el progreso de la partición mediante GET /api/v1/admin/sync/checkpoints y esperar a que concluya antes de solicitar un nuevo disparo manual.`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }

      case 'INVALID_GWS_PAYLOAD': {
        const componenteAfectado = `1. Componente afectado: Validador de Esquema de Identidad (customSchemas.MINEDEC_Perfil) en el dominio ${input.dominio ?? 'institucional'}.`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): El registro de Google Workspace (${input.googleUserId ?? 'N/A'}) presenta datos no recuperables (${safeError}) y no pudo consolidarse automáticamente.`;
        const mitigacionActiva = `3. Mitigación activa: El registro se aisló en la bandeja DLQ / anomalías manteniendo postura fail-close sin afectar el flujo de otros usuarios.`;
        const accionRecomendada = `4. Acción recomendada: Corregir los atributos de identificación en Google Workspace y ejecutar el reprocesamiento controlado desde la consola administrativa.`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }

      case 'HEALTH_SUMMARY':
      default: {
        const modo = input.modoIngesta ?? 'INDIVIDUAL_GET';
        const rps = input.reqPorSegundoActual ?? 0;
        const dlq = input.pendientesDlq ?? 0;
        const componenteAfectado = `1. Componente afectado: Subsistema de Sincronización Incremental y Conciliación Masiva (Google Workspace -> AlloyDB / Redis L2).`;
        const impactoOperativo = `2. Impacto operativo (Qué ocurrió): Operando en modo ${modo} a ${rps} req/s (techo seguro <= 28 req/s) con ${dlq} eventos pendientes en la bandeja DLQ.`;
        const mitigacionActiva = `3. Mitigación activa: Gobernador distribuido de cuotas en Redis con reserva de 5 req/s para REGISTRO_CALIENTE y conmutación automática con histéresis.`;
        const accionRecomendada =
          dlq > 0
            ? `4. Acción recomendada: Revisar los ${dlq} registros pendientes en GET /api/v1/admin/sync/dlq y ejecutar POST /api/v1/admin/sync/dlq/replay.`
            : `4. Acción recomendada: No se requiere intervención manual; el sincronizador opera dentro de los parámetros nominales.`;
        return {
          componenteAfectado,
          impactoOperativo,
          mitigacionActiva,
          accionRecomendada,
          resumenEjecutivo: `${componenteAfectado} ${impactoOperativo} ${mitigacionActiva} ${accionRecomendada}`,
        };
      }
    }
  }
}

export * from './incident-diagnostics';
