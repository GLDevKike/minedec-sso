# Feature Specification: Autenticación M2M (Client Credentials), Catálogo JWKS Segregado y Rotación Dual Sin Tiempo de Inactividad (`005-autenticacion-m2m-rotacion`)

**Feature Branch**: `spec/005-autenticacion-m2m-rotacion`

**Created**: 2026-10-26

**Status**: Approved (`Clarified & Planned`)

**Input**: User description: "Diseño y especificación del subsistema de autenticación Máquina a Máquina (OAuth 2.0 Client Credentials RFC 6749 §4.4), emisión de tokens de acceso M2M (POST /api/v1/oauth/token), gobierno del catálogo criptográfico JWKS RS256 segregado por servicio_emisor (GET /api/v1/.well-known/jwks.json), rotación periódica <= 90 días con ventana de gracia dual sin indisponibilidad y revocación de emergencia (< 1 h / <= 300 s) para el Subcomponente C2.2 de Conecta MINEDEC."

## Contexto MINEDEC *(mandatory)*

| Campo | Valor |
|-------|--------|
| **Dominio** | `SSO` |
| **Iniciativa** | `sso-c22` |

### Referencias OKF / knowledge

- Concepto: [`knowledge/arquitectura/indice-arquitectura-c22.md`](../../knowledge/arquitectura/indice-arquitectura-c22.md) — Arquitectura C4 de Contenedores y Componentes del Subcomponente C2.2 (`motor-pdp`, `sso-oidc`, `api-pap`, `pip-identity-service`).
- Concepto: [`knowledge/arquitectura/contrato-autorizacion-pep-pdp.md`](../../knowledge/arquitectura/contrato-autorizacion-pep-pdp.md) — Especificación de `POST /api/v1/oauth/token` (`grant_type=client_credentials`), aislamiento de alcance M2M por patrón de integración (`APLICACION_PATRON_1` vs `PEP_PATRON_2`), publicación de JWKS `RS256` y rotación dual sin caída de servicio.
- Concepto: [`knowledge/arquitectura/patrones-integracion-aplicaciones.md`](../../knowledge/arquitectura/patrones-integracion-aplicaciones.md) — Diferenciación operativa entre el **Patrón 1 (Integración Nativa SP/RP)** —donde cada aplicación consume el PDP con su propia credencial M2M acotada exclusivamente a su `aplicacion_id`— y el **Patrón 2 (Integración Perimetral PEP)** —donde la capa perimetral invoca el PDP con una credencial M2M transversal—.
- Concepto: [`knowledge/requerimientos/requerimientos-funcionales-c22.md`](../../knowledge/requerimientos/requerimientos-funcionales-c22.md) — Requerimientos funcionales `RF-AUT-04`, `RF-AUT-05`, `RF-AUT-06`, `RF-SEG-01..06` y matriz de decisiones `D-01..D-21` (`DA-04`, `DA-06`, `DA-11`).
- Concepto: [`knowledge/requerimientos/requerimientos-no-funcionales-sla.md`](../../knowledge/requerimientos/requerimientos-no-funcionales-sla.md) — Requerimientos no funcionales de seguridad criptográfica, rotación máxima `<= 90 días`, sustitución de emergencia `< 1 hora`, revocación efectiva `<= 300 segundos` (`PI-07`), degradación `Fail-Close` y auditoría forense inmutable de 3 capas.
- Decisión de Arquitectura: [`docs/decisiones/DA-11-intermediario-oidc.md`](../../docs/decisiones/DA-11-intermediario-oidc.md) — Segregación estricta de emisores (`servicio_emisor = 'SSO_OIDC'` para `id_token` de sesión vs `servicio_emisor = 'MOTOR_PDP'` para tokens M2M y `assertion_jwt` de autorización).
- Modelo de Datos: [`docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml`](../../docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml) — Modelo relacional canónico en 3FN/BCNF de las tablas `credencial_m2m` y `llave_jwks_rotacion`.
- Índice leído: `knowledge/index.md`

