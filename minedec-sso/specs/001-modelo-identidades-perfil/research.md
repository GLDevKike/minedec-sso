# Fase 0: Investigación y Decisiones Técnicas — Base de Identidades en Dos Niveles, Catálogos Parametrizables y Esquema `MINEDEC_Perfil`

**Feature**: `001-modelo-identidades-perfil`  
**Fecha**: 2026-10-26  
**Estado**: Completado (0 incógnitas `[NEEDS CLARIFICATION]` pendientes)

---

## 1. Modelo de Identidad en Dos Niveles (`persona_identidad` + `cuenta_institucional` en 3FN), Tenant Único GWS, Alcance de Personas Naturales e Inmutabilidad de `CEDULA`

- **Decision**:
  - **Tenant Único de Google Workspace con Subdominios por Población (`D-21`, `FR-001`)**: Todas las cuentas institucionales conviven en un **único tenant corporativo de Google Workspace** (`google_customer_id` compartido), dentro del cual se define una sola vez el esquema personalizado `customSchemas.MINEDEC_Perfil`. Los dominios/subdominios se segmentan por población en `dominio_institucional` (`tipo_poblacion` en `ESTUDIANTE`, `DOCENTE`, `ADMINISTRATIVO`, `MIXTO`): `@estudiante.edu.ec` (o `@estudiantes.educacion.gob.ec`) para población estudiantil, `@docentes.educacion.gob.ec` para población docente y `@educacion.gob.ec` para personal administrativo/planta central.
  - **Separación en Dos Niveles y Clave Primaria Técnica vs Clave Natural (`Constitución v2.11.0`, Principio X.2)**: Separar en AlloyDB la tabla `persona_identidad` (individuo físico / persona natural única) de la tabla `cuenta_institucional` (credenciales `correo_electronico` / `google_immutable_id` en relación `N:1` con la persona física) y normalizar en 3FN los atributos del establecimiento educativo en `catalogo_territorio_sede` (`codigo_amie` → `codigo_circuito` → `codigo_distrito` → `codigo_zona`).
  - **PK Técnica (`id_interno` UUID v4) e Inmutabilidad de `CEDULA` (`FR-003`, `FR-011`)**: La clave primaria física de `persona_identidad` es `id_interno (UUID v4)` inmutable para proteger las llaves foráneas y evitar actualizaciones en cascada (`ON UPDATE CASCADE` está prohibido sobre la tabla `auditoria_evento` append-only). En negocio, la persona se identifica por la clave natural `UNIQUE (tipo_identificacion, numero_identificacion)` (`CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`). Una vez que una identidad tiene o alcanza `tipo_identificacion = 'CEDULA'`, el valor de su `CEDULA` es **estrictamente inmutable**: solo se admite la transición unidireccional `CODIGO_MINEDEC` → `CEDULA` (preservando `codigo_minedec_anterior`); cualquier intento posterior de mutar una `CEDULA` ya consolidada o revertirla a `CODIGO_MINEDEC` se rechaza y audita en la capa de dominio y mediante el trigger físico `trg_enforce_cedula_immutability` en AlloyDB (`SQLSTATE 23514`).
  - **Alcance Exclusivo de Personas Naturales frente a RUC**: Conecta MINEDEC (C2.2) autentica exclusivamente personas naturales (sin tabla `VinculacionOrganizacionRuc` ni empresas): si desde Google Workspace llega un contratista o profesional (`HONORARIOS_PROFESIONALES` / `CONTRATISTA`) con un RUC de persona natural (`10 dígitos de cédula válida + sufijo 001..999`, tercer dígito `0..5`), se extrae y valida la `CEDULA` de 10 dígitos (Módulo 10) para unificar la `persona_identidad` bajo su cédula personal; si llega un RUC societario/jurídico (tercer dígito `6` o `9`), se rechaza con anomalía `SIN_IDENTIFICACION_VALIDA` (`BLOQUEANTE`).
