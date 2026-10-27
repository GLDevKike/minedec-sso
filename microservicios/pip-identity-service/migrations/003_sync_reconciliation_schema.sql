-- =============================================================================
-- Conecta MINEDEC (Subcomponente C2.2) — Sincronizador de Identidades (Solo Lectura)
-- y Motor de Conciliación con Google Workspace
-- Migración: 003_sync_reconciliation_schema.sql
-- Motor:     AlloyDB for PostgreSQL 16
-- Descripción:
--   1. Extiende cuenta_institucional con hash_payload_gws CHAR(64) NULL y estado ELIMINADA_GWS.
--   2. Extiende auditoria_evento con los tipos de evento y canales del Sincronizador y Conciliación.
--   3. Crea las 3 tablas operativas normalizadas 3FN:
--      - checkpoint_conciliacion
--      - evento_sincronizacion_procesado
--      - registro_fallo_sincronizacion
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 1. Extensión de persona_identidad y cuenta_institucional (Hash SHA-256 de payload GWS + ELIMINADA_GWS)
-- -----------------------------------------------------------------------------
ALTER TABLE persona_identidad
  DROP CONSTRAINT IF EXISTS persona_identidad_estado_persona_check;

ALTER TABLE persona_identidad
  ADD CONSTRAINT persona_identidad_estado_persona_check
  CHECK (estado_persona IN (
    'ACTIVA',
    'PENDIENTE_IDENTIFICACION',
    'PENDIENTE_CONCILIACION',
    'RESTRINGIDA_ANOMALIA',
    'BLOQUEADA_ANOMALIA',
    'INACTIVA'
  ));

ALTER TABLE cuenta_institucional
  ADD COLUMN IF NOT EXISTS hash_payload_gws CHAR(64) NULL;

ALTER TABLE cuenta_institucional
  DROP CONSTRAINT IF EXISTS cuenta_institucional_tipo_usuario_check;

ALTER TABLE cuenta_institucional
  ADD CONSTRAINT cuenta_institucional_tipo_usuario_check
  CHECK (tipo_usuario IS NULL OR tipo_usuario IN (
    'ESTUDIANTE',
    'DOCENTE',
    'ADMINISTRATIVO',
    'DOCENTE_ADMINISTRATIVO',
    'EXTERNO',
    'CIUDADANO_EXTERNO'
  ));

ALTER TABLE cuenta_institucional
  DROP CONSTRAINT IF EXISTS cuenta_institucional_estado_sincronizacion_check;

ALTER TABLE cuenta_institucional
  ADD CONSTRAINT cuenta_institucional_estado_sincronizacion_check
  CHECK (estado_sincronizacion IN (
    'SINCRONIZADA',
    'REGISTRO_CALIENTE',
    'SUSPENDIDA_GWS',
    'ELIMINADA_GWS',
    'VIGENCIA_VENCIDA',
    'BLOQUEADA_ANOMALIA'
  ));

ALTER TABLE cuenta_institucional
  DROP CONSTRAINT IF EXISTS cuenta_institucional_origen_ultima_sincronizacion_check;

ALTER TABLE cuenta_institucional
  ADD CONSTRAINT cuenta_institucional_origen_ultima_sincronizacion_check
  CHECK (origen_ultima_sincronizacion IN (
    'EVENTO_AUDIT_LOG',
    'ADMIN_SDK_PUSH',
    'BARRIDO_DELTA_2MIN',
    'CONCILIACION_BATCH',
    'CONCILIACION_DIARIA',
    'REGISTRO_CALIENTE_PRIORITARIO',
    'REGISTRO_CALIENTE'
  ));

-- -----------------------------------------------------------------------------
-- 2. Extensión de auditoria_evento (Tipos de evento y canales de sincronización)
-- -----------------------------------------------------------------------------
ALTER TABLE auditoria_evento
  DROP CONSTRAINT IF EXISTS auditoria_evento_actor_id_interno_fkey;

