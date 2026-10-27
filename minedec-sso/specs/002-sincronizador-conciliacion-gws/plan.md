# Implementation Plan: Sincronizador de Identidades en Solo Lectura y Conciliación Masiva desde Google Workspace

**Branch**: `spec/002-sincronizador-conciliacion-gws` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/002-sincronizador-conciliacion-gws/spec.md)

**Input**: Feature specification from `/specs/002-sincronizador-conciliacion-gws/spec.md`

**Note**: Este plan técnico ha sido generado y actualizado mediante el flujo `/speckit-plan` en estricto apego a `.specify/memory/constitution.md` (Constitución MINEDEC v2.11.0) y a la base de conocimiento OKF (`knowledge/index.md`, en especial `knowledge/arquitectura/sincronizacion-identidades-cuotas.md`, `knowledge/dominio/identidad-esquema-minedec-perfil.md` y `knowledge/arquitectura/componentes-pdp-core.md`).

## Summary

Implementar el **Sincronizador de Identidades en Solo Lectura (`../microservicios/sincronizador`, Cloud Run Service `sso-sincronizador`)** y el **Job de Carga Inicial y Conciliación Masiva (`../microservicios/conciliacion-job`, Cloud Run Job `sso-conciliacion-job`)** del Subcomponente C2.2 (**Sistema de Autenticación Centralizado SSO / Conecta MINEDEC**) hacia el Repositorio Central de Identidades (**Policy Information Point — PIP** en AlloyDB for PostgreSQL 16 y Memorystore for Redis), operando 100 % en modo de solo lectura sobre el único tenant institucional de Google Workspace (`admin.directory.user.readonly` mediante delegación de dominio sin llaves JSON `IAM Credentials API signJwt` hacia `sa-workspace-reader`), bajo el modelo constitucional de **arquitectura multirrepositorio en GitLab (`git.sitimapa.co`) sincronizada en la rama `spec/002-sincronizador-conciliacion-gws`**:

