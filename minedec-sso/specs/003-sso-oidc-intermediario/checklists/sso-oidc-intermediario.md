# Requirements Quality Checklist: Servicio Intermediario Central de Inicio de Sesión Único (Identity Broker OIDC — DA-11)

**Purpose**: Pruebas unitarias de calidad de requerimientos (*"Unit Tests for Requirements"*) como compuerta formal de revisión de Arquitectura, Seguridad OWASP/OIDC y Cumplimiento Constitucional (PR / Release Gate) con trazabilidad cruzada entre `spec.md`, `data-model.md`, `contracts/sso-oidc-api.openapi.yaml` y `plan.md`.
**Created**: 2026-10-22
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [data-model.md](../data-model.md) | [sso-oidc-api.openapi.yaml](../contracts/sso-oidc-api.openapi.yaml)

---

## 1. Completitud de Requerimientos (Protocolo OIDC, Clientes 1FN/3FN y Federación Única `D-01` / `DA-11`)

- [x] CHK001 - ¿Están especificados explícitamente los 6 puntos de acceso estándar del intermediario OIDC (`GET /.well-known/openid-configuration`, `GET /authorize`, `GET /callback`, `POST /token`, `GET /jwks` y `GET/POST /logout`) junto con sus métodos HTTP, parámetros obligatorios y códigos de respuesta tanto en la especificación como en el contrato OpenAPI 3.1? [Completeness, Spec §FR-001, Contract `sso-oidc-api.openapi.yaml`]
- [x] CHK002 - ¿Define la especificación de forma inequívoca que `sso-oidc` opera con un único cliente OAuth 2.0 registrado ante Google Cloud Identity (`https://accounts.google.com`, `D-01`) y valida dinámicamente la pertenencia del correo verificado a los subdominios institucionales activos (`@educacion.gob.ec`, `@estudiantes.educacion.gob.ec`, `@deporte.gob.ec`, `@cultura.gob.ec`) registrados en `dominio_institucional` (`D-21`)? [Completeness, Spec §FR-002, §Assumptions, Data-Model §2.6]
- [x] CHK003 - ¿Están definidos todos los atributos relacionales y restricciones de integridad en 1FN/3FN/BCNF para `aplicacion`, `cliente_oidc` y `cliente_oidc_redirect_uri` (incluyendo los tres tipos de dirección `LOGIN_CALLBACK`, `POST_LOGOUT` y `BACKCHANNEL_LOGOUT`), eliminando el uso de arreglos multivaluados y superando el límite de 100 URIs de GCP? [Completeness, Spec §FR-003, §Key Entities, Data-Model §2.1–§2.3]
- [x] CHK004 - ¿Especifican los requerimientos la obligatoriedad del flujo `Authorization Code + PKCE` con `code_challenge_method = S256`, parámetro `state` y validación de coincidencia exacta carácter por carácter de `redirect_uri` antes de iniciar cualquier redirección al proveedor primario? [Completeness, Spec §FR-004, §US2-AS1]
- [x] CHK005 - ¿Están completamente especificados los requerimientos para la rotación periódica (`<= 90 días`) de secretos de clientes confidenciales en `cliente_oidc` mediante ventana de gracia dual (`secreto_activo_hash`, `secreto_anterior_hash`, `gracia_hasta`) almacenados exclusivamente como hash `SHA-256`? [Completeness, Spec §FR-005, §US2-AS2, Data-Model §2.2]
- [x] CHK006 - ¿Contempla la especificación el soporte unificado tanto para las aplicaciones del Patrón 1 (Integración Nativa SP/RP) como para el Punto de Cumplimiento Perimetral (PEP) del Patrón 2, emitiendo siempre comprobantes con audiencia (`aud`) exclusiva por cliente? [Completeness, Spec §FR-001, §FR-009, §US1]

---

## 2. Claridad y Precisión Semántica (Claims de `id_token`, `REGISTRO_CALIENTE` y Segregación de Llaves)

