# Fase 0: Investigación y Decisiones Técnicas — Sincronizador de Identidades en Solo Lectura y Conciliación Masiva desde Google Workspace

**Feature**: `002-sincronizador-conciliacion-gws`  
**Fecha**: 2026-10-26  
**Estado**: Completado (0 incógnitas `[NEEDS CLARIFICATION]` pendientes)

---

## 1. Delegación de Dominio sin Llaves JSON (`Keyless Domain-Wide Delegation`) y Modo 100 % Solo Lectura (`FR-001`, `D-01`)

- **Decision**:
  - **Cero Llaves Privadas Descargadas (`Principio IX` y `Principio XIV`)**: Los componentes `../microservicios/sincronizador` (Cloud Run Service `sso-sincronizador` con cuenta de servicio `sa-sso-sync`) y `../microservicios/conciliacion-job` (Cloud Run Job `sso-conciliacion-job` con cuenta de servicio `sa-sso-sync-job`) se autentican mediante el servidor de metadatos nativo de Google Cloud y utilizan el permiso `roles/iam.serviceAccountTokenCreator` sobre la cuenta dedicada `sa-workspace-reader` para invocar la API `IAM Credentials` (`projects/-/serviceAccounts/sa-workspace-reader@.../signJwt`).
  - **Alcance Exclusivo de Solo Lectura**: El JWT firmado en memoria tiene un tiempo de vida máximo de `3600 segundos` (renovado proactivamente a los `3000 segundos`), especifica como `sub` el correo del administrador delegado de solo lectura leído desde Google Secret Manager (`GWS_DELEGATED_ADMIN_EMAIL`) y solicita **únicamente** el scope `https://www.googleapis.com/auth/admin.directory.user.readonly`.
  - **Defensa en Profundidad en el Adaptador (`GoogleWorkspaceDirectoryReadOnlyAdapter`)**: El puerto de dominio `DirectorioExternoIdentidadPort` expone exclusivamente métodos de consulta (`obtenerUsuarioPorIdentificador`, `listarUsuariosPorPagina`). No existe en el código fuente ningún método ni alcance OAuth que permita `insert`, `update`, `patch`, `delete` o `suspend` hacia Google Workspace.
- **Rationale**: Elimina por completo el vector de exfiltración de archivos `.json` de cuentas de servicio con delegación de dominio (`Domain-Wide Delegation`) y garantiza técnicamente la invariante constitucional de que Conecta MINEDEC jamás escribe ni altera el directorio de Google Workspace (`RF-GI-01`, `D-01`).
- **Alternatives considered**:
  - *Montar un archivo `service-account-key.json` desde Secret Manager para firmar JWT localmente*: Descartado por prohibición expresa de llaves JSON estáticas en la Constitución MINEDEC v2.11.0 (Principios IV y IX).
  - *Solicitar el scope general `https://www.googleapis.com/auth/admin.directory.user`*: Descartado por violar el principio de mínimo privilegio y la restricción de solo lectura (`FR-001`).

---

## 2. Presupuesto Global de Cuota del 70 % (`<= 28 req/s`), Reserva Prioritaria para `REGISTRO_CALIENTE` y Reparto Dinámico con Conciliación Masiva (`FR-004`, `FR-005`, `FR-006`, `SC-003`)

