# Feature Specification: Motor de Autorización Central (motor-pdp)

**Feature Branch**: `spec/004-motor-pdp-autorizacion`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Motor de Autorización Central (motor-pdp) para evaluación de políticas híbridas RBAC + ABAC vía POST /api/v1/access/evaluation (DA-12), tokens M2M client_credentials vía POST /api/v1/oauth/token, aserción firmada X-Minedec-Assertion, caché L2 Redis <= 300 s, modo sombra (Shadow Mode) y postura fail-close"

## Contexto MINEDEC *(mandatory)*

| Campo | Valor |
|-------|--------|
| **Dominio** | `SSO` |
| **Iniciativa** | `sso-c22` |

### Referencias OKF / knowledge

- Concepto: `knowledge/arquitectura/contrato-autorizacion-pep-pdp.md` — Define el contrato formal unificado de evaluación `POST /api/v1/access/evaluation`, autenticación M2M `POST /api/v1/oauth/token`, catálogo de códigos de decisión, estructura canónica de respuesta, inyección de las 11 cabeceras `X-Minedec-*` y postura fail-close.
- Concepto: `knowledge/arquitectura/infraestructura-permisos-c22.md` — Nomenclatura institucional estandarizada `sso-*` (sin `"conecta"`), identidad operativa `sa-sso-core`, separación del servicio en su repositorio independiente en GitLab (`c2-sso/microservicios/motor-pdp` consumiendo `@minedec/shared`) y operación sobre la Red Compartida (Shared VPC) institucional en los ambientes `des`, `pre` y `pro`.
- Concepto: `knowledge/dominio/modelo-autorizacion-rbac-abac.md` — Especifica el cruce multidimensional entre el eje RBAC (tipoUsuario, subtipoUsuario, cargoFuncion, roles de app) y el eje ABAC (multicartera, gradoCurso -> nivelAcademico, codigoInstitucion AMIE, multisede, codigoDependenciaAdmin, zonaDistritoCircuito y vigencia temporal).
- Concepto: `knowledge/dominio/matriz-atributos-gws-catalogos.md` — Catálogo maestro oficial de los 21 atributos de identidad institucional y reglas de asignación territorial y académica.
- Concepto: `knowledge/arquitectura/componentes-pdp-core.md` — Topología del motor de autorización en alta disponibilidad con caché L2 en memoria y evaluación de baja latencia.
- Decisión de Arquitectura: `docs/decisiones/DA-12-endpoint-evaluacion-autorizacion.md` — Ratifica el nombre oficial del endpoint de autorización como `POST /api/v1/access/evaluation` conforme al estándar OpenID AuthZEN para eliminar ambigüedades con el inicio de sesión.
- Decisión de Arquitectura: `docs/decisiones/DA-11-intermediario-oidc.md` — Establece la segregación estricta entre las credenciales OIDC de sesión de usuario (`sso-oidc`) y las credenciales M2M del motor de autorización (`motor-pdp`).
- Modelo de Datos: `docs/esquemas-bd/etapa-2-autorizacion-pdp-pap-rbac-abac.dbml` y `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml` — Esquema de entidades de autorización en BCNF (`aplicacion`, `ruta_catalogo`, `permiso_atomico`, `rol`, `grupo_logico`, `credencial_m2m`, `llave_jwks_rotacion`).
- Índice leído: `knowledge/index.md`

### Integración SSO (consume-only)

- **Rol**: `Plataforma Central de Autorización (Sistema de Autenticación Centralizado SSO - Subcomponente C2.2, servicio independiente motor-pdp - Policy Decision Point)`
- **Qué se consume**: Raíz civil de persona natural (`persona_identidad`), cuenta institucional y perfil poblacional RBAC/ABAC (`cuenta_institucional`), asignaciones de contexto territorial y multisede (`asignacion_contexto`), anomalías de identidad (`anomalia_identidad`), credenciales M2M registradas en base de datos, y políticas/reglas de catálogo configuradas desde administración (PAP).
- **Qué no se construye**: Formularios locales de usuario/contraseña, servidores de login interactivo duplicados (atendidos exclusivamente por `sso-oidc`), persistencia de secretos en texto plano, ni almacenamiento de claves criptográficas privadas fuera de almacén de secretos seguro.