- **Rationale**: Evita que una misma persona física (por ejemplo, un docente en `@docentes.educacion.gob.ec` que además es funcionario en `@educacion.gob.ec` o estudiante en `@estudiante.edu.ec`) se duplique como sujetos distintos, mantiene en 3FN pura los atributos civiles en `persona_identidad` y los atributos poblacionales en `cuenta_institucional`, protege la inmutabilidad forense de `auditoria_evento` cuando un estudiante evoluciona de `CODIGO_MINEDEC` a `CEDULA`, e impide suplantaciones de identidad mediante cambios de cédula.
- **Alternatives considered**:
  - *Usar `CEDULA` como `PRIMARY KEY` física en lugar de `id_interno` UUID v4*: Descartado porque los estudiantes extranjeros o de primera infancia nacen sin cédula (`CODIGO_MINEDEC`) y las altas en `REGISTRO_CALIENTE` nacen en `PENDIENTE_IDENTIFICACION`; cambiar una PK física rompería las llaves foráneas y está prohibido hacer `UPDATE` en `auditoria_evento`.
  - *UUID v5 determinístico derivado de la cédula*: Descartado porque al transicionar de `CODIGO_MINEDEC` a `CEDULA` obligaría a cambiar el UUID; el UUID v4 generado con `crypto.randomUUID()` permanece inmutable durante toda la vida del registro.
  - *Guardar `RUC` como `tipo_identificacion` en `persona_identidad` o crear tablas de empresas (`VinculacionOrganizacionRuc`)*: Descartado en la Constitución porque fragmentaría a la persona natural entre su cédula de 10 dígitos y su RUC de 13 dígitos, y las personas jurídicas están fuera del alcance de autenticación de C2.2.

---

## 2. Catálogos Parametrizables (`D-03`), Homologación con Fuentes MINEDEC (`FO-DNTIC-20`), Dependencia Jerárquica (`tipoUsuario` → `subtipoUsuario`) y Minoría de Edad

- **Decision**:
  - Persistir en la tabla `catalogo_atributo_minedec` todos los valores permitidos de `tipoIdentificacion`, `tipoUsuario`, `subtipoUsuario`, `cargoFuncion`, `gradoCurso`, `nivelAcademico` (incluyendo los 8 niveles con `EDUCACION_SUPERIOR`), `viceministerio`, `regimenEscolar`, `modalidadEducativa` y `jornada` (incluyendo `NO_APLICA`), incluyendo la columna `codigo_padre` para modelar la dependencia jerárquica `tipoUsuario` → `subtipoUsuario`, `nivel_academico_derivado` para la derivación determinística `gradoCurso` → `nivelAcademico` (`SUPERIOR_1..3` → `EDUCACION_SUPERIOR`) y la columna `metadatos_regla` (`JSONB`) para el diccionario de sinónimos de origen (`sinonimosOrigen`).
  - **Homologación con Extracciones Reales del MINEDEC (`FO-DNTIC-20`, `FR-004`, `FR-005`)**: Soportar en `metadatos_regla.sinonimosOrigen` y en el normalizador de ingesta la traducción determinista de los valores que hoy exportan los sistemas origen del Ministerio hacia los códigos canónicos del PIP sin modificar código fuente (ej. `ZONA = '1'..'9'` → `'01'..'09'`, `"8vo año Básica"` → `EGB_8`, `"TERCER NIVEL TECNOLÓGICO SUPERIOR"` → `EDUCACION_SUPERIOR`, `"NO APLICA JORNADA"` → `NO_APLICA`), así como poblar `catalogo_territorio_sede` desde el catálogo institucional (`COD_AMIE`, `DESC_ESTABLECIMIENTO`, `ZONA`, `DESC_SOSTENIMIENTO`), permitiendo `NULL` en `codigo_circuito`, `codigo_distrito` y códigos DPA cuando el extracto origen solo provea AMIE y Zona.
  - Mantener esta tabla cacheada en memoria local del proceso (TTL 60 s) y en Redis (`minedec:pip:catalogo:v1`, `TTL <= 300 s`) con invalidación inmediata al actualizar un catálogo desde la API administrativa, cumpliendo el Principio XII (reglas normativas fuera del código).
  - Evaluar la obligatoriedad de `representanteLegalCedula` en `ESTUDIANTE` aplicando prelación: (1) si viene `fechaNacimiento`, es obligatorio cuando `edad < 18 años`; (2) si no viene `fechaNacimiento`, es obligatorio cuando `gradoCurso` está marcado en el catálogo como escolarizado menor (`INICIAL_1` a `BGU_3`) y `subtipoUsuario` pertenece a `{REGULAR, NEE}` (siendo opcional en `EDUCACION_INCONCLUSA` y `SUPERIOR_1..3`). Su ausencia genera una anomalía con `efecto_acceso = 'RESTRINGIDA'` (no bloqueante) (`FR-006`, `FR-013`).