### Integración SSO (consume-only)

- **Rol**: `Subsistema de Autenticación M2M y Gobierno Criptográfico JWKS del Motor de Autorización Central (Subcomponente C2.2 - motor-pdp)`
- **Qué se consume**: Catálogo de aplicaciones (`aplicacion`), credenciales confidenciales M2M (`credencial_m2m`), catálogo de llaves asimétricas `RS256` (`llave_jwks_rotacion`) y almacén institucional de secretos para llaves privadas de firma.
- **Qué no se construye**: Flujos interactivos de inicio de sesión de usuarios finales (`Authorization Code + PKCE`, responsabilidad exclusiva de `sso-oidc`), almacenamiento de secretos o llaves privadas en texto plano en base de datos, ni telemetría de duración por petición en respuestas HTTP.

## Clarifications

### Session 2026-10-26

- Q: ¿Cómo se entrega el `client_secret` al aprovisionar o rotar una credencial M2M si en la base de datos solo se persisten hashes `SHA-256` (`CHAR(64)`)? → A: El acto administrativo de provisión o rotación genera un secreto criptográficamente aleatorio de alta entropía (`>= 256 bits`), calcula su resumen `SHA-256` en hexadecimal minúscula (`64` caracteres) para persistirlo en `credencial_m2m.secreto_activo_hash` y devuelve el secreto en texto plano **una única vez** en la respuesta (`client_secret_unica_vez`) para su resguardo inmediato en el gestor de secretos por el consumidor autorizado, sin registrarlo jamás en tablas, cachés ni logs.
- Q: ¿Qué ocurre con los tokens M2M (`access_token` con vigencia de hasta `3600 s`) que ya fueron emitidos cuando una credencial M2M se revoca de emergencia (`estado_credencial = 'REVOCADA'`) antes de que expire el token? → A: Además de bloquear inmediatamente toda nueva emisión en `POST /api/v1/oauth/token`, la revocación de emergencia registra la marca de revocación del `client_id` en la caché de segundo nivel (`TTL <= 300 s`) y actualiza `estado_credencial = 'REVOCADA'` en `credencial_m2m`. El verificador de tokens M2M comprueba que el `client_id` del token entrante no se encuentre revocado ni con rotación vencida, rechazando de forma inmediata (`401 Unauthorized`, `<= 300 s`) cualquier petición a `POST /api/v1/access/evaluation` aun cuando la firma y el `exp` del token sigan vigentes.
- Q: ¿Cuál es la diferencia operativa entre los estados `RETIRADA` y `REVOCADA` en el catálogo `llave_jwks_rotacion`? → A: `RETIRADA` representa el cierre limpio y planificado del ciclo de vida de una llave que estuvo en `GRACIA_VERIFICACION` una vez concluida su ventana de convivencia tras una rotación normal (`PDP_JWKS_RETIRADO`), dejando de publicarse en `/.well-known/jwks.json`. `REVOCADA` representa una baja inmediata de emergencia (`< 1 h`) ante sospecha o confirmación de compromiso criptográfico (`PDP_JWKS_REVOCADO_EMERGENCIA`), pudiendo aplicarse tanto sobre una llave en `GRACIA_VERIFICACION` como sobre una llave en `ACTIVA_FIRMA`.
- Q: ¿Cómo se garantiza que una aplicación del Patrón 1 no utilice su token M2M para consultar decisiones de autorización de otra aplicación registrada en Conecta MINEDEC? → A: Toda credencial con `tipo_cliente = 'APLICACION_PATRON_1'` exige invariante `aplicacion_id IS NOT NULL` (`ck_m2m_patron_alcance`). El token M2M emitido incrusta los claims firmados `tipo_cliente = 'APLICACION_PATRON_1'` y `aplicacion_id = '<uuid>'`. Durante `POST /api/v1/access/evaluation`, el motor compara el `aplicacion_id` del token Bearer contra el `aplicacion_id` de la aplicación evaluada; cualquier discrepancia se rechaza con `403 Forbidden` (`FORBIDDEN_M2M_SCOPE`) antes de devolver datos de identidad o permisos.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Emisión de Tokens M2M (`Client Credentials`) y Aislamiento de Alcance por Patrón (Priority: P1)