- [x] CHK007 - ¿Está definido sin ambigüedad el conjunto exacto de atributos (*claims*) incluidos en el `id_token` emitido por `POST /token` (`iss`, `sub`, `aud`, `exp`, `iat`, `nonce`, `email`, `email_verified`, `tipo_identificacion` y `numero_identificacion`), prohibiendo expresamente incluir roles, permisos o asignaciones territoriales (`AMIE`, `zona`, `distrito`, `circuito`)? [Clarity, Spec §FR-009, §US1-AS1, Contract `components.schemas.IdTokenClaims`]
- [x] CHK008 - ¿Está especificada con precisión la máquina de decisión durante `GET /callback` cuando una cuenta recién creada entra en `REGISTRO_CALIENTE` / `PENDIENTE_IDENTIFICACION`: encolado prioritario en segundo plano, espera local acotada (`<= 3 segundos` con backoff contra PIP/caché y `0 llamadas` a Google Admin SDK desde `sso-oidc`) y retención `fail-close` con pantalla informativa en español si al finalizar la ventana aún no existe `numero_identificacion` consolidado? [Clarity, Spec §Clarifications, §FR-007, §US3-AS2]
- [x] CHK009 - ¿Distingue la especificación con total claridad entre los estados denegados de cuenta institucional (`SUSPENDIDA_GWS`, `ELIMINADA_GWS`, `BLOQUEADA_ANOMALIA`) y los estados denegados de persona natural (`INACTIVA`, `VIGENCIA_VENCIDA`, `BLOQUEADA_ANOMALIA`), exigiendo bloqueo inmediato (`fail-close`) en todos ellos? [Clarity, Spec §FR-008, §US3-AS1]
- [x] CHK010 - ¿Define la especificación sin ambigüedad el esquema híbrido de dos capas para el Cierre de Sesión Único (`GET/POST /logout`, `FR-011`): Capa 1 con purga inmediata de sesión central y envío asíncrono de `logout_token` firmado (`OIDC Back-Channel Logout 1.0`) a las URIs `BACKCHANNEL_LOGOUT` activas (`< 1 s`), y Capa 2 con expiración/revalidación máxima obligatoria de `<= 300 segundos` para aplicaciones sin canal trasero? [Clarity, Spec §Clarifications, §FR-011, §US4-AS1]
- [x] CHK011 - ¿Está claramente especificada la segregación criptográfica en `llave_jwks_rotacion` mediante la columna `servicio_emisor` (`SSO_OIDC` vs `MOTOR_PDP`) y sus cuatro estados (`ACTIVA_FIRMA`, `GRACIA_VERIFICACION`, `RETIRADA`, `REVOCADA`), garantizando que `GET /jwks` de `sso-oidc` publique únicamente llaves de `SSO_OIDC` en estado `ACTIVA_FIRMA` o `GRACIA_VERIFICACION`? [Clarity, Spec §Clarifications, §FR-013, §US5-AS2, Data-Model §2.4]

---

## 3. Consistencia Cruzada entre Artefactos (`spec.md` ↔ `data-model.md` ↔ `contracts/` ↔ `plan.md`)

- [x] CHK012 - ¿Coinciden exactamente los nombres de tablas, columnas y enumeraciones entre `spec.md` (`Key Entities`), `data-model.md` (`migrations/004_sso_oidc_broker_schema.sql`) y los esquemas canónicos DBML (`etapa-2-autorizacion-pdp-pap-rbac-abac.dbml` y `etapa-3-seguridad-m2m-jwks-publicador.dbml`) para `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` y `llave_jwks_rotacion`? [Consistency, Spec §Key Entities, Data-Model §2.1–§2.4]
- [x] CHK013 - ¿Son consistentes las estructuras de claves efímeras en Memorystore for Redis (`minedec:oidc:{model}:{id}`, `minedec:oidc:session:by-cuenta:{cuenta_id}`, `minedec:oidc:session:by-persona:{id_interno}` y `minedec:oidc:reval:{session_uid}`) definidas en `data-model.md` con los tiempos de vida y reglas de invalidación de `spec.md` (`code <= 60 s`, revalidación `<= 300 s`, sesión central `<= 28800 s`)? [Consistency, Spec §FR-009, §FR-010, §FR-012, Data-Model §3.1–§3.2]
- [x] CHK014 - ¿Está alineado el contrato de eventos Pub/Sub de revocación `sso.identity.revoked` (`IdentityRevokedEvent` con `scope: 'CUENTA' | 'PERSONA'`) consumido en `plan.md` y `data-model.md` con el esquema publicado por la Feature 002 (`002-sincronizador-conciliacion-gws`) y el caso de borde de múltiples cuentas por persona (`RF-GI-07`)? [Consistency, Spec §FR-012, §Edge Cases, Data-Model §3.2, Plan §Resumen Técnico]
- [x] CHK015 - ¿Coinciden los esquemas de `IdTokenClaims`, `BackChannelLogoutTokenClaims`, `OidcDiscoveryMetadata` y respuestas de error (`OAuth2ErrorResponse` / `ErrorEnvelope`) del contrato `contracts/sso-oidc-api.openapi.yaml` con las reglas de `spec.md` (`FR-001`, `FR-009`, `FR-011`, `FR-014`)? [Consistency, Spec §FR-001, §FR-009, §FR-011, §FR-014, Contract `sso-oidc-api.openapi.yaml`]
- [x] CHK016 - ¿Existe consistencia entre el catálogo de eventos de auditoría de `data-model.md` (`OIDC_LOGIN_SUCCESS`, `OIDC_LOGIN_DENIED_DOMAIN`, `OIDC_LOGIN_DENIED_STATUS`, `OIDC_LOGIN_HOT_REGISTRATION_PENDING`, `OIDC_CODE_REUSE_DETECTED`, `OIDC_REDIRECT_URI_MISMATCH`, `OIDC_LOGOUT_INITIATED`, `OIDC_SESSION_REVOKED_PUBSUB`, `OIDC_CLIENT_SECRET_GRACE_USED`, `OIDC_JWKS_ROTATED`, `OIDC_JWKS_REVOKED_EMERGENCY`) y las exigencias de trazabilidad inmutable de `FR-014`? [Consistency, Spec §FR-014, Data-Model §2.5]
- [x] CHK017 - ¿Respeta la estructura de paquetes definida en `plan.md` (`backend/sso-oidc/src/{domain,application,infrastructure,main}` + `backend/shared`) el aislamiento de Arquitectura Hexagonal e InversifyJS únicamente en el Composition Root (`container.ts`), manteniendo `domain/` y `application/` 100 % libres de decoradores e imports de infraestructura? [Consistency, Plan §Constitution Check, §Project Structure, Constitution §IV]