- **Rationale**: Dado que `MINEDEC_Perfil` convive con extracciones operativas reales de Google Workspace (`FO-DNTIC-20`) y es un esquema evolutivo (`D-03`), parametrizar los catálogos, sus relaciones jerárquicas y sus sinónimos de homologación evita recompilar o redesplegar los servicios cuando el Ministerio ajuste denominaciones.
- **Alternatives considered**:
  - *Enumeraciones estáticas (`enum` de TypeScript / `CHECK` SQL rígidos)*: Descartado porque violaría el Principio XII de la Constitución y `D-03`.

---

## 3. Registro en Caliente (`REGISTRO_CALIENTE`) con Identidad Provisional y Reconciliación Asíncrona

- **Decision**: Cuando el Motor PDP invoca la resolución de identidad para un usuario recién autenticado en Google Cloud Identity cuya cuenta aún no existe en Redis ni en AlloyDB y cuyo token OIDC primario solo trae claims básicos (`email`, `sub`, `given_name`, `family_name`, `hd`) sin `(tipoIdentificacion, numeroIdentificacion)`:
  1. No se realiza ninguna llamada síncrona a Google Admin SDK (`FR-007`, `SC-002`).
  2. Se inserta transaccionalmente en AlloyDB una `persona_identidad` provisional con `id_interno = UUID v4`, `estado_persona = 'PENDIENTE_IDENTIFICACION'` y marcador documental temporal `TEMP-<google_sub_id>`, junto con su `cuenta_institucional` (`estado_sincronizacion = 'REGISTRO_CALIENTE'`).
  3. Se permite al usuario acceder de inmediato únicamente a rutas clasificadas como `AUTENTICADA` (efecto `RESTRINGIDA`, sin roles operativos) con expiración dura `<= 300 s`, y se encola una tarea prioritaria en Cloud Tasks (`sso-sync-priority-hot-reg`) para que el sincronizador (`002-sincronizador-conciliacion-gws`) consulte los 21 atributos.
  4. Segundos después, cuando el endpoint interno de ingestión del PIP recibe los 21 atributos desde el sincronizador:
     - Si el par `(tipo_identificacion, numero_identificacion)` ya existe en otra `persona_identidad` previa, re-vincula `cuenta_institucional.id_interno` hacia la `persona_identidad` existente, desactiva el registro provisional y purga la caché en Redis en `< 5 s`.
     - Si no existe, actualiza la `persona_identidad` provisional con su `(tipo_identificacion, numero_identificacion)` validado y cambia su estado a `ACTIVA`.
     - Si carece de identificación válida o presenta conflicto de unicidad, abre la anomalía `BLOQUEANTE` correspondiente (`SIN_IDENTIFICACION_VALIDA` o `COLISION_IDENTIFICADOR`) y revoca el acceso provisional en `< 5 s`.
- **Rationale**: Resuelve la condición de carrera del primer login manteniendo 0 llamadas a Google en el camino crítico y evitando registros huérfanos cuando el usuario ya tenía otra cuenta en el Ministerio.
- **Alternatives considered**:
  - *Denegar el login (`HTTP 403`) hasta que termine la cola*: Descartado porque incumple `RF-GI-14` (`FR-012`) y degrada la experiencia de incorporación de nuevos usuarios.
  - *Consultar `users.get` síncronamente en el login*: Descartado por riesgo crítico de agotamiento de cuota (`RNF-REN-06`).

---

## 4. Bandeja de Anomalías (`anomalia_identidad`) con Bloqueo Graduado, Estado `LISTA_PARA_CERRAR` y Encadenamiento Histórico