Como aplicación integrada mediante el Patrón 1 (SP/RP Nativo) o como componente perimetral PEP del Patrón 2, necesito autenticarme ante `POST /api/v1/oauth/token` mediante el flujo estándar `OAuth 2.0 Client Credentials` para obtener un `access_token` firmado que me autorice a invocar `POST /api/v1/access/evaluation` únicamente dentro de mi ámbito permitido.

**Why this priority**: Es el control de acceso perimetral e inter-servicio que protege al Motor de Autorización Central. Sin autenticación M2M y aislamiento de alcance por aplicación, cualquier servicio interno podría consultar permisos de cualquier aplicación o suplantar al PEP.

**Independent Test**: Se puede probar registrando una credencial `APLICACION_PATRON_1` (vinculada a la aplicación `A`) y una credencial `PEP_PATRON_2` (`aplicacion_id = NULL`), solicitando tokens en `POST /api/v1/oauth/token` y verificando que la credencial de la aplicación `A` solo puede evaluar rutas de `A` (`200 OK`) y recibe `403 FORBIDDEN_M2M_SCOPE` al intentar evaluar la aplicación `B`, mientras que la credencial `PEP_PATRON_2` puede evaluar rutas de `A` y `B`.

**Acceptance Scenarios**:

1. **Given** un cliente M2M con `estado_credencial = 'ACTIVA'`, `expira_rotacion_en > NOW()` y `secreto_activo_hash` coincidente en tiempo constante con el `client_secret` presentado, **When** invoca `POST /api/v1/oauth/token` con `grant_type=client_credentials` y `scope=pdp:evaluate`, **Then** el servicio responde `200 OK` con `Cache-Control: no-store`, `Pragma: no-cache`, `token_type: "Bearer"`, `expires_in: 3600` y un `access_token` firmado (`typ: "at+jwt"`) que incluye `sub`, `client_id`, `tipo_cliente`, `aplicacion_id`, `scope`, `iss`, `aud`, `iat`, `exp` y cabecera `kid`, registrando el evento transaccional `PDP_TOKEN_M2M_EMITIDO`.
2. **Given** un cliente M2M de tipo `APLICACION_PATRON_1` vinculado exclusivamente a `uuid_aplicacion_A`, **When** presenta su `access_token` Bearer en `POST /api/v1/access/evaluation` solicitando evaluar una ruta de `uuid_aplicacion_B`, **Then** el servicio rechaza la petición con `403 Forbidden` (`FORBIDDEN_M2M_SCOPE`) sin revelar información de la aplicación `B`.
3. **Given** un cliente M2M que presenta un `client_secret` incorrecto, un `client_id` inexistente o cuya fecha `expira_rotacion_en` ha vencido (`<= NOW()`), **When** invoca `POST /api/v1/oauth/token`, **Then** el servicio responde `401 Unauthorized` (`INVALID_M2M_CLIENT`) y registra el evento de seguridad `PDP_TOKEN_M2M_RECHAZADO` en `auditoria_evento`.

---

### User Story 2 - Ciclo de Vida y Rotación Dual de Secretos M2M (`<= 90 días`) sin Caída de Servicio (Priority: P1)

Como Superadministrador de Seguridad Informática o proceso automatizado de rotación periódica (`<= 90 días`), necesito aprovisionar credenciales M2M, rotar su secreto abriendo una ventana de convivencia dual (`EN_ROTACION_GRACIA` con `secreto_activo_hash` y `secreto_anterior_hash` válidos hasta `gracia_hasta`) y cerrar la ventana de gracia al finalizar la transición, garantizando cero interrupciones operativas en las aplicaciones integradas y en el PEP.