---

## 4. Medibilidad y Criterios de Aceptación Cuantificables (`SLA`, `PKCE`, `SLO` y Revocación `<= 300 s`)

- [x] CHK018 - ¿Son cuantificables y verificables mediante pruebas automatizadas las cotas de escalabilidad del catálogo normalizado (`SC-001`: soporte de más de 200 aplicaciones y más de 500 `redirect_uris` distintas sin límites de plataforma externa)? [Measurability, Spec §SC-001, §US2]
- [x] CHK019 - ¿Define la especificación un umbral temporal medible y determinista para la vigencia máxima del código de autorización efímero (`TTL <= 60 segundos`, `FR-009`, `SC-005`) y para el rechazo inmediato en caso de expiración o segundo intento de canje (`invalid_grant`)? [Measurability, Spec §FR-009, §SC-005, §Edge Cases]
- [x] CHK020 - ¿Está cuantificada la cota máxima de reintento local durante `REGISTRO_CALIENTE` en `<= 3 segundos` (`FR-007`) y la exigencia de exactamente `0 llamadas` al directorio administrativo externo (`Google Admin SDK`) durante el camino crítico de inicio de sesión (`FR-006`, `SC-003`, `RNF-REN-05`)? [Measurability, Spec §FR-006, §FR-007, §SC-003]
- [x] CHK021 - ¿Están cuantificados de forma verificable los dos umbrales del SLA de revocación de sesiones e identidades (`SC-004`, `FR-010`, `FR-012`, `PI-07`): `< 5 segundos` tras recibir el evento Pub/Sub `sso.identity.revoked` en camino nominal y `<= 300 segundos` como techo duro absoluto por expiración de la marca de revalidación en Redis? [Measurability, Spec §FR-010, §FR-012, §SC-004]
- [x] CHK022 - ¿Son medibles los criterios de continuidad operativa (`0 %` de interrupción en `SC-006`) durante la ventana de gracia de rotación de secretos de cliente (`<= 90 días`, `FR-005`) y de llaves asimétricas `RS256` (`<= 90 días` y sustitución `< 1 h` ante compromiso, `FR-013`)? [Measurability, Spec §FR-005, §FR-013, §SC-006]

---

## 5. Cobertura de Escenarios, Flujos de Excepción y Recuperación (`Fail-Close` y Resiliencia)