1. **En los repositorios independientes de código (`c2-sso/microservicios/{shared,sincronizador,conciliacion-job}` en `../microservicios/*`, gobernados desde `minedec-sso`)**:
   - **Consumo de `@minedec/shared` desde GitLab NPM Package Registry**: Tanto `../microservicios/sincronizador` como `../microservicios/conciliacion-job` consumen el paquete transversal `@minedec/shared` (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`) y se compilan, escanean y publican mediante pipelines independientes `.gitlab-ci.yml` ejecutados por `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (metadata server, cero llaves JSON) hacia Artifact Registry (`sso-containers:$CI_COMMIT_SHA`).
   - **`../microservicios/sincronizador` (Cloud Run Service interno `sso-sincronizador` — `sa-sso-sync`)**: Recibe eventos push de Cloud Pub/Sub (`sso-gws-directory-events`) desde el sink organizacional de Google Workspace Admin Audit Logs (`CREATE_USER`, `CHANGE_USER`, `SUSPEND_USER`, `UNSUSPEND_USER`, `DELETE_USER`), deduplica de forma idempotente por `idEventoExterno` (`Redis L2` + `evento_sincronizacion_procesado`), y despacha la sincronización respetando estrictamente el **techo del 70 % de la cuota oficial (`<= 28 req/s` sobre `40 req/s`, `R-02`)** mediante un gobernador de tasa distribuido en Redis con doble carril en tiempo real (`<= 5 req/s` reservados en `sso-sync-priority-hot-reg` para la reconciliación prioritaria de identidades provisionales `REGISTRO_CALIENTE` y `<= 23 req/s` en `sso-sync-incremental` para eventos incrementales ordinarios, ajustándose dinámicamente a `8 req/s` de reserva en tiempo real + `20 req/s` para el job masivo cuando hay conciliación en curso). Conmuta automáticamente de lectura individual (`users.get`) a lectura por lotes (`users.list` de hasta 500 cuentas) con histéresis (`>= 100` eventos pendientes o antigüedad `> 10 s` para activar modo lote; `< 20` pendientes para restaurar modo individual), ejecuta el barrido delta cada 2 minutos, aplica la **baja lógica diferenciada en dos niveles** (suspender/eliminar una `CuentaInstitucional` solo afecta a esa cuenta e invalida su caché vía `sso-pip-cache-invalidation` sin afectar otras cuentas activas de la misma `PersonaIdentidad`, pasando `PersonaIdentidad` a `INACTIVA` únicamente si quedan `0` cuentas activas; mientras que desactivar la `PersonaIdentidad` raíz desactiva e invalida en cascada todas sus cuentas en todos los subdominios garantizando el techo duro `<= 300 s`), y gestiona reintentos con retroceso exponencial + `jitter` hasta 5 intentos antes de derivar a la bandeja `DLQ` (`registro_fallo_sincronizacion` y tópico `sso-sync-dlq`) con diagnósticos en lenguaje natural en español y reprocesamiento regulado con validación de obsolescencia (`RESUELTO_POR_OBSOLESCENCIA`). Incorpora **trazabilidad distribuida OpenTelemetry de extremo a extremo (`W3C traceparent` + `X-Cloud-Trace-Context` + `X-Trace-Id`)**, **logging estructurado `pino` con autodetección de plataforma (`GKE_AUTOPILOT` vs `CLOUD_RUN_SERVICE` vs `CLOUD_RUN_JOB`)**, **manejo centralizado de errores (`syncErrorHandler`)**, y **prohibición estricta de calcular o retornar duraciones por petición (`Date.now() - startedAt`, `latenciaTotalMs`, `latenciaMs`) en Node.js conforme a `RNF-REN-01..06`, Principio V.4 y Principio XIII**.
   - **`../microservicios/conciliacion-job` (Cloud Run Job `sso-conciliacion-job` — `sa-sso-sync-job`)**: Ejecuta la carga inicial y la conciliación nocturna masiva (`01:00 AM America/Guayaquil`) para ~2,28 millones de cuentas particionadas por `(dominio, org_unit_path, tipo_proceso)` a un ritmo de hasta `20 req/s` en páginas de 500 usuarios (`~4.560 llamadas`, `SC-003`), comparando la huella `SHA-256` (`hash_payload_gws`) para omitir escrituras sin cambios (`FR-009`), persistiendo transaccionalmente cada `next_page_token` en `checkpoint_conciliacion` con bloqueo de exclusión mutua por partición (`pg_try_advisory_lock`) y reclamando automáticamente particiones huérfanas cuyo latido (`heartbeat_en`) supere `> 15 minutos` sin reiniciar desde cero (`SC-004`), envolviendo la ejecución en un span OpenTelemetry correlacionado (`withOtelSpan`) con `CLOUD_RUN_JOB` y `CLOUD_RUN_EXECUTION` y emitiendo diagnósticos en lenguaje natural en español (`FR-015`, `SC-007`).
2. **En el repositorio central de infraestructura (`c2-sso/devops/iac-terraform` en `../iac-terraform`)**: Extiende en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** estructurado en **3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`)**, empaquetado con `scripts/bundle.sh` y gobernado por **Google Cloud Infrastructure Manager (`config.googleapis.com` vía `sa-infra-manager@<project_id>.iam.gserviceaccount.com`)** desde `.gitlab-ci.yml`:
   - En `plantillas/devops`: las cuentas de servicio estandarizadas `sa-sso-sync`, `sa-sso-sync-job` y `sa-workspace-reader` (con `roles/iam.serviceAccountTokenCreator` para `signJwt`).
   - En `modulos/pubsub_cloud_tasks_sync` y `plantillas/data`: tópicos `sso-gws-directory-events` y `sso-sync-dlq`, y colas `sso-sync-priority-hot-reg` (`5 req/s`) y `sso-sync-incremental` (`23 req/s`).
   - En `modulos/cloud_run_sincronizador`, `modulos/cloud_run_conciliacion_job` y `plantillas/apps`: el Cloud Run Service `sso-sincronizador` (`INGRESS_TRAFFIC_INTERNAL_ONLY`) y el Cloud Run Job `sso-conciliacion-job` conectados mediante **Direct VPC Egress** a las subredes autorizadas de la **Shared VPC** en los proyectos host (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) desde los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`), junto con los triggers Cloud Scheduler y las alertas SRE en `modulos/monitoring`.

## Technical Context

