# Fase 0: Investigación y Decisiones Técnicas — Servicio Intermediario Central de Inicio de Sesión Único (Identity Broker OIDC)

**Feature**: `003-sso-oidc-intermediario`  
**Fecha**: 2026-10-26  
**Estado**: Completado (0 incógnitas `[NEEDS CLARIFICATION]` pendientes)

---

## 1. Arquitectura de `sso-oidc` como *Identity Broker* OIDC de Doble Nivel (`DA-11`, `D-01`, `FR-001`..`FR-005`, `SC-002`)

- **Decision**:
  - **Doble Rol Simultáneo en `../microservicios/sso-oidc` (`c2-sso/microservicios/sso-oidc` en GKE Autopilot — `sa-sso-core`)**:
    1. **Relying Party (RP) Único ante Google Cloud Identity / Google Workspace (`https://accounts.google.com`, `D-01`)**: `sso-oidc` actúa como el **único cliente OAuth 2.0 confidencial** registrado en Google Cloud (`GOOGLE_IDP_CLIENT_ID` y `GOOGLE_IDP_CLIENT_SECRET` almacenados en Google Secret Manager), utilizando un único URI de retorno institucional (`https://login.sso.<dominio>/callback`). Verifica criptográficamente el `id_token` emitido por Google contra el JWKS oficial de Google (`https://www.googleapis.com/oauth2/v3/certs`), validando `iss` (`https://accounts.google.com` o `accounts.google.com`), `aud` igual al cliente único de `sso-oidc`, `exp` vigente, `nonce` correlacionado, `email_verified = true` y que el reclamo `hd` (*Hosted Domain*) pertenezca al catálogo activo `dominio_institucional` (`educacion.gob.ec`, `estudiantes.educacion.gob.ec` / `estudiante.edu.ec`, `docentes.educacion.gob.ec`, `deporte.gob.ec`, `cultura.gob.ec`).
    2. **OpenID Provider (OP) Central ante Aplicaciones Institucionales (`https://login.sso.<dominio>`, `DA-11`)**: Implementado sobre `oidc-provider` (certificado por la OpenID Foundation) montado en **Express 5** y expuesto detrás del External Application Load Balancer + Cloud Armor WAF (`sso-oidc-waf-policy`, **sin Cloud IAP delante**, dado que `sso-oidc` es el propio proveedor de identidad). Publica los endpoints estándar `GET /.well-known/openid-configuration`, `GET /authorize`, `GET /callback`, `POST /token`, `GET /jwks` y `GET/POST /logout`.
  - **Catálogo Relacional 1FN/3FN de Clientes OIDC (`cliente_oidc` y `cliente_oidc_redirect_uri`) sin Límite de 100 URIs de GCP (`FR-002`, `FR-003`, `SC-002`)**:
    - Las aplicaciones del Patrón 1 (SP/RP Nativo) y el PEP Perimetral del Patrón 2 se registran en AlloyDB en las tablas `aplicacion`, `cliente_oidc` y `cliente_oidc_redirect_uri` (con caché L2 en Memorystore for Redis `minedec:oidc:client:{oidc_client_id}` con `TTL <= 300 s`).
    - Se exige **comparación exacta carácter por carácter** de `redirect_uri` contra filas activas con `tipo_uri = 'LOGIN_CALLBACK'` y el uso obligatorio de **`Authorization Code + PKCE (code_challenge_method = S256)`** para el 100 % de los clientes (tanto públicos SPA con `metodo_autenticacion_token = 'none'` como confidenciales backend/PEP con `client_secret_basic` o `client_secret_post`).
    - Los secretos de clientes confidenciales se validan comparando en tiempo constante (`crypto.timingSafeEqual`) el hash `SHA-256` del secreto recibido contra `secreto_activo_hash` o, si el cliente se encuentra en `EN_ROTACION_GRACIA` y `NOW() <= gracia_hasta`, contra `secreto_anterior_hash` (`FR-012`).