ALTER TABLE auditoria_evento
  DROP CONSTRAINT IF EXISTS auditoria_evento_tipo_evento_check;

ALTER TABLE auditoria_evento
  ADD CONSTRAINT auditoria_evento_tipo_evento_check
  CHECK (tipo_evento IN (
    'IDENTIDAD_SINCRONIZADA',
    'IDENTIDAD_CREADA',
    'IDENTIDAD_ACTUALIZADA',
    'IDENTIDAD_SUSPENDIDA',
    'IDENTIDAD_ELIMINADA',
    'PERSONA_DESACTIVADA',
    'TRANSICION_CODIGO_A_CEDULA',
    'INTENTO_MUTACION_CEDULA_RECHAZADO',
    'REGISTRO_CALIENTE_CREADO',
    'REGISTRO_CALIENTE_PROVISIONAL',
    'REGISTRO_CALIENTE_UNIFICADO',
    'REGISTRO_CALIENTE_FUSIONADO',
    'REGISTRO_CALIENTE_PROMOVIDO',
    'ANOMALIA_DETECTADA',
    'ANOMALIA_ABIERTA',
    'ANOMALIA_RESUELTA',
    'ANOMALIA_AUTO_RESUELTA',
    'ASIGNACION_CONTEXTO_CREADA',
    'ASIGNACION_CONTEXTO_MODIFICADA',
    'ASIGNACION_CONTEXTO_DESACTIVADA',
    'CACHE_INVALIDADO',
    'CATALOGO_ACTUALIZADO',
    'CONCILIACION_PARTICION_COMPLETADA',
    'CONCILIACION_PARTICION_RECLAMADA',
    'EVENTO_DLQ_REGISTRADO',
    'EVENTO_DLQ_REPROCESADO'
  ));

ALTER TABLE auditoria_evento
  DROP CONSTRAINT IF EXISTS auditoria_evento_origen_canal_check;

ALTER TABLE auditoria_evento
  ADD CONSTRAINT auditoria_evento_origen_canal_check
  CHECK (origen_canal IN (
    'PIP_INGEST',
    'LOGIN_JIT',
    'PDP_MOTOR',
    'PAP_ADMIN',
    'SYNC_INCREMENTAL',
    'SYNC_BATCH_JOB',
    'SINCRONIZADOR_GWS'
  ));

-- -----------------------------------------------------------------------------
-- 3. Tabla: checkpoint_conciliacion (Particionamiento, Cursores y Heartbeat)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkpoint_conciliacion (
  checkpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dominio VARCHAR(120) NOT NULL REFERENCES dominio_institucional(dominio) ON DELETE RESTRICT,
  org_unit_path VARCHAR(512) NOT NULL DEFAULT '/',
  tipo_proceso VARCHAR(32) NOT NULL
    CHECK (tipo_proceso IN ('BARRIDO_DELTA_2MIN', 'BARRIDO_DELTA', 'CONCILIACION_DIARIA', 'CONCILIACION_NOCTURNA', 'CONCILIACION_MASIVA', 'CARGA_INICIAL')),
  next_page_token TEXT NULL,
  cuentas_procesadas INTEGER NOT NULL DEFAULT 0 CHECK (cuentas_procesadas >= 0),
  cuentas_actualizadas INTEGER NOT NULL DEFAULT 0 CHECK (cuentas_actualizadas >= 0),
  cuentas_omitidas_hash INTEGER NOT NULL DEFAULT 0 CHECK (cuentas_omitidas_hash >= 0),
  cuentas_baja_detectadas INTEGER NOT NULL DEFAULT 0 CHECK (cuentas_baja_detectadas >= 0),
  anomalias_abiertas INTEGER NOT NULL DEFAULT 0 CHECK (anomalias_abiertas >= 0),
  estado_ejecucion VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_ejecucion IN ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'COMPLETADO', 'PAUSADA_CUOTA', 'PAUSADO_CUOTA', 'FALLIDA', 'FALLIDO')),
  worker_instancia_id VARCHAR(128) NULL,
  lock_advisory_key BIGINT NOT NULL,
  heartbeat_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  iniciado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completado_en TIMESTAMPTZ NULL,
  ultimo_error_codigo VARCHAR(64) NULL,
  diagnostico_operativo TEXT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_checkpoint_particion UNIQUE (dominio, org_unit_path, tipo_proceso)
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_estado_heartbeat
  ON checkpoint_conciliacion (estado_ejecucion, heartbeat_en);