**Language/Version**: TypeScript 5.8+ (`strict: true`) sobre Node.js 22 LTS en repositorios independientes de GitLab (`../microservicios/shared`, `../microservicios/sincronizador` y `../microservicios/conciliacion-job`; imagen base `node:22-alpine` multi-stage `non-root`); Arquitectura Hexagonal + principios **SOLID** + **DRY** (`@minedec/shared` publicado en GitLab NPM Package Registry) + **Inyección de Dependencias con `InversifyJS` configurado exclusivamente en el Composition Root (`container.ts`, sin decoradores en Dominio/Aplicación)**; **Terraform `1.5.7` (HCL puro, sin Terragrunt)** en el repositorio separado `../iac-terraform` en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`).

**Primary Dependencies**: Express 5 (100 % único framework HTTP para `../microservicios/sincronizador`), `@minedec/shared` (consumido desde GitLab NPM Package Registry), `inversify` (contenedor IoC/DI configurado exclusivamente en `container.ts`), `zod` (validación estricta de eventos de auditoría GWS, payloads de Cloud Tasks, umbrales de cuota/histéresis y los 21 atributos `MINEDEC_Perfil`), `jose` (verificación de tokens internos y construcción de claims JWT), `pg` + `pg-format` (cliente AlloyDB con consultas 100 % parametrizadas `$1, $2`, lista blanca `safe_sql_identifier` y bloqueos consultivos `pg_try_advisory_lock`), `ioredis` (caché L2 con `TTL <= 300 s`, deduplicación y gobernador distribuido de cuota de `28 req/s`), `helmet`, `@google-cloud/pubsub`, `@google-cloud/tasks`, `@google-cloud/secret-manager`, `pino` (logging estructurado JSON compatible con Cloud Logging + OpenTelemetry y redacción Zero-Secret).

**Storage**: AlloyDB for PostgreSQL 16 sobre la Shared VPC (tablas existentes del PIP en 3FN + tablas `checkpoint_conciliacion`, `evento_sincronizacion_procesado`, `registro_fallo_sincronizacion` y columna `hash_payload_gws` en `cuenta_institucional` en `migrations/003_sync_reconciliation_schema.sql`, más bitácora inmutable `auditoria_evento` append-only con cadena SHA-256), Memorystore for Redis (caché L2 de identidades `minedec:pip:*` con `TTL <= 300 s` y estado operativo de cuota/histéresis/deduplicación `minedec:sync:*`), Cloud Storage (estado Terraform en Infrastructure Manager y archivo forense WORM), Cloud Logging y BigQuery.

**Testing**: Jest + Supertest (100 % único runner unitario e integración con cobertura `>= 70 %`), incluyendo pruebas de gobernador de cuota del 70 % (`<= 28 req/s`: reparto `5 + 23` y reparto con job masivo `20 + 8`), conmutación automática a modo lote con histéresis (`>= 100` / `> 10 s` hacia `LOTE_LIST_500` y `< 20` hacia `INDIVIDUAL_GET`), baja lógica diferenciada en dos niveles (`CuentaInstitucional` vs `PersonaIdentidad`), reconciliación prioritaria de `REGISTRO_CALIENTE` (`<= 5 req/s`), conciliación particionada con `pg_try_advisory_lock` y reclamo de particiones huérfanas (`heartbeat > 15 min`), retroceso exponencial con `jitter` + derivación y reprocesamiento controlado de `DLQ` con protección de obsolescencia (`RESUELTO_POR_OBSOLESCENCIA`), paridad 1:1 SQL/DBML (`sql-schema-alignment.spec.ts`) y validación estática de Terraform en 3 capas (`devops-iac-alignment.spec.ts`).

**Target Platform**: Google Cloud Platform — Proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`) conectados vía **Direct VPC Egress** a la Red Compartida (Shared VPC) de los proyectos host (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`). Cloud Run Service (`sso-sincronizador` con `sa-sso-sync` e `INGRESS_TRAFFIC_INTERNAL_ONLY`), Cloud Run Job (`sso-conciliacion-job` con `sa-sso-sync-job`), delegación de dominio sin llaves hacia `sa-workspace-reader` (`IAM Credentials API signJwt`), Cloud Pub/Sub (`sso-gws-directory-events`, `sso-sync-dlq`, `sso-pip-cache-invalidation`), Cloud Tasks (`sso-sync-priority-hot-reg`, `sso-sync-incremental`), Cloud Scheduler, Memorystore for Redis, AlloyDB for PostgreSQL 16, Secret Manager, Artifact Registry (`sso-containers`) y **Google Cloud Infrastructure Manager (`config.googleapis.com` mediante `.gitlab-ci.yml` con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` e invocando `sa-infra-manager`)**.

**Project Type**: Plataforma central de autorización y gestión de accesos SSO (Subcomponente C2.2) bajo **arquitectura multirrepositorio en GitLab (`git.sitimapa.co`)**:
1. `minedec-sso` (`c2-sso/gobierno/minedec-sso`): Gobernanza, especificaciones Spec Kit (`specs/002-sincronizador-conciliacion-gws/`), esquemas DBML y contratos OpenAPI.
2. `../microservicios/shared` (`c2-sso/microservicios/shared`): Paquete transversal `@minedec/shared` publicado en GitLab NPM Package Registry.
3. `../microservicios/sincronizador` (`c2-sso/microservicios/sincronizador`): Cloud Run Service `sso-sincronizador` con su `Dockerfile` y `.gitlab-ci.yml`.
4. `../microservicios/conciliacion-job` (`c2-sso/microservicios/conciliacion-job`): Cloud Run Job `sso-conciliacion-job` con su `Dockerfile` y `.gitlab-ci.yml`.
5. `../iac-terraform` (`c2-sso/devops/iac-terraform`): Repositorio central declarativo de infraestructura GCP en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) con Terraform `1.5.7` y `scripts/bundle.sh`.