- **Decision**:
  - **Techo Duro del 70 % (`<= 28 req/s` sobre el límite oficial de `40 req/s` de Google Admin SDK Directory API)**: Conecta MINEDEC nunca despacha más de `28 solicitudes/segundo` agregadas hacia Google Admin SDK Directory API, dejando un margen de seguridad permanente del `30 %` (`12 req/s`) para herramientas propias del Ministerio y consolas de Google Admin.
  - **Doble Carril en Tiempo Real (Operación Ordinaria sin Job Masivo Activo)**:
    1. **Cola Prioritaria `REGISTRO_CALIENTE` (`sso-sync-priority-hot-reg`)**: Reserva garantizada de hasta **`5 req/s`** (`max_dispatches_per_second = 5`, `max_concurrent_dispatches = 5`) dedicada exclusivamente a reconciliar identidades provisionales (`PENDIENTE_IDENTIFICACION`) creadas durante el primer login OIDC (`FR-006`, `SC-002`).
    2. **Cola Incremental Ordinaria (`sso-sync-incremental`)**: Hasta **`23 req/s`** (`5 + 23 = 28 req/s`) para eventos de auditoría (`CREATE_USER`, `CHANGE_USER`, `SUSPEND_USER`, `UNSUSPEND_USER`, `DELETE_USER`), barrido delta cada 2 minutos y reprocesamiento regulado de `DLQ`.
  - **Coordinación Dinámica de Cuota durante Carga Inicial o Conciliación Masiva (`sso-conciliacion-job`)**:
    - Mientras `sso-conciliacion-job` mantiene particiones en estado `EN_PROGRESO` (registrado también en la llave de coordinación en Redis `minedec:sync:quota:batch_active` con TTL renovable de `60 s`), el presupuesto de **`28 req/s`** se reparte mediante un limitador de tasa distribuido en Redis (Token Bucket atómico con script Lua en `@minedec/shared`):
      - **Job de Conciliación / Carga Inicial (`sso-conciliacion-job`)**: Hasta **`20 req/s`** en páginas de `500` cuentas (`users.list`), permitiendo recorrer `~2,28 millones` de cuentas en `~4.560 llamadas` (`~4 minutos` de tiempo de red efectivo, cumpliendo holgadamente la ventana `< 4 horas` de `SC-003`).
      - **Reserva Intocable de Tiempo Real (`sso-sincronizador`)**: Al menos **`8 req/s`** garantizados (`5 req/s` para `REGISTRO_CALIENTE` + `3 a 8 req/s` para eventos incrementales urgentes), asegurando que la suma combinada (`20 + 8 = 28 req/s`) jamás supere el techo del 70 %.
- **Rationale**: Evita que una conciliación masiva de 2,28 millones de cuentas agote el techo de `28 req/s` o provoque errores `429 RATE_LIMIT_EXCEEDED` cuando ocurren inicios de sesión en caliente (`REGISTRO_CALIENTE`) o bajas de seguridad concurrentes.
- **Alternatives considered**:
  - *Asignar los `28 req/s` completos al job nocturno y pausar las colas en tiempo real*: Descartado porque incumpliría el SLA de `REGISTRO_CALIENTE` y la invalidación `< 5 s` de suspensiones durante la ventana de conciliación.
  - *Contadores locales en memoria por contenedor sin coordinación en Redis*: Descartado porque al escalar horizontalmente instancias de Cloud Run o ejecutar tareas paralelas del Job se excedería la cuota global del tenant único.

---

## 3. Conmutación Automática a Lectura por Lotes con Histéresis (`FR-005`) y Deduplicación Idempotente (`FR-003`)

- **Decision**:
  - **Regla de Conmutación con Histéresis (Umbral Alto `>= 100` o `> 10 s` / Umbral Bajo `< 20`)**:
    - En estado nominal (`MODO_INDIVIDUAL_GET`), cada tarea incremental consulta `users.get(userKey, projection='full')`.
    - Si el monitor de cola en `sso-sincronizador` detecta una acumulación de **`>= 100 eventos pendientes`** o una antigüedad del mensaje más viejo **`> 10 segundos`** (por ejemplo, tras una importación masiva de matrículas en Google Workspace), activa el estado `MODO_LOTE_LIST_500` en Redis (`minedec:sync:dispatch_mode`).
    - En `MODO_LOTE_LIST_500`, el sincronizador agrupa los eventos pendientes por subdominio/ventana temporal y ejecuta `users.list(customer, domain, projection='full', maxResults=500)`, hidratando hasta 500 perfiles completos en una sola llamada de cuota y marcando como resueltos todos los eventos individuales incluidos en la página.
    - Para evitar oscilaciones (*flapping*), el sistema permanece en `MODO_LOTE_LIST_500` hasta que la profundidad de la cola desciende por debajo de **`< 20 eventos pendientes`** (todos los umbrales son parametrizables por variables de entorno validadas con `zod`).
  - **Deduplicación en Dos Capas (`FR-003`)**:
    - Cada evento de Google Admin Audit Log posee un identificador determinista `idEventoExterno = "${id.uniqueQualifier}:${id.time}:${userKey}"`.
    - Antes de invocar Google Workspace o el PIP, `sso-sincronizador` verifica `SET NX EX 86400` en Redis (`minedec:sync:dedup:{idEventoExterno}`) y la tabla `evento_sincronizacion_procesado` en AlloyDB. Además, si la cuenta en AlloyDB ya registra `ultima_sincronizacion_en >= timestamp_evento_gws` y el evento no aporta un estado más reciente, se descarta como `OMITIDO_OBSOLETO` sin sobrescribir datos más nuevos.