## Clarifications

### Session 2026-10-23

- Q: ¿Cómo debe resolver el motor PDP los roles y permisos efectivos cuando los atributos de un usuario cumplen simultáneamente las condiciones de dos o más Grupos Lógicos en la misma aplicación? → A: Resolución aditiva/acumulativa (Opción A): el usuario recibe la unión de todos los roles otorgados por los grupos lógicos satisfechos y la consolidación sin duplicados de todos sus permisos atómicos (incluyendo acciones CRUD: puede_crear, puede_leer, puede_editar, puede_eliminar), permitiendo asignar o revocar funciones de forma independiente sin afectar las demás.
- Q: En solicitudes de evaluación enviadas a `POST /api/v1/access/evaluation`, ¿debe permitirse que el campo `email_autenticado` sea nulo u opcional para rutas de acceso público (`PUBLICA`)? → A: Opcional/Nulo permitido (Opción A): si `email_autenticado` no se envía o viene vacío/nulo, el motor evalúa la clasificación de la ruta; si es `PUBLICA`, autoriza con `AUTHZ_PUBLIC_ROUTE`, y si es `AUTENTICADA` o `PROTEGIDA`, deniega con `AUTHZ_DENIED_POLICY`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluación de Autorización en Tiempo Real con Cruce Híbrido RBAC + ABAC y Aserción Criptográfica (Priority: P1)

Como sistema cliente integrado (aplicación nativa bajo Patrón 1 o punto de cumplimiento perimetral PEP bajo Patrón 2), requiero consultar al motor de autorización central mediante una petición segura para determinar si una persona autenticada tiene permiso de ejecutar una acción sobre una ruta específica de mi aplicativo, recibiendo una decisión determinista acompañada de su contexto institucional enriquecido y una aserción criptográfica firmada que garantice la autenticidad e integridad de la respuesta.

**Why this priority**: Es la funcionalidad nuclear de todo el Subcomponente C2.2. Sin el motor de decisión en tiempo real, ninguna aplicación del Ministerio de Educación puede autorizar operaciones ni validar privilegios de forma centralizada.

**Independent Test**: Puede probarse de forma totalmente autónoma configurando una aplicación con catálogo de rutas y grupos lógicos de prueba, enviando solicitudes de evaluación a `POST /api/v1/access/evaluation` con tokens M2M válidos y verificando que responda con la decisión correcta (`autorizado: true/false`), el código de decisión pertinente y un token firmado `X-Minedec-Assertion`.

**Acceptance Scenarios**:

1. **Given** un usuario docente activo con cargo `DOCENTE_AULA` en el plantel AMIE `17H00123` y una ruta protegida `/api/v1/calificaciones/registro` configurada con el permiso `CALIFICACIONES_REGISTRAR`, **When** la aplicación cliente consulta `POST /api/v1/access/evaluation` con la credencial M2M autorizada, **Then** el motor responde con estado HTTP `200 OK`, `autorizado: true`, `codigo_decision: "AUTHZ_PERMITTED"`, su lista de roles y permisos atómicos, el contexto territorial con `amie_titular: "17H00123"`, y un JWT firmado con RS256 en `assertion_jwt`.
2. **Given** un usuario estudiante con nivel académico `EGB_MEDIA`, **When** intenta acceder a un recurso restringido para docentes o estudiantes de bachillerato (`BGU`), **Then** el motor responde con estado HTTP `200 OK`, `autorizado: false`, `codigo_decision: "AUTHZ_DENIED_POLICY"`, lista vacía de permisos para esa ruta y sin permitir el acceso al recurso protegido.
3. **Given** una aplicación cliente que envía `host_solicitado` (Patrón 2) o `uuid_aplicacion` (Patrón 1) coincidente con la identidad autorizada en su Bearer Token M2M, **When** solicita la evaluación, **Then** el motor valida la correlación entre el token M2M y la aplicación solicitada, procesando la decisión exitosamente.

