# Research & Technical Decisions: Motor de Autorización Central (motor-pdp)

**Feature**: `004-motor-pdp-autorizacion`  
**Date**: 2026-10-26  
**Status**: Approved  

---

## 1. Decisiones Técnicas y de Arquitectura

### Decisión 1: Motor de Decisión Híbrido RBAC + ABAC basado en AST JSON Tipado y Precompilación en Memoria

- **Decisión**: Implementar el motor de cruce multidimensional RBAC × ABAC como un evaluador determinista y puro en TypeScript (`src/domain/services/rbac-abac-evaluator.service.ts` en `../microservicios/motor-pdp`), procesando reglas de negocio representadas como un AST JSON (*Abstract Syntax Tree*) validado estrictamente con `zod` (`regla_cruce_abac_rbac`).
- **Racional**: En el Subcomponente C2.2 (SSO MINEDEC), la autorización combina la función del usuario (eje RBAC: `tipoUsuario`, `subtipoUsuario`, `cargoFuncion`, roles específicos) con el contexto de asignación (eje ABAC: `viceministerio`, `nivelAcademico`, `codigoInstitucion` AMIE titular y multisede, `codigoDependenciaAdmin`, `zonaDistritoCircuito` y vigencia temporal). Utilizar un AST JSON tipado permite que el servicio PAP administre y compile bundles de políticas que se cargan en memoria y Redis L2, evaluando solicitudes con cero llamadas recurrentes a la base de datos y sin dependencias de motores externos pesados.
- **Alternativas descartadas**:
  - *Open Policy Agent (OPA) / Rego*: Introduce un proceso desacoplado adicional con latencia de red inter-servicio (o sidecar con sobrecarga de memoria en Pods) y obliga a mantener una lógica de políticas en lenguaje Rego, ajeno al stack TypeScript 5.8+ ratificado en la Constitución MINEDEC.
  - *Consultas SQL dinámicas directas por petición*: Generaría un cuello de botella inmanejable en la base de datos relacional para el volumen concurrente de estudiantes (~2,1 millones) y docentes.
- **Referencias OKF**:
  - `knowledge/dominio/modelo-autorizacion-rbac-abac.md`
  - `knowledge/dominio/matriz-atributos-gws-catalogos.md`
  - `docs/esquemas-bd/etapa-2-autorizacion-pdp-pap-rbac-abac.dbml` (`grupo_logico.regla_cruce_abac_rbac`)

---

### Decisión 2: Proyecciones de Caché L2 en Memorystore for Redis y Postura Fail-Close

- **Decisión**: Utilizar **Memorystore for Redis (Standard Tier con Alta Disponibilidad)** para almacenar dos estructuras clave-valor:
  1. `minedec:pdp:bundle:{aplicacion_codigo}`: Contiene el catálogo de rutas ordenadas por especificidad, la bandera `modo_sombra` de la aplicación y el conjunto precompilado de grupos lógicos/reglas (incluyendo expansión de roles y perfiles `RF-AUZ-04`).
  2. `minedec:pdp:decision:{aplicacion_codigo}:{id_interno}:{cuenta_id}:{version_catalogo}`: Contiene la decisión de autorización precalculada por persona y cuenta institucional (`cuenta_id`), roles y permisos efectivos, matriz de capacidades CRUD (`permisos_crud_json`) y scoping territorial (`TTL <= 300 s`).
  Ante cualquier falla de conexión con Redis o AlloyDB, el servicio adopta la **política estricta *Fail-Close*** (`DA-10`, `RNF-SEG-10`, `PI-06`), respondiendo con `HTTP 503 Service Unavailable` y bloqueando el acceso.
- **Racional**: Garantiza respuesta ágil y consistente, absorbiendo picos de concurrencia institucional. El límite duro de 300 segundos (`RF-GI-06`, `RF-AUT-06`, `PI-07`) asegura que las desvinculaciones o revocaciones se propaguen en un tiempo máximo acotado, además de contar con invalidación reactiva por eventos de Cloud Pub/Sub (`sso-pip-cache-invalidation`).
- **Alternativas descartadas**:
  - *Caché solo en memoria local de proceso (RAM del pod)*: Impediría la sincronización y coherencia de revocaciones entre múltiples réplicas en GKE Autopilot.
  - *Fail-open ante contingencias*: Abrir accesos cuando el PDP no responde comprometería severamente la seguridad nacional y la protección de datos de menores de edad.
