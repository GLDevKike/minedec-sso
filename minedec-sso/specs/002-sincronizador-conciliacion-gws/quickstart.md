# Quickstart & Guía de Verificación: Sincronizador de Identidades en Solo Lectura y Conciliación Masiva desde Google Workspace

**Feature**: `002-sincronizador-conciliacion-gws` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/002-sincronizador-conciliacion-gws/spec.md) | **Data Model**: [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/002-sincronizador-conciliacion-gws/data-model.md) | **OpenAPI Contract**: [sync-reconciliation-api.openapi.yaml](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/002-sincronizador-conciliacion-gws/contracts/sync-reconciliation-api.openapi.yaml)

---

## 1. Requisitos del Entorno de Desarrollo

- **Node.js**: v22 LTS (`node:22-alpine`) y **TypeScript**: v5.8+ (`strict: true`) en repositorios independientes (`../microservicios/shared`, `../microservicios/sincronizador`, `../microservicios/conciliacion-job`)
- **Registro de Paquetes**: GitLab NPM Package Registry (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`) para consumir `@minedec/shared`
- **Base de Datos Local**: PostgreSQL 16 / AlloyDB Omni (puerto `5432`)
- **Caché L2 y Coordinador de Cuotas Local**: Redis 7.x (puerto `6379`)
- **Runner de Pruebas (`Constitución V`)**: `Jest + Supertest` (100 % único runner unitario e integración, cobertura `>= 70 %`)
- **Inyección de Dependencias (`Constitución V` y `VI`)**: `InversifyJS` (`inversify`) configurado exclusivamente en `src/container.ts` (Composition Root) con `decorate(injectable(), ...)` externo, manteniendo `domain/` y `application/` 100 % libres de decoradores.

---

## 2. Inicialización Rápida

```powershell
# 1. Levantar PostgreSQL 16 y Redis 7 para pruebas de integración
docker compose -f docker-compose.dev.yml up -d postgres redis

# 2. Compilar @minedec/shared y ejecutar migraciones DDL estáticas versionadas (incluyendo 003_sync_reconciliation_schema.sql)
Set-Location ..\microservicios\shared
npm ci
npm run build

Set-Location ..\pip-identity-service
npm ci
npm run db:migrate
npm run db:seed:catalogs

# 3. Instalar dependencias y ejecutar suite completa en sincronizador y conciliacion-job (meta >= 70% cobertura)
Set-Location ..\sincronizador
npm ci
npm run test:coverage

Set-Location ..\conciliacion-job
npm ci
npm run test:coverage
```

---

## 3. Escenarios de Verificación Ejecutables

### Escenario 1: Autenticación `Keyless` (`signJwt`) en Modo 100 % Solo Lectura y Protección de Cuota del 70 % (`<= 28 req/s`) con Histéresis de Modo Lote (`US-1`, `FR-001`, `FR-003`, `FR-004`, `FR-005`, `SC-001`)

Verifica que:
- El adaptador `GoogleWorkspaceDirectoryReadOnlyAdapter` (ejecutándose con `sa-sso-sync` o `sa-sso-sync-job`) firme tokens efímeros (`<= 3600 s`) vía `IAM Credentials API signJwt` hacia `sa-workspace-reader` exclusivamente con el scope `https://www.googleapis.com/auth/admin.directory.user.readonly` (`0` llaves JSON descargadas y `0` operaciones de escritura permitidas, `FR-001`, `SC-001`).
- El presupuesto de despacho agregado respete estrictamente el techo del **70 % (`<= 28 req/s`)**, reservando `5 req/s` en `sso-sync-priority-hot-reg` para `REGISTRO_CALIENTE`, `23 req/s` en `sso-sync-incremental` para eventos incrementales (o `20 req/s` para el Job de conciliación masiva `sso-conciliacion-job` + `8 req/s` de reserva en tiempo real cuando hay conciliación activa).
- Cuando la cola incremental acumula **`>= 100` eventos pendientes** o el mensaje más antiguo supera **`> 10 segundos`**, el sincronizador conmute automáticamente de `INDIVIDUAL_GET` (`users.get`) a `LOTE_LIST_500` (`users.list` de hasta 500 cuentas) y solo regrese a `INDIVIDUAL_GET` cuando la cola descienda por debajo de **`< 20` eventos pendientes** (histéresis).
- Los eventos duplicados con el mismo `idEventoExterno` o con marca temporal anterior a `ultima_sincronizacion_en` se ignoren sin realizar escrituras redundantes.

```powershell
npx jest tests/unit/sync/quota-hysteresis-governor.spec.ts
npx jest tests/integration/sync/incremental-sync-and-batch-switch.spec.ts
```

---

### Escenario 2: Baja Lógica Diferenciada en Dos Niveles (`CuentaInstitucional` vs. `PersonaIdentidad`) e Invalidación Reactiva `< 5 s` (`US-1`, `US-3`, `FR-002`, `FR-010`, `FR-011`, `SC-002`)

Verifica que:
1. **Baja o suspensión de una `CuentaInstitucional` específica (`SUSPEND_USER` / `DELETE_USER`)**:
   - Si una persona natural con `idInterno` posee dos cuentas activas (`juan.perez@estudiante.edu.ec` y `juan.perez@docentes.educacion.gob.ec`) y se suspende o elimina únicamente `juan.perez@estudiante.edu.ec`, solo esa cuenta pasa a `SUSPENDIDA_GWS` o `ELIMINADA_GWS` y se purga su caché vía `sso-pip-cache-invalidation` en `< 5 s`, mientras que `juan.perez@docentes.educacion.gob.ec` y la `PersonaIdentidad` continúan `ACTIVA`.
   - Si posteriormente se suspende o elimina la última cuenta activa restante, `PersonaIdentidad` transiciona automáticamente a `INACTIVA`.
2. **Desactivación de usuario raíz (`PersonaIdentidad`)**:
   - Cuando se invoca `POST /api/v1/admin/sync/persons/{idInterno}/deactivate`, la `PersonaIdentidad` pasa a `INACTIVA` (o `BLOQUEADA_ANOMALIA`), **todas** sus `CuentaInstitucional` asociadas en todos los subdominios se desactivan en cascada lógica y todas sus claves en Redis se invalidan en `< 5 segundos` (`TTL <= 300 s` límite duro).

```powershell
npx jest tests/integration/sync/two-level-logical-deactivation.spec.ts
```

---

### Escenario 3: Reconciliación Prioritaria de `REGISTRO_CALIENTE` en Carril Reservado (`<= 5 req/s`, `< 10 s` p95) (`US-2`, `FR-006`, `SC-005`)

Verifica que:
- Aunque la cola incremental ordinaria tenga una ráfaga de cientos de eventos o el Job de conciliación masiva esté activo consumiendo `20 req/s`, las tareas enviadas a `POST /internal/v1/sync/tasks/priority-hot-registration` (cola `sso-sync-priority-hot-reg`) utilicen su reserva dedicada de `5 req/s`.
- Si los 21 atributos `MINEDEC_Perfil` obtenidos de Google Workspace pertenecen a una `PersonaIdentidad` ya existente en otro subdominio, la cuenta provisional se re-vincule al `idInterno` existente y el registro provisional se cierre; si es una persona nueva, se promueva a `ACTIVA`; y si carece de identificación válida, se bloquee con anomalía `SIN_IDENTIFICACION_VALIDA` e invalidación de caché en `< 5 s`.

```powershell
npx jest tests/integration/sync/priority-hot-registration-reconcile.spec.ts
```

---

### Escenario 4: Conciliación Masiva Particionada (`CheckpointConciliacion`), Comparación por `hash_payload_gws` y Recuperación de Particiones Huérfanas (`> 15 min`) (`US-3`, `US-4`, `FR-007`, `FR-008`, `FR-009`, `SC-003`, `SC-004`)

Verifica que:
- `../microservicios/conciliacion-job` (`sso-conciliacion-job`) procese particiones `(dominio, org_unit_path, tipo_proceso)` en páginas de 500 cuentas respetando el tope de `20 req/s`, omitiendo escrituras cuando `hash_payload_gws` (SHA-256) no ha cambiado (`cuentas_omitidas_hash`, `FR-009`) y persistiendo `next_page_token` y `heartbeat_en` en cada página.
- Dos workers concurrentes no puedan procesar la misma partición simultáneamente gracias a `pg_try_advisory_lock(lock_advisory_key)` (`HTTP 409 Conflict` si el latido tiene `<= 15 minutos`).
- Si un worker se interrumpe o su `heartbeat_en` supera `> 15 minutos` de inactividad, el siguiente worker reclame automáticamente la partición huérfana, reanude exactamente desde el último `next_page_token` confirmado (`0` páginas reprocesadas desde cero, `SC-004`) y emita el diagnóstico operativo en español.
- Al completar todas las páginas de una partición (`next_page_token IS NULL`), las cuentas locales de esa partición que ya no existan en Google Workspace se marquen en baja lógica (`ELIMINADA_GWS`) aplicando la regla diferenciada de dos niveles.

```powershell
npx jest tests/integration/sync/partitioned-reconciliation-checkpoint.spec.ts
```

---

### Escenario 5: Retroceso Exponencial con `Jitter`, Derivación a `DLQ`, Diagnóstico en Lenguaje Natural y Reprocesamiento Regulado con Protección de Obsolescencia (`US-5`, `FR-012`, `FR-013`, `FR-014`, `FR-015`, `SC-006`, `SC-007`)

Verifica que:
- Ante errores `429` o `503` de Google Workspace, el cliente aplique espera exponencial `(2^intento) s + jitter(0..1000 ms)` y respete `Retry-After` hasta `5` intentos.
- Al agotarse el 5.º intento, el evento se registre en `registro_fallo_sincronizacion` (`estado_dlq = 'PENDIENTE_REVISION'`) y se publique en `sso-sync-dlq` con su diagnóstico en lenguaje natural en español (`diagnostico_lenguaje_natural` y `accion_recomendada`) sin detener los demás eventos de la cola.
- Al invocar `POST /api/v1/admin/sync/dlq/replay`, los eventos se re-encolen por el canal regulado (`<= 28 req/s`): si la cuenta ya fue actualizada por un evento o conciliación más reciente (`ultima_sincronizacion_en > timestamp_evento_gws`), el registro se cierre automáticamente como `RESUELTO_POR_OBSOLESCENCIA` sin sobrescribir los datos vigentes; de lo contrario, consulte el estado actual en vivo en Google Workspace y pase a `RESUELTO_REPROCESADO`.

```powershell
npx jest tests/integration/sync/dlq-resilience-and-replay.spec.ts
```

---

### Escenario 6: Paridad de Esquema Relacional 3FN (`003_sync_reconciliation_schema.sql`), Contenedores `Non-Root`, Observabilidad Unificada GKE + Cloud Run e Infraestructura en 3 Capas en `iac-terraform` (`Constitución v2.11.0`)

Verifica que:
1. Las tablas nuevas (`checkpoint_conciliacion`, `evento_sincronizacion_procesado`, `registro_fallo_sincronizacion`) y las extensiones a `cuenta_institucional` y `auditoria_evento` coincidan 1:1 entre `migrations/003_sync_reconciliation_schema.sql`, `docs/esquemas-bd/etapa-1-identidad-pip-auditoria.dbml` y `ALLOWED_PIP_SQL_IDENTIFIERS`.
2. `../microservicios/sincronizador/src/container.ts` y `../microservicios/conciliacion-job/src/container.ts` resuelvan todas sus dependencias con `InversifyJS` manteniendo `domain/` y `application/` 100 % libres de decoradores.
3. `PinoStructuredLogger` detecte automáticamente el runtime (`GKE_AUTOPILOT`, `CLOUD_RUN_SERVICE` vía `K_SERVICE`/`K_REVISION`, o `CLOUD_RUN_JOB` vía `CLOUD_RUN_JOB`/`CLOUD_RUN_EXECUTION`), propague el contexto de traza distribuida OpenTelemetry (`traceparent`, `X-Cloud-Trace-Context`, `X-Trace-Id`) entre GKE, Cloud Tasks y Cloud Run, y `syncErrorHandler` emita diagnósticos en español (`diagnosticoAdministrador`).
4. Los `Dockerfile` de `../microservicios/sincronizador` y `../microservicios/conciliacion-job` usen `node:22-alpine` y ejecuten con `USER node`, consuman `@minedec/shared` desde el GitLab NPM Package Registry mediante `.gitlab-ci.yml` (`gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com`), y el repositorio `../iac-terraform` valide limpiamente (`terraform fmt -check` y `scripts/bundle.sh`) las 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) con Direct VPC Egress hacia la Shared VPC (`mec-003-sha-net-*`), cuentas de servicio (`sa-sso-sync`, `sa-sso-sync-job`, `sa-workspace-reader`, `sa-infra-manager`) y alertas SRE unificadas GKE + Cloud Run (`cloud-run-alert-configuration`).

```powershell
npx jest tests/unit/sql-schema-alignment.spec.ts
npx jest tests/unit/container-wiring.spec.ts
npx jest tests/unit/devops-iac-alignment.spec.ts
npx jest tests/unit/sync/observability-trace-error.spec.ts
```
