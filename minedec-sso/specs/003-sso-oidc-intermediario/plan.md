# Implementation Plan: Servicio Intermediario Central de Inicio de Sesión Único (Identity Broker OIDC)

**Branch**: `spec/003-sso-oidc-intermediario` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/003-sso-oidc-intermediario/spec.md)

**Input**: Feature specification from `/specs/003-sso-oidc-intermediario/spec.md`

**Note**: Este plan técnico ha sido actualizado mediante el flujo `/speckit-plan` en estricto apego a `.specify/memory/constitution.md` (Constitución MINEDEC v2.11.0) y a la base de conocimiento OKF (`knowledge/index.md`, en especial `knowledge/arquitectura/decisiones-arquitectonicas-adrs.md`, `knowledge/arquitectura/patrones-integracion-pep-oid-saml.md`, `knowledge/arquitectura/componentes-pdp-core.md`, `knowledge/dominio/identidad-esquema-minedec-perfil.md` y `knowledge/requerimientos/rf-gestion-identidades-federacion.md`).

## Summary

Implementar el **Servicio Intermediario Central de Inicio de Sesión Único (`sso-oidc`, `DA-11`)** del Subcomponente C2.2 (**Sistema de Autenticación Centralizado SSO MINEDEC**) en `https://login.sso.<dominio>`, actuando simultáneamente como **único cliente OAuth 2.0 registrado ante Google Cloud Identity / Google Workspace (`https://accounts.google.com`, `D-01`)** y como **OpenID Provider (OP) central certificado (`oidc-provider`)** frente a todas las aplicaciones institucionales (Patrón 1 SP/RP Nativo y PEP del Patrón 2 Perimetral), bajo el modelo constitucional **v2.11.0 de repositorios independientes en GitLab (`git.sitimapa.co`) sincronizados en la rama `spec/003-sso-oidc-intermediario`**:

1. **En los Repositorios de Aplicación (`../microservicios/shared`, `../microservicios/sso-oidc` y `minedec-sso`)**:
   - **`../microservicios/sso-oidc` (`c2-sso/microservicios/sso-oidc` en GKE Autopilot — `sa-sso-core`, `FR-001`)**: Publica los endpoints estándar `GET /.well-known/openid-configuration`, `GET /authorize`, `GET /callback`, `POST /token`, `GET /jwks` y `GET/POST /logout` sobre **Express 5 + `oidc-provider`**, consumiendo `@minedec/shared` desde el **GitLab NPM Package Registry**.
   - **Catálogo 1FN/3FN de Clientes y URIs sin Límite de 100 URIs de GCP (`FR-003`, `FR-004`, `FR-005`, `SC-001`, `SC-005`)**: Valida `client_id` y coincidencia exacta de `redirect_uri`, `post_logout_redirect_uri` y `backchannel_logout_uri` contra `cliente_oidc` y `cliente_oidc_redirect_uri` en AlloyDB (con caché L2 en Memorystore for Redis `TTL <= 300 s`), exigiendo **`Authorization Code + PKCE (code_challenge_method = S256)` obligatorio** para el 100 % de los clientes y soportando rotación dual de `client_secret` (`SHA-256` en tiempo constante con ventana de gracia `gracia_hasta`, `FR-005`, `SC-006`).
   - **Federación Única con Google Cloud Identity, Resolución en el PIP y Reintento Corto Local Acotado (`<= 3 s`) en `REGISTRO_CALIENTE` (`FR-002`, `FR-006`, `FR-007`, `FR-008`, `SC-003`, `Clarificación Q1`)**: Verifica criptográficamente el `id_token` de Google y la pertenencia a los subdominios institucionales activos (`@educacion.gob.ec`, `@estudiantes.educacion.gob.ec` / `@estudiante.edu.ec`, `@docentes.educacion.gob.ec`, `@deporte.gob.ec`, `@cultura.gob.ec`). Resuelve en el PIP el `id_interno` y `(tipo_identificacion, numero_identificacion)` canónicos; cuando una cuenta nueva aún no posee `numero_identificacion`, dispara `REGISTRO_CALIENTE` (en la cola prioritaria `sso-sync-priority-hot-reg`) y realiza una **espera corta acotada de hasta `3 segundos` consultando exclusivamente el PIP local / Redis (`0` llamadas directas a Google Admin SDK)**. Si se consolida en `<= 3 s`, completa el login; si continúa en `PENDIENTE_IDENTIFICACION`, aplica **`fail-close`** (prohibido emitir `id_token` incompleto) y muestra una pantalla informativa en español con opción de reintentar.
   - **Emisión de `id_token` `RS256` por Aplicación Libre de Roles (`FR-009`, `SC-002`)**: Emite a cada aplicación o PEP un `id_token` firmado con `RS256` con `aud = oidc_client_id` exclusivo, `sub = id_interno`, `(tipo_identificacion, numero_identificacion)` e identidad canónica, **sin incluir jamás reclamos de roles, permisos, perfiles ni alcance territorial** (responsabilidad exclusiva de `motor-pdp`).
   - **Sesión Central en Redis, Uso Único de `code` (`<= 60 s`), Revocación Reactiva (`< 5 s` / Techo Duro `<= 300 s`) y SLO Híbrido de Dos Capas (`FR-009`, `FR-010`, `FR-011`, `FR-012`, `SC-004`, `SC-005`, `Clarificación Q2`)**: Persiste sesiones y códigos efímeros en Memorystore for Redis, bloquea atómicamente cualquier reutilización de `code`, revalida sesiones contra el PIP cada `<= 300 segundos` (`RF-GI-06`, `RF-AUT-06`, `PI-07`), purga selectivamente sesiones por `CuentaInstitucional` o en cascada por `PersonaIdentidad` vía Pub/Sub (`sso-pip-cache-invalidation` en `< 5 s`), e implementa el Cierre de Sesión Único (SLO) en dos capas: destrucción inmediata en Redis + envío asíncrono de `logout_token` firmado con `RS256` (**OIDC Back-Channel Logout 1.0**) a las URIs `BACKCHANNEL_LOGOUT` registradas + red de seguridad universal de expiración `<= 300 s`.
   - **Rotación Criptográfica `RS256` (`<= 90 días`) Segregada por `servicio_emisor = 'SSO_OIDC'` (`FR-013`, `SC-006`, `Clarificación Q3`)**: Llaves privadas exclusivamente en Google Secret Manager y publicación en `GET /jwks` únicamente de las llaves con `servicio_emisor = 'SSO_OIDC'` y `estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')`, excluyendo llaves `RETIRADA` o `REVOCADA` y llaves de `MOTOR_PDP`.
   - **Auditoría Inmutable y Cero Cálculo de Latencia en Node.js (`FR-014`, `RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII)**: Prohibición estricta de calcular o retornar duraciones por petición (`Date.now() - startedAt`) en Node.js; toda medición de latencia se delega a la infraestructura (External Application Load Balancer, GKE/Envoy y Cloud Trace).
   - **Pipeline CI/CD en GitLab (`.gitlab-ci.yml`)**: Ejecutado por el runner institucional con la cuenta de servicio adjunta `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (autenticación por metadata server, cero llaves JSON), publicando imágenes inmutables en Artifact Registry (`sso-containers:$CI_COMMIT_SHA`).
2. **En `iac-terraform` (`../iac-terraform`, `c2-sso/devops/iac-terraform`, rama sincronizada `spec/003-sso-oidc-intermediario`)**: Declara en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** estructurado en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`), empaquetado con `scripts/bundle.sh` y gobernado por **Google Cloud Infrastructure Manager (`config.googleapis.com` vía `sa-infra-manager@<project_id>.iam.gserviceaccount.com`)** sobre la **Red Compartida (Shared VPC)** existente (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) para los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`), el módulo `gke_sso_oidc_service` en `plantillas/apps/` (Deployment GKE Autopilot con Workload Identity `sa-sso-core`, `Service`, `BackendConfig` con política WAF de **Google Cloud Armor** `sso-oidc-waf-policy`, `FrontendConfig` TLS/HTTPS e `Ingress` público en `https://login.sso.<dominio>` **sin Cloud IAP delante** conforme a `DA-11`), además de extender `secret_manager` (cliente OAuth único de Google y llaves privadas JWKS `RS256` de `sso-oidc`) y `monitoring`.

## Technical Context

**Language/Version**: TypeScript 5.8+ (`strict: true`) sobre Node.js 22 LTS en repositorios independientes (`../microservicios/shared/`, `../microservicios/pip-identity-service/`, `../microservicios/sincronizador/`, `../microservicios/conciliacion-job/` y `../microservicios/sso-oidc/`; imagen base `node:22-alpine` multi-stage `non-root`); Arquitectura Hexagonal + principios **SOLID** + **DRY** (`@minedec/shared` publicado en GitLab NPM Package Registry) + **Inyección de Dependencias con `InversifyJS` configurado exclusivamente en el Composition Root (`container.ts`, sin decoradores en Dominio/Aplicación)**; **Terraform `1.5.7` (HCL puro, sin Terragrunt)** en el repositorio separado `../iac-terraform`.