- **Decision**:
  - Clasificar toda anomalía detectada en dos niveles de efecto de acceso:
    - `BLOQUEANTE` (`fail-close`, impide toda autorización): `SIN_IDENTIFICACION_VALIDA`, `COLISION_IDENTIFICADOR`, `VIGENCIA_INVALIDA`.
    - `RESTRINGIDA` (solo acceso base de lectura en rutas `AUTENTICADA`, sin roles operativos): `ATRIBUTO_OBLIGATORIO_FALTANTE` (incluida la falta de `representanteLegalCedula`) y `FORMATO_AMIE_INVALIDO`.
  - **Regla de cierre diferenciado (`FR-013`)**:
    - Anomalías de datos/formato (`SIN_IDENTIFICACION_VALIDA`, `ATRIBUTO_OBLIGATORIO_FALTANTE`, `FORMATO_AMIE_INVALIDO`, `VIGENCIA_INVALIDA`): cuando una actualización posterior entrega los atributos válidos que subsanan la causa, el PIP marca automáticamente la anomalía como `RESUELTA` (`origen_resolucion = 'AUTO_SINCRONIZACION'`), guarda `valor_anterior` y `valor_nuevo`, restablece el estado operativo de la cuenta e invalida su caché en `< 5 s`.
    - Anomalías de `COLISION_IDENTIFICADOR` (dos `idInterno` distintos reclamando la misma cédula/documento): **siempre requieren cierre explícito de un Administrador de Seguridad** (`origen_resolucion = 'MANUAL_ADMIN'`). Si en una actualización posterior desaparece el conflicto en origen, la anomalía transiciona de `ABIERTA` a `LISTA_PARA_CERRAR`, manteniendo el bloqueo de seguridad hasta la confirmación administrativa.
  - **Recurrencia enlazada**: Los registros `RESUELTA` nunca se sobrescriben ni eliminan; si la misma anomalía reaparece en el futuro sobre la cuenta, se inserta una nueva fila con `estado_anomalia = 'ABIERTA'` apuntando a la anterior mediante `anomalia_anterior_id`.
- **Rationale**: Combina agilidad operativa para millones de cuentas (auto-curación al corregir datos en Google Workspace) con control estricto de seguridad informática ante posibles intentos de suplantación o duplicación de cédula (`COLISION_IDENTIFICADOR`).

---

## 5. Arquitectura Hexagonal, Paquete Compartido `@minedec/shared` en GitLab NPM Package Registry (DRY + SOLID) e InversifyJS en el Composition Root