- **Referencias Oficiales de Google Developer Knowledge**:
  - `documents/docs.cloud.google.com/memorystore/docs/redis/high-availability-for-memorystore-for-redis`
  - `documents/docs.cloud.google.com/memorystore/docs/cluster/ha-and-replicas`

---

### Decisión 3: Autenticación Máquina a Máquina (M2M) con Rotación Dual y Verificación en Tiempo Constante

- **Decisión**: Exponer `POST /api/v1/oauth/token` implementando `OAuth 2.0 Client Credentials Grant` (`RFC 6749 §4.4`), validando `client_id` y `client_secret` contra la tabla `credencial_m2m` de AlloyDB. El secreto se compara calculando su hash SHA-256 y aplicando comparación en tiempo constante (`crypto.timingSafeEqual`). Se soporta rotación periódica `<= 90 días` con ventana de gracia dual (`secreto_activo_hash` y `secreto_anterior_hash` con fecha límite `gracia_hasta`). Devuelve un Bearer Token JWT firmado con `RS256` y vigencia de 3600 s.
- **Racional**: La decisión arquitectónica `DA-11` establece que las aplicaciones y PEPs no utilizan credenciales de Google Cloud ni interactúan directamente con el intermediario OIDC para autorización backend-a-backend. Guardar solo el hash SHA-256 (`CHAR(64)`) cumple con el principio de *Zero Secret* y rotación sin tiempo de inactividad (*zero downtime*).
- **Alternativas descartadas**:
  - *Almacenar secretos en texto plano o cifrado reversible*: Inaceptable bajo la Constitución MINEDEC (Principio IX).
  - *Tokens de larga duración (días/meses)*: Incrementan la superficie de exposición ante exfiltración de credenciales.
- **Referencias OKF**:
  - `knowledge/arquitectura/contrato-autorizacion-pep-pdp.md` (§1)
  - `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml` (`credencial_m2m`)

---

### Decisión 4: Aserción Criptográfica `X-Minedec-Assertion` y Publicación JWKS Segregada por `MOTOR_PDP`

- **Decisión**: En cada respuesta exitosa de evaluación sobre rutas protegidas, el PDP emite en el campo `assertion_jwt` un JWT firmado con `RS256` mediante la librería `jose`, con vigencia de 60 segundos (`exp = +60s`), `iss = https://pdp.sso.<dominio>`, `aud = uuid_aplicacion` y los claims de identidad y contexto resueltos. Las claves públicas se publican en `GET /api/v1/.well-known/jwks.json` filtrando estrictamente las llaves en `llave_jwks_rotacion` donde `servicio_emisor = 'MOTOR_PDP'` y `estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')`.
- **Racional**: En el Patrón 2 (PEP Perimetral), el PEP inyecta las cabeceras HTTP `X-Minedec-*` hacia el backend junto con `X-Minedec-Assertion`. Esto permite a los microservicios backend comprobar criptográficamente que las cabeceras no fueron inyectadas ni modificadas por un actor malicioso en tránsito, verificando la firma con el JWKS del PDP. La segregación por `servicio_emisor` garantiza que las claves de firma del intermediario OIDC (`sso-oidc`) no se mezclen con las claves del PDP.
- **Alternativas descartadas**:
  - *Firma simétrica HMAC SHA-256*: Requeriría compartir una clave secreta simétrica con todos los microservicios y PEPs, aumentando el riesgo de fuga.
  - *Endpoint JWKS compartido sin discriminar servicio*: Rompería el principio de mínimo privilegio y aislamiento de dominios de confianza criptográfica.
- **Referencias Oficiales de Google Developer Knowledge**:
  - `documents/docs.cloud.google.com/secret-manager/docs/secret-rotation`
  - `documents/docs.cloud.google.com/secret-manager/docs/rotation-recommendations`

---

### Decisión 5: Normalización Determinista de Rutas y Precedencia Jerárquica