**Primary Dependencies**: `@minedec/shared` (desde GitLab NPM Package Registry), Express 5 (100 % único framework HTTP), `oidc-provider` (certificado por la OpenID Foundation, para `../microservicios/sso-oidc`), `inversify` (contenedor IoC/DI configurado exclusivamente en `container.ts`), `zod` (100 % único validador runtime de parámetros OIDC, PKCE `S256`, reclamos del `id_token` de Google y del `id_token` MINEDEC libre de roles), `jose` (firma y verificación JWS `RS256` de `id_token` y `logout_token`, y gestión de JWKS), `pg` + `pg-format` (cliente AlloyDB con consultas 100 % parametrizadas `$1, $2` y lista blanca `safe_sql_identifier`), `ioredis` (sesión central OIDC, adaptador de códigos efímeros `<= 60 s`, llave testigo de revalidación `<= 300 s` y caché L2 de clientes/JWKS), `helmet` (cabeceras HTTP de nivel A: `HSTS`, `CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`), `@google-cloud/pubsub`, `@google-cloud/secret-manager`, `pino` (logging estructurado JSON compatible con Cloud Logging + OpenTelemetry y redacción Zero-Secret).

**Storage**: AlloyDB for PostgreSQL 16 (tablas existentes del PIP en 3FN + nuevas tablas `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` y `llave_jwks_rotacion` con `servicio_emisor` en `migrations/004_sso_oidc_broker_schema.sql`, más bitácora inmutable `auditoria_evento` append-only con cadena SHA-256), Memorystore for Redis (sesiones centrales `minedec:oidc:session:*`, llave de revalidación `minedec:oidc:reval:*` con `TTL <= 300 s`, índices por cuenta/persona y códigos de autorización de uso único con `TTL <= 60 s`), Google Secret Manager (secreto del cliente OAuth único de Google y llaves privadas `RS256` del JWKS), Cloud Storage (bundles Terraform y estado gestionado por Infrastructure Manager más archivo forense WORM), Cloud Logging y BigQuery.

**Testing**: Jest + Supertest (100 % único runner unitario e integración con cobertura `>= 70 %`), incluyendo pruebas de descubrimiento `/.well-known/openid-configuration`, validación estricta de `client_id` y `redirect_uri` en 1FN (`>= 250` URIs sin tope de 100 de GCP), obligatoriedad de PKCE `S256`, uso único de `code` (`<= 60 s`), federación con Google Cloud Identity y filtro de los subdominios institucionales, sesión SSO silenciosa multi-aplicación con `aud` exclusivo y `0` reclamos de roles en el `id_token`, espera corta local acotada (`<= 3 s`) en `REGISTRO_CALIENTE` con `fail-close`, SLO híbrido de dos capas (`OIDC Back-Channel Logout` + expiración `<= 300 s`), revocación reactiva en dos niveles (`CuentaInstitucional` vs `PersonaIdentidad` en `<= 300 s`), rotación dual y revocación de emergencia de llaves `RS256` segregadas por `servicio_emisor = 'SSO_OIDC'`, paridad 1:1 SQL/DBML (`sql-schema-alignment.spec.ts`) y validación estática de Terraform (`devops-iac-alignment.spec.ts`).