**SSO Repo**:
- **Gobernanza y Especificación**: `minedec-sso` (rama `spec/002-sincronizador-conciliacion-gws`).
- **Código de Aplicación**: `../microservicios/sincronizador` y `../microservicios/conciliacion-job` (rama `spec/002-sincronizador-conciliacion-gws`; sincronizador en modo de solo lectura desde Google Cloud Identity / Google Workspace conforme a `D-01`).
- **Infraestructura Declarativa**: `../iac-terraform` (rama sincronizada `spec/002-sincronizador-conciliacion-gws`).

**Performance Goals**:
- Presupuesto agregado hacia Google Admin SDK Directory API estrictamente `<= 28 req/s` (70 % de `40 req/s`) en el 100 % de las ventanas de ejecución (`FR-004`, `SC-001`):
  - Sin job masivo: `<= 5 req/s` (`REGISTRO_CALIENTE` en `sso-sync-priority-hot-reg`) + `<= 23 req/s` (incremental en `sso-sync-incremental`).
  - Con job masivo activo: `<= 20 req/s` (`sso-conciliacion-job` en lotes de 500 cuentas) + `>= 8 req/s` reservados para tiempo real (`5 req/s` `REGISTRO_CALIENTE` + `3 a 8 req/s` incremental).
- Reconciliación prioritaria de identidades provisionales en `REGISTRO_CALIENTE` mediante carril reservado de hasta `5 req/s` (`FR-006`, `SC-005`).
- Propagación de suspensiones, bajas y cambios de atributos con invalidación inmediata de caché L2 vía Pub/Sub (`sso-pip-cache-invalidation`) y **`<= 300 segundos`** como límite duro absoluto por TTL en Redis (`FR-010`, `SC-002`, `RF-GI-06`, `RF-AUT-06`, `PI-07`).
- Cero cálculo o exposición de duración por petición (`Date.now() - startedAt`, `latenciaTotalMs`, `latenciaMs`) ni arreglos en memoria de percentiles (`resolveLatenciesMs`) en Node.js; toda medición de latencia se delega a la infraestructura (Cloud Run, GKE/Envoy y Cloud Trace) conforme a `RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII.
- Carga inicial o conciliación completa de `~2,28 millones` de cuentas en **`< 4 horas`** por ventana (ejecutándose en `~4.560 llamadas` de red / `~4 minutos` de lectura efectiva a `20 req/s` en páginas de 500 cuentas) (`FR-007`, `SC-003`).
- Reducción de **`>= 95 %`** en escrituras transaccionales redundantes en AlloyDB durante conciliaciones diarias mediante comparación previa de `hash_payload_gws` (`SHA-256`) (`FR-009`).
- Aislamiento del **100 %** de eventos fallidos tras 5 reintentos exponenciales en la bandeja `DLQ` (`FR-012`, `FR-013`, `SC-006`) y el **100 %** de las alertas y errores acompañados de diagnósticos accionables en lenguaje natural en español (`FR-015`, `SC-007`).

**Constraints**:
- Operación **100 % en modo de solo lectura** sobre Google Workspace (`https://www.googleapis.com/auth/admin.directory.user.readonly`); prohibido crear, modificar, suspender o eliminar usuarios en Google Workspace (`FR-001`, `SC-001`).
- Cero archivos JSON de cuentas de servicio descargados o montados; uso exclusivo de `IAM Credentials API signJwt` desde `sa-sso-sync` y `sa-sso-sync-job` hacia `sa-workspace-reader` (`FR-001`, `Principio IX`).
- Prohibido integrar Active Directory o LDAP (`D-01`).
- Alcance exclusivo para **personas naturales** (`CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`), preservando la inmutabilidad estricta de `CEDULA` una vez consolidada y las asignaciones contextuales delegadas (`PAP_DELEGADO`) (`FR-011`, `Principio X.2`).
- Baja lógica diferenciada en dos niveles (`CuentaInstitucional` vs `PersonaIdentidad`) (`FR-002`, `FR-007`, `FR-010`).
- Exclusión mutua por partición (`pg_try_advisory_lock`) y recuperación automática de particiones huérfanas tras `> 15 minutos` sin avance de `heartbeat_en` (`FR-008`, `SC-004`).
- Prohibido incluir archivos `.tf` de infraestructura GCP en los repositorios de aplicación o gobernanza (`Principios IV y XVIII`).