- **Decisión**: Toda ruta recibida en `POST /api/v1/access/evaluation` pasa por una tubería de normalización estricta (`route-normalizer-matcher.service.ts`):
  1. Decodificación de secuencias percent-encoding permitidas.
  2. Detección y rechazo inmediato con `HTTP 400 Bad Request` ante caracteres nulos (`%00`), secuencias de escape no canónicas, dobles codificaciones o patrones de *path traversal* (`..` fuera de la raíz).
  3. Búsqueda en el catálogo de rutas con orden de especificidad determinista:
     - Prioridad 1: Coincidencia **EXACTA** (método HTTP específico o `ALL`).
     - Prioridad 2: Coincidencia por **PREFIJO** de mayor longitud (*longest prefix match*).
     - Prioridad 3: Coincidencia por **EXTENSION** (ej. `*.pdf`).
     - Prioridad 4: **Regla por defecto de la aplicación** (`politica_ruta_defecto`: `PROTEGIDA` por defecto, fail-close).
- **Racional**: Mitiga vulnerabilidades de bypass de WAF / PEP perimetral y asegura que rutas críticas específicas tengan prioridad sobre comodines genéricos.
- **Referencias OKF**:
  - `knowledge/arquitectura/contrato-autorizacion-pep-pdp.md` (§3)
  - `docs/esquemas-bd/etapa-2-autorizacion-pdp-pap-rbac-abac.dbml` (`ruta_catalogo`, índices y enums)

---

### Decisión 6: Modo Sombra (*Shadow Mode*) y Auditoría Estructurada de 3 Capas sin Cuello de Botella

- **Decisión**: Incorporar soporte para evaluar aplicaciones (`aplicacion.modo_sombra`) o rutas individuales (`ruta_catalogo.modo_sombra`) en modo sombra (`modo_sombra: true`). Cuando el modo sombra está activo:
  - Si la regla evalúa como denegada (`autorizado: false`), el motor retorna en la respuesta HTTP `autorizado: true`, pero asigna `codigo_decision = 'AUTHZ_PERMITTED_SHADOW_MODE'` y adjunta en los metadatos `modo_sombra_activo: true` y la decisión efectiva proyectada (`AUTHZ_DENIED_POLICY`).
  - Para preservar una respuesta ágil conforme a `RNF-REN-01..06` y `D-06` (sin umbrales fijos en milisegundos) y evitar la serialización del `pg_advisory_xact_lock` de `auditoria_evento` en cada petición de evaluación (`POST /api/v1/access/evaluation`), las decisiones de autorización (`PDP_EVALUACION_PERMIT`, `PDP_EVALUACION_DENY`, `PDP_EVALUACION_SHADOW_PERMIT`) se emiten de forma asíncrona no bloqueante mediante registros estructurados JSON (`pino`) hacia Cloud Logging Sink / Cloud Pub/Sub con ingesta en streaming hacia `bq_auditoria_analitica_append_only` (BigQuery append-only) y `gcs_worm_archivo_forense` (Cloud Storage WORM). La tabla `auditoria_evento` en AlloyDB (con encadenamiento SHA-256) se reserva para eventos de control, bloqueos perimetrales de seguridad (`PDP_RECHAZO_SEGURIDAD_RUTA`), autenticación M2M (`POST /api/v1/oauth/token`), invalidaciones Pub/Sub y rotaciones JWKS.
- **Racional**: Permite desplegar nuevas aplicaciones y transicionar sistemas legados minimizando el riesgo de falsos positivos y cortes de operación, y garantiza simultáneamente trazabilidad forense inmutable de 3 capas sin convertir a AlloyDB en un cuello de botella secuencial.
- **Alternativas descartadas**:
  - *Escribir cada decisión de evaluación sincrónicamente en `auditoria_evento` (AlloyDB)*: El bloqueo consultivo `pg_advisory_xact_lock` serializaría miles de peticiones por segundo de los 2,28 millones de usuarios, degradando la respuesta de alta velocidad requerida por `RNF-REN-01..06` y `D-06`.
  - *Modo sombra mediante duplicación de tráfico a nivel de red*: Duplica el consumo de cómputo y requiere componentes de enrutamiento avanzados; implementarlo en la lógica del PDP ofrece control granular por aplicación y ruta.

