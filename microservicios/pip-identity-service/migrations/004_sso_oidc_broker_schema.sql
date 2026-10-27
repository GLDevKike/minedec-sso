-- =============================================================================
-- Conecta MINEDEC (Subcomponente C2.2) — Servicio Intermediario Central de Inicio
-- de Sesión Único (Identity Broker OIDC — DA-11)
-- Migración: 004_sso_oidc_broker_schema.sql
-- Motor:     AlloyDB for PostgreSQL 16
-- Descripción:
--   1. Garantiza en semilla los subdominios institucionales activos en dominio_institucional
--      (educacion.gob.ec, estudiantes.educacion.gob.ec, deporte.gob.ec, cultura.gob.ec).
--   2. Extiende auditoria_evento con el canal 'SSO_OIDC_BROKER' y los códigos de evento OIDC.
--   3. Crea las 4 tablas relacionales normalizadas en 1FN/3FN/BCNF:
--      - aplicacion
--      - cliente_oidc
--      - cliente_oidc_redirect_uri
--      - llave_jwks_rotacion
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
-- 1. Semilla de los 4 subdominios institucionales activos en dominio_institucional (D-01, D-21)
-- -----------------------------------------------------------------------------
INSERT INTO dominio_institucional (
  dominio,
  google_customer_id,
  tipo_poblacion,
  es_subdominio,
  activo
) VALUES
  ('educacion.gob.ec', 'C01MINEDEC01', 'ADMINISTRATIVO', false, true),
  ('estudiantes.educacion.gob.ec', 'C01MINEDEC01', 'ESTUDIANTE', true, true),
  ('deporte.gob.ec', 'C01MINEDEC01', 'ADMINISTRATIVO', false, true),
  ('cultura.gob.ec', 'C01MINEDEC01', 'ADMINISTRATIVO', false, true),
  ('docentes.educacion.gob.ec', 'C01MINEDEC01', 'DOCENTE', true, true),
  ('estudiante.edu.ec', 'C01MINEDEC01', 'ESTUDIANTE', true, true)
ON CONFLICT (dominio) DO UPDATE
SET google_customer_id = EXCLUDED.google_customer_id,
    tipo_poblacion = EXCLUDED.tipo_poblacion,
    es_subdominio = EXCLUDED.es_subdominio,
    activo = EXCLUDED.activo,
    actualizado_en = NOW();

-- -----------------------------------------------------------------------------
-- 2. Extensión de auditoria_evento (Canal 'SSO_OIDC_BROKER' y eventos OIDC)
-- -----------------------------------------------------------------------------
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
    'EVENTO_DLQ_REPROCESADO',
    'OIDC_AUTHORIZE_INICIADO',
    'OIDC_FEDERACION_GOOGLE_EXITOSA',
    'OIDC_ID_TOKEN_EMITIDO',
    'OIDC_REGISTRO_CALIENTE_PENDIENTE_BLOQUEADO',
    'OIDC_RECHAZO_SEGURIDAD',
    'OIDC_SLO_EJECUTADO',
    'OIDC_SESION_REVOCADA_PUBSUB',
    'OIDC_JWKS_ROTADO',
    'OIDC_JWKS_REVOCADO_EMERGENCIA'
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
    'SINCRONIZADOR_GWS',
    'SSO_OIDC_BROKER'
  ));