- **Rationale**: Protege la cuota de Google Workspace durante ráfagas masivas reduciendo hasta en un factor de `500x` las llamadas a la API, y garantiza idempotencia absoluta frente a la entrega *at-least-once* de Cloud Pub/Sub y Cloud Tasks.
- **Alternatives considered**:
  - *Usar siempre `users.get` individual sin modo lote*: Descartado porque una ráfaga de 50.000 cambios tardaría más de 36 minutos en drenarse a 23 req/s; con páginas de 500 se drena en ~100 llamadas (~5 segundos).

---

## 4. Baja Lógica Diferenciada en Dos Niveles (`CuentaInstitucional` vs. `PersonaIdentidad`) e Invalidación Reactiva `< 5 s` (`FR-002`, `FR-007`, `FR-010`, `SC-002`)

- **Decision**:
  - **Nivel 1 — Baja o Suspensión de Cuenta Específica (`CuentaInstitucional`)**:
    - Cuando Google Workspace notifica `SUSPEND_USER`, `DELETE_USER` o cuando la conciliación completa de una partición confirma que un `google_sub_id` ya no existe en el directorio externo:
      1. Se actualiza **únicamente** esa fila en `cuenta_institucional` (`suspended_en_gws = true` y `estado_sincronizacion = 'SUSPENDIDA_GWS'` o `'ELIMINADA_GWS'`).
      2. Se desactivan las asignaciones contextuales primarias vinculadas exclusivamente a esa `cuenta_id` (`origen_datos = 'GWS_PRIMARIO'`), conservando intactas las demás cuentas activas que la misma `PersonaIdentidad` posea en otros subdominios (por ejemplo, si un docente deja de ser estudiante en `@estudiante.edu.ec`, conserva íntegro su acceso docente en `@docentes.educacion.gob.ec`).
      3. Solo si tras desactivar la cuenta se verifica que la `PersonaIdentidad` tiene **cero (`0`) cuentas activas restantes** en todos los subdominios del tenant, `persona_identidad.estado_persona` transiciona a `'INACTIVA'`.
      4. Se ejecuta `UNLINK` atómico en Memorystore Redis y se publica el evento en `sso-pip-cache-invalidation` en **`< 5 segundos`** (`TTL <= 300 s` como límite duro).
  - **Nivel 2 — Desactivación de Usuario Raíz (`PersonaIdentidad`)**:
    - Cuando se desactiva o bloquea al usuario a nivel de `PersonaIdentidad` (`estado_persona = 'INACTIVA'` o `'BLOQUEADA_ANOMALIA'`), la transacción propaga de inmediato el bloqueo lógico a **todas** sus `CuentaInstitucional` asociadas en todos los subdominios y purga de una sola vez todas sus claves de sesión/autorización en Redis (`< 5 s`).
- **Rationale**: Respeta el modelo en dos niveles (3FN) de la Feature `001-modelo-identidades-perfil`, donde una persona física puede desempeñar simultáneamente distintos roles poblacionales en distintos subdominios sin que la baja de una cuenta estudiantil revoque por error su plaza docente o administrativa.
- **Alternatives considered**:
  - *Marcar `persona_identidad = INACTIVA` ante la baja de cualquiera de sus cuentas*: Descartado en la sesión `/speckit-clarify` (Pregunta 2) porque dejaría sin acceso laboral a docentes o administrativos cuando se cierra su cuenta histórica de estudiante.