---

### User Story 2 - Autenticación Máquina a Máquina (M2M) con Rotación Dual y Mínimo Privilegio (Priority: P1)

Como servicio cliente o punto de control perimetral (PEP), requiero autenticarme ante el motor de autorización mediante credenciales de máquina seguras para obtener un token de acceso de corta duración que me permita invocar la API de evaluación sin depender de sesiones interactivas ni exponer identidades humanas.

**Why this priority**: Garantiza el principio de defensa en profundidad y cero confianza (Zero Trust): ninguna entidad de red puede invocar el motor de autorización de forma anónima ni asumir la identidad de otra aplicación.

**Independent Test**: Puede verificarse enviando una solicitud a `POST /api/v1/oauth/token` con `grant_type=client_credentials`, `client_id` y `client_secret` válidos, comprobando la recepción de un Bearer Token JWT firmado con vigencia de 3600 segundos, y verificando el rechazo inmediato ante credenciales erróneas o revocadas.

**Acceptance Scenarios**:

1. **Given** una aplicación cliente registrada con credencial M2M activa, **When** invoca `POST /api/v1/oauth/token` con sus credenciales correctas, **Then** recibe un token JWT con tiempo de expiración de 3600 segundos y los identificadores de aplicación autorizados en sus declaraciones.
2. **Given** una credencial M2M en periodo de rotación dual (`EN_ROTACION_GRACIA`) donde conviven el secreto activo y el secreto anterior, **When** el cliente solicita autenticación usando el secreto anterior antes de que expire la ventana de gracia, **Then** el motor autentica la solicitud con éxito emitiendo el token de acceso.
3. **Given** una credencial M2M revocada o una solicitud con secreto incorrecto, **When** se solicita autenticación en el endpoint de tokens, **Then** el motor rechaza la solicitud con código HTTP `401 Unauthorized` protegiéndose contra ataques de fuerza bruta mediante validación de hash en tiempo constante.

---

### User Story 3 - Normalización Perimetral de Rutas y Postura Estricta Fail-Close (Priority: P1)

Como oficial de seguridad y custodio de la plataforma, requiero que el motor de autorización aplique una normalización determinista sobre las rutas solicitadas y opere bajo una postura estricta *Fail-Close* ante anomalías o fallas de infraestructura, para evitar eludir controles mediante técnicas de evasión de rutas (*path traversal*) o accesos indebidos durante contingencias.

**Why this priority**: Es un requisito no negociable de ciberseguridad. Cualquier ambigüedad en la interpretación de una ruta o cualquier apertura permisiva por falla técnica comprometería la confidencialidad de todo el ecosistema educativo.

**Independent Test**: Probar enviando rutas con caracteres especiales codificados (`%2F`, `%00`), rutas relativas (`..`) o simulando la indisponibilidad total de las fuentes de datos, validando que el motor responda con `400 Bad Request` en rutas maliciosas y con denegación estricta (`503 Service Unavailable` / denegación) ante indisponibilidad, sin conceder jamás acceso por omisión.

**Acceptance Scenarios**:

1. **Given** una solicitud de evaluación que contiene secuencias de evasión como `/api/v1/..%2Fadmin` o bytes nulos `%00`, **When** ingresa al motor PDP, **Then** el motor detecta la anomalía en la fase de normalización y rechaza la petición con estado HTTP `400 Bad Request` registrando un evento de seguridad.
2. **Given** una ruta registrada en el catálogo con nivel `PUBLICA` (por ejemplo `/assets/logo.png`), **When** se solicita su evaluación, **Then** el motor responde inmediatamente con `autorizado: true` y `codigo_decision: "AUTHZ_PUBLIC_ROUTE"` sin requerir roles ni permisos restrictivos.
3. **Given** una situación de indisponibilidad catastrófica simultánea de los almacenes de políticas y caché, **When** se recibe una solicitud sobre una ruta protegida, **Then** el sistema aplica la política *Fail-Close*, respondiendo con `HTTP 503 Service Unavailable` y bloqueando por completo la operación sin abrir brechas por error.