- **Rationale**: Resuelve de raíz el límite duro de 100 `redirect_uris` por cliente OAuth 2.0 en Google Cloud (`DA-11`), aísla criptográficamente la audiencia (`aud = oidc_client_id`) de cada aplicación para impedir ataques de *token replay* cruzado entre sistemas ministeriales, y mantiene a Google Cloud Identity como único IdP primario sin introducir Active Directory ni LDAP (`D-01`).
- **Alternatives considered**:
  - *Registrar cada aplicación del Ministerio como un cliente OAuth 2.0 separado directamente en Google Cloud Console*: Descartado en `DA-11` porque impide mantener una sesión SSO central gobernada por el Ministerio, fragmenta la revocación inmediata ante bajas y choca con los límites de URIs y cuotas de aprovisionamiento manual en GCP.
  - *Reenviar el `id_token` de Google directamente a las aplicaciones*: Descartado porque todos los `id_token` compartirían el mismo `aud` (permitiendo que una aplicación maliciosa o comprometida reutilice el token frente a otra) y carecerían de `id_interno` y `(tipo_identificacion, numero_identificacion)` canónicos del PIP.

---

## 2. Adaptador Distribuido en Memorystore for Redis, Uso Único de `AuthorizationCode` (`<= 60 s`) y Revocación Inmediata + Techo Duro `<= 300 s` (`FR-006`, `FR-010`, `SC-001`, `SC-004`, `SC-006`)

- **Decision**:
  - **Adaptador Redis Personalizado para `oidc-provider` (`RedisOidcAdapter`)**:
    - Persiste en Memorystore for Redis (`minedec:oidc:adapter:{model}:{id}`) todos los artefactos del protocolo: `Session`, `Interaction`, `AuthorizationCode` (con **`TTL <= 60 segundos`** estricto), `Grant` y estado de correlación hacia Google (`minedec:oidc:google_state:{state}` con `TTL = 300 s`).
    - **Consumo Atómico de Uso Único (`Single-Use Authorization Code`)**: Al invocar `POST /token`, un script Lua atómico en Redis verifica y marca `consumedAt` sobre el `AuthorizationCode`. Si un código ya consumido intenta canjearse por segunda vez, `sso-oidc` rechaza la petición con `HTTP 400 invalid_grant`, revoca inmediatamente el `Grant` y la sesión asociada por sospecha de interceptación (`RFC 6749 §4.1.2` / `RFC 6819`), y registra una alerta en `auditoria_evento`.
  - **Indexación por Cuenta y Persona para Revocación Reactiva (`< 5 s`) en Dos Niveles**:
    - Cada sesión central (`minedec:oidc:session:{sessionId}`) se indexa en dos conjuntos Redis: `minedec:oidc:account_sessions:{cuentaId}` y `minedec:oidc:person_sessions:{idInterno}`.
    - Cuando `../microservicios/sincronizador` o `../microservicios/pip-identity-service` publica un evento de invalidación en `sso-pip-cache-invalidation` (`sso.identity.revoked`):
      1. Si la baja o suspensión ocurre a nivel de una **`CuentaInstitucional`** (`SUSPENDIDA_GWS`, `ELIMINADA_GWS`, `VIGENCIA_VENCIDA`), `sso-oidc` ejecuta `UNLINK` inmediato de todas las sesiones y códigos efímeros en `minedec:oidc:account_sessions:{cuentaId}`, **preservando intactas** las sesiones activas de otras cuentas institucionales que la misma `PersonaIdentidad` posea en otros subdominios.
      2. Si la desactivación o bloqueo ocurre a nivel de la **`PersonaIdentidad`** raíz (`INACTIVA`, `BLOQUEADA_ANOMALIA`), `sso-oidc` purga en cascada todas las sesiones indexadas en `minedec:oidc:person_sessions:{idInterno}` en todos los subdominios.
  - **Revalidación Obligatoria Cada `<= 300 Segundos` (`RF-GI-06`, `RF-AUT-06`, `PI-07`)**:
    - Toda sesión central en Redis guarda `lastPipValidatedAt` y una llave testigo `minedec:oidc:reval:{sessionId}` con `TTL = 300 s`.
    - En cualquier solicitud `GET /authorize` (incluyendo renovación o inicio silencioso entre aplicaciones con `prompt=none`), si la llave testigo expiró (`> 300 s`), `sso-oidc` revalida obligatoriamente el estado de la `CuentaInstitucional` y de la `PersonaIdentidad` contra el PIP antes de emitir un nuevo código. Si la cuenta ya no está activa, destruye la sesión central y deniega el acceso (`login_required` / `access_denied`).
    - Adicionalmente, todo `id_token` emitido tiene una vigencia máxima de `300 segundos` (`exp - iat <= 300`), garantizando matemáticamente el cumplimiento del límite duro absoluto de `<= 300 s` (`SC-004`).