- **Decision**:
  - Centralizar en el repositorio independiente `../microservicios/shared` (`c2-sso/microservicios/shared`), versionado y publicado como **`@minedec/shared`** en el **GitLab NPM Package Registry** (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`), los artefactos transversales reutilizables por todos los microservicios y jobs de C2.2 (`pip-identity-service`, `sincronizador`, `conciliacion-job`, `sso-oidc`, `motor-pdp`, `api-pap`, `publicador-job`):
    1. Esquemas y validadores de los 21 atributos `MINEDEC_Perfil` (Módulo 10 preservando cero inicial, normalización de RUC de persona natural de 13 dígitos a `CEDULA` de 10 dígitos, inmutabilidad de `CEDULA` consolidada y regex AMIE).
    2. Helpers SQL parametrizados (`pg` + `pg-format`) y validador de identificadores dinámicos por lista blanca `safe_sql_identifier`.
    3. Cliente de caché L2 Memorystore Redis (`ioredis`) con invariante `TTL <= 300 s` (`EX 300`) e invalidación atómica `UNLINK`.
    4. Calculador y escritor de cadena hash `SHA-256` para `auditoria_evento` serializado con bloqueo consultivo transaccional `pg_advisory_xact_lock(2026022001)` y protegido físicamente en AlloyDB por el trigger `trg_enforce_auditoria_append_only`.
    5. Logger estructurado `pino` con redacción automática de secretos y tokens + correlación W3C `traceparent`.
  - Configurar `InversifyJS` (`inversify`) exclusivamente en `src/container.ts` (Composition Root de `../microservicios/pip-identity-service`) usando identificadores simbólicos tipados (`TYPES`) y decoración dinámica externa (`decorate(injectable(), UseCaseClass)` / `toDynamicValue()`), manteniendo `domain/` y `application/` 100% libres de imports de `inversify` o decoradores `@injectable()` / `@inject()`.
- **Rationale**: Cumple de manera estricta los Principios IV, V, VI, X.2 y XVIII de la Constitución MINEDEC v2.11.0, garantizando desacoplamiento por repositorio en GitLab, pureza de dominio, facilidad de reemplazo de adaptadores en pruebas (`container.rebind(...)`) y cero duplicación de lógica de seguridad entre microservicios.

---

## 6. Invalidación Reactiva de Caché (`< 5 s` Nominal / `<= 300 s` Límite Duro) y Frontera con `002-sincronizador-conciliacion-gws`

- **Decision**:
  - Cada vez que el PIP modifique el estado de una cuenta (`suspended = true`, expiración de `fechaFinVigencia`, cambio de atributos RBAC/ABAC, transición `CODIGO_MINEDEC` → `CEDULA` o apertura/resolución de anomalía), ejecuta un pipeline atómico `UNLINK` sobre las claves de la persona/cuenta en Memorystore Redis y publica el evento en el tópico de invalidación `sso-pip-cache-invalidation`, logrando una invalidación nominal en `< 5 segundos (p95)`. Todas las claves en Redis se escriben obligatoriamente con `EX 300` (`TTL <= 300 s`), garantizando el límite duro de 300 segundos incluso ante caída del bus de eventos (`FR-009`, `SC-004`).
  - **Frontera con `002-sincronizador-conciliacion-gws`**: Las decisiones ya ratificadas sobre delegación de dominio sin llaves JSON (`signJwt` sobre `sa-workspace-reader` con scope `admin.directory.user.readonly`), arquitectura de sincronización en 3 capas (Audit Logs → Cloud Logging Org Sink → Pub/Sub → Cloud Tasks `<= 28 req/s`, barrido delta cada 2 min con solapamiento y conciliación masiva por lotes de 500 cuentas con `checkpoint_conciliacion`), conmutación a modo lote y backoff exponencial con DLQ se implementan en los repositorios `../microservicios/sincronizador` y `../microservicios/conciliacion-job` (`002-sincronizador-conciliacion-gws`), consumiendo el caso de uso/endpoint de ingestión idempotente provisto por esta feature `001`.

---

## 7. Arquitectura Multirrepositorio en GitLab (`git.sitimapa.co`), Nomenclatura `sso-*`, Red Compartida (`Shared VPC`) y Gobierno en 3 Capas con Google Cloud Infrastructure Manager (`Constitución v2.11.0`)

- **Decision**:
  - **Repositorios Independientes de Aplicación (`../microservicios/shared` y `../microservicios/pip-identity-service`) y CI/CD en GitLab (`.gitlab-ci.yml`)**:
    - Reemplazar el antiguo monorepo y `cloudbuild.yaml` por repositorios independientes dentro del subgrupo `c2-sso/microservicios` en GitLab (`git.sitimapa.co`), cada uno con su propio `.gitlab-ci.yml` ejecutado por el runner institucional con cuenta de servicio adjunta `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (autenticación por metadata server, cero llaves JSON).
    - `../microservicios/pip-identity-service/Dockerfile` construye en multi-stage sobre `node:22-alpine`, instala `@minedec/shared` desde el GitLab NPM Package Registry, elimina dependencias de desarrollo (`npm prune --omit=dev`) y ejecuta con `USER node` (`UID != 0`), publicando la imagen en Google Artifact Registry (`sso-containers`) etiquetada con `$CI_COMMIT_SHA`.
  - **Repositorio Central de Infraestructura en 3 Capas (`../iac-terraform` en `c2-sso/devops/iac-terraform`, sincronizado en la rama `spec/001-modelo-identidades-perfil`)**:
    - Estructurar el repositorio en **Terraform HCL puro (`1.5.7`, sin Terragrunt)** en 3 capas (`modulos/`, `plantillas/` y `despliegues/<ambiente>/{devops,data,apps}`) y empaquetar cada unidad de despliegue con `scripts/bundle.sh` (que ensambla en `build/<ambiente>/<stack>` los archivos del despliegue junto con su plantilla y módulos requeridos para `--local-source="."` y `--tf-version-constraint="1.5.7"`).
    - **Operación sobre Red Compartida (Shared VPC)**: No se incluye un stack `host` en `iac-terraform` porque la Shared VPC es administrada por el equipo de redes en los proyectos host `mec-003-sha-net-des` (Desarrollo), `mec-003-sha-net-pre` (Preproducción) y `mec-003-sha-net-pro-511014` (Producción). Los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`) consumen la red y subredes compartidas autorizadas para aprovisionar GKE Autopilot (`gke_pip_service`), AlloyDB for PostgreSQL 16 (`alloydb`) y Memorystore for Redis (`redis`).
    - **Nomenclatura Estandarizada `sso-*` (sin `"conecta"`) y Gobierno con `sa-infra-manager`**:
      - `sa-sso-core`: Cuenta de servicio con Workload Identity en GKE Autopilot para `pip-identity-service` (y demás servicios core en GKE: `sso-oidc`, `motor-pdp`, `api-pap`).
      - `sa-infra-manager`: Cuenta de servicio (`sa-infra-manager@<project_id>.iam.gserviceaccount.com`) invocada por `.gitlab-ci.yml` (`gcloud infra-manager previews create` y `gcloud infra-manager deployments apply --service-account=...`) para administrar el estado remoto nativo en Google Cloud Infrastructure Manager (`config.googleapis.com`).
- **Rationale**: Cumple íntegramente los Principios IV, IX, XIII, XVI y XVIII de la Constitución MINEDEC v2.11.0, alineando el proyecto con la infraestructura institucional de GitLab (`git.sitimapa.co`), la topología corporativa de Shared VPC y la convención de nombres `sso-*`.
- **Alternatives considered**:
  - *Mantener un monorepo con `cloudbuild.yaml` o crear una VPC propia por proyecto*: Descartado por la ratificación de la Constitución v2.11.0, donde la organización opera con repositorios independientes en GitLab y una Shared VPC centralizada por ambiente (`mec-003-sha-net-*`).

---

## 8. Verificación Documental Oficial en Google Developer Knowledge (`Principio V.13` — `retrieving-developer-knowledge`)

Conforme al **Principio V.13** de la Constitución MINEDEC v2.11.0 y a la skill `.agents/skills/retrieving-developer-knowledge/SKILL.md` (servidor MCP `google-developer-knowledge` con proyecto de cuota `mec-001-dev-aurora`), todas las decisiones de arquitectura, clústeres en Shared VPC, políticas de IAM y despliegues con Google Cloud Infrastructure Manager en esta especificación han sido contrastadas contra las siguientes fuentes autoritativas oficiales:

| Componente / Decisión Técnica | Recurso Documental Oficial (`documents/...`) |
|-------------------------------|----------------------------------------------|
| Aprovisionamiento de clústeres GKE Autopilot en proyectos de servicio sobre una Red Compartida (`Shared VPC`: `roles/container.hostServiceAgentUser`, `roles/compute.networkUser` en subredes del host project) | `documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc` |
| Configuración de la cuenta de servicio dedicada (`sa-infra-manager`) y permisos IAM para Google Cloud Infrastructure Manager | `documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account` |
| Despliegue declarativo (`--local-source`, `--tf-version-constraint="1.5.7"`) y previsualizaciones con Google Cloud Infrastructure Manager (`config.googleapis.com`) | `documents/docs.cloud.google.com/infrastructure-manager/docs/deploy-resources`<br>`documents/docs.cloud.google.com/sdk/gcloud/reference/infra-manager/deployments/apply` |
| Tareas HTTP autenticadas con token OIDC (`oidcToken`) hacia endpoints internos en Cloud Tasks | `documents/docs.cloud.google.com/tasks/docs/creating-http-target-tasks`<br>`documents/docs.cloud.google.com/tasks/docs/samples/cloud-tasks-create-http-task-with-token` |
| Delegación de dominio sin llaves JSON (`Keyless Domain-Wide Delegation`) mediante `IAM Credentials API signJwt` | `documents/docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt`<br>`documents/docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct` |
