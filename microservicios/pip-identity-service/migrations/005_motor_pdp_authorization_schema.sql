-- =============================================================================
-- CONECTA MINEDEC (Subcomponente C2.2) — Migración DDL 005
-- Feature 004: Motor de Autorización Central (motor-pdp) y Gobierno RBAC + ABAC
-- Normalización: 1FN / 3FN / BCNF con Aislamiento Multi-Aplicación por FK Compuesta
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensiones de Integridad sobre Tablas Preexistentes (001 y 004)
-- -----------------------------------------------------------------------------
ALTER TABLE aplicacion ADD COLUMN IF NOT EXISTS modo_sombra BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_oidc_aplicacion
  ON cliente_oidc (aplicacion_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_id_persona_compuesto
  ON cuenta_institucional (cuenta_id, id_interno);

-- -----------------------------------------------------------------------------
-- 1. Tabla: administrador_aplicativo (Gobierno Centralizado y Delegado PAP)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS administrador_aplicativo (
  admin_app_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  id_interno UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  rol_consola VARCHAR(32) NOT NULL DEFAULT 'ADMIN_PROPIETARIO',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  asignado_por UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_admin_rol_consola CHECK (
    rol_consola IN (
      'SUPERADMIN_SEGURIDAD',
      'AUDITOR_GLOBAL',
      'ADMIN_PROPIETARIO',
      'OPERADOR_POLITICAS',
      'AUDITOR_APP'
    )
  ),
  CONSTRAINT chk_admin_scope_coherente CHECK (
    (rol_consola IN ('SUPERADMIN_SEGURIDAD', 'AUDITOR_GLOBAL') AND aplicacion_id IS NULL)
    OR
    (rol_consola IN ('ADMIN_PROPIETARIO', 'OPERADOR_POLITICAS', 'AUDITOR_APP') AND aplicacion_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_consola_persona_ambito
  ON administrador_aplicativo NULLS NOT DISTINCT (id_interno, rol_consola, aplicacion_id)
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_admin_app_activo
  ON administrador_aplicativo (aplicacion_id, activo);

-- -----------------------------------------------------------------------------
-- 2. Tabla: ruta_catalogo (Catálogo 1FN/3FN de Rutas por Aplicación)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ruta_catalogo (
  ruta_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  patron_ruta VARCHAR(512) NOT NULL,
  metodo_http VARCHAR(10) NOT NULL DEFAULT 'ALL',
  tipo_coincidencia VARCHAR(16) NOT NULL,
  nivel_acceso VARCHAR(16) NOT NULL,
  modo_evaluacion_permisos VARCHAR(8) NOT NULL DEFAULT 'ANY',
  orden_especificidad INTEGER NOT NULL DEFAULT 100,
  modo_sombra BOOLEAN NOT NULL DEFAULT FALSE,
  descripcion VARCHAR(255) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ruta_app_id_compuesto UNIQUE (aplicacion_id, ruta_id),
  CONSTRAINT uq_ruta_app_patron_metodo UNIQUE (aplicacion_id, patron_ruta, metodo_http, tipo_coincidencia),
  CONSTRAINT chk_ruta_metodo_http CHECK (
    metodo_http IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL')
  ),
  CONSTRAINT chk_ruta_tipo_coincidencia CHECK (
    tipo_coincidencia IN ('EXACTA', 'PREFIJO', 'EXTENSION')
  ),
  CONSTRAINT chk_ruta_nivel_acceso CHECK (
    nivel_acceso IN ('PUBLICA', 'AUTENTICADA', 'PROTEGIDA')
  ),
  CONSTRAINT chk_ruta_modo_evaluacion CHECK (
    modo_evaluacion_permisos IN ('ANY', 'ALL')
  ),
  CONSTRAINT chk_ruta_patron_normalizado CHECK (
    patron_ruta LIKE '/%'
    AND POSITION('..' IN patron_ruta) = 0
    AND POSITION('%2f' IN LOWER(patron_ruta)) = 0
    AND POSITION('%00' IN LOWER(patron_ruta)) = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_ruta_evaluacion_pdp
  ON ruta_catalogo (aplicacion_id, activo, orden_especificidad);

-- -----------------------------------------------------------------------------
-- 3. Tabla: permiso_atomico (Unidades Mínimas de Autorización por Aplicación)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permiso_atomico (
  permiso_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  codigo_permiso VARCHAR(100) NOT NULL,
  nombre_visible VARCHAR(160) NOT NULL,
  descripcion TEXT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_permiso_app_id_compuesto UNIQUE (aplicacion_id, permiso_id),
  CONSTRAINT uq_permiso_app_codigo UNIQUE (aplicacion_id, codigo_permiso)
);

-- -----------------------------------------------------------------------------
-- 4. Tabla: ruta_permiso_requerido (Asociación Ruta <-> Permiso con FK Compuesta)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ruta_permiso_requerido (
  aplicacion_id UUID NOT NULL,
  ruta_id UUID NOT NULL,
  permiso_id UUID NOT NULL,
  accion_crud_requerida VARCHAR(16) NOT NULL DEFAULT 'LEER',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_ruta_permiso_requerido PRIMARY KEY (ruta_id, permiso_id),
  CONSTRAINT fk_ruta_permiso_ruta_app FOREIGN KEY (aplicacion_id, ruta_id)
    REFERENCES ruta_catalogo (aplicacion_id, ruta_id) ON DELETE CASCADE,
  CONSTRAINT fk_ruta_permiso_permiso_app FOREIGN KEY (aplicacion_id, permiso_id)
    REFERENCES permiso_atomico (aplicacion_id, permiso_id) ON DELETE CASCADE,
  CONSTRAINT chk_ruta_accion_crud CHECK (
    accion_crud_requerida IN ('CREAR', 'LEER', 'EDITAR', 'ELIMINAR', 'CUALQUIERA')
  )
);

-- -----------------------------------------------------------------------------
-- 5. Tabla: rol (Roles de Negocio por Aplicación)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rol (
  rol_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  codigo_rol VARCHAR(80) NOT NULL,
  nombre_visible VARCHAR(160) NOT NULL,
  descripcion TEXT NULL,
  es_rol_sistema BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rol_app_id_compuesto UNIQUE (aplicacion_id, rol_id),
  CONSTRAINT uq_rol_app_codigo UNIQUE (aplicacion_id, codigo_rol)
);

-- -----------------------------------------------------------------------------
-- 6. Tabla: rol_permiso (Relación Rol <-> Permiso con Capacidades CRUD Aditivas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rol_permiso (
  aplicacion_id UUID NOT NULL,
  rol_id UUID NOT NULL,
  permiso_id UUID NOT NULL,
  puede_crear BOOLEAN NOT NULL DEFAULT FALSE,
  puede_leer BOOLEAN NOT NULL DEFAULT TRUE,
  puede_editar BOOLEAN NOT NULL DEFAULT FALSE,
  puede_eliminar BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_rol_permiso PRIMARY KEY (rol_id, permiso_id),
  CONSTRAINT fk_rol_permiso_rol_app FOREIGN KEY (aplicacion_id, rol_id)
    REFERENCES rol (aplicacion_id, rol_id) ON DELETE CASCADE,
  CONSTRAINT fk_rol_permiso_permiso_app FOREIGN KEY (aplicacion_id, permiso_id)
    REFERENCES permiso_atomico (aplicacion_id, permiso_id) ON DELETE CASCADE,
  CONSTRAINT chk_rol_permiso_al_menos_un_crud CHECK (
    puede_crear OR puede_leer OR puede_editar OR puede_eliminar
  )
);

-- -----------------------------------------------------------------------------
-- 7. Tabla: perfil (Agrupación Reutilizable de Roles — RF-AUZ-04)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfil (
  perfil_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  codigo_perfil VARCHAR(80) NOT NULL,
  nombre_visible VARCHAR(160) NOT NULL,
  descripcion TEXT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_perfil_app_id_compuesto UNIQUE (aplicacion_id, perfil_id),
  CONSTRAINT uq_perfil_app_codigo UNIQUE (aplicacion_id, codigo_perfil)
);

-- -----------------------------------------------------------------------------
-- 8. Tabla: perfil_rol (Asociación Perfil <-> Rol con FK Compuesta)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfil_rol (
  aplicacion_id UUID NOT NULL,
  perfil_id UUID NOT NULL,
  rol_id UUID NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_perfil_rol PRIMARY KEY (perfil_id, rol_id),
  CONSTRAINT fk_perfil_rol_perfil_app FOREIGN KEY (aplicacion_id, perfil_id)
    REFERENCES perfil (aplicacion_id, perfil_id) ON DELETE CASCADE,
  CONSTRAINT fk_perfil_rol_rol_app FOREIGN KEY (aplicacion_id, rol_id)
    REFERENCES rol (aplicacion_id, rol_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 9. Tabla: grupo_logico (Motor Declarativo RBAC x ABAC con AST JSON)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupo_logico (
  grupo_logico_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  codigo_grupo VARCHAR(80) NOT NULL,
  nombre_visible VARCHAR(160) NOT NULL,
  descripcion TEXT NULL,
  regla_cruce_abac_rbac JSONB NOT NULL,
  prioridad_evaluacion INTEGER NOT NULL DEFAULT 100,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_grupo_app_id_compuesto UNIQUE (aplicacion_id, grupo_logico_id),
  CONSTRAINT uq_grupo_app_codigo UNIQUE (aplicacion_id, codigo_grupo)
);

-- -----------------------------------------------------------------------------
-- 10. Tabla: grupo_logico_rol (Roles Otorgados por Grupo Lógico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupo_logico_rol (
  aplicacion_id UUID NOT NULL,
  grupo_logico_id UUID NOT NULL,
  rol_id UUID NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_grupo_logico_rol PRIMARY KEY (grupo_logico_id, rol_id),
  CONSTRAINT fk_gl_rol_grupo_app FOREIGN KEY (aplicacion_id, grupo_logico_id)
    REFERENCES grupo_logico (aplicacion_id, grupo_logico_id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_rol_rol_app FOREIGN KEY (aplicacion_id, rol_id)
    REFERENCES rol (aplicacion_id, rol_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 11. Tabla: grupo_logico_perfil (Perfiles Otorgados por Grupo Lógico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupo_logico_perfil (
  aplicacion_id UUID NOT NULL,
  grupo_logico_id UUID NOT NULL,
  perfil_id UUID NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_grupo_logico_perfil PRIMARY KEY (grupo_logico_id, perfil_id),
  CONSTRAINT fk_gl_perfil_grupo_app FOREIGN KEY (aplicacion_id, grupo_logico_id)
    REFERENCES grupo_logico (aplicacion_id, grupo_logico_id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_perfil_perfil_app FOREIGN KEY (aplicacion_id, perfil_id)
    REFERENCES perfil (aplicacion_id, perfil_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 12. Tabla: usuario_rol_aplicacion (Asignación Nominal Directa de Rol o Perfil)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_rol_aplicacion (
  asignacion_rol_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_interno UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  cuenta_id UUID NULL,
  aplicacion_id UUID NOT NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  rol_id UUID NULL,
  perfil_id UUID NULL,
  codigo_zona_acotado VARCHAR(4) NULL,
  codigo_distrito_acotado VARCHAR(8) NULL,
  codigo_circuito_acotado VARCHAR(12) NULL,
  codigo_amie_acotado VARCHAR(8) NULL REFERENCES catalogo_territorio_sede(codigo_amie) ON DELETE RESTRICT,
  fecha_inicio_vigencia DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin_vigencia DATE NULL,
  motivo_asignacion VARCHAR(255) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  asignado_por UUID NOT NULL REFERENCES persona_identidad(id_interno) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ura_cuenta_persona FOREIGN KEY (cuenta_id, id_interno)
    REFERENCES cuenta_institucional (cuenta_id, id_interno) ON DELETE RESTRICT,
  CONSTRAINT fk_ura_rol_app FOREIGN KEY (aplicacion_id, rol_id)
    REFERENCES rol (aplicacion_id, rol_id) ON DELETE CASCADE,
  CONSTRAINT fk_ura_perfil_app FOREIGN KEY (aplicacion_id, perfil_id)
    REFERENCES perfil (aplicacion_id, perfil_id) ON DELETE CASCADE,
  CONSTRAINT chk_ura_rol_xor_perfil CHECK (
    (rol_id IS NOT NULL AND perfil_id IS NULL)
    OR
    (rol_id IS NULL AND perfil_id IS NOT NULL)
  ),
  CONSTRAINT chk_ura_vigencia_coherente CHECK (
    fecha_fin_vigencia IS NULL OR fecha_fin_vigencia >= fecha_inicio_vigencia
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_rol_ambito_activo
  ON usuario_rol_aplicacion NULLS NOT DISTINCT (
    id_interno,
    cuenta_id,
    aplicacion_id,
    rol_id,
    perfil_id,
    codigo_zona_acotado,
    codigo_distrito_acotado,
    codigo_circuito_acotado,
    codigo_amie_acotado
  )
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_usuario_rol_app_activo
  ON usuario_rol_aplicacion (id_interno, aplicacion_id, activo);

-- -----------------------------------------------------------------------------
-- 13. Tabla: credencial_m2m (Clientes OAuth 2.0 client_credentials SHA-256)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credencial_m2m (
  credencial_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacion_id UUID NULL REFERENCES aplicacion(aplicacion_id) ON DELETE CASCADE,
  tipo_cliente VARCHAR(24) NOT NULL DEFAULT 'APLICACION_PATRON_1',
  client_id VARCHAR(128) NOT NULL UNIQUE,
  secreto_activo_hash CHAR(64) NOT NULL,
  secreto_anterior_hash CHAR(64) NULL,
  gracia_hasta TIMESTAMPTZ NULL,
  expira_rotacion_en TIMESTAMPTZ NOT NULL,
  scopes_permitidos VARCHAR(255) NOT NULL DEFAULT 'pdp:evaluate',
  estado_credencial VARCHAR(24) NOT NULL DEFAULT 'ACTIVA',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_m2m_tipo_cliente CHECK (
    tipo_cliente IN ('APLICACION_PATRON_1', 'PEP_PATRON_2')
  ),
  CONSTRAINT chk_m2m_scope_por_tipo CHECK (
    (tipo_cliente = 'APLICACION_PATRON_1' AND aplicacion_id IS NOT NULL)
    OR
    (tipo_cliente = 'PEP_PATRON_2' AND aplicacion_id IS NULL)
  ),
  CONSTRAINT chk_m2m_estado_credencial CHECK (
    estado_credencial IN ('ACTIVA', 'EN_ROTACION_GRACIA', 'REVOCADA')
  ),
  CONSTRAINT chk_m2m_gracia_coherente CHECK (
    (estado_credencial = 'EN_ROTACION_GRACIA' AND secreto_anterior_hash IS NOT NULL AND gracia_hasta IS NOT NULL)
    OR
    (estado_credencial IN ('ACTIVA', 'REVOCADA'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credencial_m2m_aplicacion
  ON credencial_m2m (aplicacion_id)
  WHERE aplicacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credencial_m2m_estado
  ON credencial_m2m (estado_credencial);

-- -----------------------------------------------------------------------------
-- 14. Ampliación de CHECKs en auditoria_evento (Capa 1 AlloyDB) para PDP_MOTOR
-- -----------------------------------------------------------------------------
ALTER TABLE auditoria_evento DROP CONSTRAINT IF EXISTS auditoria_evento_tipo_evento_check;
ALTER TABLE auditoria_evento DROP CONSTRAINT IF EXISTS chk_auditoria_tipo_evento;
ALTER TABLE auditoria_evento ADD CONSTRAINT chk_auditoria_tipo_evento CHECK (
  tipo_evento IN (
    'IDENTIDAD_SINCRONIZADA',
    'IDENTIDAD_CREADA',
    'IDENTIDAD_ACTUALIZADA',
    'IDENTIDAD_SUSPENDIDA',
    'IDENTIDAD_ELIMINADA',
    'PERSONA_DESACTIVADA',
    'CREACION_IDENTIDAD',
    'CONSOLIDACION_CUENTA',
    'TRANSICION_CODIGO_A_CEDULA',
    'INTENTO_MUTACION_CEDULA_RECHAZADO',
    'RECHAZO_MUTACION_CEDULA',
    'RECHAZO_RUC_SOCIETARIO',
    'REGISTRO_CALIENTE_CREADO',
    'REGISTRO_CALIENTE_PROVISIONAL',
    'REGISTRO_CALIENTE_UNIFICADO',
    'REGISTRO_CALIENTE_FUSIONADO',
    'REGISTRO_CALIENTE_PROMOVIDO',
    'REGISTRO_CALIENTE_JIT',
    'ANOMALIA_DETECTADA',
    'ANOMALIA_ABIERTA',
    'ANOMALIA_RESUELTA',
    'ANOMALIA_AUTO_RESUELTA',
    'APERTURA_ANOMALIA',
    'RESOLUCION_ANOMALIA',
    'ASIGNACION_CONTEXTO_CREADA',
    'ASIGNACION_CONTEXTO_MODIFICADA',
    'ASIGNACION_CONTEXTO_DESACTIVADA',
    'CACHE_INVALIDADO',
    'REVOCACION_CACHE',
    'CATALOGO_ACTUALIZADO',
    'CAMBIO_ESTADO_SINCRONIZACION',
    'SINCRONIZACION_INCREMENTAL',
    'CONCILIACION_MASIVA',
    'CONCILIACION_PARTICION_COMPLETADA',
    'CONCILIACION_PARTICION_RECLAMADA',
    'EVENTO_DLQ_REGISTRADO',
    'EVENTO_DLQ_REPROCESADO',
    'DESPACHO_DLQ_SINCRONIZACION',
    'OIDC_AUTHORIZE_INICIADO',
    'OIDC_FEDERACION_GOOGLE_EXITOSA',
    'OIDC_ID_TOKEN_EMITIDO',
    'OIDC_REGISTRO_CALIENTE_PENDIENTE_BLOQUEADO',
    'OIDC_RECHAZO_SEGURIDAD',
    'OIDC_SLO_EJECUTADO',
    'OIDC_SESION_REVOCADA_PUBSUB',
    'OIDC_JWKS_ROTADO',
    'OIDC_JWKS_REVOCADO_EMERGENCIA',
    'OIDC_LOGIN_EXITOSO',
    'OIDC_LOGIN_RECHAZADO_DOMINIO',
    'OIDC_LOGIN_RECHAZADO_ESTADO',
    'OIDC_TOKEN_EMITIDO',
    'OIDC_LOGOUT_EJECUTADO',
    'OIDC_CODIGO_REPLAY_DETECTADO',
    'JWKS_ROTACION_EJECUTADA',
    'JWKS_REVOCACION_EMERGENCIA',
    'PDP_EVALUACION_PERMIT',
    'PDP_EVALUACION_DENY',
    'PDP_EVALUACION_SHADOW_PERMIT',
    'PDP_TOKEN_M2M_EMITIDO',
    'PDP_TOKEN_M2M_RECHAZADO',
    'PDP_CACHE_INVALIDADO_PUBSUB',
    'PDP_RECHAZO_SEGURIDAD_RUTA',
    'PDP_JWKS_ROTADO',
    'PDP_JWKS_REVOCADO_EMERGENCIA'
  )
);

COMMIT;