- **Rationale**: Combina invalidación reactiva sub-segundo (`< 5 s`) por Pub/Sub con un límite determinista por expiración (`<= 300 s`) en Redis y en el propio `id_token`, asegurando que ninguna cuenta suspendida conserve capacidad de acceso o federación silenciosa más allá de 5 minutos incluso ante particiones de red.
- **Alternatives considered**:
  - *Sesiones OIDC en memoria local de cada pod de GKE*: Descartado porque rompería el balanceo horizontal entre pods de `sso-oidc` en GKE Autopilot e impediría purgar sesiones desde eventos de Pub/Sub.
  - *Confiar únicamente en el TTL de 8 horas de la cookie de sesión sin revalidar cada `<= 300 s`*: Descartado porque si un mensaje Pub/Sub se retrasara, un usuario suspendido en Google Workspace podría abrir una nueva aplicación mediante SSO silencioso después de los 300 segundos permitidos por `RF-GI-06`.

---

## 3. Resolución Canónica en el PIP y Reintento Corto Acotado (`<= 3 s`) en `REGISTRO_CALIENTE` con `Fail-Close` (`FR-007`, `FR-008`, `FR-009`, `Clarificación Q1`)

- **Decision**:
  - **Resolución de Identidad Natural Unificada**:
    - Tras validar el `id_token` de Google (`sub`, `email`, `hd`, `name`), `sso-oidc` consulta al PIP para obtener el expediente canónico: `id_interno (UUID v4)` y `(tipo_identificacion, numero_identificacion)` (`CEDULA`, `PASAPORTE` o `CODIGO_MINEDEC`), aplicando la regla constitucional de normalizar cualquier RUC de persona natural de 13 dígitos en régimen `HONORARIOS_PROFESIONALES` / `CONTRATISTA` a sus primeros 10 dígitos como `CEDULA` inmutable.
  - **Flujo `REGISTRO_CALIENTE` con Espera Corta Acotada (`<= 3 Segundos`) exclusivamente Local (`Clarificación Q1`)**:
    - Cuando una cuenta institucional válida recién creada en Google Workspace inicia sesión por primera vez y aún no posee `numero_identificacion` consolidado en el PIP:
      1. `sso-oidc` dispara el caso de uso de `REGISTRO_CALIENTE` en el PIP, el cual registra/actualiza la identidad provisional (`PENDIENTE_IDENTIFICACION`) y despacha la tarea prioritaria en la cola `sso-sync-priority-hot-reg` (`<= 5 req/s` reservados en `../microservicios/sincronizador`, propagando `traceparent` / `X-Cloud-Trace-Context`).
      2. `sso-oidc` ejecuta un **bucle de sondeo local acotado de hasta `3.000 ms` totales** (hasta 6 verificaciones espaciadas cada `500 ms` **únicamente contra la caché L2 en Memorystore for Redis / AlloyDB del PIP, realizando `0` llamadas directas desde `sso-oidc` hacia Google Admin SDK** para no competir por la cuota de `28 req/s`).
      3. **Caso A (Consolidación exitosa en `<= 3 s`)**: Si `../microservicios/sincronizador` consolida `numero_identificacion` y promueve la persona a `ACTIVA` dentro de los `3 segundos`, `sso-oidc` continúa el flujo OIDC de forma transparente y emite el código de autorización en el mismo intento.
      4. **Caso B (Persistencia en `PENDIENTE_IDENTIFICACION` tras `3 s` o `BLOQUEADA_ANOMALIA` — `Fail-Close`)**: `sso-oidc` **no emite `code` ni `id_token` sin `numero_identificacion`**, registra el evento en `auditoria_evento` y responde con una pantalla informativa controlada en español (`HTTP 403 Forbidden` / vista de estado con botón de reintentar inicio de sesión y código de traza) indicando que su perfil institucional está terminando de sincronizarse.
  - **Aserción `id_token` Canónica Libre de Roles (`FR-008`, `FR-009`, `SC-003`)**:
    - El `id_token` firmado con `RS256` por `sso-oidc` contiene exclusivamente:
      - Reclamos OIDC estándar: `iss` (`https://login.sso.<dominio>`), `sub` (`id_interno` UUID v4), `aud` (`oidc_client_id` exclusivo de la aplicación solicitante), `iat`, `exp` (`iat + 300`), `auth_time`, `nonce` (si fue provisto), `sid` (ID de sesión central), `at_hash` / `c_hash` cuando aplique.
      - Reclamos canónicos de identidad MINEDEC: `tipo_identificacion`, `numero_identificacion`, `nombre_completo`, `email` (`email_principal`), `email_verified` (`true`), `hd` (`dominio` institucional).
    - **Prohibición Estricta de Roles en `id_token`**: El constructor de reclamos bloquea por esquema `zod` y por prueba unitaria/integración la inclusión de `roles`, `permisos`, `perfiles`, `grupos_logicos` o `scoping_territorial`.