**Scale/Scope**: Subcomponente C2.2 exclusivamente (Subcomponente C2.3 fuera de alcance); sincronización continua y conciliación masiva del universo nacional de **~2,28 millones de cuentas institucionales** dentro del único tenant de Google Workspace del Ministerio (`@estudiante.edu.ec`, `@docentes.educacion.gob.ec`, `@educacion.gob.ec` y subdominios parametrizables en `dominio_institucional`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked and verified after Phase 1 design (`research.md`, `data-model.md`, `contracts/sync-reconciliation-api.openapi.yaml`, `quickstart.md`) against Constitución MINEDEC v2.11.0.*

- [x] Language/Version coincide con el stack ratificado en `.specify/memory/constitution.md` v2.11.0 (TypeScript 5.8+ `strict: true` sobre Node.js 22 LTS en repositorios independientes `../microservicios/{shared,sincronizador,conciliacion-job}` y Terraform HCL `1.5.7` sin Terragrunt en `../iac-terraform`; sin improvisar otro lenguaje)
- [x] Stack ratificado resuelto: sin `[PLACEHOLDER]` pendiente en Language/Version, Primary Dependencies, Storage, Testing, Target Platform, Project Type, OIDC Issuer (`https://accounts.google.com`), SSO Repo (`minedec-sso` + `../microservicios/{shared,sincronizador,conciliacion-job}` + `../iac-terraform`)
- [x] Separación multirrepositorio en GitLab (Principios IV y XVIII): `../microservicios/sincronizador` y `../microservicios/conciliacion-job` consumen `@minedec/shared` desde GitLab NPM Package Registry y contienen exclusivamente código, pruebas, `Dockerfile` multi-stage `non-root` (`node:22-alpine`) y `.gitlab-ci.yml` (cero archivos `.tf`); `../iac-terraform` contiene exclusivamente la infraestructura en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) empaquetada con `scripts/bundle.sh` y gobernada por Google Cloud Infrastructure Manager (`sa-infra-manager`) sobre la Shared VPC (`mec-003-sha-net-*`)
- [x] Microservicios o jobs desacoplados; sin acceder a la BD de otro servicio (`sso-sincronizador` y `sso-conciliacion-job` son los componentes de ingesta del propio PIP sobre AlloyDB con `deletion_protection = true`)
- [x] Pruebas unitarias/integración mapeadas; cobertura prevista ≥ 70 % con Jest + Supertest (detalladas en `quickstart.md` y exigidas como Quality Gate bloqueante en `.gitlab-ci.yml`)
- [x] Flujos E2E de usuario crítico identificados **si hay UI** (N/A en Feature 002: esta feature implementa el Cloud Run Service `sso-sincronizador` y el Cloud Run Job `sso-conciliacion-job`; la Consola Web SPA corresponde a `../microservicios/frontend`)
- [x] OpenAPI o contrato de datos actualizable en `contracts/` (`specs/002-sincronizador-conciliacion-gws/contracts/sync-reconciliation-api.openapi.yaml`)
- [x] Spec y este plan: cuerpo en español; IDs FR-/SC- y User Story sin traducir
- [x] SSO: sincronización 100 % en solo lectura desde Google Cloud Identity / Google Workspace (`D-01`) sin escribir jamás en el directorio externo
- [x] OKF/knowledge citado (`knowledge/arquitectura/sincronizacion-identidades-cuotas.md`, `knowledge/dominio/identidad-esquema-minedec-perfil.md`, `knowledge/arquitectura/componentes-pdp-core.md`); nada de LOEI inventada
- [x] Si hay reglas LOEI / pedagógicas / de movimiento: Drools (u motor aprobado); si no aplican, N/A (N/A: validación y homologación de catálogo gobernada por `catalogo_atributo_minedec` según `D-03`)
- [x] Si hay mapa interactivo: MapLibre; si no hay mapa, MapLibre N/A (N/A)
- [x] Identidad de servicio estandarizada (`sso-*`): cuentas dedicadas de mínimo privilegio (`sa-sso-sync`, `sa-sso-sync-job` y `sa-workspace-reader` mediante `IAM Credentials API signJwt` sin llaves JSON, más `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` y `sa-infra-manager` para Infrastructure Manager); secretos en Secret Manager
- [x] Observabilidad de aplicación: logs estructurados JSON con `pino` + OpenTelemetry (Cloud Logging con autodetección `GKE_AUTOPILOT` / `CLOUD_RUN_SERVICE` / `CLOUD_RUN_JOB`, propagación de `traceparent` + `X-Cloud-Trace-Context` + `X-Trace-Id` entre GKE, Cloud Tasks y Cloud Run), manejador centralizado `syncErrorHandler` con reportes de diagnóstico en lenguaje natural en español (`AdminIncidentDiagnosticReport`), y métricas/alertas SRE unificadas GKE + Cloud Run
- [x] Verificación documental obligatoria en Google Developer Knowledge (`Principio V.13` — `retrieving-developer-knowledge`): recursos `documents/docs.cloud.google.com/run/docs/configuring/shared-vpc-direct-vpc`, `documents/docs.cloud.google.com/run/docs/execute/jobs-on-schedule`, `documents/docs.cloud.google.com/tasks/docs/creating-http-target-tasks`, `documents/docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt`, `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account`, `documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources`, `documents/docs.cloud.google.com/run/docs/container-contract`, `documents/docs.cloud.google.com/run/docs/configuring/jobs/environment-variables`, `documents/docs.cloud.google.com/trace/docs/setup/nodejs-ot`, `documents/docs.cloud.google.com/logging/docs/agent/logging/structured-logging`, `documents/docs.cloud.google.com/trace/docs/trace-context` y `documents/docs.cloud.google.com/run/docs/trace` verificados y citados en `research.md`
- [x] No implementar Security Command Center ni landing zone org-level (ni stack `host` de VPC, ya que la Shared VPC es administrada por el equipo de redes)
- [x] Autorización en servidor por operación; consultas SQL 100 % parametrizadas (`$1, $2`), identificadores dinámicos solo por lista blanca cerrada + regex `safe_sql_identifier` + `%I`, y migraciones DDL estáticas
- [x] **Gate Constitucional Extra (Principios IV, V, VI, IX, XIII, XV, XVI y XVIII)**: Reutilización DRY en `@minedec/shared`, InversifyJS exclusivamente en `container.ts` (0 decoradores en `domain/` y `application/`), prohibición de calcular duraciones por petición en Node.js (`RNF-REN-01..06`), invalidación inmediata de caché vía Pub/Sub con techo duro `<= 300 s` (TTL Redis), bitácora `auditoria_evento` append-only con cadena SHA-256, y contenedores `node:22-alpine` con `USER node`.

