# Implementation Plan: Base de Identidades en Dos Niveles, Catálogos Parametrizables y Esquema MINEDEC_Perfil

**Branch**: `spec/001-modelo-identidades-perfil` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/001-modelo-identidades-perfil/spec.md)

**Input**: Feature specification from `/specs/001-modelo-identidades-perfil/spec.md`

**Note**: Este plan técnico ha sido generado y actualizado mediante el flujo `/speckit-plan` en estricto apego a `.specify/memory/constitution.md` (Constitución MINEDEC v2.11.0) y a la base de conocimiento OKF (`knowledge/index.md`).

## Summary

Implementar la **Base de Identidades Unificada (Policy Information Point — PIP)** en **3ra Forma Normal (3FN)**, el paquete compartido transversal (`@minedec/shared` en `../microservicios/shared`) y la gobernanza de **Catálogos Parametrizables y Esquema de 21 Atributos `MINEDEC_Perfil`** del Subcomponente C2.2 (**Sistema de Autenticación Centralizado SSO / Conecta MINEDEC**), acotada exclusivamente a **personas naturales**, bajo el modelo constitucional de **arquitectura multirrepositorio en GitLab (`git.sitimapa.co`) sincronizada en la rama `spec/001-modelo-identidades-perfil`**:

1. **En los repositorios independientes de código (`c2-sso/microservicios/shared` en `../microservicios/shared` y `c2-sso/microservicios/pip-identity-service` en `../microservicios/pip-identity-service`, gobernados desde `minedec-sso`)**:
   - **`@minedec/shared` (`../microservicios/shared`)**: Paquete transversal DRY con esquemas y validadores canónicos de los 21 atributos `MINEDEC_Perfil`, pool AlloyDB (`pg`), cliente Memorystore for Redis (`ioredis` con `TTL <= 300 s`), escritor de auditoría inmutable con encadenamiento SHA-256 (`pg_advisory_xact_lock`) y observabilidad (`pino` + OpenTelemetry). Se versiona y publica en el **GitLab NPM Package Registry** (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`) mediante su propio `.gitlab-ci.yml`.
   - **`pip-identity-service` (`../microservicios/pip-identity-service`)**: Consume `@minedec/shared` desde el GitLab NPM Package Registry y consolida bajo una única entidad `PersonaIdentidad` (con clave primaria técnica inmutable `idInterno` UUID v4 para proteger llaves foráneas y la tabla `auditoria_evento` append-only, y clave natural `UNIQUE` `(tipoIdentificacion, numeroIdentificacion)` donde la `CEDULA` es estrictamente inmutable una vez consolidada) las múltiples cuentas institucionales de un **único tenant de Google Workspace** segmentado en subdominios/dominios por población (`@estudiante.edu.ec`, `@docentes.educacion.gob.ec`, `@educacion.gob.ec`). Normaliza en `CatalogoTerritorioSede` la jerarquía de establecimientos educativos (`AMIE -> Circuito -> Distrito -> Zona`) homologada con las fuentes reales del MINEDEC (`FO-DNTIC-20`), extrae y unifica la `CEDULA` de 10 dígitos si llega un RUC de persona natural (`10 dígitos + 001..999`, rechazando RUCs societarios), soporta asignaciones contextuales multisede (`1:N` diferenciando `GWS_PRIMARIO` y `PAP_DELEGADO`), ejecuta la transición unidireccional `1 a 1` de `CODIGO_MINEDEC` a `CEDULA`, resuelve en caliente (`REGISTRO_CALIENTE`) el primer inicio de sesión OIDC mediante identidad provisional (`PENDIENTE_IDENTIFICACION`) sin invocar la API de Google Workspace en el camino crítico del login, y gobierna la Bandeja de Anomalías (`BLOQUEANTE` vs `RESTRINGIDA`, con estado `LISTA_PARA_CERRAR` y cierre manual obligatorio para `COLISION_IDENTIFICADOR`). Incluye contenedorización multi-stage sobre `node:22-alpine` (`non-root`) y pipeline `.gitlab-ci.yml` ejecutado por el runner institucional (`gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` por metadata server, cero llaves JSON) que ejecuta `npm ci`, lint, `npm audit`, tests con cobertura `>= 70%`, build de imagen Docker y publicación en Artifact Registry (`sso-containers`) con `$CI_COMMIT_SHA`.
2. **En el repositorio central de infraestructura (`c2-sso/devops/iac-terraform` en `../iac-terraform`)**: Estructura declarativa en **3 capas (`modulos/`, `plantillas/` y `despliegues/{des,pre,pro}/{devops,data,apps}`)** en **Terraform HCL puro (`1.5.7`, sin Terragrunt)**, empaquetada con `scripts/bundle.sh` y gobernada por **Google Cloud Infrastructure Manager (`config.googleapis.com` vía `sa-infra-manager@<project_id>.iam.gserviceaccount.com`)** desde `.gitlab-ci.yml` (`gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com`). Opera sobre la **Red Compartida (Shared VPC)** administrada por el equipo de redes en los proyectos host (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) para aprovisionar en los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`) el clúster AlloyDB for PostgreSQL 16 (`deletion_protection = true`), Memorystore for Redis (`TTL <= 300 s` + `AUTH` en Secret Manager), tópicos/suscripciones Cloud Pub/Sub (`sso-pip-cache-invalidation`) con DLQ para invalidación reactiva inmediata, cola Cloud Tasks (`sso-sync-priority-hot-reg`) para `REGISTRO_CALIENTE`, secretos en Secret Manager y la cuenta de servicio estandarizada `sa-sso-core` con Workload Identity en GKE Autopilot.