**Why this priority**: Cumple el mandato institucional de higiene criptográfica (rotación `<= 90 días`, cero secretos en texto plano en base de datos y ventana de gracia dual para despliegues sin indisponibilidad).

**Independent Test**: Se puede probar aprovisionando una credencial M2M, obteniendo un token con el secreto inicial `S1`, ejecutando la rotación para generar el nuevo secreto `S2` con ventana de gracia, comprobando que tanto `S1` como `S2` emiten tokens válidos durante la ventana de gracia, ejecutando el cierre de la ventana de gracia (`expire-grace`) y verificando que `S1` es rechazado con `401 Unauthorized` mientras `S2` continúa operando.

**Acceptance Scenarios**:

1. **Given** una solicitud administrativa de creación de credencial M2M para `APLICACION_PATRON_1` (con `aplicacion_id` válido) o `PEP_PATRON_2` (`aplicacion_id = NULL`), **When** se invoca `POST /internal/v1/pdp/m2m/credentials`, **Then** el sistema genera un secreto aleatorio de alta entropía (`>= 256 bits`), persiste únicamente su hash `SHA-256` (`CHAR(64)`) en `secreto_activo_hash` con `estado_credencial = 'ACTIVA'` y `expira_rotacion_en <= NOW() + 90 días`, registra `PDP_CREDENCIAL_M2M_CREADA` en `auditoria_evento` y devuelve el secreto en texto plano por única vez (`client_secret_unica_vez`).
2. **Given** una credencial M2M activa con secreto `S1`, **When** se invoca `POST /internal/v1/pdp/m2m/credentials/:clientId/rotate`, **Then** el hash de `S1` pasa a `secreto_anterior_hash`, el hash del nuevo secreto `S2` se almacena en `secreto_activo_hash`, el estado cambia a `EN_ROTACION_GRACIA` con `gracia_hasta > NOW()` y `expira_rotacion_en <= NOW() + 90 días`, se audita `PDP_CREDENCIAL_M2M_ROTADA` y durante la vigencia de `gracia_hasta` tanto `S1` como `S2` son aceptados en `POST /api/v1/oauth/token`.
3. **Given** una credencial M2M en estado `EN_ROTACION_GRACIA`, **When** vence el timestamp `gracia_hasta` o se invoca explícitamente `POST /internal/v1/pdp/m2m/credentials/:clientId/expire-grace`, **Then** el sistema limpia `secreto_anterior_hash = NULL` y `gracia_hasta = NULL`, retorna la credencial a `estado_credencial = 'ACTIVA'`, audita `PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA` y rechaza inmediatamente cualquier intento de autenticación con el secreto anterior `S1` (`401 INVALID_M2M_CLIENT`).

---

### User Story 3 - Revocación de Emergencia de Credenciales M2M (`< 1 h`) e Invalidación Inmediata de Tokens en Vuelo (`<= 300 s`) (Priority: P1)

Como Superadministrador de Seguridad Informática, necesito revocar de emergencia una credencial M2M comprometida (`POST /internal/v1/pdp/m2m/credentials/:clientId/revoke`) de modo que no solo se impida la emisión de nuevos tokens en `/api/v1/oauth/token`, sino que también se rechacen de inmediato (`<= 300 s`) todos los `access_token` Bearer M2M previamente emitidos para ese `client_id` que aún no hayan alcanzado su expiración natural de `3600 s`.

**Why this priority**: Un token M2M tiene un tiempo de vida de hasta `3600 segundos` (`1 hora`). Si una credencial M2M es comprometida, esperar hasta `3600 s` violaría el acuerdo de nivel de servicio de revocación efectiva (`<= 300 s`, `RF-AUT-06`, `PI-07`).