---

## 5. Conciliación Masiva Particionada (`sso-conciliacion-job`), Exclusión Mutua (`pg_try_advisory_lock`) y Recuperación de Particiones Huérfanas (`FR-007`, `FR-008`, `SC-003`, `SC-004`)

- **Decision**:
  - **Particionamiento por `(dominio, org_unit_path, tipo_proceso)`**: El universo de ~2,28 millones de cuentas se divide en particiones lógicas registradas en la tabla `checkpoint_conciliacion` (por ejemplo, por cada subdominio activo en `dominio_institucional` y unidad organizativa `org_unit_path` de primer nivel como `/Estudiantes/Zona01`..`/Estudiantes/Zona09`, `/Docentes`, `/Administrativos`, o `/` por defecto).
  - **Comparación por Huella Criptográfica (`hash_payload_gws` SHA-256)**: Por cada usuario devuelto en la página de 500 registros de `users.list(projection='full')`, el job calcula el hash `SHA-256` canónico de los atributos relevantes de Google Workspace (`primaryEmail`, `name`, `suspended`, `orgUnitPath` y los 21 campos de `customSchemas.MINEDEC_Perfil`). Si coincide con `cuenta_institucional.hash_payload_gws`, omite la escritura en AlloyDB e incrementa `cuentas_omitidas_hash`, reduciendo en `>= 95 %` el I/O transaccional en conciliaciones diarias (`FR-009`).
  - **Exclusión Mutua por Partición y Recuperación Automática por Expiración de Latido (`Heartbeat > 15 min`)**:
    - Al reclamar una partición en estado `PENDIENTE`, `PAUSADO_CUOTA`, `FALLIDO` o `EN_PROGRESO` huérfana, el worker calcula una llave entera determinista de 64 bits (`lock_advisory_key = hashtextextended(dominio || ':' || org_unit_path || ':' || tipo_proceso, 2026002)`) e invoca `pg_try_advisory_lock(lock_advisory_key)`.
    - Cada vez que confirma una página de 500 cuentas, actualiza atómicamente `next_page_token`, contadores y `heartbeat_en = NOW()`.
    - Si un contenedor muere abruptamente (`OOM`, desalojo de nodo o timeout), su sesión PostgreSQL se cierra liberando el `advisory lock`; o bien, si una instancia queda colgada sin avanzar páginas durante **`> 15 minutos`** (`heartbeat_en < NOW() - INTERVAL '15 minutes'`, umbral parametrizable), cualquier nuevo worker reclama la partición de forma segura, retoma desde el último `next_page_token` confirmado sin reiniciar desde cero (`SC-004`) y registra un diagnóstico explicativo en español (`CONCILIACION_PARTICION_RECLAMADA`).
- **Rationale**: Garantiza que dos ejecuciones solapadas nunca procesen la misma partición simultáneamente y que ninguna partición quede bloqueada indefinidamente si un worker falla a mitad de millón de registros.
- **Alternatives considered**:
  - *Bloqueo global único para todo el Job de conciliación*: Descartado porque impediría paralelizar particiones por subdominio/zona dentro del presupuesto de `20 req/s`.
  - *Guardar el `pageToken` únicamente en memoria o en Redis*: Descartado porque Redis tiene política de expiración corta y ante un reinicio del contenedor se perdería el punto de control transaccional.

---

## 6. Resiliencia (`Backoff` Exponencial + `Jitter`), Reprocesamiento Controlado de `DLQ` con Protección de Obsolescencia y Diagnóstico en Lenguaje Natural (`FR-012`, `FR-013`, `FR-014`, `FR-015`)