- **Rationale**: Garantiza una experiencia fluida (un solo clic) en el `>= 95 %` de los primeros inicios de sesión donde el carril prioritario de `5 req/s` hidrata el perfil en `< 2 s`, manteniendo a la vez la invariante de seguridad `fail-close` de que ninguna aplicación reciba jamás un `id_token` sin `numero_identificacion` válido ni que `sso-oidc` consuma cuota del Admin SDK.
- **Alternatives considered**:
  - *Rechazar en `0 ms` el primer login sin esperar la hidratación prioritaria*: Descartado en `/speckit-clarify` (Pregunta 1) porque obligaría al 100 % de los usuarios nuevos a fallar siempre en su primer intento de acceso aunque la sincronización prioritaria tarde menos de 2 segundos.
  - *Emitir un `id_token` con `numero_identificacion: null`*: Descartado porque rompería los contratos de negocio de las aplicaciones integradas y del PEP/PDP que exigen `(tipo_identificacion, numero_identificacion)` en cada sesión autenticada.

---

## 4. Cierre de Sesión Único Centralizado (SLO Híbrido de Dos Capas: OIDC Back-Channel Logout + Expiración `<= 300 s`, `FR-011`, `Clarificación Q2`)

- **Decision**:
  - Cuando el usuario o una aplicación invoca `GET /logout` o `POST /logout` en `sso-oidc`:
    1. **Destrucción Inmediata de Sesión Central**: `sso-oidc` valida `id_token_hint` (cuando se envía) y verifica que `post_logout_redirect_uri` coincida exactamente con una fila activa con `tipo_uri = 'POST_LOGOUT'` del cliente en `cliente_oidc_redirect_uri`. Elimina de inmediato la sesión central en Redis (`minedec:oidc:session:{sessionId}`), limpia las cookies de sesión en `https://login.sso.<dominio>` y registra el cierre en `auditoria_evento`.
    2. **Capa 1 — Propagación Activa Inmediata mediante OIDC Back-Channel Logout 1.0**:
       - Para cada aplicación participante en la sesión (`participating_client_ids`) y/o el PEP perimetral que tenga registrada al menos una URI activa con `tipo_uri = 'BACKCHANNEL_LOGOUT'` en `cliente_oidc_redirect_uri`, `sso-oidc` genera un `logout_token` JWT firmado con `RS256` que contiene `iss`, `sub` (`id_interno`), `aud` (`oidc_client_id`), `iat`, `jti`, `sid` y el reclamo obligatorio `events: { "http://schemas.openid.net/specs/openid-connect-backchannel-logout-1_0.html": {} }` (sin reclamo `nonce`, conforme a la especificación OIDC Back-Channel Logout 1.0).
       - Despacha en paralelo peticiones `POST` (`Content-Type: application/x-www-form-urlencoded`, cuerpo `logout_token=<jwt>`) con timeout acotado de `3.000 ms` por destino, de forma no bloqueante para la redirección final del navegador hacia `post_logout_redirect_uri`.
    3. **Capa 2 — Red de Seguridad Universal por Expiración Corta (`<= 300 s`)**:
       - Para aplicaciones que no expongan un endpoint `BACKCHANNEL_LOGOUT` o si ocurre un error de red transitorio durante el webhook, la vigencia máxima de `<= 300 segundos` del `id_token` y la eliminación previa de la sesión central en Redis garantizan que al intentar renovar sesión silenciosa (`GET /authorize?prompt=none`) o revalidar en el PEP/PDP, el acceso quede revocado dentro del límite duro de `<= 300 segundos`.