**Independent Test**: Se puede probar emitiendo un `access_token` válido para un `client_id`, verificando que puede invocar `POST /api/v1/access/evaluation`, ejecutando `POST /internal/v1/pdp/m2m/credentials/:clientId/revoke` y comprobando inmediatamente después que: (a) `POST /api/v1/oauth/token` devuelve `401 Unauthorized` y (b) el `access_token` ya emitido es rechazado con `401 Unauthorized` al invocar `POST /api/v1/access/evaluation`.

**Acceptance Scenarios**:

1. **Given** un cliente M2M con un `access_token` Bearer en vuelo (con `exp` restante de hasta `3600 s`), **When** se ejecuta `POST /internal/v1/pdp/m2m/credentials/:clientId/revoke`, **Then** la credencial pasa a `estado_credencial = 'REVOCADA'` (limpiando `secreto_anterior_hash = NULL` y `gracia_hasta = NULL`), se registra la marca de revocación en caché de segundo nivel y se audita transaccionalmente `PDP_CREDENCIAL_M2M_REVOCADA`.
2. **Given** un `access_token` Bearer perteneciente a un `client_id` cuya credencial ha sido marcada como `REVOCADA`, **When** el cliente invoca `POST /api/v1/access/evaluation`, **Then** el verificador de autenticación M2M rechaza la petición con `401 Unauthorized` (`INVALID_M2M_TOKEN`) en tiempo real (`<= 300 s`), sin permitir la evaluación de políticas.

---

### User Story 4 - Publicación, Rotación Dual (`<= 90 días`), Retiro Limpio y Revocación de Emergencia (`< 1 h`) del Catálogo JWKS `RS256` (Priority: P1)

Como consumidor de aserciones del PDP (aplicación SP/RP del Patrón 1 o PEP del Patrón 2) y como operador de seguridad, necesito que el motor publique su catálogo JWKS `RS256` en `GET /api/v1/.well-known/jwks.json` exponiendo exclusivamente las llaves públicas de `servicio_emisor = 'MOTOR_PDP'` en estado `ACTIVA_FIRMA` y `GRACIA_VERIFICACION`, y que soporte la rotación hacia una nueva llave activa, el retiro limpio (`RETIRADA`) de llaves cuya ventana de verificación haya concluido y la revocación de emergencia (`REVOCADA`, `< 1 h`) ante compromiso.

**Why this priority**: Garantiza la autenticidad e integridad criptográfica de `assertion_jwt` (`X-Minedec-Assertion`) y de los tokens M2M sin acoplar ni contaminar las llaves de sesión OIDC de `sso-oidc` (`DA-11`).

**Independent Test**: Se puede probar consultando `GET /api/v1/.well-known/jwks.json`, rotando la llave con `POST /internal/v1/pdp/jwks/rotate`, verificando que la llave anterior (`kid_1`) pasa a `GRACIA_VERIFICACION` y sigue verificando tokens firmados antes de la rotación mientras la nueva (`kid_2`) firma los nuevos tokens, retirando limpiamente `kid_1` con `POST /internal/v1/pdp/jwks/:kid/retire` y verificando que desaparece del JWKS y que los tokens firmados con `kid_1` dejan de ser aceptados.

**Acceptance Scenarios**:

1. **Given** el catálogo `llave_jwks_rotacion` con llaves de `MOTOR_PDP` y de `SSO_OIDC`, **When** un cliente consulta `GET /api/v1/.well-known/jwks.json` (o `/api/v1/oauth/jwks`), **Then** el servicio responde `200 OK` con `Cache-Control: public, max-age=3600` incluyendo únicamente los objetos JWK públicos (`kty`, `use`, `alg`, `kid`, `n`, `e`, cero material privado) con `servicio_emisor = 'MOTOR_PDP'` y `estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')`.
2. **Given** una llave `kid_1` en estado `ACTIVA_FIRMA`, **When** se invoca `POST /internal/v1/pdp/jwks/rotate`, **Then** `kid_1` transiciona a `GRACIA_VERIFICACION`, la nueva llave `kid_2` queda como única `ACTIVA_FIRMA` con `expira_rotacion_en <= NOW() + 90 días`, ambas se publican en el JWKS y se registra `PDP_JWKS_ROTADO` en `auditoria_evento`.
3. **Given** una llave `kid_1` en estado `GRACIA_VERIFICACION` tras cumplirse la ventana de transición de cachés JWKS, **When** se invoca `POST /internal/v1/pdp/jwks/:kid/retire`, **Then** `kid_1` transiciona a `estado_llave = 'RETIRADA'` con `retirada_en = NOW()`, deja de publicarse en `GET /api/v1/.well-known/jwks.json` y se registra `PDP_JWKS_RETIRADO` en `auditoria_evento`.
4. **Given** cualquier llave `kid` de `MOTOR_PDP` sospechosa de compromiso criptográfico, **When** se invoca `POST /internal/v1/pdp/jwks/:kid/revoke`, **Then** pasa inmediatamente a `estado_llave = 'REVOCADA'` con `retirada_en = NOW()`, se elimina del JWKS público y del verificador en memoria y se registra `PDP_JWKS_REVOCADO_EMERGENCIA`.

---

### Edge Cases

