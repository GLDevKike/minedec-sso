-- =============================================================================
-- Migración: 001_init_pip_identity_schema.sql
-- Feature:   001-modelo-identidades-perfil (Conecta MINEDEC - Subcomponente C2.2)
-- Motor:     AlloyDB for PostgreSQL 16
-- Diseño:    Tercera Forma Normal (3FN) pura y defensa en profundidad:
--            - Exclusivo para Personas Naturales (Constitución v2.7.0 Principio X.2)
--            - Tenant único de Google Workspace con subdominios por población (D-21)
--            - Homologación con fuentes oficiales MINEDEC (FO-DNTIC-20 / D-03)
--            - Inmutabilidad física de CEDULA consolidada y de auditoria_evento (Triggers)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. dominio_institucional
-- Subdominios por población dentro del único tenant de Google Workspace (D-21)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dominio_institucional (
    dominio VARCHAR(120) PRIMARY KEY,
    google_customer_id VARCHAR(64) NOT NULL,
    tipo_poblacion VARCHAR(40) NOT NULL
        CHECK (tipo_poblacion IN ('ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO', 'MIXTO')),
    es_subdominio BOOLEAN NOT NULL DEFAULT false,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dominio_lower
    ON dominio_institucional (LOWER(dominio));

CREATE INDEX IF NOT EXISTS idx_dominio_customer_activo
    ON dominio_institucional (google_customer_id, activo);

-- -----------------------------------------------------------------------------
-- 2. catalogo_atributo_minedec
-- Catálogo parametrizable jerárquico (D-03), derivación académica y sinónimos FO-DNTIC-20
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalogo_atributo_minedec (
    catalogo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_atributo VARCHAR(40) NOT NULL
        CHECK (categoria_atributo IN (
            'TIPO_IDENTIFICACION',
            'TIPO_USUARIO',
            'SUBTIPO_USUARIO',
            'CARGO_FUNCION',
            'GRADO_CURSO',
            'NIVEL_ACADEMICO',
            'VICEMINISTERIO',
            'NIVEL_ESTRUCTURA',
            'REGIMEN_ESCOLAR',
            'MODALIDAD_EDUCATIVA',
            'JORNADA'
        )),
    codigo_valor VARCHAR(64) NOT NULL,
    codigo_padre VARCHAR(64) NULL,
    etiqueta_visible VARCHAR(160) NOT NULL,
    nivel_academico_derivado VARCHAR(32) NULL,
    requiere_vigencia_temporal BOOLEAN NOT NULL DEFAULT false,
    metadatos_regla JSONB NOT NULL DEFAULT '{}'::jsonb,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_catalogo_categoria_codigo UNIQUE (categoria_atributo, codigo_valor)
);

CREATE INDEX IF NOT EXISTS idx_catalogo_categoria_activo
    ON catalogo_atributo_minedec (categoria_atributo, activo);

-- -----------------------------------------------------------------------------
-- 3. catalogo_territorio_sede
-- Maestro normalizado 3FN de instituciones educativas (AMIE) y jerarquía territorial
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalogo_territorio_sede (
    codigo_amie VARCHAR(8) PRIMARY KEY
        CHECK (codigo_amie ~ '^(0[1-9]|1[0-9]|2[0-4]|90)[A-Z][0-9]{5}$'),
    nombre_institucion VARCHAR(200) NOT NULL,
    codigo_zona VARCHAR(4) NOT NULL
        CHECK (codigo_zona ~ '^(0[1-9]|1[0-9]|2[0-4]|90)$'),
    codigo_distrito VARCHAR(8) NULL,
    codigo_circuito VARCHAR(12) NULL,
    provincia_dpa VARCHAR(2) NULL,
    canton_dpa VARCHAR(4) NULL,
    parroquia_dpa VARCHAR(6) NULL,
    regimen_escolar VARCHAR(24) NOT NULL DEFAULT 'SIERRA_AMAZONIA'
        CHECK (regimen_escolar IN ('COSTA_GALAPAGOS', 'SIERRA_AMAZONIA', 'NO_APLICA')),
    sostenimiento VARCHAR(30) NULL
        CHECK (sostenimiento IS NULL OR sostenimiento IN ('FISCAL', 'FISCOMISIONAL', 'MUNICIPAL', 'PARTICULAR')),
    modalidad_educativa VARCHAR(30) NULL DEFAULT 'PRESENCIAL'
        CHECK (modalidad_educativa IS NULL OR modalidad_educativa IN ('PRESENCIAL', 'SEMIPRESENCIAL', 'A_DISTANCIA', 'VIRTUAL', 'NO_APLICA')),
    jornada VARCHAR(24) NULL DEFAULT 'MATUTINA'
        CHECK (jornada IS NULL OR jornada IN ('MATUTINA', 'VESPERTINA', 'NOCTURNA', 'INTENSIVA', 'NO_APLICA')),
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_territorio_jerarquia
    ON catalogo_territorio_sede (codigo_zona, codigo_distrito, codigo_circuito);

-- -----------------------------------------------------------------------------
-- 4. persona_identidad
-- Nivel 1 (3FN Puro): Raíz civil/demográfica de Persona Natural (Constitución v2.7.0 X.2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persona_identidad (
    id_interno UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_identificacion VARCHAR(20) NOT NULL
        CHECK (tipo_identificacion IN ('CEDULA', 'PASAPORTE', 'CODIGO_MINEDEC')),
    numero_identificacion VARCHAR(64) NOT NULL,
    codigo_minedec_anterior VARCHAR(64) NULL UNIQUE,
    nombre_completo VARCHAR(250) NOT NULL,
    fecha_nacimiento DATE NULL,
    representante_legal_cedula VARCHAR(10) NULL,
    estado_persona VARCHAR(32) NOT NULL DEFAULT 'ACTIVA'
        CHECK (estado_persona IN (
            'ACTIVA',
            'PENDIENTE_IDENTIFICACION',
            'RESTRINGIDA_ANOMALIA',
            'BLOQUEADA_ANOMALIA',
            'INACTIVA'
        )),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_persona_tipo_numero_id UNIQUE (tipo_identificacion, numero_identificacion),
    CONSTRAINT uq_persona_numero_identificacion UNIQUE (numero_identificacion)
);

CREATE INDEX IF NOT EXISTS idx_persona_estado
    ON persona_identidad (estado_persona);

CREATE INDEX IF NOT EXISTS idx_persona_codigo_anterior
    ON persona_identidad (codigo_minedec_anterior)
    WHERE codigo_minedec_anterior IS NOT NULL;

-- Defensa en profundidad (Constitución X.2): Inmutabilidad estricta de CEDULA consolidada
CREATE OR REPLACE FUNCTION fn_enforce_cedula_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.tipo_identificacion = 'CEDULA' AND (
        NEW.tipo_identificacion <> 'CEDULA'
        OR NEW.numero_identificacion <> OLD.numero_identificacion
    ) THEN
        RAISE EXCEPTION 'IMMUTABLE_CEDULA_VIOLATION: La CEDULA consolidada (%) de id_interno (%) es estrictamente inmutable conforme al Principio X.2 de la Constitucion MINEDEC v2.7.0.',
            OLD.numero_identificacion, OLD.id_interno
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_cedula_immutability ON persona_identidad;
CREATE TRIGGER trg_enforce_cedula_immutability
    BEFORE UPDATE ON persona_identidad
    FOR EACH ROW
    EXECUTE FUNCTION fn_enforce_cedula_immutability();

-- -----------------------------------------------------------------------------
-- 5. cuenta_institucional
-- Nivel 2 (3FN Puro): Cuenta de Google Workspace y perfil poblacional por subdominio
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuenta_institucional (
    cuenta_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_interno UUID NOT NULL REFERENCES persona_identidad(id_interno),
    google_sub_id VARCHAR(64) NOT NULL UNIQUE,
    email_principal VARCHAR(254) NOT NULL UNIQUE,
    dominio VARCHAR(120) NOT NULL REFERENCES dominio_institucional(dominio),
    org_unit_path VARCHAR(512) NOT NULL DEFAULT '/',
    given_name VARCHAR(120) NULL,
    family_name VARCHAR(120) NULL,
    tipo_usuario VARCHAR(40) NULL
        CHECK (tipo_usuario IS NULL OR tipo_usuario IN ('ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO', 'EXTERNO')),
    subtipo_usuario VARCHAR(40) NULL,
    cargo_funcion VARCHAR(64) NULL,
    grado_curso VARCHAR(32) NULL,
    nivel_academico_derivado VARCHAR(32) NULL,
    docente_multisede BOOLEAN NOT NULL DEFAULT false,
    fecha_inicio_vigencia DATE NULL,
    fecha_fin_vigencia DATE NULL,
    suspended_en_gws BOOLEAN NOT NULL DEFAULT false,
    estado_sincronizacion VARCHAR(32) NOT NULL DEFAULT 'SINCRONIZADA'
        CHECK (estado_sincronizacion IN (
            'SINCRONIZADA',
            'REGISTRO_CALIENTE',
            'SUSPENDIDA_GWS',
            'VIGENCIA_VENCIDA',
            'BLOQUEADA_ANOMALIA'
        )),
    origen_ultima_sincronizacion VARCHAR(40) NULL
        CHECK (origen_ultima_sincronizacion IS NULL OR origen_ultima_sincronizacion IN (
            'EVENTO_AUDIT_LOG',
            'BARRIDO_DELTA_2MIN',
            'CONCILIACION_BATCH',
            'CONCILIACION_DIARIA',
            'REGISTRO_CALIENTE_PRIORITARIO'
        )),
    ultima_sincronizacion_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cuenta_vigencia_fechas CHECK (
        fecha_fin_vigencia IS NULL
        OR fecha_inicio_vigencia IS NULL
        OR fecha_fin_vigencia >= fecha_inicio_vigencia
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_email_lower
    ON cuenta_institucional (LOWER(email_principal));

CREATE INDEX IF NOT EXISTS idx_cuenta_id_interno
    ON cuenta_institucional (id_interno);

CREATE INDEX IF NOT EXISTS idx_cuenta_dominio_estado
    ON cuenta_institucional (dominio, estado_sincronizacion);

CREATE INDEX IF NOT EXISTS idx_cuenta_rbac_tripleta
    ON cuenta_institucional (tipo_usuario, subtipo_usuario, cargo_funcion);

-- -----------------------------------------------------------------------------
-- 6. asignacion_contexto
-- Asignación territorial y multisede en 3FN (GWS_PRIMARIO y PAP_DELEGADO)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asignacion_contexto (
    asignacion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_interno UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE CASCADE,
    cuenta_id UUID NULL REFERENCES cuenta_institucional(cuenta_id) ON DELETE SET NULL,
    origen_datos VARCHAR(24) NOT NULL DEFAULT 'PAP_DELEGADO'
        CHECK (origen_datos IN ('GWS_PRIMARIO', 'PAP_DELEGADO')),
    es_sede_primaria BOOLEAN NOT NULL DEFAULT false,
    nivel_estructura VARCHAR(40) NOT NULL DEFAULT 'INSTITUCION_EDUCATIVA'
        CHECK (nivel_estructura IN ('PLANTA_CENTRAL', 'ZONA', 'DISTRITO', 'CIRCUITO', 'INSTITUCION_EDUCATIVA')),
    viceministerio VARCHAR(40) NOT NULL DEFAULT 'NO_APLICA'
        CHECK (viceministerio IN ('EDUCACION', 'DEPORTE', 'CULTURA', 'GESTION_EDUCATIVA', 'NO_APLICA')),
    codigo_zona VARCHAR(4) NOT NULL
        CHECK (codigo_zona ~ '^(0[1-9]|1[0-9]|2[0-4]|90)$'),
    codigo_distrito VARCHAR(8) NULL,
    codigo_circuito VARCHAR(12) NULL,
    codigo_amie VARCHAR(8) NULL REFERENCES catalogo_territorio_sede(codigo_amie),
    codigo_dependencia_admin VARCHAR(160) NULL,
    regimen_escolar VARCHAR(24) NOT NULL DEFAULT 'NO_APLICA'
        CHECK (regimen_escolar IN ('COSTA_GALAPAGOS', 'SIERRA_AMAZONIA', 'NO_APLICA')),
    modalidad_educativa VARCHAR(30) NOT NULL DEFAULT 'NO_APLICA'
        CHECK (modalidad_educativa IN ('PRESENCIAL', 'SEMIPRESENCIAL', 'A_DISTANCIA', 'VIRTUAL', 'NO_APLICA')),
    jornada VARCHAR(24) NOT NULL DEFAULT 'NO_APLICA'
        CHECK (jornada IN ('MATUTINA', 'VESPERTINA', 'NOCTURNA', 'INTENSIVA', 'NO_APLICA')),
    activo BOOLEAN NOT NULL DEFAULT true,
    asignado_por_identificacion VARCHAR(64) NULL,
    motivo_asignacion TEXT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contexto_id_interno_activo
    ON asignacion_contexto (id_interno, activo);

CREATE INDEX IF NOT EXISTS idx_contexto_amie_activo
    ON asignacion_contexto (codigo_amie, activo)
    WHERE codigo_amie IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contexto_zona_distrito_circuito
    ON asignacion_contexto (codigo_zona, codigo_distrito, codigo_circuito);

-- -----------------------------------------------------------------------------
-- 7. anomalia_identidad
-- Bandeja de Anomalías de Identidad (bloqueo graduado, recurrencia y auto-resolución)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anomalia_identidad (
    anomalia_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anomalia_anterior_id UUID NULL REFERENCES anomalia_identidad(anomalia_id),
    id_interno UUID NULL REFERENCES persona_identidad(id_interno),
    cuenta_id UUID NULL REFERENCES cuenta_institucional(cuenta_id),
    google_sub_id VARCHAR(64) NOT NULL,
    email_principal VARCHAR(254) NOT NULL,
    dominio VARCHAR(120) NOT NULL,
    codigo_causal VARCHAR(40) NOT NULL
        CHECK (codigo_causal IN (
            'SIN_IDENTIFICACION_VALIDA',
            'COLISION_IDENTIFICADOR',
            'VIGENCIA_INVALIDA',
            'ATRIBUTO_OBLIGATORIO_FALTANTE',
            'FORMATO_AMIE_INVALIDO'
        )),
    efecto_acceso VARCHAR(20) NOT NULL
        CHECK (efecto_acceso IN ('BLOQUEANTE', 'RESTRINGIDA')),
    estado_anomalia VARCHAR(24) NOT NULL DEFAULT 'ABIERTA'
        CHECK (estado_anomalia IN (
            'ABIERTA',
            'EN_REVISION',
            'LISTA_PARA_CERRAR',
            'RESUELTA',
            'DESCARTADA'
        )),
    origen_resolucion VARCHAR(32) NULL
        CHECK (origen_resolucion IS NULL OR origen_resolucion IN ('AUTO_SINCRONIZACION', 'MANUAL_ADMIN')),
    resuelta_por_identificacion VARCHAR(64) NULL,
    motivo_resolucion TEXT NULL,
    valor_anterior JSONB NULL,
    valor_nuevo JSONB NULL,
    detalle_tecnico TEXT NOT NULL,
    detectada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resuelta_en TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_anomalia_bandeja_estado
    ON anomalia_identidad (estado_anomalia, codigo_causal, dominio, detectada_en DESC);

CREATE INDEX IF NOT EXISTS idx_anomalia_google_sub_causal
    ON anomalia_identidad (google_sub_id, codigo_causal, estado_anomalia);

CREATE INDEX IF NOT EXISTS idx_anomalia_id_interno
    ON anomalia_identidad (id_interno)
    WHERE id_interno IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. auditoria_evento
-- Registro inmutable append-only (INSERT/SELECT) con encadenamiento SHA-256 (Constitución XV)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria_evento (
    evento_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_evento VARCHAR(64) NOT NULL
        CHECK (tipo_evento IN (
            'IDENTIDAD_SINCRONIZADA',
            'IDENTIDAD_SUSPENDIDA',
            'TRANSICION_CODIGO_A_CEDULA',
            'INTENTO_MUTACION_CEDULA_RECHAZADO',
            'REGISTRO_CALIENTE_CREADO',
            'REGISTRO_CALIENTE_UNIFICADO',
            'ANOMALIA_DETECTADA',
            'ANOMALIA_RESUELTA',
            'ASIGNACION_CONTEXTO_CREADA',
            'ASIGNACION_CONTEXTO_DESACTIVADA',
            'CACHE_INVALIDADO',
            'CATALOGO_ACTUALIZADO'
        )),
    actor_id_interno UUID NULL REFERENCES persona_identidad(id_interno),
    actor_identificacion VARCHAR(64) NOT NULL,
    sujeto_identificacion VARCHAR(64) NULL,
    correo_afectado VARCHAR(254) NULL,
    origen_canal VARCHAR(32) NOT NULL
        CHECK (origen_canal IN ('PIP_INGEST', 'LOGIN_JIT', 'PAP_ADMIN')),
    entidad_afectada VARCHAR(64) NOT NULL,
    registro_afectado_id VARCHAR(128) NOT NULL,
    valores_anteriores JSONB NULL,
    valores_nuevos JSONB NULL,
    hash_evento_anterior_sha256 CHAR(64) NOT NULL,
    hash_evento_sha256 CHAR(64) NOT NULL UNIQUE,
    fecha_evento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_sujeto_fecha
    ON auditoria_evento (sujeto_identificacion, fecha_evento DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_actor_fecha
    ON auditoria_evento (actor_identificacion, fecha_evento DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_tipo_fecha
    ON auditoria_evento (tipo_evento, fecha_evento DESC);

-- Defensa en profundidad (Constitución XV): Prohibición absoluta de UPDATE/DELETE en auditoria_evento
CREATE OR REPLACE FUNCTION fn_enforce_auditoria_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'APPEND_ONLY_AUDIT_VIOLATION: La tabla auditoria_evento es estrictamente append-only (solo INSERT/SELECT) conforme al Principio XV de la Constitucion MINEDEC v2.7.0.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_auditoria_append_only ON auditoria_evento;
CREATE TRIGGER trg_enforce_auditoria_append_only
    BEFORE UPDATE OR DELETE ON auditoria_evento
    FOR EACH ROW
    EXECUTE FUNCTION fn_enforce_auditoria_append_only();

COMMIT;