## Project Structure

### Documentation — Repositorio de Gobernanza (`minedec-sso`)

```text
specs/002-sincronizador-conciliacion-gws/
├── plan.md              # Plan de implementación técnica (/speckit-plan - Constitución v2.11.0)
├── research.md          # Decisiones de arquitectura, cuota 28 req/s, histéresis, checkpoints, Shared VPC y DLQ
├── data-model.md        # Extensión relacional 3FN en AlloyDB (Migración 003) y llaves Redis
├── quickstart.md        # Guía ejecutable de verificación de los 6 escenarios de la Feature 002
├── contracts/           # Contrato OpenAPI 3.1.0 de Fase 1
│   └── sync-reconciliation-api.openapi.yaml
└── tasks.md             # Lista de tareas ordenadas por dependencias (/speckit-tasks)
```

### 1. Source Code — Repositorios Independientes (`../microservicios/{shared,sincronizador,conciliacion-job}`)

```text
../microservicios/
├── shared/                          # Repositorio GitLab: c2-sso/microservicios/shared (@minedec/shared)
│   ├── .gitlab-ci.yml               # Publica versión en GitLab NPM Package Registry
│   └── src/
│       ├── domain/                  # Validadores de 21 atributos MINEDEC_Perfil y calculador hashPayloadGws (SHA-256)
│       ├── db/                      # Pool AlloyDB (pg), helper safe_sql_identifier y advisory locks por partición
│       ├── cache/                   # Cliente Redis L2 (TTL <= 300 s) y gobernador distribuido de cuota (<= 28 req/s) + histéresis
│       ├── audit/                   # Escritor de auditoría inmutable SHA-256 (ampliado con eventos de sync/DLQ/checkpoint)
│       └── observability/           # Logger estructurado pino con autodetección GKE/Cloud Run + OpenTelemetry (traceparent / X-Cloud-Trace-Context) y generador de diagnósticos en español
├── pip-identity-service/            # Repositorio GitLab: c2-sso/microservicios/pip-identity-service
│   └── migrations/
│       └── 003_sync_reconciliation_schema.sql # Tablas checkpoint_conciliacion, evento_sincronizacion_procesado, registro_fallo_sincronizacion y columna hash_payload_gws
├── sincronizador/                   # Repositorio GitLab: c2-sso/microservicios/sincronizador (Cloud Run Service sso-sincronizador - sa-sso-sync)
│   ├── .gitlab-ci.yml               # Pipeline GitLab CI (gitlab-runner@...): npm ci, lint, audit, tests >= 70%, docker build y push a sso-containers:$CI_COMMIT_SHA
│   ├── .npmrc                       # Registro @minedec:registry=https://git.sitimapa.co/api/v4/projects/<ID>/packages/npm/
│   ├── Dockerfile                   # Multi-stage build sobre node:22-alpine con ejecución non-root (USER node)
│   ├── package.json                 # Consume "@minedec/shared" desde GitLab NPM Package Registry
│   ├── src/
│   │   ├── domain/
│   │   │   ├── entities/            # EventoSincronizacionProcesado, RegistroFalloSincronizacion (DLQ), CheckpointConciliacion
│   │   │   ├── services/            # Evaluador de histéresis (100/10s -> 20), clasificador de backoff exponencial y obsolescencia DLQ
│   │   │   └── ports/               # Interfaces segregadas (ISP): DirectorioExternoIdentidadPort (solo lectura), DlqRepositoryPort, CheckpointRepositoryPort, CloudTasksDispatcherPort
│   │   ├── application/
│   │   │   ├── receive-pubsub-audit-event.usecase.ts       # Deduplicación idempotente y encolamiento regulado (<= 28 req/s)
│   │   │   ├── process-incremental-sync.usecase.ts         # Ejecución individual (users.get) o lote (users.list 500) con histéresis
│   │   │   ├── reconcile-priority-hot-reg.usecase.ts       # Carril reservado (<= 5 req/s) en sso-sync-priority-hot-reg para REGISTRO_CALIENTE
│   │   │   ├── apply-two-level-deactivation.usecase.ts     # Baja diferenciada CuentaInstitucional vs PersonaIdentidad + purga inmediata en sso-pip-cache-invalidation (<= 300 s TTL)
│   │   │   ├── execute-delta-sweep.usecase.ts              # Barrido delta cada 2 min con ventana de solapamiento de 30 s
│   │   │   └── manage-dlq-and-replay.usecase.ts            # Derivación tras 5 intentos a sso-sync-dlq y replay regulado con protección de obsolescencia
│   │   ├── infrastructure/
│   │   │   ├── gws/                 # GoogleWorkspaceDirectoryReadOnlyAdapter con IAM Credentials signJwt hacia sa-workspace-reader (0 llaves JSON)
│   │   │   ├── persistence/         # Repositorios PostgreSQL 100% parametrizados ($1, $2) para deduplicación, checkpoints y DLQ
│   │   │   ├── messaging/           # Adaptador Cloud Tasks de doble carril (sso-sync-priority-hot-reg, sso-sync-incremental) y publicador DLQ / invalidación Pub/Sub
│   │   │   └── http/                # Rutas, controladores Express 5 validados con Zod, middleware OpenTelemetry y syncErrorHandler con diagnosticoAdministrador
│   │   ├── container.ts             # Composition Root con InversifyJS (decorate/bind externo, 0 decoradores en domain/ y application/)
│   │   └── index.ts
│   └── tests/
└── conciliacion-job/                # Repositorio GitLab: c2-sso/microservicios/conciliacion-job (Cloud Run Job sso-conciliacion-job - sa-sso-sync-job)
    ├── .gitlab-ci.yml               # Pipeline GitLab CI (gitlab-runner@...): npm ci, lint, audit, tests >= 70%, docker build y push a sso-containers:$CI_COMMIT_SHA
    ├── .npmrc                       # Registro @minedec:registry=https://git.sitimapa.co/api/v4/projects/<ID>/packages/npm/
    ├── Dockerfile                   # Multi-stage build sobre node:22-alpine con ejecución non-root (USER node)
    ├── package.json                 # Consume "@minedec/shared" desde GitLab NPM Package Registry
    ├── src/
    │   ├── application/
    │   │   └── run-partitioned-reconciliation.usecase.ts   # Recorrido de páginas de 500 cuentas (<= 20 req/s), hashPayloadGws, pg_try_advisory_lock y reclamo de particiones huérfanas (> 15 min)
    │   ├── container.ts             # Composition Root del Job con InversifyJS
    │   └── index.ts                 # Ejecución envuelta en withOtelSpan correlacionando CLOUD_RUN_JOB y CLOUD_RUN_EXECUTION
    └── tests/
```