---

### User Story 4 - Validación y Despliegue Seguro en Modo Sombra (Shadow Mode) (Priority: P2)

Como administrador de aplicativo o analista de seguridad, requiero configurar una aplicación o un conjunto de políticas en "Modo Sombra" (*Shadow Mode*) durante la fase de puesta en marcha o reestructuración de reglas, para observar y auditar las decisiones que tomaría el motor sin bloquear las operaciones productivas de los usuarios reales.

**Why this priority**: Permite transicionar sistemas legados y desplegar nuevas reglas complejas de autorización con riesgo cero de interrupción operativa, verificando la precisión de las reglas antes de activarlas de manera vinculante.

**Independent Test**: Configurar una aplicación o política con bandera de modo sombra activa, enviar peticiones de usuarios que no cumplan las nuevas reglas y comprobar que la auditoría registre la denegación proyectada, pero la respuesta de evaluación devuelva autorización permisiva indicando en sus metadatos que la decisión opera en modo sombra.

**Acceptance Scenarios**:

1. **Given** una aplicación configurada con `modo_sombra = true` y una política que denegaría el acceso a un usuario por falta de un nuevo atributo, **When** se evalúa la petición en `POST /api/v1/access/evaluation`, **Then** el motor emite una respuesta con `autorizado: true` para no interrumpir el flujo productivo, pero marca el código y los metadatos registrando en auditoría que en modo vinculante la decisión habría sido `AUTHZ_DENIED_POLICY`.
2. **Given** que el administrador verifica la concordancia de las reglas observadas y desactiva el modo sombra, **When** ingresa una nueva solicitud sin los privilegios requeridos, **Then** el motor deniega formalmente el acceso con `autorizado: false` de forma vinculante.

---

### User Story 5 - Publicación y Rotación de Llaves Públicas JWKS Exclusivas del PDP (Priority: P2)

Como servicio consumidor que recibe la cabecera `X-Minedec-Assertion` o un token M2M, requiero consultar un conjunto de claves públicas JWKS expuesto por el motor de autorización para verificar la firma digital de las aserciones de forma local y autónoma, asegurando la interoperabilidad y el soporte de rotación periódica de llaves sin afectación de servicio.

**Why this priority**: Permite a los backends de las aplicaciones y al paquete SP/RP verificar criptográficamente que las cabeceras y aserciones provienen efectivamente del motor de autorización oficial sin tener que invocar la red en cada verificación.

**Independent Test**: Consultar el endpoint `GET /api/v1/.well-known/jwks.json`, verificar que retorne únicamente las claves públicas RSA activas correspondientes al emisor del PDP (con identificadores `kid` válidos y en estado activo o gracia), y utilizar dicha clave pública para validar la firma de un token emitido.

**Acceptance Scenarios**:

1. **Given** el motor de autorización operando normalmente, **When** un cliente realiza una consulta HTTP a `GET /api/v1/.well-known/jwks.json`, **Then** el motor devuelve un documento JSON con las claves públicas RSA activas, conteniendo su respectivo `kid`, algoritmo `RS256` y uso previsto para firma.
2. **Given** un proceso de rotación donde se activa una nueva clave de firma y la anterior pasa a estado de gracia de verificación, **When** se consulta el endpoint de claves públicas, **Then** el documento JWKS expone ambas claves para permitir verificar tokens emitidos antes y después de la rotación sin rechazos espurios.
3. **Given** que existen llaves criptográficas pertenecientes a otros servicios (como el intermediario `sso-oidc`), **When** se publica el JWKS del PDP, **Then** el endpoint expone de forma estricta y exclusiva las llaves correspondientes a `MOTOR_PDP`, garantizando aislamiento de emisor criptográfico.