- **Decision**:
  - **Política de Reintentos Exponenciales (`FR-012`)**: Ante respuestas `429 Too Many Requests`, `500`, `502`, `503` o `504` de Google Workspace o fallos transitorios de red/base de datos, el cliente aplica espera exponencial `(2^intento) segundos + jitter_aleatorio(0..1000 ms)` respetando la cabecera `Retry-After` cuando esté presente, hasta un máximo de **`5 intentos`**.
  - **Derivación a `DLQ` (`registro_fallo_sincronizacion`) y Reprocesamiento Regulado con Protección de Obsolescencia (`FR-013`)**:
    - Si el evento falla tras el 5.º intento, se persiste en `registro_fallo_sincronizacion` (`estado_dlq = 'PENDIENTE_REVISION'`) y se publica en el tópico `sso-sync-dlq`, devolviendo confirmación controlada al despachador para no bloquear el resto de la cola (`SC-006`).
    - Cuando un Administrador invoca el endpoint de reprocesamiento (`POST /api/v1/admin/sync/dlq/replay`), los registros seleccionados no llaman directamente a Google Workspace sin control, sino que se **re-encolan a través del mismo canal regulado (`<= 28 req/s`)**.
    - Al ejecutarse el reprocesamiento, el worker verifica primero si `cuenta_institucional.ultima_sincronizacion_en > timestamp_evento_gws`: si la cuenta ya fue actualizada por un evento o conciliación posterior, o tras consultar el estado vivo actual en Google Workspace se confirma que el fallo quedó superado, marca el registro `DLQ` como `'RESUELTO_POR_OBSOLESCENCIA'` o `'RESUELTO_REPROCESADO'` sin jamás sobrescribir datos más recientes con un payload viejo.
  - **Diagnóstico Operativo en Lenguaje Natural (`FR-015`)**: Reutilizando y extendiendo el patrón `AdminIncidentDiagnosticReport` de `@minedec/shared`, todo fallo en `DLQ`, pausa por cuota o reclamo de partición huérfana genera automáticamente en español: (a) qué ocurrió y por qué, (b) el impacto en los usuarios y la confirmación de postura `FAIL_CLOSE_ACTIVO`, y (c) los pasos o comandos exactos recomendados al Administrador.
- **Rationale**: Impide tormentas de reintentos (*retry storms*), evita bloqueos de cabeza de línea (*head-of-line blocking*) y previene el riesgo clásico de las colas `DLQ` donde reprocesar un mensaje antiguo pisa cambios más recientes del usuario.
- **Alternatives considered**:
  - *Reaplicar ciegamente el payload JSON original guardado en la `DLQ`*: Descartado en `/speckit-clarify` (Pregunta 5) porque sobrescribiría cambios de atributos o suspensiones ocurridas después del fallo original.

---

## 7. Arquitectura Multirrepositorio en GitLab (`git.sitimapa.co`), Nomenclatura `sso-*` y Direct VPC Egress hacia Shared VPC en `iac-terraform` (`Constitución v2.11.0`)