---

### Decisión 7: Topología en GKE Autopilot, Internal Load Balancer y Cero Telemetría de Latencia en Node.js

- **Decisión**: Desplegar el microservicio `../microservicios/motor-pdp` (`c2-sso/microservicios/motor-pdp`) en **GKE Autopilot** con Workload Identity asociado a la cuenta de servicio dedicada `sa-sso-core`. El servicio se expone internamente mediante un **Internal Load Balancer passthrough L4** (`networking.gke.io/l4-regional-internal` con GKE subsetting habilitado) para ser consumido de forma privada por los backends de las aplicaciones y el PEP. De acuerdo con `RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII de la Constitución MINEDEC, el código Node.js **no calcula ni expone campos de latencia en milisegundos (`Date.now() - startedAt`, `latenciaMs`)**; la observabilidad de latencia se delega a Cloud Monitoring y Cloud Trace.
- **Racional**: Cumple estrictamente con la constitución de este repositorio y protege el rendimiento al evitar llamadas no optimizadas al reloj de sistema en peticiones concurrentes de alta frecuencia.
- **Referencias Oficiales de Google Developer Knowledge**:
  - `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/internal-load-balancing`

---

### Decisión 8: Operación sobre la Red Compartida (Shared VPC) Institucional y Permisos IAM de `sa-infra-manager` (`Constitución v2.11.0`)

- **Decisión**: En cumplimiento de la **Constitución MINEDEC v2.11.0 (Principios IV y XVIII)**:
  1. **Consumo de la Red Compartida (Shared VPC) sin Stack `host` en `../iac-terraform`**:
     - La Red Compartida (Shared VPC), sus subredes y la conexión de Private Services Access son administradas centralmente por el equipo de redes en los proyectos host oficiales: `mec-003-sha-net-des` (Desarrollo), `mec-003-sha-net-pre` (Preproducción) y `mec-003-sha-net-pro-511014` (Producción).
     - El repositorio `../iac-terraform` (`c2-sso/devops/iac-terraform`) **no incluye un stack `host` ni crea redes VPC propias**; despliega exclusivamente en los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`), referenciando las rutas relativas canónicas `projects/${var.host_project_id}/global/networks/${var.network_name}` y `projects/${var.host_project_id}/regions/${var.region}/subnetworks/${var.subnetwork_name}`.
     - Dichas referencias alimentan la conectividad privada de **GKE Autopilot** (`pip-identity-service`, `sso-oidc` y el Internal Load Balancer L4 de `motor-pdp`), el **Direct VPC Egress** de los servicios y jobs de **Cloud Run** (`sincronizador` y `conciliacion-job`), **AlloyDB for PostgreSQL 16** (o Cloud SQL en pruebas de desarrollo) y **Memorystore for Redis**.
     - **Segmentación CIDR oficial exclusiva (`/20`, `/23`, `/24`)**: El direccionamiento de red emplea únicamente las 3 máscaras oficiales definidas: **`/20`** (`10.10.16.0/20`) para el rango secundario `pods` de GKE Autopilot, **`/24`** (`10.10.2.0/24`) para el rango secundario `services` de GKE Autopilot, y **`/23`** (`10.10.0.0/23`) subdividido en dos bloques `/24` contiguos: `10.10.0.0/24` como subred primaria unificada `snet-sso-ue1` (nodos GKE Autopilot + Direct VPC Egress de Cloud Run) y `10.10.1.0/24` como rango global de Private Services Access `psa-sso-<ambiente>` (`servicenetworking.googleapis.com` para AlloyDB/Cloud SQL y Memorystore Redis), operando el plano de control de GKE Autopilot sobre Private Service Connect (`master_ipv4_cidr_block = null`). En el ambiente `des` (`mec-003-sso-des`), `plantillas/devops` permite aprovisionar esta topología sobre una VPC local (`enable_local_vpc = true`) mientras se mantiene comentada la referencia al proyecto host `mec-003-sha-net-des`.
  2. **Gobernanza IAM en `plantillas/devops`**:
     - `sa-infra-manager@<project_id>.iam.gserviceaccount.com` actúa como cuenta de servicio oficial de **Google Cloud Infrastructure Manager (`config.googleapis.com`)** con `roles/config.agent` en el proyecto de servicio SSO y permisos de usuario de subred (`roles/compute.networkUser` / `roles/container.hostServiceAgentUser`) sobre la subred compartida del proyecto host.
     - Se aprovisionan de forma declarativa las cuentas de servicio estandarizadas de mínimo privilegio: `sa-sso-core` (GKE: `pip-identity-service`, `sso-oidc`, `motor-pdp`, `api-pap`), `sa-sso-sync` (`sincronizador`), `sa-sso-sync-job` (`conciliacion-job`) y `sa-sso-publicador` (`publicador-job`).