---

### Edge Cases

- ¿Qué ocurre si la solicitud de evaluación omite tanto `uuid_aplicacion` como `host_solicitado`? El motor rechaza la solicitud con código `HTTP 400 Bad Request` indicando la falta del identificador de la aplicación destino.
- ¿Qué ocurre si el Bearer Token M2M pertenece a la Aplicación A pero en el cuerpo se solicita acceso para la Aplicación B? El motor deniega la evaluación con código `HTTP 403 Forbidden` y registra una alerta de seguridad por intento de suplantación inter-aplicación.
- ¿Qué ocurre si un usuario tiene cuenta en estado suspendido o desvinculado? El motor devuelve `autorizado: false` con el código de decisión `AUTHZ_USER_SUSPENDED`, denegando cualquier operación independientemente de los roles asignados.
- ¿Qué ocurre si la fecha actual está fuera del rango de vigencia de un contrato o asignación temporal? El motor retorna `autorizado: false` con código `AUTHZ_OUTSIDE_VALIDITY_WINDOW`.
- ¿Qué ocurre si la aplicación destino no existe, está en borrador o se encuentra suspendida en el catálogo? El motor retorna `HTTP 404 Not Found` (o `403 Forbidden` según la política de divulgación) y bloquea el acceso.
- ¿Qué ocurre si un usuario cumple simultáneamente las condiciones de dos o más grupos lógicos en una aplicación? El motor PDP agrega de forma aditiva los roles y calcula la unión consolidada de los permisos atómicos (creación, lectura, edición, eliminación), de modo que si un grupo o función es retirado, los permisos concedidos por los grupos restantes se preservan de manera determinista e independiente.
- ¿Qué ocurre si se recibe una solicitud de evaluación con `email_autenticado` nulo o vacío? El motor clasifica primero la ruta normalizada: si coincide con una regla `PUBLICA`, responde HTTP `200 OK` con `autorizado: true` y `codigo_decision: "AUTHZ_PUBLIC_ROUTE"`; si la ruta es `AUTENTICADA` o `PROTEGIDA`, responde HTTP `200 OK` con `autorizado: false` y `codigo_decision: "AUTHZ_DENIED_POLICY"`.
- ¿Qué ocurre si una ruta coincide con múltiples patrones configurados? El motor resuelve la colisión mediante precedencia estricta y determinista: coincidencia Exacta tiene mayor prioridad que Prefijo más largo, y este mayor que Extensión, aplicando finalmente la política por defecto en caso de no coincidir con ninguna regla específica.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer el endpoint oficial `POST /api/v1/access/evaluation` como único punto de decisión de autorización en tiempo real, conforme a la decisión de arquitectura DA-12.
- **FR-002**: El endpoint de evaluación DEBE aceptar solicitudes con compatibilidad dual, permitiendo identificar la aplicación destino mediante `uuid_aplicacion`, `host_solicitado`, o ambos de manera simultánea.
- **FR-003**: El sistema DEBE validar de forma obligatoria que la identidad de la aplicación solicitada en la evaluación coincida exactamente con la aplicación autorizada en las declaraciones del token Bearer M2M presentado cuando el cliente sea de tipo `APLICACION_PATRON_1`, o que la aplicación destino opere bajo `PATRON_2_PEP_PERIMETRAL` cuando el token pertenezca a una credencial de plataforma `PEP_PATRON_2`.
- **FR-004**: El sistema DEBE ejecutar un cruce multidimensional estricto entre el eje RBAC (tipo de usuario, subtipo/régimen contractual, cargo o función y roles/perfiles específicos del aplicativo) y el eje ABAC (multicartera/viceministerio, nivel académico curricular, código de plantel AMIE titular y multisede, dependencia administrativa, alcance territorial por zona/distrito/circuito y ventana de vigencia temporal). Los grupos lógicos y las asignaciones directas nominales (`usuario_rol_aplicacion`) pueden otorgar tanto **roles individuales** (`grupo_logico_rol` / `rol_id`) como **perfiles agrupadores de roles** (`grupo_logico_perfil` / `perfil_id`, `RF-AUZ-04`), los cuales se expanden recursivamente mediante `perfil_rol` hacia sus roles activos. Cuando un usuario satisfaga simultáneamente dos o más grupos lógicos o asignaciones nominales, el sistema DEBE resolver la asignación de forma aditiva acumulando los roles y consolidando la unión sin duplicados de todos sus permisos atómicos (incluyendo acciones de creación, lectura, edición y eliminación), asegurando la independencia al revocar o asignar funciones individuales.
- **FR-005**: El sistema DEBE emitir una respuesta estructurada bajo código HTTP `200 OK` tanto en casos de acceso permitido como de acceso denegado por política de negocio, informando el estado booleano `autorizado` y el código de decisión formal (`AUTHZ_PERMITTED`, `AUTHZ_PUBLIC_ROUTE`, `AUTHZ_AUTHENTICATED_ROUTE`, `AUTHZ_DENIED_POLICY`, `AUTHZ_USER_SUSPENDED`, `AUTHZ_OUTSIDE_VALIDITY_WINDOW`).
- **FR-006**: En cada evaluación exitosa o denegada sobre rutas protegidas, el sistema DEBE generar y adjuntar en la respuesta una aserción criptográfica firmada en formato JWT (`assertion_jwt`) con algoritmo asimétrico `RS256`, con tiempo de vida máximo de 60 segundos y con la audiencia (`aud`) restringida exclusivamente a la aplicación evaluada.
- **FR-007**: El sistema DEBE exponer el endpoint de autenticación máquina a máquina `POST /api/v1/oauth/token` bajo el estándar OAuth 2.0 Client Credentials Grant, emitiendo tokens de acceso Bearer con vigencia de 3600 segundos.
- **FR-008**: El sistema DEBE soportar el ciclo de vida y rotación dual de secretos M2M con periodicidad máxima de 90 días, validando credenciales contra hashes criptográficos seguros en tiempo constante y admitiendo la convivencia del secreto activo y el secreto previo durante el periodo de gracia.
- **FR-009**: El sistema DEBE aplicar una fase de normalización estricta sobre la ruta solicitada antes de la evaluación, rechazando con código HTTP `400 Bad Request` cualquier ruta con secuencias de escape no permitidas, bytes nulos, doble codificación o secuencias relativas de navegación de directorios (*path traversal*).
- **FR-010**: El sistema DEBE clasificar las rutas según un orden determinista de especificidad: primero coincidencias exactas, segundo prefijos de mayor longitud, tercero coincidencias por extensión y finalmente la regla por defecto del aplicativo (`PUBLICA`, `AUTENTICADA` o `PROTEGIDA`). Cuando una ruta `PROTEGIDA` exija múltiples permisos en `ruta_permiso_requerido`, el motor DEBE evaluar si basta con poseer al menos uno (`modo_evaluacion_permisos = 'ANY'`, valor por defecto) o todos (`modo_evaluacion_permisos = 'ALL'`), verificando además la capacidad CRUD requerida (`accion_crud_requerida`). Asimismo, DEBE admitir que el campo `email_autenticado` sea opcional o nulo en la solicitud: si la ruta clasificada resulta `PUBLICA`, concederá acceso inmediato con `AUTHZ_PUBLIC_ROUTE` aun sin identidad de usuario; si resulta `AUTENTICADA` o `PROTEGIDA` y carece de `email_autenticado` válido, denegará con `AUTHZ_DENIED_POLICY`.
- **FR-011**: El sistema DEBE implementar una política estricta de *Fail-Close*, respondiendo con `HTTP 503 Service Unavailable` y denegando cualquier acceso ante fallos de conectividad, caídas de componentes internos o indisponibilidad de datos.
- **FR-012**: El sistema DEBE permitir habilitar el modo sombra (*Shadow Mode*) a nivel de aplicación (`aplicacion.modo_sombra`) o por regla de ruta individual (`ruta_catalogo.modo_sombra`), permitiendo registrar la decisión proyectada en auditoría sin bloquear la navegación del usuario en solicitudes denegadas mientras el modo sombra permanezca activo (`AUTHZ_PERMITTED_SHADOW_MODE`).
- **FR-013**: El sistema DEBE publicar el catálogo de llaves públicas en `GET /api/v1/.well-known/jwks.json`, exponiendo exclusivamente las claves públicas RSA activas y en periodo de gracia correspondientes al servicio emisor `MOTOR_PDP`.
- **FR-014**: El sistema DEBE mantener en memoria intermedia (caché L2 en Redis) las decisiones frecuentes (`minedec:pdp:decision:{aplicacion_codigo}:{id_interno}:{cuenta_id}:{version_catalogo}`) y los paquetes compilados de políticas (`minedec:pdp:bundle:{aplicacion_codigo}`) con un tiempo de vida (TTL) no superior a 300 segundos, admitiendo invalidación inmediata ante eventos de desvinculación o cambios de privilegios.
- **FR-015**: El sistema DEBE implementar auditoría inmutable de 3 capas sin cuello de botella de bloqueos en el camino crítico (respuesta ágil conforme a `RNF-REN-01..06` y `D-06`, sin umbrales fijos en milisegundos): las decisiones de evaluación de alta frecuencia (`POST /api/v1/access/evaluation`: `PDP_EVALUACION_PERMIT`, `PDP_EVALUACION_DENY`, `PDP_EVALUACION_SHADOW_PERMIT`) se emiten de forma asíncrona no bloqueante mediante registros estructurados hacia el repositorio analítico de solo adición y el archivo forense inmutable de retención bloqueada, mientras que los eventos de control, seguridad perimetral (`PDP_RECHAZO_SEGURIDAD_RUTA`), autenticación M2M (`POST /api/v1/oauth/token`), invalidaciones de caché y rotaciones JWKS se persisten transaccionalmente en la bitácora relacional (`auditoria_evento`) con encadenamiento criptográfico `SHA-256`.
- **FR-016**: El sistema NO DEBE exponer métricas de duración por petición ni campos de latencia en milisegundos en las respuestas HTTP dirigidas a los consumidores, delegando la observabilidad a la infraestructura de la plataforma.