- **Invariante de alcance por tipo de cliente M2M (`ck_m2m_patron_alcance`)**: Intentar aprovisionar una credencial `APLICACION_PATRON_1` con `aplicacion_id = NULL` o una credencial `PEP_PATRON_2` con `aplicacion_id IS NOT NULL` es rechazado con `400 Bad Request` (`INVALID_REQUEST_SCHEMA`).
- **Límite duro de rotación (`<= 90 días`, `ck_m2m_rotacion_90_dias` / `ck_jwks_rotacion_90_dias`)**: Si una solicitud intenta fijar una vigencia de rotación superior a `90 días`, el sistema la rechaza por validación de esquema (`400 Bad Request`) o la acota estrictamente a `<= 90 días`.
- **Comparación criptográfica en tiempo constante**: La validación del `client_secret` frente a `secreto_activo_hash` y `secreto_anterior_hash` utiliza comparación en tiempo constante sobre representaciones de longitud idéntica para neutralizar ataques de temporización (*timing attacks*).
- **Aislamiento cruzado de llaves JWKS entre `SSO_OIDC` y `MOTOR_PDP`**: Intentar rotar, retirar o revocar desde `motor-pdp` un `kid` cuyo `servicio_emisor` sea `SSO_OIDC` devuelve error de llave no encontrada (`400 JWKS_KEY_NOT_FOUND`), manteniendo intacto el dominio criptográfico del broker OIDC.
- **Fallo de dependencias críticas (`Fail-Close`)**: Si el almacén primario o la caché sufren una caída durante la emisión o verificación de credenciales M2M, el servicio responde `503 Service Unavailable` (`AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE`) sin otorgar acceso por omisión.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer `POST /api/v1/oauth/token` aceptando `grant_type=client_credentials` con credenciales enviadas mediante cabecera `Authorization: Basic` o en el cuerpo de la petición, emitiendo tokens firmados con `RS256` (`typ = "at+jwt"`, `TTL = 3600 s`, `Cache-Control: no-store`, `Pragma: no-cache`).
- **FR-002**: El sistema DEBE distinguir entre credenciales `APLICACION_PATRON_1` (obligatoriamente vinculadas a un `aplicacion_id` específico) y `PEP_PATRON_2` (`aplicacion_id = NULL`), impidiendo con `403 FORBIDDEN_M2M_SCOPE` que un token `APLICACION_PATRON_1` consulte decisiones de autorización de otra aplicación.
- **FR-003**: El sistema DEBE almacenar los secretos M2M exclusivamente como resúmenes `SHA-256` hexadecimales de 64 caracteres (`secreto_activo_hash` y `secreto_anterior_hash`) en la entidad `credencial_m2m`, validándolos mediante comparación en tiempo constante.
- **FR-004**: El sistema DEBE proveer la capacidad administrativa interna (`POST /internal/v1/pdp/m2m/credentials`) para registrar credenciales M2M generando un secreto aleatorio de alta entropía (`>= 256 bits`), retornando el secreto en texto plano una única vez (`client_secret_unica_vez`) y persistiendo únicamente su hash `SHA-256` con `expira_rotacion_en <= NOW() + 90 días`.
- **FR-005**: El sistema DEBE permitir rotar el secreto de una credencial M2M (`POST /internal/v1/pdp/m2m/credentials/:clientId/rotate`), desplazando el `secreto_activo_hash` vigente hacia `secreto_anterior_hash`, almacenando el nuevo `secreto_activo_hash`, transicionando la credencial a `EN_ROTACION_GRACIA` con ventana `gracia_hasta` y renovando `expira_rotacion_en <= NOW() + 90 días`. Durante la ventana de gracia, ambos secretos DEBEN ser aceptados en `POST /api/v1/oauth/token`.
- **FR-006**: El sistema DEBE rechazar automáticamente el `secreto_anterior_hash` cuando `gracia_hasta <= NOW()` y DEBE proveer el acto administrativo (`POST /internal/v1/pdp/m2m/credentials/:clientId/expire-grace`) para purgar `secreto_anterior_hash = NULL` y `gracia_hasta = NULL`, restableciendo `estado_credencial = 'ACTIVA'`.
- **FR-007**: El sistema DEBE permitir revocar de emergencia una credencial M2M (`POST /internal/v1/pdp/m2m/credentials/:clientId/revoke`), cambiando su estado a `REVOCADA`, registrando la revocación en caché de segundo nivel y bloqueando de inmediato (`<= 300 s`) tanto la emisión de nuevos tokens como el uso de cualquier `access_token` Bearer previamente emitido para ese `client_id` en `POST /api/v1/access/evaluation`.
- **FR-008**: El sistema DEBE publicar en `GET /api/v1/.well-known/jwks.json` (y `/api/v1/oauth/jwks`) con cabecera `Cache-Control: public, max-age=3600` únicamente las llaves públicas `RS256` (`kty`, `use`, `alg`, `kid`, `n`, `e`) cuyo `servicio_emisor` sea `MOTOR_PDP` y cuyo `estado_llave` sea `ACTIVA_FIRMA` o `GRACIA_VERIFICACION`.
- **FR-009**: El sistema DEBE permitir rotar la llave de firma `RS256` del PDP (`POST /internal/v1/pdp/jwks/rotate`), pasando la llave `ACTIVA_FIRMA` anterior a `GRACIA_VERIFICACION` y activando la nueva llave vinculada a su referencia en el gestor de secretos (`secret_manager_version`) con `expira_rotacion_en <= NOW() + 90 días`.
- **FR-010**: El sistema DEBE soportar tanto el retiro planificado de llaves en `GRACIA_VERIFICACION` hacia `RETIRADA` (`POST /internal/v1/pdp/jwks/:kid/retire`) como la revocación inmediata de emergencia hacia `REVOCADA` (`POST /internal/v1/pdp/jwks/:kid/revoke`), removiendo en ambos casos la llave del JWKS público y del verificador de tokens.
- **FR-011**: Todo evento del ciclo de vida de credenciales M2M y llaves JWKS (`PDP_TOKEN_M2M_EMITIDO`, `PDP_TOKEN_M2M_RECHAZADO`, `PDP_CREDENCIAL_M2M_CREADA`, `PDP_CREDENCIAL_M2M_ROTADA`, `PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA`, `PDP_CREDENCIAL_M2M_REVOCADA`, `PDP_JWKS_ROTADO`, `PDP_JWKS_RETIRADO`, `PDP_JWKS_REVOCADO_EMERGENCIA`) DEBE persistirse transaccionalmente en `auditoria_evento` con eslabonamiento criptográfico `SHA-256`.
- **FR-012**: Ninguna respuesta de los endpoints OAuth 2.0 M2M, JWKS o administración interna DEBE calcular ni exponer campos de duración o latencia por petición.