- **Racional**: Se alinea con la arquitectura de red institucional del Ministerio (Shared VPC gestionada por el equipo de redes), evita duplicar infraestructura de red en los proyectos de servicio SSO y mantiene un modelo 100 % declarativo y auditado por Infrastructure Manager.
- **Alternativas descartadas**:
  - *Aprovisionar una VPC aislada (`vpc-sso-*`) dentro del proyecto de servicio SSO*: Descartado en la Constitución v2.11.0 porque la topología oficial del Ministerio opera sobre los proyectos host de Shared VPC (`mec-003-sha-net-{des,pre,pro-511014}`).
- **Referencias Oficiales de Google Developer Knowledge**:
  - `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc`
  - `documents/docs.cloud.google.com/run/docs/configuring/shared-vpc-direct-vpc`
  - `documents/docs.cloud.google.com/alloydb/docs/about-private-services-access`
  - `documents/docs.cloud.google.com/memorystore/docs/redis/establish-connection`
  - `documents/docs.cloud.google.com/memorystore/docs/redis/networking`
  - `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account`
  - `documents/docs.cloud.google.com/infrastructure-manager/docs/access-control`

---

### Decisión 9: CI/CD 100 % en GitLab (`.gitlab-ci.yml`), GitLab NPM Package Registry (`@minedec/shared`), Artifact Registry (`sso-containers`) y Empaquetado en 3 Capas con `scripts/bundle.sh` para Infrastructure Manager