- **Rationale**: Satisface el requerimiento de Single Logout (SLO) de los TDR (`C2-49` / `C2-50`) sin depender de *iframes* de Front-Channel Logout (que son bloqueados por las políticas modernas de particionamiento de cookies de terceros en navegadores) y sabiendo que Google Cloud Identity no actúa como coordinador de SLO de las aplicaciones internas del Ministerio.
- **Alternatives considered**:
  - *OIDC Front-Channel Logout basado en `<iframe>` en el navegador*: Descartado porque los navegadores modernos bloquean cookies en iframes cross-site (*Third-Party Cookie Deprecation / Storage Partitioning*), dejando sesiones colgadas silenciosamente.
  - *Depender exclusivamente de la expiración de 300 s sin enviar `logout_token`*: Descartado en `/speckit-clarify` (Pregunta 2) porque el PEP perimetral y las aplicaciones con soporte Back-Channel pueden invalidar su sesión local en `< 2 segundos` al recibir el `logout_token`.

---

## 5. Gestión Criptográfica `RS256`, Segregación por `servicio_emisor` en `llave_jwks_rotacion` y Rotación Dual `<= 90 Días` (`FR-012`, `FR-013`, `SC-005`, `Clarificación Q3`)

- **Decision**:
  - **Cero Llaves Privadas en Base de Datos o Código (`Principio IX`)**:
    - El material criptográfico privado `RS256` (RSA 2048/4096 bits) de `sso-oidc` reside exclusivamente en **Google Secret Manager** (`secret_manager_version`), leído en memoria al arranque y refrescado periódicamente mediante Workload Identity (`sa-sso-core` con `roles/secretmanager.secretAccessor`).
  - **Segregación por `servicio_emisor` en `llave_jwks_rotacion` (`Clarificación Q3`)**:
    - Se extiende la tabla `llave_jwks_rotacion` en AlloyDB (`migrations/004_sso_oidc_broker_schema.sql` y `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml`) agregando la columna `servicio_emisor VARCHAR(24) NOT NULL DEFAULT 'SSO_OIDC' CHECK (servicio_emisor IN ('SSO_OIDC', 'MOTOR_PDP'))` y ampliando `estado_llave` a `'ACTIVA_FIRMA' | 'GRACIA_VERIFICACION' | 'RETIRADA' | 'REVOCADA'`.
    - Un índice único parcial `CREATE UNIQUE INDEX uq_llave_jwks_activa_por_emisor ON llave_jwks_rotacion (servicio_emisor) WHERE estado_llave = 'ACTIVA_FIRMA'` garantiza en base de datos que exista a lo sumo una llave activa de firma para `SSO_OIDC` y una llave activa independiente para `MOTOR_PDP`.
    - El endpoint público `GET /jwks` de `sso-oidc` devuelve **únicamente** las llaves cuyo `servicio_emisor = 'SSO_OIDC'` y `estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')`, con cabeceras de caché segura (`Cache-Control: public, max-age=300, must-revalidate`). Cuando una llave pasa a `RETIRADA` o `REVOCADA`, desaparece de inmediato del conjunto JWKS y se purga la caché L2 de JWKS (`minedec:oidc:jwks:public`) vía Pub/Sub (`SC-005`).