### Key Entities

- **`credencial_m2m`**: Registro de clientes confidenciales OAuth 2.0 `Client Credentials` (`credencial_id`, `aplicacion_id`, `tipo_cliente` [`APLICACION_PATRON_1` | `PEP_PATRON_2`], `client_id`, `secreto_activo_hash`, `secreto_anterior_hash`, `gracia_hasta`, `expira_rotacion_en`, `scopes_permitidos`, `estado_credencial` [`ACTIVA` | `EN_ROTACION_GRACIA` | `REVOCADA`]).
- **`llave_jwks_rotacion`**: Catálogo de llaves asimétricas `RS256` segregado por `servicio_emisor` (`MOTOR_PDP` | `SSO_OIDC`), con referencia de versión en almacén de secretos (`secret_manager_version`), JWK público (`public_jwk_json`) y ciclo de estados (`ACTIVA_FIRMA` | `GRACIA_VERIFICACION` | `RETIRADA` | `REVOCADA`).
- **`auditoria_evento`**: Registro inmutable (`append-only`) con hash encadenado `SHA-256` de todas las operaciones de emisión/rechazo de tokens M2M y mutaciones del ciclo de vida de credenciales y llaves JWKS.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las solicitudes válidas a `POST /api/v1/oauth/token` emiten un token firmado verificable contra `GET /api/v1/.well-known/jwks.json`, y el 100 % de los intentos de evaluación cruzada entre aplicaciones con un token `APLICACION_PATRON_1` son bloqueados con `403 FORBIDDEN_M2M_SCOPE`.
- **SC-002**: Durante una rotación de secreto M2M (`EN_ROTACION_GRACIA`) o de llave JWKS (`GRACIA_VERIFICACION`), el 100 % de las peticiones que utilizan tanto el secreto/llave anterior vigente como el nuevo secreto/llave activo son procesadas exitosamente (`0 %` de errores `401` inducidos por rotación).
- **SC-003**: Tras revocar una credencial M2M (`REVOCADA`) o una llave JWKS (`REVOCADA`), el 100 % de los tokens previamente emitidos bajo esa credencial o llave son rechazados con `401 Unauthorized` de forma inmediata (`< 5 s` en caché y siempre `<= 300 s`).
- **SC-004**: `0` secretos en texto plano en `credencial_m2m` (100 % hashes `SHA-256` de 64 caracteres) y `0` atributos de llave privada RSA (`d`, `p`, `q`, `dp`, `dq`, `qi`) en `llave_jwks_rotacion.public_jwk_json` y en `GET /api/v1/.well-known/jwks.json`.
- **SC-005**: El 100 % de las operaciones de provisión, rotación, cierre de gracia y revocación de credenciales M2M y llaves JWKS generan su registro en `auditoria_evento` con cadena `SHA-256` verificable.
- **SC-006**: Cobertura de pruebas automatizadas `>= 70 %` en líneas, funciones, ramas y sentencias.

## Assumptions

- La rotación periódica automatizada (`<= 90 días`) es invocada sobre los endpoints internos del servicio (`POST /internal/v1/pdp/jwks/rotate` y `POST /internal/v1/pdp/m2m/credentials/:clientId/rotate`), o bajo demanda desde la consola de administración (`api-pap`, Feature `006`) por un Superadministrador de Seguridad Informática.
- Las llaves privadas `RS256` residen en el almacén institucional de secretos y la base de datos almacena únicamente la referencia de versión (`secret_manager_version`) y el JWK público en `public_jwk_json`.