- **Decision**:
  - **Repositorios Independientes (`../microservicios/sincronizador` y `../microservicios/conciliacion-job`) y Consumo de `@minedec/shared`**:
    - Cada servicio reside en su propio repositorio en GitLab (`c2-sso/microservicios/sincronizador` y `c2-sso/microservicios/conciliacion-job`), consume `@minedec/shared` desde el **GitLab NPM Package Registry**, configura `InversifyJS` exclusivamente en `src/container.ts` (0 decoradores en `domain/` ni `application/`), y ejecuta su pipeline `.gitlab-ci.yml` mediante `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` para publicar su imagen en Artifact Registry (`sso-containers:$CI_COMMIT_SHA`).
  - **Repositorio Central de Infraestructura en 3 Capas (`../iac-terraform`, rama sincronizada `spec/002-sincronizador-conciliacion-gws`) sobre Shared VPC**:
    - Estructurado en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** bajo `modulos/`, `plantillas/` y `despliegues/{des,pre,pro}/{devops,data,apps}`, empaquetado con `scripts/bundle.sh` y desplegado por **Google Cloud Infrastructure Manager (`sa-infra-manager`)**:
      1. Cuentas de servicio estandarizadas `sa-sso-sync`, `sa-sso-sync-job` y `sa-workspace-reader` (con permiso `roles/iam.serviceAccountTokenCreator` para `signJwt` sin llaves JSON) en `plantillas/devops`.
      2. Tópicos y suscripciones Cloud Pub/Sub de ingesta de Google Workspace Audit Logs (`sso-gws-directory-events`) y Dead-Letter Queue (`sso-sync-dlq`), junto con las colas Cloud Tasks de doble carril (`sso-sync-priority-hot-reg` a `5 req/s` y `sso-sync-incremental` a `23 req/s`, total `<= 28 req/s`) en `modulos/pubsub_cloud_tasks_sync` y `plantillas/data`.
      3. Módulos `modulos/cloud_run_sincronizador/` (Cloud Run Service `sso-sincronizador` con `INGRESS_TRAFFIC_INTERNAL_ONLY`) y `modulos/cloud_run_conciliacion_job/` (Cloud Run Job `sso-conciliacion-job`) configurados con **Direct VPC Egress** hacia las subredes autorizadas de la **Shared VPC** en los proyectos host (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) desde los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`), más Cloud Scheduler (cron cada 2 min para barrido delta y cron diario `0 1 * * *` `America/Guayaquil` para conciliación nocturna).
- **Rationale**: Mantiene 100 % alineados los repositorios de aplicación en GitLab y el repositorio central declarativo de infraestructura en 3 capas sobre la Shared VPC (`Principios IV y XVIII`).
- **Alternatives considered**:
  - *Empaquetar el sincronizador incremental y el job masivo de 2,28 millones de cuentas dentro del mismo proceso del PDP/PIP en GKE*: Descartado porque la Constitución v2.11.0 establece que el Sincronizador y los Jobs de Conciliación corren desacoplados en Cloud Run Service (`sso-sincronizador`) y Cloud Run Jobs (`sso-conciliacion-job`) con identidades IAM segregadas (`sa-sso-sync` y `sa-sso-sync-job`).

---

## 8. Observabilidad Unificada GKE + Cloud Run (Logging Estructurado `pino`, Trazabilidad Distribuida OpenTelemetry W3C `traceparent` y Alertas SRE)

- **Decision**:
  1. **Estandarización de Logs Estructurados con `pino` (`PinoStructuredLogger` en `@minedec/shared`) con Auto-Detección de Plataforma (GKE vs. Cloud Run Service vs. Cloud Run Job)**:
     - Se mantiene **`pino`** como 100 % único logger de alta velocidad ratificado en la Constitución v2.11.0 (Principio V y XV.2), parametrizando dinámicamente `componentName` (`pip-identity-service`, `sso-sincronizador`, `sso-conciliacion-job`) e inyectando automáticamente el contexto de plataforma a partir de las variables de entorno del contrato oficial de contenedores de Google Cloud:
       - **Cloud Run Service**: `K_SERVICE`, `K_REVISION`, `K_CONFIGURATION` $\rightarrow$ `runtimePlatform: 'CLOUD_RUN_SERVICE'`.
       - **Cloud Run Job**: `CLOUD_RUN_JOB`, `CLOUD_RUN_EXECUTION`, `CLOUD_RUN_TASK_INDEX`, `CLOUD_RUN_TASK_ATTEMPT` $\rightarrow$ `runtimePlatform: 'CLOUD_RUN_JOB'`.
       - **GKE Autopilot**: `K8S_POD_NAME` / `HOSTNAME`, `K8S_NAMESPACE` $\rightarrow$ `runtimePlatform: 'GKE_AUTOPILOT'`.
     - Cumple con el contrato de correlación nativa de Cloud Logging (`logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, `logging.googleapis.com/trace_sampled: true`, `severity`) y redacción Zero-Secret (`redactSensitiveData`).
  2. **Trazabilidad Distribuida OpenTelemetry Extremo a Extremo (`W3C traceparent` + `X-Cloud-Trace-Context` + `X-Trace-Id`) entre GKE, Cloud Tasks, Cloud Pub/Sub y Cloud Run**:
     - Todos los servicios HTTP (`pip-identity-service` en GKE y `sso-sincronizador` en Cloud Run Service) extraen o crean un `OtelSpanContext` desde las cabeceras entrantes (`traceparent: 00-<traceId>-<spanId>-01`, `X-Cloud-Trace-Context: <traceId>/<spanIdDecimal>;o=1`, `X-Trace-Id`) mediante `extractOrCreateOtelSpanContext` y devuelven `traceparent`, `X-Trace-Id` y `X-Span-Id` en la respuesta.
     - Al despachar tareas asíncronas hacia Cloud Tasks (`CloudTasksPrioritySyncAdapter` desde GKE hacia Cloud Run y `CloudTasksDispatcherAdapter` en Cloud Run), se propagan explícitamente las cabeceras `traceparent`, `X-Cloud-Trace-Context` y `X-Trace-Id` en `httpRequest.headers` junto con el `traceId` del payload, preservando un único árbol de traza distribuida desde el primer login JIT (`REGISTRO_CALIENTE`) o evento de directorio hasta su persistencia en AlloyDB e invalidación en Redis.
     - En `../microservicios/conciliacion-job` (Cloud Run Job `sso-conciliacion-job`), cada ejecución envuelve el procesamiento de particiones dentro de `withOtelSpan('conciliacion-job.run', ...)` vinculando `CLOUD_RUN_EXECUTION` y `CLOUD_RUN_TASK_INDEX` al `traceId`.
  3. **Manejo Detallado de Errores y Diagnóstico en Lenguaje Natural (`syncErrorHandler`)**:
     - Se incorpora en `../microservicios/sincronizador/src/infrastructure/http/app.ts` e `internal-sync.controller.ts` un manejador centralizado de errores (`syncErrorHandler`) homologado con `pipErrorHandler`, que clasifica errores de validación Zod (`400`), conflictos de bloqueo de partición (`409`), fallos de infraestructura AlloyDB/Redis/GWS (`503` fail-close) y excepciones no controladas (`500`), emitiendo `logger.error` estructurado con `traceId`, `spanId`, `httpMethod`, `httpPath` y `diagnosticoAdministrador` (`AdminIncidentDiagnosticReport` en español).
  4. **Infraestructura de Alertas SRE Unificada para GKE + Cloud Run en `../iac-terraform/modulos/monitoring/`**:
     - La métrica basada en logs `pip_alloydb_outage_events` cubre tanto contenedores en **GKE** (`resource.type="k8s_container"`) como servicios y jobs en **Cloud Run** (`resource.type="cloud_run_revision" OR resource.type="cloud_run_job"`).
     - Conforme a la skill `.agents/skills/cloud-run-alert-configuration/SKILL.md` (`user_labels = { "created-with-google-skill" = "cloud-run-alert-configuration" }`), se declaran políticas PromQL de alta señal para:
       - **Cloud Run Service (`sso-sincronizador`)**: Disponibilidad (errores HTTP `5xx`) y Latencia `p99 > 8 s` sobre `run_googleapis_com:request_count` / `run_googleapis_com:request_latencies`.
       - **Cloud Run Job (`sso-conciliacion-job`)**: Fallo inmediato de ejecución (`run_googleapis_com:job_completed_execution_count{result="failed"}`, `duration = "0s"`).