-- -----------------------------------------------------------------------------
-- 3. Tabla: aplicacion (Activos Tecnológicos Integrados — Etapa 2/3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aplicacion (
  aplicacion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_unico VARCHAR(64) NOT NULL UNIQUE,
  nombre_visible VARCHAR(160) NOT NULL,
  descripcion TEXT NULL,
  patron_integracion VARCHAR(32) NOT NULL
    CHECK (patron_integracion IN ('PATRON_1_SP_RP', 'PATRON_2_PEP_PERIMETRAL')),
  nivel_adopcion_pep VARCHAR(24) NULL
    CHECK (nivel_adopcion_pep IS NULL OR nivel_adopcion_pep IN ('PROTEGIDA', 'INTEGRADA', 'NATIVA')),
  host_publico VARCHAR(255) NOT NULL UNIQUE,
  url_backend_interno VARCHAR(512) NULL,
  politica_ruta_defecto VARCHAR(24) NOT NULL DEFAULT 'PROTEGIDA'
    CHECK (politica_ruta_defecto IN ('PUBLICA', 'AUTENTICADA', 'PROTEGIDA')),
  viceministerio_dueno VARCHAR(40) NOT NULL DEFAULT 'EDUCACION',
  estado_ciclo_vida VARCHAR(24) NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado_ciclo_vida IN ('BORRADOR', 'PUBLICANDO', 'PUBLICADO', 'SUSPENDIDO', 'DESPUBLICADO')),
  version_catalogo INTEGER NOT NULL DEFAULT 1 CHECK (version_catalogo >= 1),
  creado_por UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aplicacion_estado_ciclo_vida
  ON aplicacion (estado_ciclo_vida);

DROP TRIGGER IF EXISTS trg_aplicacion_updated_at ON aplicacion;
CREATE TRIGGER trg_aplicacion_updated_at
  BEFORE UPDATE ON aplicacion
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Tabla: cliente_oidc (Clientes OIDC por Aplicación o PEP — DA-11)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_oidc (
  cliente_oidc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE RESTRICT,
  oidc_client_id VARCHAR(128) NOT NULL UNIQUE,
  secreto_activo_hash CHAR(64) NULL
    CHECK (secreto_activo_hash IS NULL OR secreto_activo_hash ~ '^[0-9a-f]{64}$'),
  secreto_anterior_hash CHAR(64) NULL
    CHECK (secreto_anterior_hash IS NULL OR secreto_anterior_hash ~ '^[0-9a-f]{64}$'),
  gracia_hasta TIMESTAMPTZ NULL,
  expira_rotacion_en TIMESTAMPTZ NULL,
  metodo_autenticacion_token VARCHAR(32) NOT NULL DEFAULT 'client_secret_basic'
    CHECK (metodo_autenticacion_token IN ('client_secret_basic', 'client_secret_post', 'none')),
  estado_cliente VARCHAR(24) NOT NULL DEFAULT 'ACTIVO'
    CHECK (estado_cliente IN ('ACTIVO', 'EN_ROTACION_GRACIA', 'REVOCADO')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_cliente_oidc_secreto_confidencial
    CHECK (
      (metodo_autenticacion_token = 'none' AND secreto_activo_hash IS NULL)
      OR (metodo_autenticacion_token IN ('client_secret_basic', 'client_secret_post')
          AND secreto_activo_hash IS NOT NULL
          AND expira_rotacion_en IS NOT NULL)
    ),
  CONSTRAINT chk_cliente_oidc_gracia_coherente
    CHECK (
      (estado_cliente = 'EN_ROTACION_GRACIA'
        AND secreto_anterior_hash IS NOT NULL
        AND gracia_hasta IS NOT NULL)
      OR (estado_cliente IN ('ACTIVO', 'REVOCADO'))
    )
);

CREATE INDEX IF NOT EXISTS idx_cliente_oidc_aplicacion_estado
  ON cliente_oidc (aplicacion_id, estado_cliente);

DROP TRIGGER IF EXISTS trg_cliente_oidc_updated_at ON cliente_oidc;
CREATE TRIGGER trg_cliente_oidc_updated_at
  BEFORE UPDATE ON cliente_oidc
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Tabla: cliente_oidc_redirect_uri (URIs de Retorno Normalizadas 1FN/3FN — DA-11)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_oidc_redirect_uri (
  redirect_uri_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_oidc_id UUID NOT NULL REFERENCES cliente_oidc(cliente_oidc_id) ON DELETE CASCADE,
  tipo_uri VARCHAR(24) NOT NULL DEFAULT 'LOGIN_CALLBACK'
    CHECK (tipo_uri IN ('LOGIN_CALLBACK', 'POST_LOGOUT', 'BACKCHANNEL_LOGOUT')),
  uri VARCHAR(512) NOT NULL
    CHECK (uri ~ '^https://[^\s*]+$' OR uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^\s*]*)?$'),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cliente_oidc_tipo_uri UNIQUE (cliente_oidc_id, tipo_uri, uri)
);

CREATE INDEX IF NOT EXISTS idx_cliente_oidc_redirect_lookup
  ON cliente_oidc_redirect_uri (cliente_oidc_id, tipo_uri, activo);

-- -----------------------------------------------------------------------------
-- 6. Tabla: llave_jwks_rotacion (Metadatos de Llaves RS256 Segregadas por Emisor)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llave_jwks_rotacion (
  kid VARCHAR(64) PRIMARY KEY,
  servicio_emisor VARCHAR(24) NOT NULL DEFAULT 'SSO_OIDC'
    CHECK (servicio_emisor IN ('SSO_OIDC', 'MOTOR_PDP')),
  algoritmo VARCHAR(16) NOT NULL DEFAULT 'RS256'
    CHECK (algoritmo = 'RS256'),
  secret_manager_version VARCHAR(255) NOT NULL,
  public_jwk_json JSONB NOT NULL,
  estado_llave VARCHAR(24) NOT NULL
    CHECK (estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION', 'RETIRADA', 'REVOCADA')),
  activada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_rotacion_en TIMESTAMPTZ NOT NULL
    CHECK (expira_rotacion_en <= activada_en + INTERVAL '90 days'),
  retirada_en TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_llave_jwks_activa_por_emisor
  ON llave_jwks_rotacion (servicio_emisor)
  WHERE estado_llave = 'ACTIVA_FIRMA';

CREATE INDEX IF NOT EXISTS idx_llave_jwks_emisor_estado
  ON llave_jwks_rotacion (servicio_emisor, estado_llave);

COMMIT;