- [x] CHK023 - ¿Especifican los requerimientos el comportamiento exacto de cierre seguro (`fail-close`, `RNF-SEG-10`) cuando el Repositorio Central de Identidades (PIP / AlloyDB) o la capa de estado en memoria (Memorystore for Redis) no están disponibles o exceden su tiempo de espera durante `/authorize`, `/callback` o `/token`? [Coverage, Spec §Edge Cases, §FR-007, §FR-008, Contract `503 Service Unavailable`]
- [x] CHK024 - ¿Está cubierto el escenario de seguridad en el que un código de autorización (`code`) ya consumido intenta ser canjeado por segunda vez en `POST /token`, exigiendo rechazar la petición con `invalid_grant`, revocar los artefactos asociados a esa transacción y registrar `OIDC_CODE_REUSE_DETECTED` en auditoría? [Coverage, Spec §US1-AS3, §Edge Cases, Data-Model §2.5]
- [x] CHK025 - ¿Cubre la especificación el escenario en que una aplicación cambia su estado a `SUSPENDIDO` o `DESPUBLICADO` (o su `ClienteOidc` pasa a `REVOCADO`) mientras existen sesiones centrales activas o códigos pendientes, exigiendo denegar de inmediato nuevos inicios de sesión y canjes de código para esa aplicación? [Coverage, Spec §US2-AS3, §FR-004]
- [x] CHK026 - ¿Está especificado el manejo de fallos de red o timeouts al despachar asíncronamente el `logout_token` hacia las direcciones `BACKCHANNEL_LOGOUT` de las aplicaciones participantes, asegurando que un fallo en un webhook externo no bloquee la destrucción inmediata de la sesión central en Redis ni la redirección del navegador? [Coverage, Spec §FR-011, §US4-AS1, Plan §Resumen Técnico]
- [x] CHK027 - ¿Define la especificación el comportamiento de revocación de emergencia de una llave criptográfica comprometida (`estado_llave = 'REVOCADA'` en `< 1 hora`), garantizando su eliminación inmediata del endpoint `GET /jwks` y el rechazo de cualquier artefacto firmado con dicho `kid`? [Coverage, Spec §US5, §FR-013, Data-Model §2.4]

---

## 6. Casos de Borde, Ciberseguridad OWASP/OIDC e Invariantes Constitucionales

- [x] CHK028 - ¿Cubre la especificación el caso de borde de múltiples cuentas activas para una misma persona natural (`RF-GI-07`, p. ej. `@educacion.gob.ec` y `@cultura.gob.ec` bajo la misma `CEDULA`), diferenciando entre la baja de una sola `CuentaInstitucional` (que purga solo las sesiones de esa cuenta) y la inactivación de la `PersonaIdentidad` (que purga las sesiones de todas sus cuentas)? [Edge Case, Spec §Edge Cases, §FR-012, Data-Model §3.2]
- [x] CHK029 - ¿Está contemplado el rechazo determinista de cuentas autenticadas en Google que pertenezcan a dominios personales (`@gmail.com`) o a dominios no activos en `dominio_institucional`, sin crear sesión central ni disparar `REGISTRO_CALIENTE`? [Edge Case, Spec §Edge Cases, §FR-002]
- [x] CHK030 - ¿Están especificados los invariantes de defensa contra *Open Redirect* y ataques de inyección/transversal de rutas: prohibición de redireccionar jamás hacia un `redirect_uri` o `post_logout_redirect_uri` no registrado carácter por carácter, y rechazo de secuencias ambiguas (`%2F`, `%5C`, `..`)? [Security, Spec §US2-AS1, §FR-004, §FR-011, Plan §Constitution Check]
- [x] CHK031 - ¿Cumplen los artefactos de diseño con los invariantes constitucionales de **Zero Secret en código/base de datos** (llaves privadas `RS256` y secreto del cliente OAuth de Google exclusivamente en Secret Manager; secretos OIDC de aplicaciones solo como hash `SHA-256` en AlloyDB) y **consultas SQL 100 % parametrizadas (`$1, $2`)**? [Security, Spec §FR-005, §FR-013, Data-Model §2.2, §2.4, Plan §Constitution Check]
- [x] CHK032 - ¿Está explícitamente establecido en `spec.md`, `contracts/sso-oidc-api.openapi.yaml` y `plan.md` el invariante constitucional de **Cero Telemetría de Latencia en Node.js** (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII), prohibiendo calcular `Date.now() - startedAt` o exponer campos de duración en milisegundos en respuestas HTTP o registros de aplicación? [Constitution, Spec §FR-014, Contract `sso-oidc-api.openapi.yaml`, Plan §Constitution Check]

---

## Notes & Audit Summary

- **Resultado de la Auditoría de Calidad de Requerimientos (2026-10-22)**: **32 / 32 ítems verificados (`100 %` aprobados)**.
- **Trazabilidad Cruzada**: `100 %` de los ítems (`32/32`, superando el umbral mínimo del `80 %`) cuentan con referencias explícitas a secciones de `spec.md`, `data-model.md`, `contracts/sso-oidc-api.openapi.yaml` y `plan.md`.
- **Estado de la Compuerta**: La especificación y el diseño técnico de la **Feature 003 (`003-sso-oidc-intermediario`)** están completos, sin ambigüedades ni brechas, y listos para `/speckit-tasks` y `/speckit-analyze`.