## Technical Context

**Language/Version**: TypeScript 5.8+ (`strict: true`) sobre Node.js 22 LTS en repositorios independientes de GitLab (`../microservicios/shared` publicado como `@minedec/shared` en GitLab NPM Package Registry y `../microservicios/pip-identity-service`; imagen base `node:22-alpine` multi-stage `non-root`); Arquitectura Hexagonal + principios **SOLID** + **DRY** (`@minedec/shared`) + **Inyección de Dependencias con `InversifyJS` configurado exclusivamente en el Composition Root (`container.ts`, sin decoradores en Dominio/Aplicación)**; **Terraform `1.5.7` (HCL puro, sin Terragrunt)** en el repositorio separado `../iac-terraform` estructurado en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`).

**Primary Dependencies**: Express 5 (100% único framework HTTP), `@minedec/shared` (consumido desde GitLab NPM Package Registry), `inversify` (contenedor IoC/DI configurado exclusivamente en `container.ts` / `ContainerModule`), `zod` (validación estricta de los 21 atributos `MINEDEC_Perfil` y contratos HTTP), `jose` (verificación de tokens internos OIDC/JWT RS256), `pg` + `pg-format` (cliente PostgreSQL con consultas 100% parametrizadas `$1, $2` e identificadores por lista blanca `safe_sql_identifier`), `ioredis` (cliente Memorystore for Redis con `TTL <= 300 s`), `helmet`, `@google-cloud/pubsub` (invalidación reactiva de caché en `sso-pip-cache-invalidation`), `@google-cloud/tasks` (encolamiento asíncrono de alta prioridad en `sso-sync-priority-hot-reg` para `REGISTRO_CALIENTE`), `@google-cloud/secret-manager`, `pino` (logging estructurado JSON con redacción de secretos).

**Storage**: AlloyDB for PostgreSQL 16 sobre la Shared VPC (base de datos transaccional primaria del PIP en 3FN pura con `deletion_protection = true`, triggers de defensa en profundidad `trg_enforce_cedula_immutability` y `trg_enforce_auditoria_append_only`, índices funcionales `LOWER()` + tabla `auditoria_evento` append-only con encadenamiento SHA-256 serializado mediante `pg_advisory_xact_lock`), Memorystore for Redis (caché L2 de identidades, índices inversos y catálogos con `TTL <= 300 s` y `AUTH` en Secret Manager), Cloud Storage (estado remoto gestionado por Infrastructure Manager y archivo forense WORM de auditoría con `retention_policy` bloqueada `is_locked = true`), Cloud Logging y BigQuery (almacén analítico de auditoría append-only con `deletion_protection = true`).

**Testing**: Jest + Supertest (pruebas unitarias y de integración con cobertura `>= 70%`), incluyendo prueba automatizada de contrato de esquema relacional 3FN (`sql-schema-alignment.spec.ts`), contenedores locales PostgreSQL 16 / AlloyDB Omni y Redis 7 para pruebas de integración de unificación multi-dominio en el tenant único de GWS, normalización de RUC de persona natural a `CEDULA`, homologación de catálogos/AMIE (`FO-DNTIC-20`), preservación multisede en 3FN (`catalogo_territorio_sede`), transición unidireccional `CODIGO_MINEDEC` → `CEDULA` con inmutabilidad posterior de `CEDULA`, `REGISTRO_CALIENTE`, ciclo de vida de anomalías e invalidación inmediata de caché L2 vía Pub/Sub (`<= 300 s` límite duro), más validación estática de IaC (`terraform fmt -check`, `terraform validate` y empaquetado `scripts/bundle.sh`) en `../iac-terraform`.

**Target Platform**: Google Cloud Platform — Proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`) conectados a la Red Compartida (Shared VPC) de los proyectos host (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`). GKE Autopilot (`sa-sso-core` con Workload Identity para el servicio `pip-identity-service`), Memorystore for Redis, AlloyDB for PostgreSQL 16, Cloud Pub/Sub, Cloud Tasks, Secret Manager, Artifact Registry (`sso-containers`) y **Google Cloud Infrastructure Manager (`config.googleapis.com` mediante `.gitlab-ci.yml` ejecutado con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` e invocando `sa-infra-manager@<project_id>.iam.gserviceaccount.com`)**.