### Key Entities

- **Aplicacion**: Representa el activo tecnológico protegido por la plataforma, con sus atributos de identificación, nombre institucional, viceministerio propietario, host público, política de acceso por defecto, bandera de modo sombra (`modo_sombra`) y estado en el ciclo de vida.
- **CredencialM2M**: Credencial de máquina a máquina asociada a una aplicación o componente perimetral, almacenada mediante hash unidireccional con fechas de vigencia, soporte de secreto anterior en rotación y alcance de permisos autorizado (`pdp:evaluate`).
- **RutaCatalogo**: Registro declarativo normalizado que define una ruta o recurso del aplicativo, su método HTTP asociado, su tipo de coincidencia (exacta, prefijo, extensión), su nivel de acceso requerido (`PUBLICA`, `AUTENTICADA`, `PROTEGIDA`), su modo de evaluación de múltiples permisos (`ANY` / `ALL`) y su bandera opcional de modo sombra.
- **PermisoAtomico**: Unidad granular mínima de autorización dentro de una aplicación (por ejemplo, `CALIFICACIONES_REGISTRAR`), vinculable a rutas protegidas y a roles con capacidades CRUD.
- **Rol**: Agrupador de permisos atómicos dentro del ámbito de una aplicación específica, asignable de manera nominal a usuarios, agrupable en perfiles o inferido a través de reglas de negocio.
- **Perfil**: Agrupador funcional de múltiples roles dentro de una misma aplicación (`RF-AUZ-04`, por ejemplo `PERFIL_EQUIPO_DIRECTIVO_PLANTEL`), asignable dinámicamente vía grupos lógicos (`grupo_logico_perfil`) o nominalmente a usuarios (`usuario_rol_aplicacion.perfil_id`).
- **GrupoLogico**: Regla declarativa de negocio que evalúa la concordancia entre los atributos de identidad institucional (cargo, régimen, cartera, nivel escolar) y asigna automáticamente roles (`grupo_logico_rol`) y perfiles (`grupo_logico_perfil`) efectivos dentro de la aplicación.
- **EvaluacionDecision**: Resultado canónico emitido por el motor de decisión que compila el estado de autorización, código explicativo, permisos y roles efectivos, contexto territorial/educativo y la aserción criptográfica firmada.
- **LlaveCriptograficaPdp**: Metadatos de la clave asimétrica RSA utilizada para firmar tokens y aserciones del motor PDP, con identificador único (`kid`), estado de ciclo de vida (activa, gracia, retirada) y fecha límite de rotación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El motor de autorización resuelve las solicitudes de evaluación `POST /api/v1/access/evaluation` de manera consistente bajo alta concurrencia de peticiones simultáneas sin pérdida de paquetes ni fallos atribuibles a saturación interna.
- **SC-002**: El 100 % de las solicitudes con rutas maliciosas, intentos de navegación relativa (`..`), bytes nulos o credenciales M2M inválidas son bloqueadas de forma inmediata en el perímetro con los códigos HTTP correspondientes (`400`, `401` o `403`).
- **SC-003**: Toda revocación o desvinculación de un usuario se propaga de manera que ninguna sesión o caché previa permita accesos posteriores una vez transcurrido el tiempo límite de revalidación de 300 segundos.
- **SC-004**: El 100 % de las aserciones criptográficas `X-Minedec-Assertion` emitidas son verificables de forma autónoma por los servicios consumidores mediante el catálogo de claves públicas JWKS del PDP sin requerir claves de otros servicios ni emitir falsos positivos de integridad.
- **SC-005**: Ante una contingencia de desconexión o falla interna simulada de los almacenes de datos, el 100 % de las peticiones a rutas protegidas son denegadas de acuerdo a la postura estricta *Fail-Close*, sin producirse ninguna concesión de acceso indebida por estado de error.