**Target Platform**: Google Cloud Platform — Proyectos de Servicio SSO: `mec-003-sso-des` (Desarrollo), `mec-003-sso-pre` (Preproducción) y `mec-003-sso-pro` (Producción), conectados a los Proyectos Host de Red Compartida (Shared VPC): `mec-003-sha-net-des`, `mec-003-sha-net-pre` y `mec-003-sha-net-pro-511014` — GKE Autopilot (`../microservicios/sso-oidc` con Workload Identity `sa-sso-core`, publicado detrás del External Application Load Balancer + Google Cloud Armor WAF `sso-oidc-waf-policy` en `https://login.sso.<dominio>` **sin Cloud IAP delante** conforme a `DA-11`), Memorystore for Redis, AlloyDB for PostgreSQL 16, Cloud Pub/Sub (`sso-pip-cache-invalidation`), Secret Manager, Artifact Registry (`sso-containers`) y **Google Cloud Infrastructure Manager (`config.googleapis.com` mediante `.gitlab-ci.yml` con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` invocando `sa-infra-manager@<project_id>.iam.gserviceaccount.com`)**.

**Project Type**: Plataforma central de autorización y gestión de accesos SSO (Subcomponente C2.2) bajo modelo **multirrepositorio en GitLab (`git.sitimapa.co`)**:
1. `minedec-sso`: Repositorio de gobernanza Spec Kit, esquemas DBML, migraciones SQL y contratos OpenAPI.
2. `../microservicios/shared` (`c2-sso/microservicios/shared`): Paquete transversal `@minedec/shared` publicado en GitLab NPM Package Registry.
3. `../microservicios/sso-oidc` (`c2-sso/microservicios/sso-oidc`): Servicio Intermediario OIDC Central en GKE Autopilot con su `Dockerfile` y `.gitlab-ci.yml`.
4. `../iac-terraform` (`c2-sso/devops/iac-terraform`): Repositorio central declarativo de infraestructura GCP en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) con Terraform `1.5.7` y `scripts/bundle.sh`.

**SSO Repo**:
- **Código de Aplicación**: `../microservicios/sso-oidc` y `../microservicios/shared` (rama sincronizada `spec/003-sso-oidc-intermediario`; *Identity Broker* OIDC central `sso-oidc` conforme a `D-01` y `DA-11`).
- **Infraestructura Declarativa**: `../iac-terraform` (`c2-sso/devops/iac-terraform`, rama sincronizada `spec/003-sso-oidc-intermediario`).

**Performance Goals**:
- Respuesta ágil en resolución de autorización silenciosa (`GET /authorize` con sesión activa en Redis) y canje de código (`POST /token`), sin umbrales fijos en milisegundos, con medición delegada exclusivamente a la infraestructura de borde (External Application Load Balancer / GKE Envoy / Cloud Trace) (`RNF-REN-01..06`, `D-06`, `BR-11`, `Principio V.4`, `Principio X.6`).
- Cero cálculo o exposición de duración por petición (`Date.now() - startedAt`, `latenciaMs`, `durationMs`) en el código Node.js (`FR-014`, `Principio V.4` y `Principio XIII`).
- Soporte de **`> 200` aplicaciones y `> 500` `redirect_uris`** (`>= 250` verificadas en suite de integración) en 1FN/3FN sin degradación ni bloqueo por el límite de 100 URIs de Google Cloud (`FR-002`, `FR-003`, `SC-001`).
- Espera corta local acotada en `REGISTRO_CALIENTE` estrictamente **`<= 3 segundos`** contra el PIP local / Redis con `0` llamadas directas desde `sso-oidc` a Google Admin SDK (`FR-006`, `FR-007`, `SC-003`, `Clarificación Q1`).
- Propagación de bajas, suspensiones y cierres de sesión (SLO) con purga inmediata en Redis (`< 5 s`) y límite duro absoluto de **`<= 300 segundos`** (`RF-GI-06`, `RF-AUT-06`, `PI-07`, `FR-010`, `FR-011`, `FR-012`, `SC-004`).
- Sustitución y retiro inmediato en `GET /jwks` de llaves `RS256` revocadas en **`< 1 hora`** (efectivo en `< 5 s` tras invocar el endpoint de revocación) y rotación periódica `<= 90 días` con `0 %` de interrupción (`FR-005`, `FR-013`, `SC-006`).

**Constraints**:
- Único IdP primario: Google Cloud Identity / Google Workspace (`https://accounts.google.com`, `D-01`) mediante un **único cliente OAuth 2.0** registrado en Google Cloud (`DA-11`); prohibido integrar Active Directory o LDAP.
- `sso-oidc` se publica detrás de External Application Load Balancer + Cloud Armor WAF (`sso-oidc-waf-policy`) **sin Cloud IAP delante** (`DA-11`).
- Prohibido incluir roles, permisos, perfiles, grupos lógicos o alcance territorial dentro del `id_token` emitido por `sso-oidc` (`FR-009`, `SC-002`).
- Prohibido emitir un `id_token` sin `(tipo_identificacion, numero_identificacion)` e `id_interno` consolidados (`fail-close` en `FR-007`, `FR-008` y `SC-002`).
- Cero llaves privadas `RS256` o secretos en texto plano en AlloyDB, código o imágenes Docker; uso exclusivo de Google Secret Manager y hashes `SHA-256` (`Principio IX`).
- Prohibido incluir archivos `.tf` de infraestructura GCP dentro de los repositorios de aplicación o utilizar `cloudbuild.yaml` (`Principios IV y XVIII`).

**Scale/Scope**: Subcomponente C2.2 exclusivamente (Subcomponente C2.3 fuera de alcance); autenticación federada centralizada para el universo nacional de **~2,28 millones de cuentas institucionales** en los subdominios `@educacion.gob.ec`, `@estudiantes.educacion.gob.ec` (`@estudiante.edu.ec` / `@docentes.educacion.gob.ec`), `@deporte.gob.ec` y `@cultura.gob.ec`, sirviendo a decenas de aplicaciones ministeriales (Patrón 1 y PEP Patrón 2).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked and verified after Phase 1 design (`research.md`, `data-model.md`, `contracts/sso-oidc-api.openapi.yaml`, `quickstart.md`) against Constitución MINEDEC v2.11.0.*

- [x] Language/Version coincide con el stack ratificado en `.specify/memory/constitution.md` v2.11.0 (TypeScript 5.8+ `strict: true` sobre Node.js 22 LTS en repositorios independientes consumiendo `@minedec/shared` desde GitLab NPM Package Registry y Terraform HCL `1.5.7` sin Terragrunt en `../iac-terraform`; sin improvisar otro lenguaje)
- [x] Stack ratificado resuelto: sin `[PLACEHOLDER]` pendiente en Language/Version, Primary Dependencies (`@minedec/shared`, `Express 5`, `oidc-provider`, `inversify`, `zod`, `jose`, `pg` + `pg-format`, `ioredis`, `helmet`, `pino`), Storage, Testing (`Jest + Supertest`), Target Platform (`mec-003-sso-{des,pre,pro}` sobre Shared VPC `mec-003-sha-net-{des,pre,pro-511014}`), Project Type, OIDC Issuer (doble nivel `D-01` + `DA-11`: `https://accounts.google.com` validado por `sso-oidc` y `https://login.sso.<dominio>` como emisor OIDC ante las aplicaciones), SSO Repo (`../microservicios/sso-oidc` + `../microservicios/shared` + `../iac-terraform`)
- [x] Separación multirrepositorio en GitLab (`git.sitimapa.co`, Principios IV y XVIII): `../microservicios/sso-oidc` contiene exclusivamente código de aplicación, pruebas, `Dockerfile` multi-stage `non-root` (`node:22-alpine`) y `.gitlab-ci.yml` ejecutado con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (cero archivos `.tf` y cero `cloudbuild.yaml`); `../iac-terraform` contiene exclusivamente módulos, plantillas y despliegues Terraform HCL (`1.5.7`) gobernados por Google Cloud Infrastructure Manager (`sa-infra-manager`) en la rama sincronizada `spec/003-sso-oidc-intermediario`
- [x] Microservicios o jobs desacoplados; `../microservicios/sso-oidc` interactúa con el PIP, Redis y AlloyDB dentro del dominio acotado del núcleo SSO C2.2 (`deletion_protection = true`)
- [x] Pruebas unitarias/integración mapeadas; cobertura prevista ≥ 70 % con Jest + Supertest (detalladas en `quickstart.md` y exigidas como Quality Gate bloqueante en `.gitlab-ci.yml`)
- [x] Flujos E2E de usuario crítico identificados **si hay UI** (N/A para la Consola Web SPA de administración, que pertenece a la feature de Consola PAP; los endpoints de redirección OIDC `/authorize`, `/callback` y `/logout` se verifican íntegramente mediante pruebas de integración HTTP con Supertest)
- [x] OpenAPI o contrato de datos actualizable en `contracts/` (`specs/003-sso-oidc-intermediario/contracts/sso-oidc-api.openapi.yaml`)
- [x] Spec y este plan: cuerpo en español; IDs FR-/SC- y User Story sin traducir
- [x] SSO: `sso-oidc` implementa el *Identity Broker* OIDC central (`DA-11`) con `Authorization Code + PKCE S256` obligatorio y único cliente OAuth 2.0 ante Google Cloud Identity (`D-01`)
- [x] OKF/knowledge citado (`knowledge/arquitectura/decisiones-arquitectonicas-adrs.md`, `knowledge/arquitectura/patrones-integracion-pep-oid-saml.md`, `knowledge/arquitectura/componentes-pdp-core.md`, `knowledge/dominio/identidad-esquema-minedec-perfil.md`, `knowledge/requerimientos/rf-gestion-identidades-federacion.md`); nada de LOEI inventada
- [x] Si hay reglas LOEI / pedagógicas / de movimiento: Drools (u motor aprobado); si no aplican, N/A (N/A)
- [x] Si hay mapa interactivo: MapLibre; si no hay mapa, MapLibre N/A (N/A)
- [x] Identidad de servicio: cuenta dedicada de mínimo privilegio (`sa-sso-core` con Workload Identity en GKE Autopilot, cero llaves JSON); secretos de cliente OAuth de Google y llaves privadas `RS256` en Google Secret Manager (`Principio IX`)
- [x] Observabilidad de aplicación: logs estructurados JSON con `pino` + OpenTelemetry (`GKE_AUTOPILOT`, propagación de `traceparent` + `X-Cloud-Trace-Context` + `X-Trace-Id`, redacción Zero-Secret de códigos, tokens y secretos), manejador centralizado `oidcErrorHandler` con diagnósticos en español (`AdminIncidentDiagnosticReport`), y **cero cálculo de latencia por petición en Node.js (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII)**
- [x] Verificación documental obligatoria en Google Developer Knowledge (`Principio V.13` — `retrieving-developer-knowledge`): recursos `documents/developers.google.com/identity/openid-connect/reference`, `documents/developers.google.com/identity/gsi/web/guides/verify-google-id-token`, `documents/developers.google.com/identity/sign-in/web/backend-auth`, `documents/docs.cloud.google.com/armor/docs/integrating-cloud-armor`, `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/ingress-configuration`, `documents/docs.cloud.google.com/kubernetes-engine/docs/tutorials/workload-identity-secrets`, `documents/docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component`, `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc` y `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account` verificados y citados en `research.md`
- [x] No implementar Security Command Center ni landing zone org-level
- [x] Autorización en servidor por operación (el `id_token` emitido por `sso-oidc` jamás contiene roles ni permisos; consultas SQL 100 % parametrizadas `$1, $2`, identificadores dinámicos solo por lista blanca cerrada + regex `safe_sql_identifier` + `%I`, y migraciones DDL estáticas)
- [x] **Gate Constitucional Extra (Principios IV, V, VI, IX, XIII, XIV, XV, XVI y XVIII)**: Reutilización DRY en `@minedec/shared` (`../microservicios/shared/`), `InversifyJS` exclusivamente en `../microservicios/sso-oidc/src/container.ts` (0 decoradores en `domain/` y `application/`), segregación de llaves `RS256` por `servicio_emisor = 'SSO_OIDC'`, SLO híbrido con Back-Channel Logout + expiración `<= 300 s`, bitácora `auditoria_evento` append-only con cadena SHA-256, y contenedor `node:22-alpine` con `USER node`.

## Project Structure

### Documentation (this feature)

```text
specs/003-sso-oidc-intermediario/
├── plan.md              # Plan de implementación técnica (/speckit-plan - Constitución v2.11.0)
├── research.md          # Decisiones de arquitectura DA-11, Redis adapter, REGISTRO_CALIENTE 3s, SLO híbrido, JWKS y GitLab/Shared VPC
├── data-model.md        # Esquema relacional 1FN/3FN/BCNF en AlloyDB (Migración 004) y claves Redis
├── quickstart.md        # Guía ejecutable de verificación de los 5 escenarios de la Feature 003
├── contracts/           # Contrato OpenAPI 3.1.0 de Fase 1
│   └── sso-oidc-api.openapi.yaml
└── tasks.md             # Lista de tareas ordenadas por dependencias (/speckit-tasks)
```

### 1. Source Code — Repositorios Independientes de Aplicación (`../microservicios/*` y `minedec-sso`)

```text
../microservicios/
├── shared/                          # c2-sso/microservicios/shared — Paquete transversal @minedec/shared (GitLab NPM Registry)
│   ├── .gitlab-ci.yml               # Pipeline GitLab CI (build, SAST, tests y npm publish en GitLab Package Registry)
│   ├── package.json
│   └── src/
│       ├── domain/                  # Validadores de identidad canónica y dominios institucionales
│       ├── db/                      # Pool AlloyDB (pg) y ALLOWED_PIP_SQL_IDENTIFIERS actualizado con tablas OIDC
│       ├── cache/                   # Cliente Redis L2 (TTL <= 300 s)
│       ├── audit/                   # Escritor de auditoría inmutable SHA-256 (ampliado con eventos SSO_OIDC_BROKER)
│       └── observability/           # Logger estructurado pino (GKE_AUTOPILOT) + OpenTelemetry + diagnósticos en español
├── pip-identity-service/            # c2-sso/microservicios/pip-identity-service (Feature 001)
├── sincronizador/                   # c2-sso/microservicios/sincronizador (Feature 002)
├── conciliacion-job/                # c2-sso/microservicios/conciliacion-job (Feature 002)
└── sso-oidc/                        # c2-sso/microservicios/sso-oidc — Servicio Intermediario OIDC Central en GKE Autopilot (DA-11 — sa-sso-core)
    ├── .gitlab-ci.yml               # Pipeline CI (gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com -> sso-containers:$CI_COMMIT_SHA)
    ├── Dockerfile                   # Multi-stage build sobre node:22-alpine con ejecución non-root (USER node)
    ├── package.json                 # Consume @minedec/shared desde GitLab NPM Package Registry
    ├── src/
    │   ├── domain/
    │   │   ├── entities/            # ClienteOidc, ClienteOidcRedirectUri, SesionCentralOidc, CodigoAutorizacionEfimero, LlaveJwksRotacion
    │   │   ├── services/            # Validador PKCE S256 + URI exacta 1FN, constructor de reclamos id_token sin roles y logout_token
    │   │   └── ports/               # Interfaces segregadas (ISP): OidcClientRepositoryPort, OidcSessionStorePort, GoogleIdpFederationPort, PipIdentityResolverPort, JwksKeyStorePort, BackchannelLogoutDispatcherPort
    │   ├── application/
    │   │   ├── start-oidc-authorization.usecase.ts         # Validación client_id + redirect_uri 1FN + PKCE S256 y SSO silencioso (revalidado <= 300 s) o redirección a Google
    │   │   ├── handle-google-idp-callback.usecase.ts       # Verificación id_token Google + filtro hd + resolución PIP con espera corta local (<= 3 s) en REGISTRO_CALIENTE y fail-close
    │   │   ├── exchange-authorization-code.usecase.ts      # Consumo atómico de code (<= 60 s, uso único), verificación PKCE/client_secret dual y emisión id_token RS256 sin roles
    │   │   ├── execute-single-logout.usecase.ts            # SLO híbrido: destrucción en Redis + despacho asíncrono OIDC Back-Channel Logout + redirección POST_LOGOUT
    │   │   ├── revoke-identity-sessions.usecase.ts         # Purga inmediata (< 5 s) selectiva por CuentaInstitucional o en cascada por PersonaIdentidad
    │   │   └── manage-jwks-keys.usecase.ts                 # Publicación /jwks (SSO_OIDC: ACTIVA_FIRMA + GRACIA_VERIFICACION), rotación dual y revocación de emergencia (< 1 h)
    │   ├── infrastructure/
    │   │   ├── oidc-provider/       # Integración de oidc-provider + RedisOidcAdapter respaldado en Memorystore for Redis
    │   │   ├── google-idp/          # GoogleCloudIdentityRelyingPartyAdapter (único cliente OAuth 2.0 y verificador criptográfico JWS/hd)
    │   │   ├── pip/                 # Adaptador de consulta/hidratación contra el PIP y espera local acotada (<= 3 s, 0 llamadas a GWS)
    │   │   ├── persistence/         # Repositorios PostgreSQL 100% parametrizados ($1, $2) para cliente_oidc, cliente_oidc_redirect_uri y llave_jwks_rotacion
    │   │   ├── crypto/              # Adaptador RS256 (jose + Google Secret Manager) y despachador HTTP de Back-Channel Logout
    │   │   └── http/                # Rutas y controladores Express 5 validados con Zod (/.well-known/openid-configuration, /authorize, /callback, /token, /jwks, /logout, /internal/v1/oidc/*) y oidcErrorHandler
    │   ├── container.ts             # Composition Root con InversifyJS (decorate/bind externo, 0 decoradores en domain/ y application/)
    │   └── index.ts
    └── tests/
        ├── unit/
        │   ├── oidc/                # Pruebas unitarias de PKCE S256, validación exacta de URIs 1FN, id_token sin roles, logout_token y rotación JWKS
        │   ├── container-wiring.spec.ts     # Verificación de pureza hexagonal, InversifyJS y cero cálculo de latencia en sso-oidc
        │   ├── sql-schema-alignment.spec.ts # Paridad 1:1 entre migraciones 001-004, DBML Etapas 1-3 y repositorios
        │   └── devops-iac-alignment.spec.ts # Validación de Dockerfile non-root, .gitlab-ci.yml y módulos Terraform de sso-oidc
        └── integration/
            └── oidc/                # Pruebas de integración de flujo OIDC completo, SSO silencioso multi-app (>= 250 URIs), REGISTRO_CALIENTE (<= 3 s + fail-close), SLO híbrido + revocación <= 300 s y rotación/revocación JWKS

minedec-sso/migrations/
├── 001_init_pip_identity_schema.sql
├── 002_seed_minedec_catalogs.sql
├── 003_sync_reconciliation_schema.sql
└── 004_sso_oidc_broker_schema.sql   # Tablas aplicacion, cliente_oidc, cliente_oidc_redirect_uri, llave_jwks_rotacion (con servicio_emisor) y extensión de auditoria_evento / dominio_institucional
```

### 2. Infrastructure as Code — Repositorio Central (`../iac-terraform` / `c2-sso/devops/iac-terraform`)

```text
../iac-terraform/                    # Rama sincronizada: spec/003-sso-oidc-intermediario (Terraform 1.5.7)
├── .gitlab-ci.yml                   # Pipeline GitLab CI/CD (validate, bundle.sh, infra-manager previews create / deployments apply con sa-infra-manager)
├── scripts/
│   └── bundle.sh                    # Empaqueta despliegues/<ambiente>/<stack> resolviendo modulos/ y plantillas/ para Infrastructure Manager
├── modulos/
│   ├── alloydb/
│   ├── redis/
│   ├── gke_pip_service/
│   ├── gke_sso_oidc_service/        # Módulo GKE Autopilot para sso-oidc + External ALB Ingress + Cloud Armor WAF (sso-oidc-waf-policy, sin IAP delante, DA-11)
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── pubsub_cloud_tasks_sync/     # Extendido con suscripción push desde sso-pip-cache-invalidation hacia sso-oidc (< 5 s)
│   ├── cloud_run_sincronizador/
│   ├── cloud_run_conciliacion_job/
│   ├── secret_manager/              # Extendido con secretos GOOGLE_IDP_CLIENT_ID, GOOGLE_IDP_CLIENT_SECRET y llaves privadas JWKS RS256 de sso-oidc
│   └── monitoring/                  # Extendido con alertas SRE de disponibilidad 5xx, latencia p95/p99 del External ALB/sso-oidc y rotación JWKS
├── plantillas/
│   ├── devops/                      # Artifact Registry (sso-containers) e IAM base (sa-infra-manager, sa-sso-core, sa-sso-sync, sa-sso-sync-job, sa-sso-publicador)
│   ├── data/                        # AlloyDB + Memorystore for Redis conectados a la Shared VPC existente
│   └── apps/                        # Composición de GKE Autopilot (pip-identity-service + sso-oidc) y Cloud Run (sincronizador + conciliacion-job)
└── despliegues/
    ├── des/                         # Proyecto mec-003-sso-des sobre Shared VPC mec-003-sha-net-des
    │   ├── devops/
    │   ├── data/
    │   └── apps/
    ├── pre/                         # Proyecto mec-003-sso-pre sobre Shared VPC mec-003-sha-net-pre
    │   ├── devops/
    │   ├── data/
    │   └── apps/
    └── pro/                         # Proyecto mec-003-sso-pro sobre Shared VPC mec-003-sha-net-pro-511014
        ├── devops/
        ├── data/
        └── apps/
```

**Structure Decision**: Se adopta el modelo constitucional **v2.11.0 de repositorios independientes en GitLab (`git.sitimapa.co`) sincronizados en la rama `spec/003-sso-oidc-intermediario`**:
1. En **`../microservicios/shared`** (`c2-sso/microservicios/shared`) se publican las utilidades transversales (`@minedec/shared`) en el **GitLab NPM Package Registry**, y en **`../microservicios/sso-oidc`** (`c2-sso/microservicios/sso-oidc`) se implementa el servicio con `InversifyJS` configurado exclusivamente en `src/container.ts` (0 decoradores en `domain/` y `application/`), su `Dockerfile` multi-stage `non-root` (`node:22-alpine`, `USER node`) y su pipeline `.gitlab-ci.yml` ejecutado con `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com`.
2. En **`../iac-terraform`** (`c2-sso/devops/iac-terraform`, rama `spec/003-sso-oidc-intermediario`) se declara en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) el módulo `gke_sso_oidc_service` con cuenta de servicio `sa-sso-core` expuesto detrás del External Application Load Balancer + Google Cloud Armor WAF (`sso-oidc-waf-policy`, **sin Cloud IAP delante**, `DA-11`) sobre la Shared VPC institucional, empaquetado con `scripts/bundle.sh` y gobernado por **Google Cloud Infrastructure Manager (`sa-infra-manager`)**.

## Complexity Tracking

> **Sin violaciones a la Constitución**: Todos los componentes de aplicación e infraestructura cumplen íntegramente con `.specify/memory/constitution.md` v2.11.0 sin requerir excepciones.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Ninguna | N/A | N/A |