**Project Type**: Plataforma central de autorización y gestión de accesos SSO (Subcomponente C2.2) bajo **arquitectura multirrepositorio en GitLab (`git.sitimapa.co`)**:
1. `minedec-sso` (`c2-sso/gobierno/minedec-sso`): Gobernanza, especificaciones Spec Kit (`specs/001-modelo-identidades-perfil/`), esquemas DBML y contratos OpenAPI.
2. `../microservicios/shared` (`c2-sso/microservicios/shared`): Paquete transversal `@minedec/shared` publicado en GitLab NPM Package Registry con `.gitlab-ci.yml`.
3. `../microservicios/pip-identity-service` (`c2-sso/microservicios/pip-identity-service`): Microservicio PIP, migraciones SQL, `Dockerfile` y `.gitlab-ci.yml`.
4. `../iac-terraform` (`c2-sso/devops/iac-terraform`): Repositorio central declarativo de infraestructura GCP en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) con Terraform `1.5.7` y `scripts/bundle.sh`.

**SSO Repo**:
- **Gobernanza y Especificación**: `minedec-sso` (rama `spec/001-modelo-identidades-perfil`).
- **Código de Aplicación**: `../microservicios/shared` y `../microservicios/pip-identity-service` (rama `spec/001-modelo-identidades-perfil`; consumidor de Google Cloud Identity `https://accounts.google.com` conforme a `D-01`).
- **Infraestructura Declarativa**: `../iac-terraform` (rama sincronizada `spec/001-modelo-identidades-perfil`).

**Performance Goals**: Resolución interna de identidad unificada en el PIP en tiempo real mediante lectura en caché L2 Redis en 1 salto; consultas administrativas paginadas (hasta 100 registros por página) con índices en 3FN; purga reactiva inmediata de caché L2 vía Pub/Sub (`sso-pip-cache-invalidation`) ante cambios de estado, vigencia, sede o anomalías; expiración garantizada en `<= 300 s` por TTL en Redis; `0` llamadas a Google Workspace API en el camino crítico del login OIDC (`REGISTRO_CALIENTE`); y prohibición expresa de calcular duraciones por petición (`Date.now() - startedAt`) o mantener arreglos de percentiles de latencia en memoria en Node.js (`RNF-REN-01..06`, Principio V.4 y XIII).

**Constraints**: Cero consultas en tiempo real a Google Workspace en el login/autorización (`FR-007`); prohibido integrar Active Directory o LDAP (`D-01`); alcance exclusivo para **personas naturales** (`CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`, con inmutabilidad estricta de la `CEDULA` una vez consolidada y prohibición de tablas de RUC societario); prohibido incluir archivos `.tf` de infraestructura GCP en los repositorios de aplicación o gobernanza (Principios IV y XVIII); cero llaves JSON de cuentas de servicio (Workload Identity obligatorio para `sa-sso-core`, metadata server para `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` e impersonación para `sa-infra-manager`); cero secretos en código, `.tfvars` o imágenes Docker (100% en Google Secret Manager); contenedor Docker `non-root` (`USER node`); preservación obligatoria de ceros a la izquierda (`01`–`09`) en cédulas y códigos territoriales (`VARCHAR`); bloqueo graduado de anomalías (`BLOQUEANTE` vs `RESTRINGIDA`) y cierre manual obligatorio (`MANUAL_ADMIN`) para `COLISION_IDENTIFICADOR`.