## Assumptions

- Las identidades de los usuarios evaluados provienen de cuentas institucionales consolidadas previamente en el repositorio unificado de identidades naturales.
- Las aplicaciones consumidoras que operan bajo el Patrón 1 gestionan de forma segura su credencial M2M y la almacenan en un entorno protegido fuera del alcance del navegador del usuario.
- Los puntos de control perimetral (PEP) bajo el Patrón 2 eliminan de manera obligatoria cualquier cabecera entrante con prefijo `X-Minedec-*` proveniente de redes públicas antes de inyectar las cabeceras autenticadas generadas a partir de la aserción del PDP.
- La rotación periódica de credenciales y claves criptográficas se coordina respetando las ventanas de gracia duales para asegurar cero tiempo de inactividad durante la renovación de llaves.
- El motor de autorización central (`motor-pdp`) sigue la nomenclatura estandarizada `sso-*` (sin `"conecta"`, operando bajo la identidad de servicio `sa-sso-core`), se gestiona como un repositorio independiente en GitLab (`c2-sso/microservicios/motor-pdp` consumiendo el paquete transversal `@minedec/shared`) y opera sobre la Red Compartida (Shared VPC) institucional en los ambientes `des`, `pre` y `pro`.
- Las referencias conceptuales y decisiones de arquitectura citadas (`DA-11`, `DA-12`, modelo de autorización híbrido y contratos PEP-PDP) se consideran vigentes y ratificadas para el desarrollo del Subcomponente C2.2.