- **Decisión**: Estandarizar el ciclo CI/CD de aplicación e infraestructura al 100 % sobre **GitLab (`git.sitimapa.co`, subgrupos `c2-sso/microservicios` y `c2-sso/devops/iac-terraform`)**, eliminando por completo `cloudbuild.yaml` y triggers de Cloud Build Repositories:
  1. **Runner Institucional Sin Llaves JSON**:
     - Todos los pipelines `.gitlab-ci.yml` se ejecutan en el runner institucional de GitLab autenticado de forma nativa por metadata server de GCE mediante su cuenta de servicio adjunta `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (cero llaves JSON exportadas).
  2. **Pipelines de Microservicios (`../microservicios/*`) y Registro NPM + Docker (`sso-containers`)**:
     - El repositorio `../microservicios/shared` (`c2-sso/microservicios/shared`) compila, prueba y publica versiones inmutables de `@minedec/shared` en el **GitLab NPM Package Registry**.
     - El repositorio `../microservicios/motor-pdp` (`c2-sso/microservicios/motor-pdp`) instala `@minedec/shared`, ejecuta SAST (`ESLint`), SCA (`npm audit`), detección de secretos (`Gitleaks`), pruebas unitarias e integración (`Jest + Supertest` con cobertura `>= 70 %`), construye la imagen Docker multi-stage `non-root` (`node:22-alpine`, `USER node`) y la publica en el repositorio de Artifact Registry `sso-containers` (`us-central1-docker.pkg.dev/<project_id>/sso-containers/motor-pdp:$CI_COMMIT_SHA`) aprovisionado por `plantillas/devops`.
  3. **Estructura de 3 Capas en `../iac-terraform` y Empaquetado con `scripts/bundle.sh`**:
     - `../iac-terraform` (`c2-sso/devops/iac-terraform`) se organiza en `modulos/`, `plantillas/{devops,data,apps}` y `despliegues/{des,pre,pro}/{devops,data,apps}` con Terraform `1.5.7`.
     - En cada Merge Request o push a las ramas gobernadas (`des`, `pre`, `pro`), `.gitlab-ci.yml` ejecuta `scripts/bundle.sh <ambiente> <stack>`, el cual ensambla en un directorio autocontenido `.bundle/<ambiente>-<stack>/` los archivos del stack junto con `modulos/` y `plantillas/`, e invoca `gcloud infra-manager previews create` o `gcloud infra-manager deployments apply` con `--local-source="."`, `--tf-version-constraint="1.5.7"` y `--service-account="projects/${PROJECT_ID}/serviceAccounts/sa-infra-manager@${PROJECT_ID}.iam.gserviceaccount.com"`.
- **Racional**: Permite que Infrastructure Manager suba un paquete autocontenido a Cloud Storage con todas las referencias modulares resueltas, sin depender de conexiones Cloud Build 2nd Gen hacia GitHub, manteniendo la trazabilidad de CI/CD en GitLab institucional.
- **Alternativas descartadas**:
  - *Mantener `cloudbuild.yaml` o `google_cloudbuild_trigger` conectados a GitHub*: Descartado en la Constitución v2.11.0 dado que el código fuente y los pipelines residen al 100 % en el GitLab institucional (`git.sitimapa.co`).
- **Referencias Oficiales de Google Developer Knowledge**:
  - `documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources`
  - `documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/deployments/apply`
  - `documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/previews/create`

---

### Decisión 10: Gobernanza de Merge Requests en GitLab (`allow-destroy` Gatekeeper) y Controles Declarativos en Infrastructure Manager (`backup_window`, `condition_matched_log`, Ruta Relativa Canónica de Red y Bootstrap de Cloud Run)

- **Decisión**: Incorporar en `../iac-terraform` los controles de gobernanza de Merge Requests en GitLab y las validaciones declarativas requeridas por **Google Cloud Infrastructure Manager (`config.googleapis.com`, Terraform `1.5.7`)**:
  1. **Gatekeeper de Destrucción en Merge Requests (`.gitlab-ci.yml`)**:
     - Tras crear el preview en Infrastructure Manager (`gcloud infra-manager previews create` + `previews describe --format="value(logs)"`), el job de validación en `.gitlab-ci.yml` inspecciona los logs del plan buscando `Plan: X to add, Y to change, Z to destroy`.
     - Si se detectan destrucciones (`DESTROY_COUNT > 0`), verifica las etiquetas del Merge Request en GitLab (`CI_MERGE_REQUEST_LABELS`) y **bloquea el pipeline (`exit 1`, Fail-Close)** a menos que un revisor autorizado haya asignado explícitamente la etiqueta **`allow-destroy`** al Merge Request.
  2. **Formato Protobuf `Duration` en AlloyDB (`modulos/alloydb/main.tf`)**:
     - Configurar `backup_window = "21600s"` (6 horas expresadas en segundos con sufijo `s`, en lugar de `"6h"`) en `continuous_backup_config` y `automated_backup_policy`, cumpliendo el formato estricto `google.protobuf.Duration` exigido por la API de AlloyDB (`^[0-9]+(\.[0-9]+)?s$`).
  3. **Filtro Obligatorio `resource.type` y Métrica Basada en Logs en Cloud Monitoring (`modulos/monitoring/main.tf`)**:
     - Añadir la restricción obligatoria `resource.type="k8s_container"` en todas las condiciones `condition_matched_log` de `google_monitoring_alert_policy` para GKE (`alloydb_down_or_failover`, `sso_oidc_jwks_rotation_alert`, `motor_pdp_jwks_rotation_alert`) y `resource.type="cloud_run_revision"` en `sync_dlq_and_quota_alert`, aprovisionando además la métrica `google_logging_metric` (`sso_sync_dlq_pending_events_${var.environment}`) para evitar errores `400 Bad Request` de Cloud Monitoring API.
  4. **Imágenes Bootstrap de Cloud Run y Ordenamiento de Dependencias**:
     - Definir imágenes públicas oficiales de bootstrap de Google Cloud Run (`us-docker.pkg.dev/cloudrun/container/hello` y `us-docker.pkg.dev/cloudrun/container/job`) como valores por defecto en `plantillas/apps/variables.tf` para permitir el aprovisionamiento inicial del stack `apps` antes de la primera publicación de imágenes de los microservicios.
  5. **Ruta Canónica Relativa de Red Compartida (`projects/{host_project}/global/networks/{name}`) para AlloyDB y Cloud Run**:
     - Conforme a `documents/docs.cloud.google.com/alloydb/docs/cluster-create` y `documents/docs.cloud.google.com/config-connector/docs/reference/resource-docs/alloydb/alloydbcluster`, `network_config.network` de AlloyDB exige el identificador relativo canónico `projects/{host_project}/global/networks/{network_id}` (sin el prefijo `https://www.googleapis.com/compute/v1/`). Se añade un bloque `validation {}` con regex `^projects/[^/]+/global/networks/[^/]+$` en `modulos/alloydb/variables.tf` para detectar cualquier formato inválido desde `terraform validate` en el Merge Request.
- **Racional**: Combina la gobernanza estricta de Merge Requests en GitLab (validación automática con resumen de `terraform plan` y gatekeeper `allow-destroy`) con despliegues idempotentes en Infrastructure Manager para los proyectos `mec-003-sso-{des,pre,pro}`.

---

## 2. Resumen de Referencias Documentales Consultadas

| Recurso Documental Google Developer Knowledge | Propósito y Aplicación |
| :--- | :--- |
| `documents/docs.cloud.google.com/memorystore/docs/redis/high-availability-for-memorystore-for-redis` | Arquitectura de alta disponibilidad y failover de Memorystore Redis L2. |
| `documents/docs.cloud.google.com/memorystore/docs/cluster/ha-and-replicas` | Prácticas recomendadas para sharding, tolerancia a fallos y clientes Redis. |
| `documents/docs.cloud.google.com/secret-manager/docs/secret-rotation` | Programación y ventanas de rotación periódica de secretos en Secret Manager. |
| `documents/docs.cloud.google.com/secret-manager/docs/rotation-recommendations` | Flujo de rotación dual con secreto anterior en periodo de gracia. |
| `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/internal-load-balancing` | Manifiestos de `Service` con `networking.gke.io/l4-regional-internal` y GKE subsetting. |
| `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc` | Despliegue de GKE Autopilot y balanceadores internos sobre subredes de una Shared VPC. |
| `documents/docs.cloud.google.com/run/docs/configuring/shared-vpc-direct-vpc` | Configuración de Direct VPC Egress de Cloud Run hacia una Red Compartida (Shared VPC). |
| `documents/docs.cloud.google.com/alloydb/docs/about-private-services-access` | Configuración de Private Services Access para AlloyDB sobre red compartida. |
| `documents/docs.cloud.google.com/alloydb/docs/cluster-create` | Configuración de `google_alloydb_cluster` con `network_config.network` (`projects/{project}/global/networks/{network}`). |
| `documents/docs.cloud.google.com/config-connector/docs/reference/resource-docs/alloydb/alloydbcluster` | Especificación del formato canónico requerido `projects/{project}/global/networks/{network_id}` para `AlloyDBCluster`. |
| `documents/docs.cloud.google.com/memorystore/docs/redis/establish-connection` | Conectividad privada de Memorystore for Redis sobre Private Services Access (`PRIVATE_SERVICE_ACCESS`). |
| `documents/docs.cloud.google.com/memorystore/docs/redis/networking` | Requisitos de red VPC y rangos de direcciones IP internas para Memorystore for Redis. |
| `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account` | Configuración y permisos requeridos por `sa-infra-manager` en Google Cloud Infrastructure Manager (`roles/config.agent`). |
| `documents/docs.cloud.google.com/infrastructure-manager/docs/access-control` | Control de acceso IAM para despliegues automatizados con Infrastructure Manager (`config.googleapis.com`). |
| `documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources` | Empaquetado y despliegue de configuraciones Terraform mediante `--local-source` en Infrastructure Manager. |
| `documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/deployments/apply` | Uso de `gcloud infra-manager deployments apply` con `--local-source`, `--service-account` y `--tf-version-constraint="1.5.7"`. |
| `documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/previews/create` | Uso de `gcloud infra-manager previews create` para previsualizaciones de Merge Requests en Infrastructure Manager. |
