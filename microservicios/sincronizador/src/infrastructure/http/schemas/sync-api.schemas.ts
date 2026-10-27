import { z } from 'zod';

export const PubSubPushEnvelopeSchema = z.object({
  subscription: z.string().optional(),
  message: z.object({
    messageId: z.string().min(1),
    publishTime: z.string().optional(),
    data: z.string().min(1),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
});

export const DecodedGwsAuditEventSchema = z.object({
  idEventoExterno: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  tipoEvento: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  googleSubId: z.string().min(1).optional(),
  emailPrincipal: z.string().email().optional(),
  dominio: z.string().min(3).optional(),
  orgUnitPath: z.string().optional().default('/'),
  timestampEventoGws: z.string().optional(),
  esRegistroCaliente: z.boolean().optional().default(false),
  colaPendientesEstimada: z.number().int().nonnegative().optional(),
  antiguedadMensajeMasViejoSegundos: z.number().nonnegative().optional(),
});

export const PriorityHotRegistrationTaskSchema = z.object({
  idEventoExterno: z.string().min(1),
  googleSubId: z.string().min(1),
  emailPrincipal: z.string().email(),
  dominio: z.string().min(3),
  solicitadoEn: z.string().optional(),
});

export const IncrementalSyncTaskSchema = z.object({
  idEventoExterno: z.string().min(1),
  tipoEvento: z.string().min(1),
  googleSubId: z.string().min(1).optional(),
  emailPrincipal: z.string().email().optional(),
  dominio: z.string().min(3).optional(),
  orgUnitPath: z.string().optional().default('/'),
  timestampEventoGws: z.string().min(1),
  colaPendientesAlDespachar: z.number().int().nonnegative().optional().default(0),
  antiguedadMensajeMasViejoSegundos: z.number().nonnegative().optional().default(0),
  intentoActual: z.number().int().min(1).max(5).optional().default(1),
});

export const DeltaSweepRequestSchema = z.object({
  ventanaMinutos: z.number().int().min(1).max(60).optional().default(2),
  solapamientoSegundos: z.number().int().min(0).max(300).optional().default(30),
  dominios: z.array(z.string().min(3)).optional(),
});

export const TriggerPartitionRequestSchema = z.object({
  dominio: z.string().min(3),
  orgUnitPath: z.string().min(1).default('/'),
  tipoProceso: z
    .enum([
      'CARGA_INICIAL',
      'CONCILIACION_DIARIA',
      'CONCILIACION_NOCTURNA',
      'BARRIDO_DELTA',
      'BARRIDO_DELTA_2MIN',
      'CONCILIACION_MASIVA',
    ])
    .default('CONCILIACION_DIARIA'),
  workerInstanciaId: z.string().min(1).optional(),
  maxPaginasPorEjecucion: z.number().int().min(1).max(5000).optional().default(100),
  confirmarBajasPorAusenciaAlCompletar: z.boolean().optional().default(true),
});

export const ReplayDlqRequestSchema = z.object({
  dlqIds: z.array(z.string().uuid()).optional(),
  dominio: z.string().min(3).optional(),
  maxRegistros: z.number().int().min(1).max(500).optional().default(50),
  adminIdentificacion: z.string().min(3),
  motivoReplay: z.string().min(5),
});

export const DeactivatePersonRequestSchema = z.object({
  nuevoEstadoPersona: z
    .enum(['INACTIVA', 'BLOQUEADA_ANOMALIA'])
    .optional()
    .default('INACTIVA'),
  adminIdentificacion: z.string().min(3).optional(),
  motivoDesactivacion: z.string().min(5),
});
