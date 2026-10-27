# Checklist de Calidad y Seguridad Constitucional — Feature `005-autenticacion-m2m-rotacion`

**Propósito**: Verificar la completitud, claridad, consistencia y cumplimiento de la Constitución MINEDEC v2.11.0 para la especificación e implementación de `005-autenticacion-m2m-rotacion`.  
**Fecha**: 2026-10-26  
**Referencia**: [`spec.md`](../spec.md) | [`plan.md`](../plan.md) | [`research.md`](../research.md)

## Calidad de Contenido y Especificación

- [x] Sin detalles de implementación filtrados en la sección de Historias de Usuario de `spec.md`.
- [x] Redacción 100 % en español con vocabulario institucional MINEDEC.
- [x] Conceptos OKF (`knowledge/index.md`) citados explícitamente en `spec.md`.
- [x] Documentación oficial de Google Cloud verificada y citada con identificadores `documents/...` de `google-developer-knowledge` en `research.md` y `plan.md`.
- [x] Cero marcadores `[NEEDS CLARIFICATION]` pendientes.

## Ciberseguridad, Criptografía y Cumplimiento Constitucional (v2.11.0)

- [x] **CHK-001 (Zero Secret en Base de Datos)**: `credencial_m2m` almacena únicamente resúmenes `SHA-256` de 64 caracteres (`secreto_activo_hash` y `secreto_anterior_hash`), jamás secretos en texto plano.
- [x] **CHK-002 (Comparación en Tiempo Constante)**: Validación de `client_secret` ejecutada con `crypto.timingSafeEqual` sobre buffers de longitud fija.
- [x] **CHK-003 (Rotación Dual `<= 90 días`)**: Invariante de expiración máxima de 90 días y ventana de gracia dual (`EN_ROTACION_GRACIA` con `gracia_hasta`) tanto en credenciales M2M como en llaves JWKS (`GRACIA_VERIFICACION`).
- [x] **CHK-004 (Revocación Efectiva `<= 300 s`)**: Al revocar una credencial M2M (`REVOCADA`), los `access_token` Bearer en vuelo son rechazados inmediatamente en `POST /api/v1/access/evaluation` sin esperar a que venza su `TTL` de `3600 s`.
- [x] **CHK-005 (Segregación de Dominio Criptográfico JWKS `DA-11`)**: `motor-pdp` publica y administra exclusivamente llaves con `servicio_emisor = 'MOTOR_PDP'`, sin exponer ni alterar llaves de `SSO_OIDC`.
- [x] **CHK-006 (Inyección de Dependencias Limpia)**: `domain/` y `application/` 100 % libres de decoradores (`@injectable`, `@inject`), configurando InversifyJS únicamente en `src/container.ts`.
- [x] **CHK-007 (Cero Telemetría de Latencia en Node.js)**: Ningún endpoint calcula ni expone campos `latency_ms` / `duration_ms`.
- [x] **CHK-008 (Consultas SQL 100 % Parametrizadas)**: Uso estricto de `$1, $2...` y `assertSafeSqlIdentifier`.
- [x] **CHK-009 (Auditoría Inmutable `SHA-256`)**: Todos los eventos del ciclo de vida M2M y JWKS se registran en `auditoria_evento` con encadenamiento `SHA-256`.