### 2. Infrastructure as Code — Repositorio Central en 3 Capas (`../iac-terraform`)

```text
../iac-terraform/                    # Repositorio GitLab: c2-sso/devops/iac-terraform (Rama: spec/002-sincronizador-conciliacion-gws)
├── .gitlab-ci.yml                   # Pipeline GitLab CI (gitlab-runner@... -> sa-infra-manager): validate, scripts/bundle.sh, previews create y deployments apply
├── scripts/
│   └── bundle.sh                    # Empaqueta despliegues/<ambiente>/<stack> + plantillas/<stack> + modulos/ en build/<ambiente>/<stack>
├── modulos/                         # Capa 1: Módulos reutilizables (Terraform 1.5.7)
│   ├── pubsub_cloud_tasks_sync/     # Tópicos sso-gws-directory-events y sso-sync-dlq + colas sso-sync-priority-hot-reg (5 req/s) y sso-sync-incremental (23 req/s)
│   ├── cloud_run_sincronizador/     # Cloud Run Service sso-sincronizador (sa-sso-sync, Direct VPC Egress hacia Shared VPC, INGRESS_TRAFFIC_INTERNAL_ONLY) + Cloud Scheduler barrido delta (*/2 * * * *)
│   ├── cloud_run_conciliacion_job/  # Cloud Run Job sso-conciliacion-job (sa-sso-sync-job, Direct VPC Egress hacia Shared VPC) + Cloud Scheduler conciliación nocturna (0 1 * * * America/Guayaquil)
│   ├── secret_manager/              # Secreto GWS_DELEGATED_ADMIN_EMAIL
│   └── monitoring/                  # Alertas unificadas GKE + Cloud Run (AlloyDB outage, cuota 28 req/s, DLQ, particiones huérfanas > 15 min, Cloud Run Service 5xx/p99 y Cloud Run Job failed)
├── plantillas/                      # Capa 2: Composición por stack (devops, data, apps; sobre Shared VPC)
│   ├── devops/                      # Cuentas sa-sso-sync, sa-sso-sync-job, sa-workspace-reader (signJwt) y sa-infra-manager; Artifact Registry sso-containers
│   ├── data/                        # AlloyDB, Redis, Secret Manager, Pub/Sub y Cloud Tasks
│   └── apps/                        # Cloud Run Service sso-sincronizador y Cloud Run Job sso-conciliacion-job con Direct VPC Egress hacia la Shared VPC
└── despliegues/                     # Capa 3: Instanciación por ambiente (mec-003-sso-des, mec-003-sso-pre, mec-003-sso-pro)
    ├── des/{devops,data,apps}/      # project_id = "mec-003-sso-des", host_project_id = "mec-003-sha-net-des"
    ├── pre/{devops,data,apps}/      # project_id = "mec-003-sso-pre", host_project_id = "mec-003-sha-net-pre"
    └── pro/{devops,data,apps}/      # project_id = "mec-003-sso-pro", host_project_id = "mec-003-sha-net-pro-511014"
```