CREATE INDEX IF NOT EXISTS idx_checkpoint_dominio_proceso
  ON checkpoint_conciliacion (dominio, tipo_proceso);

DROP TRIGGER IF EXISTS trg_checkpoint_conciliacion_updated_at ON checkpoint_conciliacion;
CREATE TRIGGER trg_checkpoint_conciliacion_updated_at
  BEFORE UPDATE ON checkpoint_conciliacion
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Tabla: evento_sincronizacion_procesado (Idempotencia y Orden Monotónico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evento_sincronizacion_procesado (
  id_evento_externo VARCHAR(128) PRIMARY KEY,
  google_sub_id VARCHAR(64) NOT NULL,
  email_principal VARCHAR(254) NULL,
  tipo_evento VARCHAR(48) NOT NULL
    CHECK (tipo_evento IN (
      'CREATE_USER',
      'CHANGE_USER',
      'CHANGE_USER_CUSTOM_FIELDS',
      'CHANGE_USER_CUSTOM_SCHEMAS',
      'SUSPEND_USER',
      'UNSUSPEND_USER',
      'DELETE_USER',
      'UNDELETE_USER',
      'CHANGE_ORG_UNIT',
      'MOVE_USER_TO_ORG_UNIT',
      'RENAME_USER',
      'HOT_REGISTRATION_RECONCILE',
      'REGISTRO_CALIENTE_RECONCILE',
      'DELTA_SWEEP_UPDATE',
      'BARRIDO_DELTA_2MIN'
    )),
  timestamp_evento_gws TIMESTAMPTZ NOT NULL,
  origen_canal VARCHAR(32) NOT NULL
    CHECK (origen_canal IN ('PUBSUB_AUDIT_LOG', 'CLOUD_SCHEDULER_DELTA', 'CLOUD_TASKS_PRIORITY', 'DLQ_REPLAY')),
  modo_despacho VARCHAR(24) NOT NULL
    CHECK (modo_despacho IN ('DIRECT_EXTRACT', 'FETCH_BY_SUB')),
  resultado VARCHAR(32) NOT NULL
    CHECK (resultado IN ('PROCESADO', 'OMITIDO_HASH_IDENTICO', 'DESCARTADO_OBSOLETO', 'IGNORADO_IDEMPOTENTE')),
  hash_payload_gws CHAR(64) NULL,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evento_sync_sub_timestamp
  ON evento_sincronizacion_procesado (google_sub_id, timestamp_evento_gws DESC);

CREATE INDEX IF NOT EXISTS idx_evento_sync_procesado_en
  ON evento_sincronizacion_procesado (procesado_en);

-- -----------------------------------------------------------------------------
-- 5. Tabla: registro_fallo_sincronizacion (Dead-Letter Queue Persistente y Replay)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_fallo_sincronizacion (
  dlq_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento_externo VARCHAR(128) NOT NULL UNIQUE,
  origen_canal VARCHAR(32) NOT NULL
    CHECK (origen_canal IN ('PUBSUB_AUDIT_LOG', 'CLOUD_TASKS_PRIORITY', 'BARRIDO_DELTA_2MIN', 'CONCILIACION_MASIVA')),
  google_sub_id VARCHAR(64) NULL,
  email_principal VARCHAR(254) NULL,
  dominio VARCHAR(120) NULL,
  tipo_evento VARCHAR(48) NOT NULL,
  payload_original JSONB NOT NULL,
  intentos_realizados INTEGER NOT NULL DEFAULT 5 CHECK (intentos_realizados >= 1),
  codigo_error VARCHAR(64) NOT NULL,
  detalle_error_tecnico TEXT NOT NULL,
  diagnostico_lenguaje_natural TEXT NOT NULL,
  accion_recomendada TEXT NOT NULL,
  estado_dlq VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE_REVISION'
    CHECK (estado_dlq IN ('PENDIENTE_REVISION', 'EN_REPROCESO', 'EN_REPROCESAMIENTO', 'RESUELTO_REPROCESADO', 'RESUELTO_POR_OBSOLESCENCIA', 'DESCARTADO_MANUAL')),
  resuelto_por_identificacion VARCHAR(64) NULL,
  motivo_resolucion TEXT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_estado_creado
  ON registro_fallo_sincronizacion (estado_dlq, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_dlq_google_sub
  ON registro_fallo_sincronizacion (google_sub_id);

DROP TRIGGER IF EXISTS trg_dlq_sincronizacion_updated_at ON registro_fallo_sincronizacion;
CREATE TRIGGER trg_dlq_sincronizacion_updated_at
  BEFORE UPDATE ON registro_fallo_sincronizacion
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

ALTER TABLE checkpoint_conciliacion
  DROP CONSTRAINT IF EXISTS checkpoint_conciliacion_tipo_proceso_check,
  DROP CONSTRAINT IF EXISTS checkpoint_conciliacion_estado_ejecucion_check;

ALTER TABLE checkpoint_conciliacion
  ADD CONSTRAINT checkpoint_conciliacion_tipo_proceso_check
    CHECK (tipo_proceso IN ('BARRIDO_DELTA_2MIN', 'BARRIDO_DELTA', 'CONCILIACION_DIARIA', 'CONCILIACION_NOCTURNA', 'CONCILIACION_MASIVA', 'CARGA_INICIAL')),
  ADD CONSTRAINT checkpoint_conciliacion_estado_ejecucion_check
    CHECK (estado_ejecucion IN ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'COMPLETADO', 'PAUSADA_CUOTA', 'PAUSADO_CUOTA', 'FALLIDA', 'FALLIDO'));

ALTER TABLE evento_sincronizacion_procesado
  DROP CONSTRAINT IF EXISTS evento_sincronizacion_procesado_tipo_evento_check;

ALTER TABLE evento_sincronizacion_procesado
  ADD CONSTRAINT evento_sincronizacion_procesado_tipo_evento_check
    CHECK (tipo_evento IN (
      'CREATE_USER',
      'CHANGE_USER',
      'CHANGE_USER_CUSTOM_FIELDS',
      'CHANGE_USER_CUSTOM_SCHEMAS',
      'SUSPEND_USER',
      'UNSUSPEND_USER',
      'DELETE_USER',
      'UNDELETE_USER',
      'CHANGE_ORG_UNIT',
      'MOVE_USER_TO_ORG_UNIT',
      'RENAME_USER',
      'HOT_REGISTRATION_RECONCILE',
      'REGISTRO_CALIENTE_RECONCILE',
      'DELTA_SWEEP_UPDATE',
      'BARRIDO_DELTA_2MIN'
    ));

ALTER TABLE registro_fallo_sincronizacion
  ALTER COLUMN estado_dlq TYPE VARCHAR(32),
  DROP CONSTRAINT IF EXISTS registro_fallo_sincronizacion_estado_dlq_check;

ALTER TABLE registro_fallo_sincronizacion
  ADD CONSTRAINT registro_fallo_sincronizacion_estado_dlq_check
    CHECK (estado_dlq IN ('PENDIENTE_REVISION', 'EN_REPROCESO', 'EN_REPROCESAMIENTO', 'RESUELTO_REPROCESADO', 'RESUELTO_POR_OBSOLESCENCIA', 'DESCARTADO_MANUAL'));

COMMIT;