- **Rationale**: Garantiza aislamiento criptográfico de dominio entre los `id_token` de identidad emitidos por `sso-oidc` y los tokens M2M / `X-Minedec-Assertion` emitidos por `motor-pdp`, permite rotación `<= 90 días` sin *downtime* gracias a la ventana de gracia dual (`ACTIVA_FIRMA` + `GRACIA_VERIFICACION`) y asegura revocación de emergencia en `< 1 hora` (`REVOCADA`).
- **Alternatives considered**:
  - *Compartir el mismo par de llaves `RS256` entre `sso-oidc` y `motor-pdp`*: Descartado en `/speckit-clarify` (Pregunta 3) por principio de mínimo privilegio criptográfico y separación de responsabilidades entre autenticación (OIDC Broker) y autorización (PDP).

---

## 6. Observabilidad, Cero Cálculo de Latencia en Node.js y Estructura Multirrepositorio en GitLab + Shared VPC (`Constitución v2.11.0`)

- **Decision**:
  - **Prohibición Estricta de Cálculo de Latencia en Node.js (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII)**:
    - `../microservicios/sso-oidc` **no calcula duraciones por petición (`Date.now() - startedAt`, `process.hrtime()`, `performance.now()`) ni expone campos `latenciaMs` / `durationMs` en respuestas HTTP o registros de aplicación**. Toda medición de latencia (`p95 <= 300 ms`, `p99 <= 600 ms`, `SC-001`) se delega 100 % a la infraestructura de Google Cloud (External Application Load Balancer, GKE/Envoy y Cloud Trace).
  - **Trazabilidad Distribuida OpenTelemetry y Logging Estructurado `pino`**:
    - `../microservicios/sso-oidc` consume `@minedec/shared` (`../microservicios/shared/src/observability/`) desde el **GitLab NPM Package Registry** (`PinoStructuredLogger` con autodetección `GKE_AUTOPILOT`, propagación W3C `traceparent` / `X-Cloud-Trace-Context` / `X-Trace-Id` hacia el PIP y Cloud Tasks, redacción Zero-Secret de códigos OIDC, tokens y secretos, y manejador centralizado `oidcErrorHandler` con diagnósticos `AdminIncidentDiagnosticReport` en español).
  - **Sincronización Multirrepositorio en GitLab (`git.sitimapa.co`) en la Rama `spec/003-sso-oidc-intermediario`**:
    1. **En `../microservicios/shared` (`c2-sso/microservicios/shared`), `../microservicios/sso-oidc` (`c2-sso/microservicios/sso-oidc`) y `minedec-sso`**:
       - Repositorio independiente `../microservicios/sso-oidc/` con Arquitectura Hexagonal pura (`domain/`, `application/`, `infrastructure/`, `container.ts` con `InversifyJS` sin decoradores en dominio/aplicación) y consumo de `@minedec/shared` desde el GitLab NPM Package Registry.
       - Migración DDL estática `migrations/004_sso_oidc_broker_schema.sql` que materializa las tablas `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` y `llave_jwks_rotacion` (con `servicio_emisor`), además de ampliar las restricciones `CHECK` de `auditoria_evento` para los eventos de `SSO_OIDC`.
       - Actualización de `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml`, `../microservicios/sso-oidc/Dockerfile` (`node:22-alpine`, `USER node`) y `.gitlab-ci.yml` ejecutado por `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (publicando en Artifact Registry `sso-containers:$CI_COMMIT_SHA`).
    2. **En `../iac-terraform` (`c2-sso/devops/iac-terraform`, rama `spec/003-sso-oidc-intermediario`)**:
       - Estructurado en 3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`) con Terraform `1.5.7` y `scripts/bundle.sh`, operando sobre la **Red Compartida (Shared VPC)** existente (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) para los proyectos de servicio SSO (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`) mediante **Google Cloud Infrastructure Manager (`sa-infra-manager@<project_id>.iam.gserviceaccount.com`)**.
       - Módulo `modulos/gke_sso_oidc_service/` instanciado en `plantillas/apps/` que despliega `sso-oidc` en GKE Autopilot con Workload Identity (`sa-sso-core`), `BackendConfig` con política Cloud Armor WAF (`sso-oidc-waf-policy` contra OWASP Top 10 y rate-limiting en `/authorize` y `/token`), `FrontendConfig` (redirección HTTPS y TLS 1.2/1.3) e `Ingress` externo en `https://login.sso.<dominio>` **sin IAP delante** (`DA-11`).
       - Extensión de `modulos/secret_manager/` (secretos de cliente OAuth único de Google y llaves privadas JWKS `RS256` de `sso-oidc`) y `modulos/monitoring/` (alertas de errores `5xx`, latencia `p95`/`p99` en el Load Balancer/GKE y fallos de rotación JWKS).
- **Rationale**: Mantiene 100 % de adherencia a la Constitución MINEDEC v2.11.0, evitando duplicar utilidades transversales gracias a `@minedec/shared` y conservando la separación estricta entre repositorios de código de aplicación e infraestructura Terraform gobernada por Infrastructure Manager desde GitLab CI/CD.
- **Alternatives considered**:
  - *Publicar `sso-oidc` detrás de Cloud IAP*: Descartado por `DA-11` y Constitución v2.11.0, ya que `sso-oidc` es el propio Broker OIDC público al que acuden los navegadores y clientes para autenticarse, protegido en el borde por External Application Load Balancer + Cloud Armor WAF (`sso-oidc-waf-policy`).

---

## 7. Referencias Documentales Oficiales Verificadas en Google Developer Knowledge (`Principio V.13`)

De conformidad con el **Principio V.13 de la Constitución MINEDEC v2.11.0** y la skill `.agents/skills/retrieving-developer-knowledge/SKILL.md`, las decisiones de esta investigación fueron verificadas contra los siguientes documentos autoritativos de `developerknowledge.googleapis.com`:

1. **`documents/developers.google.com/identity/openid-connect/reference`**: Especificación oficial de los endpoints OAuth 2.0 / OpenID Connect de Google (`https://accounts.google.com/.well-known/openid-configuration`), uso del parámetro `hd` (*Hosted Domain*) para restringir u optimizar la autenticación a dominios de Google Workspace, coincidencia exacta de `redirect_uri`, intercambio de `code` en el endpoint de token y estructura de reclamos del `id_token` de Google (`iss`, `sub`, `aud`, `email`, `email_verified`, `hd`).
2. **`documents/developers.google.com/identity/gsi/web/guides/verify-google-id-token`** y **`documents/developers.google.com/identity/sign-in/web/backend-auth`**: Directrices oficiales de Google Identity para verificar criptográficamente el `id_token` en el backend (validación de firma RS256 contra las claves públicas de Google, `aud` igual al `CLIENT_ID` registrado, `iss` igual a `accounts.google.com` o `https://accounts.google.com`, `exp` vigente, validación del reclamo `hd` para organizaciones de Google Workspace y uso de `sub` como identificador primario inmutable de la cuenta).
3. **`documents/docs.cloud.google.com/armor/docs/integrating-cloud-armor`**, **`documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/ingress-configuration`** y **`documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/ingress-features`**: Configuración oficial de GKE Ingress con External Application Load Balancer mediante `BackendConfig` (`cloud.google.com/v1`, `spec.securityPolicy.name`) y `FrontendConfig` para adjuntar políticas WAF de Google Cloud Armor (`sso-oidc-waf-policy`) al servicio público `sso-oidc` en GKE Autopilot.
4. **`documents/docs.cloud.google.com/kubernetes-engine/docs/tutorials/workload-identity-secrets`** y **`documents/docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component`**: Acceso sin llaves JSON (*keyless*) desde pods en GKE Autopilot (`sa-sso-core`) hacia Google Secret Manager mediante Workload Identity Federation for GKE (`iam.gke.io/gcp-service-account` / `roles/secretmanager.secretAccessor`) para leer el secreto del cliente OAuth de Google y las versiones de llaves privadas `RS256` del JWKS.
5. **`documents/docs.cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc`** y **`documents/docs.cloud.google.com/infrastructure-manager/docs/configure-service-account`**: Despliegue de clústeres GKE Autopilot sobre subredes de una Red Compartida (Shared VPC) administrada en el proyecto host (`mec-003-sha-net-{des,pre,pro-511014}`) y ejecución de despliegues declarativos en los proyectos de servicio (`mec-003-sso-{des,pre,pro}`) mediante Google Cloud Infrastructure Manager con `sa-infra-manager@<project_id>.iam.gserviceaccount.com`.