**Structure Decision**: Se adopta el modelo constitucional **v2.11.0 de arquitectura multirrepositorio en GitLab (`git.sitimapa.co`) sincronizada en la rama `spec/002-sincronizador-conciliacion-gws`**:
1. En **`../microservicios/sincronizador`** (`sso-sincronizador`) y **`../microservicios/conciliacion-job`** (`sso-conciliacion-job`) se implementan los servicios de sincronización y conciliación consumiendo `@minedec/shared` desde el **GitLab NPM Package Registry**, configurando `InversifyJS` exclusivamente en cada `container.ts` (0 decoradores en `domain/` y `application/`), junto con sus `Dockerfile` multi-stage `non-root` (`node:22-alpine`, `USER node`) y `.gitlab-ci.yml` ejecutados con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com`.
2. En **`../iac-terraform`** se declaran en **3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`)** en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** los servicios Cloud Run (`sso-sincronizador` y `sso-conciliacion-job` con Direct VPC Egress hacia la Shared VPC), colas Cloud Tasks de doble carril (`5 + 23 = 28 req/s`), Cloud Scheduler, tópicos Pub/Sub (`sso-gws-directory-events`, `sso-sync-dlq`) y cuentas de servicio sin llaves (`sa-sso-sync`, `sa-sso-sync-job`, `sa-workspace-reader` con `signJwt`), empaquetados mediante `scripts/bundle.sh` y gobernados por **Google Cloud Infrastructure Manager (`sa-infra-manager`)**.

## Complexity Tracking

> **Sin violaciones a la Constitución**: Todos los componentes de aplicación e infraestructura cumplen íntegramente con `.specify/memory/constitution.md` v2.11.0 sin requerir excepciones.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Ninguna | N/A | N/A |
