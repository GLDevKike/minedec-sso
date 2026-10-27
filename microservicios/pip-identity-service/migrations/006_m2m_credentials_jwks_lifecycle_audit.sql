-- =============================================================================
-- Migración 006: Ciclo de Vida Completo de Credenciales M2M, Rotación Dual y Retiro JWKS
-- Feature 005 (`005-autenticacion-m2m-rotacion`) — Subcomponente C2.2 Conecta MINEDEC
-- Motor: AlloyDB for PostgreSQL 16 (1FN / 3FN / BCNF)
-- Fuente Canónica: docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml
-- =============================================================================

BEGIN;

-- 1. Ajustar ck_m2m_rotacion_90_dias para permitir rotaciones subsecuentes respecto a actualizado_en (<= 90 días)
ALTER TABLE credencial_m2m
  DROP CONSTRAINT IF EXISTS ck_m2m_rotacion_90_dias;

ALTER TABLE credencial_m2m
  ADD CONSTRAINT ck_m2m_rotacion_90_dias CHECK (
    expira_rotacion_en <= GREATEST(creado_en, actualizado_en) + INTERVAL '90 days'
  );

-- 2. Índices compuestos adicionales para barrido de expiración de gracia y rotación de credenciales M2M y llaves JWKS
CREATE INDEX IF NOT EXISTS idx_credencial_m2m_gracia_hasta
  ON credencial_m2m (estado_credencial, gracia_hasta)
  WHERE estado_credencial = 'EN_ROTACION_GRACIA';

CREATE INDEX IF NOT EXISTS idx_llave_jwks_emisor_expiracion
  ON llave_jwks_rotacion (servicio_emisor, estado_llave, expira_rotacion_en);

-- 3. Ampliación de eventos de auditoría forense transaccional (`auditoria_evento`)
--    para cubrir provisión, rotación dual, cierre de gracia y revocación de credenciales M2M y retiro JWKS
ALTER TABLE auditoria_evento
  DROP CONSTRAINT IF EXISTS ck_auditoria_tipo_evento;

ALTER TABLE auditoria_evento
  ADD CONSTRAINT ck_auditoria_tipo_evento CHECK (
    tipo_evento IN (
      'IDENTIDAD_SINCRONIZADA',
      'IDENTIDAD_SUSPENDIDA',
      'IDENTIDAD_ELIMINADA',
      'PERSONA_DESACTIVADA',
      'TRANSICION_CODIGO_A_CEDULA',
      'INTENTO_MUTACION_CEDULA_RECHAZADO',
      'REGISTRO_CALIENTE_CREADO',
      'REGISTRO_CALIENTE_UNIFICADO',
      'ANOMALIA_DETECTADA',
      'ANOMALIA_RESUELTA',
      'ASIGNACION_CONTEXTO_CREADA',
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
      'OIDC_JWKS_REVOCADO_EMERGENCIA',
      'PDP_EVALUACION_PERMIT',
      'PDP_EVALUACION_DENY',
      'PDP_EVALUACION_SHADOW_PERMIT',
      'PDP_TOKEN_M2M_EMITIDO',
      'PDP_TOKEN_M2M_RECHAZADO',
      'PDP_CREDENCIAL_M2M_CREADA',
      'PDP_CREDENCIAL_M2M_ROTADA',
      'PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA',
      'PDP_CREDENCIAL_M2M_REVOCADA',
      'PDP_CACHE_INVALIDADO_PUBSUB',
      'PDP_RECHAZO_SEGURIDAD_RUTA',
      'PDP_JWKS_ROTADO',
      'PDP_JWKS_RETIRADO',
      'PDP_JWKS_REVOCADO_EMERGENCIA'
    )
  );

COMMIT;