- **Rationale**: Garantiza trazabilidad forense y operativa 100 % correlacionada cuando un flujo cruza fronteras entre **GKE Autopilot** (PDP/PIP), **Cloud Tasks / Pub/Sub**, **Cloud Run Service** (`sso-sincronizador`) y **Cloud Run Job** (`sso-conciliacion-job`), sin violar la Constitución cambiando `pino` por otro logger.
- **Alternatives considered**:
  - *Reemplazar `pino` por `winston`*: Descartado por decisión expresa y cumplimiento estricto de la Constitución v2.11.0 (Principio V: `pino` es la dependencia ratificada y ofrece menor sobrecarga de serialización JSON en Node.js 22 LTS).
  - *No propagar `traceparent` / `X-Cloud-Trace-Context` en cabeceras HTTP de Cloud Tasks*: Descartado porque Cloud Run genera un nuevo `traceId` independiente si la petición HTTP entrante de Cloud Tasks no incluye cabecera de contexto de traza (`documents/docs.cloud.google.com/run/docs/trace`).

---

## 9. Verificación Documental Oficial en Google Developer Knowledge (`Principio V.13` — `retrieving-developer-knowledge`)

Conforme al **Principio V.13** de la Constitución MINEDEC v2.11.0 y a la skill `.agents/skills/retrieving-developer-knowledge/SKILL.md` (servidor MCP `google-developer-knowledge` con proyecto de cuota `mec-001-dev-aurora`), todas las decisiones de sincronización con Google Workspace, Cloud Run v2 Services/Jobs con Direct VPC Egress hacia Shared VPC, Cloud Scheduler, Cloud Tasks, Cloud Pub/Sub, IAM, Observabilidad (`pino` + OpenTelemetry + Cloud Trace/Monitoring) y Google Cloud Infrastructure Manager en esta especificación han sido contrastadas contra las siguientes fuentes autoritativas oficiales:

| Componente / Decisión Técnica | Recurso Documental Oficial (`documents/...`) |
|-------------------------------|----------------------------------------------|
| Configuración de Direct VPC Egress en Cloud Run (Services y Jobs) hacia subredes de una Red Compartida (`Shared VPC`: `roles/compute.networkUser` para el Cloud Run service agent en el host project) | `documents/docs.cloud.google.com/run/docs/configuring/shared-vpc-direct-vpc` |
| Ejecución programada de Cloud Run v2 Jobs desde Cloud Scheduler (`https://run.googleapis.com/v2/projects/.../locations/.../jobs/...:run`, `oauth_token` y `roles/run.invoker` en `google_cloud_run_v2_job_iam_member`) | `documents/docs.cloud.google.com/run/docs/execute/jobs-on-schedule` |
| Creación de tareas HTTP autenticadas con token OIDC (`oidcToken: { serviceAccountEmail, audience }`) en Cloud Tasks hacia servicios privados Cloud Run (`INGRESS_TRAFFIC_INTERNAL_ONLY`) | `documents/docs.cloud.google.com/tasks/docs/creating-http-target-tasks`<br>`documents/docs.cloud.google.com/tasks/docs/samples/cloud-tasks-create-http-task-with-token` |
| Delegación de dominio sin llaves JSON (`Keyless Domain-Wide Delegation`) mediante `IAM Credentials API signJwt` (`roles/iam.serviceAccountTokenCreator`) y scope `admin.directory.user.readonly` | `documents/docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt`<br>`documents/docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct` |
| Configuración de `sa-infra-manager`, gobierno declarativo y previsualizaciones de Terraform HCL (`1.5.7`) con Google Cloud Infrastructure Manager (`gcloud infra-manager deployments apply` / `previews create` con `--local-source` empaquetado por `scripts/bundle.sh`) | `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account`<br>`documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources`<br>`documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/deployments/apply` |
| Contrato de ejecución de contenedores y variables de entorno de runtime en Cloud Run Services (`K_SERVICE`, `K_REVISION`, `K_CONFIGURATION`, `PORT=8080`) y Cloud Run Jobs (`CLOUD_RUN_JOB`, `CLOUD_RUN_EXECUTION`, `CLOUD_RUN_TASK_INDEX`, `CLOUD_RUN_TASK_ATTEMPT`) | `documents/docs.cloud.google.com/run/docs/container-contract`<br>`documents/docs.cloud.google.com/run/docs/configuring/jobs/environment-variables`<br>`documents/docs.cloud.google.com/run/docs/securing/managing-access` |
| Correlación nativa de logs JSON estructurados con `pino` y OpenTelemetry en Cloud Logging (`logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, `logging.googleapis.com/trace_sampled`, `severity`) | `documents/docs.cloud.google.com/trace/docs/setup/nodejs-ot`<br>`documents/docs.cloud.google.com/logging/docs/agent/logging/structured-logging` |
| Propagación de contexto de traza distribuida W3C (`traceparent: 00-TRACE_ID-PARENT_SPAN_ID-TRACE_FLAGS`) y Google Cloud (`X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=OPTIONS`) hacia Cloud Run Services | `documents/docs.cloud.google.com/trace/docs/trace-context`<br>`documents/docs.cloud.google.com/run/docs/trace` |