**Scale/Scope**: Subcomponente C2.2 exclusivamente (Subcomponente C2.3 fuera de alcance); soporte para el universo nacional de ~2,28 millones de cuentas institucionales dentro de un único tenant de Google Workspace con subdominios por población (`@estudiante.edu.ec`, `@docentes.educacion.gob.ec`, `@educacion.gob.ec` y subdominios futuros parametrizables), evaluando los 21 atributos de `MINEDEC_Perfil` y asignaciones multisede (`1:N`). El worker asíncrono de sincronización en 3 capas y conciliación masiva desde Google Workspace se implementa de forma desacoplada en `002-sincronizador-conciliacion-gws` (`../microservicios/sincronizador` y `../microservicios/conciliacion-job`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked and verified after Phase 1 design (`research.md`, `data-model.md`, `contracts/`, `quickstart.md`) against Constitución MINEDEC v2.11.0.*

- [x] Language/Version coincide con el stack ratificado en `.specify/memory/constitution.md` v2.11.0 (TypeScript 5.8+ `strict: true` sobre Node.js 22 LTS en repositorios independientes `../microservicios/shared` y `../microservicios/pip-identity-service` y Terraform HCL `1.5.7` sin Terragrunt en `../iac-terraform`; sin improvisar otro lenguaje)
- [x] Stack ratificado resuelto: sin `[PLACEHOLDER]` pendiente en Language/Version, Primary Dependencies, Storage, Testing, Target Platform, Project Type, OIDC Issuer (`https://accounts.google.com`), SSO Repo (`minedec-sso` + `../microservicios/{shared,pip-identity-service}` + `../iac-terraform`)
- [x] Separación multirrepositorio en GitLab (Principios IV y XVIII): `../microservicios/shared` publica `@minedec/shared` en GitLab NPM Package Registry; `../microservicios/pip-identity-service` contiene exclusivamente código, pruebas, migraciones SQL, `Dockerfile` multi-stage `non-root` (`node:22-alpine`) y `.gitlab-ci.yml` de CI (publicando en Artifact Registry `sso-containers` con `$CI_COMMIT_SHA`, cero archivos `.tf`); `../iac-terraform` contiene exclusivamente módulos, plantillas y despliegues (`despliegues/{des,pre,pro}/{devops,data,apps}`) empaquetados con `scripts/bundle.sh` y gobernados por Google Cloud Infrastructure Manager (`.gitlab-ci.yml` con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` y `sa-infra-manager`) sobre la Shared VPC (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`)
- [x] Microservicios o jobs desacoplados; sin acceder a la BD de otro servicio (AlloyDB es la base propia del PIP de Conecta MINEDEC C2.2 con `deletion_protection = true`)
- [x] Pruebas unitarias/integración mapeadas; cobertura prevista ≥ 70% con Jest + Supertest (detalladas en `quickstart.md` y exigidas como Quality Gate bloqueante en `.gitlab-ci.yml`)
- [x] Flujos E2E de usuario crítico identificados **si hay UI** (N/A en Feature 001: esta feature implementa `@minedec/shared`, el microservicio backend `pip-identity-service` y su infraestructura base; la Consola Web SPA corresponde a `../microservicios/frontend`)
- [x] OpenAPI o contrato de datos actualizable en `contracts/` (`specs/001-modelo-identidades-perfil/contracts/identity-profile-internal-api.openapi.yaml`)
- [x] Spec y este plan: cuerpo en español; IDs FR-/SC- y User Story sin traducir
- [x] SSO: consumo OIDC+PKCE de Google Cloud Identity (`https://accounts.google.com`) y resolución de identidad para la plataforma SSO C2.2
- [x] OKF/knowledge citado (`knowledge/dominio/identidad-esquema-minedec-perfil.md`, `knowledge/dominio/matriz-atributos-gws-catalogos.md`, `knowledge/arquitectura/componentes-pdp-core.md`); nada de LOEI inventada
- [x] Si hay reglas LOEI / pedagógicas / de movimiento: Drools (u motor aprobado); si no aplican, N/A (N/A: validación de catálogo y derivación determinista de los 21 atributos `MINEDEC_Perfil` gobernada por `catalogo_atributo_minedec` según `D-03`)
- [x] Si hay mapa interactivo: MapLibre; si no hay mapa, MapLibre N/A (N/A)
- [x] Identidad de servicio estandarizada (`sso-*`): cuentas dedicadas de mínimo privilegio (`sa-sso-core` con Workload Identity en GKE, `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` en el runner institucional y `sa-infra-manager` para Infrastructure Manager); cero llaves JSON; secretos en Secret Manager (incluyendo `AUTH` de Redis y credenciales de BD)
- [x] Observabilidad de aplicación: logs estructurados JSON con `pino` (Cloud Logging), contadores de caché y anomalías (Cloud Monitoring, delegando la medición de latencia a la infraestructura sin cálculos de duración por petición en Node.js), trazas en endpoints HTTP internos y administrativos
- [x] Verificación documental obligatoria en Google Developer Knowledge (`Principio V.13` — `retrieving-developer-knowledge`): recursos `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc`, `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account`, `documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources` y `documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/deployments/apply` verificados y citados en `research.md`
- [x] No implementar Security Command Center ni landing zone org-level (ni stack `host` de VPC, ya que la Shared VPC es provista por el equipo de redes)
- [x] Autorización en servidor por operación (JWT ≠ permiso sobre el recurso); consultas SQL 100% parametrizadas (`$1, $2`), identificadores dinámicos solo por lista blanca cerrada + regex `safe_sql_identifier` + `%I`, y migraciones DDL estáticas
- [x] **Gate Constitucional Extra (Principios IV, V, VI, XIII, XV, XVI y XVIII)**: Paquete compartido `@minedec/shared` (DRY + SOLID), InversifyJS configurado exclusivamente en el Composition Root (`container.ts` sin decoradores en `domain/` ni `application/`), invalidación inmediata de caché vía Pub/Sub (camino nominal) y `<= 300 s` (límite duro por TTL en Redis), cero cálculos de latencia por petición en Node.js, tabla `auditoria_evento` append-only con hash SHA-256 encadenado, e imagen Docker `node:22-alpine` con usuario `non-root` (`USER node`).

## Project Structure

### Documentation — Repositorio de Gobernanza (`minedec-sso`)

```text
specs/001-modelo-identidades-perfil/
├── plan.md              # Plan de implementación técnica (/speckit-plan - Constitución v2.11.0)
├── research.md          # Decisiones de arquitectura, diseño de Fase 0 y arquitectura multirrepositorio en GitLab
├── data-model.md        # Modelo relacional AlloyDB (PostgreSQL 16 en 3FN) y diseño de caché Redis L2
├── quickstart.md        # Guía ejecutable de validación de código, contenedores e IaC en 3 capas
├── contracts/           # Contratos OpenAPI 3.1.0 de Fase 1
│   └── identity-profile-internal-api.openapi.yaml
└── tasks.md             # Lista de tareas ordenadas por dependencias (/speckit-tasks y /speckit-converge)
```

### 1. Source Code — Repositorios Independientes de Paquete y Microservicio (`../microservicios/{shared,pip-identity-service}`)

```text
../microservicios/
├── shared/                          # Repositorio GitLab: c2-sso/microservicios/shared (@minedec/shared)
│   ├── .gitlab-ci.yml               # Pipeline GitLab CI: lint, npm audit, tests >= 70%, npm publish en GitLab NPM Package Registry
│   ├── package.json                 # name: "@minedec/shared", publishConfig hacia git.sitimapa.co/api/v4/projects/<ID>/packages/npm/
│   ├── src/
│   │   ├── domain/                  # Esquemas y validadores canónicos de los 21 atributos MINEDEC_Perfil, Cédula (Módulo 10) y AMIE
│   │   ├── db/                      # Pool AlloyDB (pg), consultas parametrizadas y helper safe_sql_identifier
│   │   ├── cache/                   # Cliente Memorystore Redis (ioredis) con TTL <= 300 s e invalidación atómica UNLINK
│   │   ├── audit/                   # Escritor de auditoría inmutable con encadenamiento SHA-256 y pg_advisory_xact_lock
│   │   └── observability/           # Logger estructurado (pino con redacción de secretos) + OpenTelemetry W3C traceparent
│   └── tests/
└── pip-identity-service/            # Repositorio GitLab: c2-sso/microservicios/pip-identity-service (GKE Autopilot - sa-sso-core)
    ├── .gitlab-ci.yml               # Pipeline GitLab CI (gitlab-runner@...): npm ci, lint, audit, tests >= 70%, docker build y push a sso-containers:$CI_COMMIT_SHA
    ├── .npmrc                       # Registro @minedec:registry=https://git.sitimapa.co/api/v4/projects/<ID>/packages/npm/
    ├── Dockerfile                   # Multi-stage build sobre node:22-alpine con ejecución non-root (USER node)
    ├── package.json                 # Consume "@minedec/shared" desde GitLab NPM Package Registry
    ├── migrations/
    │   ├── 001_init_pip_identity_schema.sql # DDL estático en 3FN pura para las 8 tablas relacionales del PIP, triggers e índices en AlloyDB
    │   └── 002_seed_minedec_catalogs.sql    # Semilla inicial de dominios institucionales, sedes y catálogos MINEDEC_Perfil (D-03)
    ├── src/
    │   ├── domain/
    │   │   ├── entities/            # PersonaIdentidad, CuentaInstitucional, AsignacionContexto, CatalogoTerritorioSede, AnomaliaIdentidad, CatalogoAtributoMinedec
    │   │   ├── services/            # Derivador gradoCurso->nivelAcademico, regla de minoría de edad, unificación multi-dominio y transición CODIGO_MINEDEC->CEDULA
    │   │   └── ports/               # Interfaces segregadas (ISP) de repositorios, caché L2, auditoría y encolador de sincronización prioritaria
    │   ├── application/
    │   │   ├── resolve-identity.usecase.ts          # Resolución en tiempo real en caché L2 o alta en REGISTRO_CALIENTE (0 llamadas a GWS)
    │   │   ├── upsert-directory-identity.usecase.ts # Ingestión idempotente de 21 atributos, unificación provisional y transición a CEDULA
    │   │   ├── manage-multisede-context.usecase.ts  # Gestión y preservación de asignaciones delegadas PAP_DELEGADO
    │   │   ├── manage-anomalies.usecase.ts          # Bandeja de anomalías, auto-resolución y cierre explícito MANUAL_ADMIN
    │   │   └── manage-catalogs.usecase.ts           # Catálogos parametrizables jerárquicos (D-03)
    │   ├── infrastructure/
    │   │   ├── persistence/         # Repositorios PostgreSQL (AlloyDB) 100% parametrizados ($1, $2)
    │   │   ├── cache/               # Proyecciones e invalidación Redis L2 (minedec:pip:*, TTL <= 300 s)
    │   │   ├── messaging/           # Adaptador Cloud Tasks (sso-sync-priority-hot-reg) e invalidación Pub/Sub (sso-pip-cache-invalidation)
    │   │   └── http/                # Rutas y controladores Express 5 validados con Zod
    │   ├── container.ts             # Composition Root con InversifyJS (decorate/bind externo, 0 decoradores en domain/ y application/)
    │   └── index.ts
    └── tests/
        ├── unit/
        │   ├── domain/                      # Pruebas unitarias de los 21 atributos, ceros a la izquierda (01-09), Módulo 10 y minoría de edad
        │   ├── container-wiring.spec.ts     # Pureza hexagonal y resolución de InversifyJS en el Composition Root
        │   └── sql-schema-alignment.spec.ts # Paridad 1:1 entre DDL SQL, DBML, semillas y repositorios PostgreSQL
        └── integration/
            ├── pip/                         # Unificación multi-dominio, preservación multisede 3FN, transición a CEDULA y REGISTRO_CALIENTE
            ├── cache/                       # Lectura en 1 salto en caché L2, purga reactiva inmediata vía Pub/Sub y expiración dura TTL <= 300s
            └── anomalies/                   # Auto-resolución, estado LISTA_PARA_CERRAR, cierre manual de COLISION_IDENTIFICADOR y recurrencia (anomalia_anterior_id)
```

### 2. Infrastructure as Code — Repositorio Central en 3 Capas (`../iac-terraform`)

```text
../iac-terraform/                    # Repositorio GitLab: c2-sso/devops/iac-terraform (Rama: spec/001-modelo-identidades-perfil)
├── .gitignore                       # Exclusión de .terraform/, *.tfstate*, build/, *.tfvars sensibles
├── .gitlab-ci.yml                   # Pipeline GitLab CI (gitlab-runner@... -> sa-infra-manager): validate, scripts/bundle.sh, previews create y deployments apply
├── scripts/
│   └── bundle.sh                    # Empaqueta despliegues/<ambiente>/<stack> + plantillas/<stack> + modulos/ en build/<ambiente>/<stack>
├── modulos/                         # Capa 1: Módulos atómicos reutilizables (Terraform 1.5.7)
│   ├── alloydb/                     # Clúster e instancia primaria AlloyDB for PostgreSQL 16 HA + Read Pool sobre Shared VPC (deletion_protection = true)
│   ├── redis/                       # Instancia Memorystore for Redis sobre Shared VPC (TLS, AUTH en Secret Manager, TTL <= 300 s)
│   ├── pubsub_cloud_tasks_sync/     # Tópico sso-pip-cache-invalidation con DLQ y cola sso-sync-priority-hot-reg
│   ├── secret_manager/              # Secretos en Google Secret Manager (AES-256, replicación automática y rotación <= 90 días)
│   ├── gke_pip_service/             # GKE Autopilot en Shared VPC + Deployment pip-identity-service con Workload Identity (sa-sso-core)
│   └── monitoring/                  # Alertas y métricas operativas en Cloud Monitoring
├── plantillas/                      # Capa 2: Composición por stack (devops, data, apps; sin stack host por uso de Shared VPC)
│   ├── devops/                      # Artifact Registry (sso-containers), sa-infra-manager, sa-sso-core y bindings IAM base
│   ├── data/                        # AlloyDB 16, Memorystore Redis, Secret Manager, Pub/Sub y Cloud Tasks conectados a la Shared VPC
│   └── apps/                        # Clúster GKE Autopilot y carga de trabajo pip-identity-service (sa-sso-core)
└── despliegues/                     # Capa 3: Instanciación por ambiente (mec-003-sso-des, mec-003-sso-pre, mec-003-sso-pro)
    ├── des/
    │   ├── devops/                  # project_id = "mec-003-sso-des", host_project_id = "mec-003-sha-net-des"
    │   ├── data/
    │   └── apps/
    ├── pre/
    │   ├── devops/                  # project_id = "mec-003-sso-pre", host_project_id = "mec-003-sha-net-pre"
    │   ├── data/
    │   └── apps/
    └── pro/
        ├── devops/                  # project_id = "mec-003-sso-pro", host_project_id = "mec-003-sha-net-pro-511014"
        ├── data/
        └── apps/
```

**Structure Decision**: Se adopta el modelo constitucional **v2.11.0 de arquitectura multirrepositorio en GitLab (`git.sitimapa.co`) sincronizada por rama (`spec/001-modelo-identidades-perfil`)**:
1. En **`../microservicios/shared`** se publica el paquete transversal `@minedec/shared` en el **GitLab NPM Package Registry**, y en **`../microservicios/pip-identity-service`** se implementa la arquitectura hexagonal en TypeScript 5.8+ sobre Node.js 22 LTS regida por **SOLID**, **DRY** e **InversifyJS exclusivamente en el Composition Root (`container.ts`)**, con su `Dockerfile` multi-stage (`node:22-alpine`, `USER node`) y `.gitlab-ci.yml` ejecutado con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` que publica la imagen inmutable etiquetada con `$CI_COMMIT_SHA` en Artifact Registry (`sso-containers`).
2. En **`../iac-terraform`** se declara toda la infraestructura base de la Feature 001 en **3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`)** en **Terraform HCL puro (`1.5.7`, sin Terragrunt)**, empaquetada mediante `scripts/bundle.sh` y gobernada al 100 % por **Google Cloud Infrastructure Manager** (`sa-infra-manager`) operando sobre la **Shared VPC** institucional (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`). Los workers Cloud Run de sincronización (`../microservicios/sincronizador` y `../microservicios/conciliacion-job`) se desacoplan hacia la Feature `002-sincronizador-conciliacion-gws`.

## Complexity Tracking

> **Sin violaciones a la Constitución**: Todos los componentes de aplicación e infraestructura cumplen íntegramente con `.specify/memory/constitution.md` v2.11.0 sin requerir excepciones.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Ninguna | N/A | N/A |
