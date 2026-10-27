import { DiagnosticoOperativoSync } from '@minedec/shared';

export type { DiagnosticoOperativoSync };

export type TipoEventoDirectorio =
  | 'CREATE_USER'
  | 'CHANGE_USER'
  | 'SUSPEND_USER'
  | 'UNSUSPEND_USER'
  | 'DELETE_USER'
  | 'REGISTRO_CALIENTE_RECONCILE'
  | 'BARRIDO_DELTA_2MIN';

export type ModoDespachoSincronizacion =
  | 'INDIVIDUAL_GET'
  | 'LOTE_LIST_500'
  | 'OMITIDO_DUPLICADO'
  | 'OMITIDO_OBSOLETO';

export type TipoProcesoConciliacion =
  | 'CARGA_INICIAL'
  | 'CONCILIACION_DIARIA'
  | 'CONCILIACION_NOCTURNA'
  | 'BARRIDO_DELTA'
  | 'BARRIDO_DELTA_2MIN'
  | 'CONCILIACION_MASIVA';

export type EstadoEjecucionCheckpoint =
  | 'PENDIENTE'
  | 'EN_PROGRESO'
  | 'PAUSADO_CUOTA'
  | 'PAUSADA_CUOTA'
  | 'COMPLETADO'
  | 'COMPLETADA'
  | 'FALLIDO'
  | 'FALLIDA';

export type EstadoRegistroDlq =
  | 'PENDIENTE_REVISION'
  | 'EN_REPROCESAMIENTO'
  | 'EN_REPROCESO'
  | 'RESUELTO_REPROCESADO'
  | 'RESUELTO_POR_OBSOLESCENCIA'
  | 'DESCARTADO_MANUAL';

export interface EventoSincronizacionGws {
  idEventoExterno: string;
  idMensajePubSub?: string;
  googleSubId: string;
  emailPrincipal: string | null;
  dominio: string;
  orgUnitPath?: string;
  tipoEvento: TipoEventoDirectorio | string;
  timestampEventoGws: string;
  origenCanal:
    | 'PUBSUB_AUDIT_LOG'
    | 'CLOUD_SCHEDULER_DELTA'
    | 'CLOUD_TASKS_PRIORITY'
    | 'DLQ_REPLAY';
  modoDespacho: 'DIRECT_EXTRACT' | 'FETCH_BY_SUB';
  resultado:
    | 'PROCESADO'
    | 'OMITIDO_HASH_IDENTICO'
    | 'DESCARTADO_OBSOLETO'
    | 'IGNORADO_IDEMPOTENTE';
  hashPayloadGws: string | null;
  procesadoEn: string;
}

export interface CheckpointConciliacion {
  checkpointId: string;
  dominio: string;
  orgUnitPath: string;
  tipoProceso: TipoProcesoConciliacion;
  nextPageToken: string | null;
  cuentasProcesadas: number;
  cuentasActualizadas: number;
  cuentasOmitidasHash: number;
  cuentasBajaDetectadas: number;
  anomaliasAbiertas: number;
  estadoEjecucion: EstadoEjecucionCheckpoint;
  workerInstanciaId: string | null;
  lockAdvisoryKey: string;
  heartbeatEn: string;
  iniciadoEn: string;
  completadoEn: string | null;
  ultimoErrorCodigo: string | null;
  diagnosticoOperativo: string | null;
  esParticionHuerfana?: boolean;
}

export interface RegistroFalloSincronizacion {
  dlqId: string;
  idEventoExterno: string;
  origenCanal:
    | 'PUBSUB_AUDIT_LOG'
    | 'CLOUD_TASKS_PRIORITY'
    | 'BARRIDO_DELTA_2MIN'
    | 'CONCILIACION_MASIVA';
  googleSubId: string | null;
  emailPrincipal: string | null;
  dominio: string | null;
  tipoEvento: string;
  timestampEventoGws: string;
  payloadOriginal: Record<string, unknown>;
  intentosRealizados: number;
  ultimoBackoffMs: number;
  codigoError: string;
  httpStatusGws?: number | null;
  detalleErrorTecnico: string;
  diagnosticoLenguajeNatural: string;
  accionRecomendada: string;
  estadoDlq: EstadoRegistroDlq;
  resueltoPorIdentificacion: string | null;
  motivoResolucion: string | null;
  creadoEn: string;
  actualizadoEn: string;
  resueltoEn: string | null;
}

export interface ResultadoSincronizacionCuenta {
  idEventoExterno: string;
  resultado:
    | 'APLICADO'
    | 'SIN_CAMBIOS_HASH'
    | 'ANOMALIA_REGISTRADA'
    | 'DUPLICADO_IGNORADO'
    | 'OBSOLETO_IGNORADO'
    | 'DERIVADO_A_DLQ';
  modoDespacho: ModoDespachoSincronizacion;
  cuentasProcesadasEnLote: number;
  idInternoPersona?: string;
  cuentaId?: string;
  estadoPersonaResultante?: string;
  estadoCuentaResultante?: string;
  cacheInvalidated: boolean;
  anomaliasGeneradasIds?: string[];
}
