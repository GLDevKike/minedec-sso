# Guía de Integración al SSO — Cómo se Integra una Aplicación con el Intermediario OIDC

Esta guía es para los equipos que van a conectar una aplicación del Ministerio al **Single Sign-On (SSO) y Plataforma Central de Autenticación y Autorización**. Explica qué opciones de integración existen y qué debe hacer la aplicación, paso a paso.

---

## Parte 1: Explicación

### 1.1 La aplicación legada no habla con Google

el SSO actúa como **intermediario de identidad** (*identity broker*) entre las aplicaciones y Google Cloud Identity:

- **Tu aplicación solo habla con el SSO.** Nunca redirige a Google ni necesita un cliente OAuth en Google Cloud.
- **El SSO es el único que habla con Google**, con un único cliente OAuth institucional para todo el ecosistema.
- **El usuario sigue viendo la pantalla de Google** (correo, contraseña y verificación en dos pasos), porque el SSO lo lleva allí. Por eso el botón de tu aplicación dice **«Ingresar con Google»**, aunque técnicamente apunte al SSO.

```
Antes (descartado):  Aplicación ──────────────────────────────→ Google (un cliente OAuth por aplicación)
Ahora :       Aplicación ──→ SSO (intermediario OIDC) ──→ Google (un único cliente OAuth)
```

### 1.2 Las dos preguntas que tu aplicación le hace al SSO

| Pregunta | ¿Cuándo? | ¿A quién? | ¿Qué recibe tu aplicación? |
| :--- | :--- | :--- | :--- |
| **1. Autenticación: ¿quién es esta persona?** | Una vez por sesión | Intermediario OIDC del SSO (`https://login.sso.<dominio>`) | Un `id_token` firmado, exclusivo para tu aplicación, con el correo verificado y el número de identificación (`numero_identificacion`). **Sin roles.** |
| **2. Autorización: ¿qué puede hacer?** | En cada acción o ruta protegida (con caché de hasta 5 minutos) | API de autorización del SSO (`POST /api/v1/access/evaluation`) | Si está autorizado, sus roles, permisos y contexto territorial (`AMIE`, distrito, zona). |

```
Usuario ──► Tu aplicación ──(1) autenticación──► SSO · intermediario OIDC ──► Google
                         └──(2) autorización───► SSO · motor de autorización
```

> [!NOTE]
> No confundas los dos endpoints: `/authorize` es del intermediario OIDC (nombre fijado por el estándar OpenID Connect) e **inicia el inicio de sesión**; `/api/v1/access/evaluation` es del motor de autorización (nombre alineado con la *Authorization API 1.0* de OpenID AuthZEN) y **decide permisos** (`DA-12`).

### 1.3 ¿Cómo puedo integrar mi aplicación? Tres opciones

| Opción | ¿Qué hace tu aplicación? | ¿Cuándo conviene? |
| :--- | :--- | :--- |
| **A. Librería OIDC estándar** (`PATRON_1_NATIVO`) | Usa la librería OIDC habitual de su lenguaje y configura cuatro valores. Programa la consulta de autorización (un `POST`). | Aplicaciones con equipo de desarrollo, en cualquier lenguaje. |
| **B. Módulo de integración de referencia** (`PATRON_1_NATIVO`) | Agrega el *starter* de Spring Boot o la librería de Angular del SSO, que ya resuelven inicio de sesión, autorización con caché y *fail-close*, vinculación del usuario y cierre de sesión. | Aplicaciones Java/Spring Boot y Angular (por ejemplo, SIEE y SGA). |
| **C. Proxy perimetral** (`PATRON_2_PEP_PERIMETRAL`) | **No cambia su código.** Un proxy (PEP) delante de la aplicación inicia sesión y consulta los permisos por ella, y le pasa la identidad ya validada. | Aplicaciones legadas que no se pueden o no conviene modificar. |

**No es obligatorio un SDK propio.** OIDC es un estándar: cualquier librería certificada sirve. El módulo de referencia (opción B) es una comodidad.

### 1.4 ¿Qué datos te entrega el equipo del SSO para empezar?

Cuando el Superadministrador registra tu aplicación en la Consola Web del SSO, te entrega estos **valores de configuración** (variables de entorno). Todos se generan en el propio SSO, sin trámites ni límites en Google Cloud (`DA-11`):

| Variable | ¿Para qué la usa tu aplicación? | ¿Es única por App o compartida? |
| :--- | :--- | :--- |
| **`SSO_OIDC_ISSUER_URL`** | URL base del intermediario OIDC del SSO (`https://login.sso.<dominio>`), desde donde tu librería OIDC descubre automáticamente `/.well-known/openid-configuration`. | **URL institucional del SSO** (compartida por todas las aplicaciones). |
| **`SSO_OIDC_CLIENT_ID`** | Identificador OIDC de tu aplicación para iniciar sesión (`/authorize` y `/token` del intermediario). Es también la audiencia (`aud`) de los `id_token` que recibirás. | **Única por aplicación**, con sus propias URL de retorno. |
| **`SSO_OIDC_CLIENT_SECRET`** | Secreto OIDC de tu aplicación, con el que tu backend canjea el código en `/token`. | **Única por aplicación** (el SSO solo guarda su hash `SHA-256`). |
| **`SSO_APP_UUID`** | Identificador único (`UUID v4`) de tu aplicación en el catálogo del SSO. Se envía en cada consulta de autorización. | **Única por aplicación**. |
| **`SSO_CLIENT_ID`** | Usuario técnico (M2M) de tu backend para autenticarse ante el API de autorización (`/api/v1/oauth/token`). | **Única por aplicación**. |
| **`SSO_CLIENT_SECRET`** | Secreto M2M de tu backend para `/api/v1/oauth/token`. | **Única por aplicación** (el SSO solo guarda su hash `SHA-256`). |

Además debes entregarle al SSO las **URL exactas** de tu aplicación:

| Tipo | Ejemplo | Obligatoria |
| :--- | :--- | :--- |
| Retorno de inicio de sesión (`LOGIN_CALLBACK`) | `https://siee.educacion.gob.ec/login/callback` | Sí |
| Retorno después de cerrar sesión (`POST_LOGOUT`) | `https://siee.educacion.gob.ec/` | Sí |
| Aviso de cierre de sesión central (`BACKCHANNEL_LOGOUT`) | `https://siee.educacion.gob.ec/sso/backchannel-logout` | Recomendada |

Los secretos se entregan y se leen desde **Secret Manager**, nunca en el código ni en el repositorio.

### 1.5 ¿Qué ocurre en el SSO cuando el Superadmin registra y publica tu aplicación?

| Elemento | Patrón 1 (opciones A y B) | Patrón 2 (opción C) |
| :--- | :--- | :--- |
| Cliente OIDC propio (`client_id`, secreto, URL de retorno) | Sí, desde la consola | No (el PEP es un único cliente de plataforma) |
| Credencial M2M para `/api/v1/oauth/token` | Sí, desde la consola | No (credencial de plataforma del PEP) |
| Ficha, rutas, roles y permisos | Sí, desde la consola | Sí, desde la consola |
| Infraestructura perimetral (ruta, certificado, NEG) | No | Sí, con Terraform (publicador) |
| Cliente OAuth en Google Cloud | **No** | **No** |

En el patrón 1, al pulsar **«Publicar»** tu aplicación queda activa **de inmediato** en la base de datos (AlloyDB) y en la caché (Redis) del SSO. Solo las aplicaciones en estado `PUBLICADO` pueden iniciar sesión; si se suspenden o despublican, el SSO bloquea de inmediato nuevos inicios de sesión.

---

## Parte 2: Detalles Técnicos para el Equipo de Desarrollo

### 2.1 El inicio de sesión, petición por petición

El inicio de sesión **no es una sola petición**: es una secuencia de redirecciones del navegador más **una** petición directa de tu servidor al SSO. Tu librería OIDC arma y valida todo; esto es lo que ocurre por debajo.

**① El usuario pulsa «Ingresar con Google».** Tu servidor genera `state`, `nonce` y el par PKCE (`code_verifier` / `code_challenge`) y redirige el navegador al SSO:

```
HTTP 302  Location: https://login.sso.<dominio>/authorize
  ?client_id=siee
  &redirect_uri=https://siee.educacion.gob.ec/login/callback
  &response_type=code
  &scope=openid%20email%20profile
  &state=xyz&nonce=abc
  &code_challenge=E9Mel...&code_challenge_method=S256
```

**② El SSO recibe la solicitud** (`GET /authorize`, con los parámetros en la URL). Verifica que `client_id` exista y su aplicación esté `PUBLICADO`, que `redirect_uri` coincida **carácter por carácter** con una registrada y que venga el desafío PKCE `S256`. Si algo falla, detiene el flujo y nunca redirige a una URL no registrada.

**③ El SSO lleva al usuario a Google** con su cliente único. El usuario ingresa sus credenciales en la pantalla de Google. Google no conoce tu aplicación.

**④ Google devuelve al usuario al SSO** (`GET /callback`). El SSO valida el token de Google, verifica que el correo pertenezca a un dominio institucional activo, busca la identidad en el repositorio central (cédula, pasaporte o código MINEDEC), crea la **sesión central** y genera **su propio** código de un solo uso (vigencia `<= 60 s`).

**⑤ El SSO devuelve al usuario a tu aplicación:**

```
HTTP 302  Location: https://siee.educacion.gob.ec/login/callback?code=<código-del-SSO>&state=xyz
```

**⑥ Tu servidor canjea el código** (la única petición directa al intermediario, de servidor a servidor):

```
POST https://login.sso.<dominio>/token
Authorization: Basic base64(<SSO_OIDC_CLIENT_ID>:<SSO_OIDC_CLIENT_SECRET>)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<código-del-SSO>
&redirect_uri=https://siee.educacion.gob.ec/login/callback&code_verifier=<code_verifier>
```

El SSO comprueba el secreto, que el código no esté usado ni vencido, que `SHA256(code_verifier)` coincida con el `code_challenge` del paso ① y que `redirect_uri` sea la misma. Responde con el `id_token`.

**⑦ Tu servidor valida el `id_token`** con las llaves públicas del SSO (`GET /jwks`, en caché) y crea su sesión local.

| Paso | De → a | Canal |
| :--- | :--- | :--- |
| ① ② ⑤ | Tu aplicación ↔ SSO | Navegador (redirecciones) |
| ③ ④ | SSO ↔ Google | Navegador, más un canje del SSO con Google de servidor a servidor |
| ⑥ | Tu servidor → SSO `/token` | Servidor a servidor (`POST`) |
| ⑦ | Tu servidor → SSO `/jwks` | Servidor a servidor (`GET`, con caché) |

**Segunda aplicación sin volver a ingresar credenciales:** si el usuario ya tiene sesión central y abre otra aplicación, en el paso ② el SSO reconoce su sesión, se salta ③ y ④ y emite un código nuevo para esa aplicación, con su propia audiencia (`aud`).

Ejemplo de `id_token` (contenido decodificado):

```json
{
  "iss": "https://login.sso.educacion.gob.ec",
  "aud": "siee",
  "sub": "b3f1c0e2-7d4a-4c1e-9f2a-5e8d6c4b2a10",
  "email": "juan.perez@educacion.gob.ec",
  "email_verified": true,
  "tipo_identificacion": "CEDULA",
  "numero_identificacion": "0912345675",
  "nonce": "abc",
  "iat": 1792679000,
  "exp": 1792679300
}
```

---

### 2.2 Requisitos del inicio de sesión OIDC

1. **Estándar obligatorio**: `OpenID Connect 1.0 Authorization Code Flow + PKCE` con método `S256`, con `state` y `nonce`.
2. **Endpoints del intermediario** (los descubre tu librería desde `SSO_OIDC_ISSUER_URL`):
   - Descubrimiento: `GET /.well-known/openid-configuration`
   - Inicio de sesión: `GET /authorize`
   - Canje de código: `POST /token`
   - Llaves públicas: `GET /jwks`
   - Cierre de sesión centralizado (SLO): `GET/POST /logout`
3. **Scopes mínimos**: `openid email profile`.
4. **Validaciones obligatorias del `id_token` en tu backend**:
   - Firma `RS256` contra `https://login.sso.<dominio>/jwks`. Las llaves rotan cada `<= 90 días` con un periodo en el que conviven la llave nueva y la anterior: selecciona la llave por `kid` y refresca el JWKS si aparece un `kid` desconocido.
   - `iss` igual a `SSO_OIDC_ISSUER_URL`; **`aud` igual a tu `SSO_OIDC_CLIENT_ID`** (rechaza tokens emitidos para otra aplicación); `exp` vigente; `nonce` igual al que enviaste.
   - Claims que entrega el SSO: `sub`, `email` (`email_verified: true`), `tipo_identificacion` y `numero_identificacion`. **El `id_token` no trae roles ni permisos**: esos se consultan en la sección 2.6.
   - Si tu aplicación valida el dominio del correo, lee la lista de dominios autorizados de la **configuración** (`D-21`); nunca la escribas fija en el código.
5. **Reglas de seguridad en el navegador**:
   - **Prohibido usar `localStorage`** para tokens, sesiones o roles.
   - En `sessionStorage` solo se permiten, de forma temporal, los parámetros del flujo (`state`, `nonce` y `code_verifier`) mientras dura la redirección.
   - El canje del código (paso ⑥) se hace en el **backend**; el secreto nunca llega al navegador.
6. **Botón de ingreso**: «Ingresar con Google». Quita el formulario de usuario y contraseña propio de tu aplicación.

Ejemplo de configuración en **Spring Boot**:

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          sso:
            client-id: ${SSO_OIDC_CLIENT_ID}
            client-secret: ${SSO_OIDC_CLIENT_SECRET}
            authorization-grant-type: authorization_code
            redirect-uri: https://siee.educacion.gob.ec/login/callback
            scope: openid, email, profile
        provider:
          sso:
            issuer-uri: ${SSO_OIDC_ISSUER_URL}   # descubre /authorize, /token y /jwks
```

> [!IMPORTANT]
> En Spring Security anterior a 5.7 (por ejemplo, Spring Boot 2.4), PKCE no se activa por defecto en clientes confidenciales: hay que registrar un `OAuth2AuthorizationRequestResolver` que agregue `code_challenge` y `code_challenge_method=S256`. El módulo de integración de referencia ya lo incluye.

---

### 2.3 Librerías recomendadas

| Lenguaje / framework | Inicio de sesión OIDC | Validación JWT / JWKS | Cliente HTTP (autorización) |
| :--- | :--- | :--- | :--- |
| **Java / Spring Boot** | `spring-boot-starter-oauth2-client` *(o el starter del SSO)* | Incluida (Nimbus JOSE) | `RestTemplate` / `WebClient` |
| **Angular** (frontend con backend propio) | `angular-oauth2-oidc` *(o la librería Angular del SSO)* | En el backend | — |
| **TypeScript / Node.js** | `openid-client` *(o `@minedec/sp-rp-sdk`)* | `jose` | `axios` o `fetch` nativo (Node 22+) |
| **Python** (FastAPI, Django o Flask) | `Authlib` | `PyJWT` (`pip install pyjwt[crypto]`) | `httpx` o `requests` |
| **.NET** | `Microsoft.AspNetCore.Authentication.OpenIdConnect` | Incluida | `HttpClient` |
| **PHP** | `jumbojett/openid-connect-php` | `firebase/php-jwt` | `Guzzle` |

---

### 2.4 Vinculación del usuario con tu base de datos

1. Usa **`numero_identificacion`** del `id_token` como llave para encontrar al usuario en tus tablas. Es única e inmutable; el correo puede cambiar o una persona puede tener más de una cuenta.
2. Si hoy tu aplicación identifica a los usuarios por **correo**, vincula por correo durante la transición y migra a `numero_identificacion` con una carga masiva que reporte las no coincidencias.
3. Si no encuentras al usuario, muestra un mensaje claro y registra el caso. **No crees usuarios automáticamente** con datos del token sin las reglas de tu aplicación.
4. Trata `numero_identificacion` siempre como **texto** (ver la sección 2.8).

---

### 2.5 Autenticación de tu backend ante el API de autorización (`POST /api/v1/oauth/token`)

El API de autorización del SSO no acepta consultas anónimas. Tu backend se autentica con sus credenciales M2M:
- `uuid_aplicacion` (`SSO_APP_UUID`): identificador único (UUID v4) de tu aplicación en el catálogo del SSO.
- `client_id` (`SSO_CLIENT_ID`) y `client_secret` (`SSO_CLIENT_SECRET`): credenciales M2M exclusivas de tu aplicación.

> [!IMPORTANT]
> **No pidas un token nuevo en cada clic del usuario.**
> El `access_token` que devuelve `/api/v1/oauth/token` dura **3600 segundos (1 hora)**. Tu backend debe guardarlo en memoria y reutilizarlo en todas las llamadas a `/api/v1/access/evaluation`, renovándolo únicamente cuando falten ~60 segundos para expirar o si recibe un código HTTP `401`.

- **Endpoint**: `POST https://<url-sso-minedec>/api/v1/oauth/token`
- **Request (`application/json`)**:
```json
{
  "grant_type": "client_credentials",
  "client_id": "app-calificaciones-web",
  "client_secret": "secreto-entregado-por-consola-sso"
}
```
- **Response (`200 OK`)**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im1pbmVkZWMtcGRwLWtleS0yMDI2LTAxIiwidHlwIjoiSldUIn0...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

### 2.6 Consulta de autorización (`POST /api/v1/access/evaluation`)

Cada vez que el usuario autenticado invoca una ruta o acción protegida en tu backend, haces un `POST` normal de servidor a servidor (sin redirecciones ni navegador). Esta consulta **reemplaza** cualquier servicio de permisos propio de tu aplicación.

- **Endpoint**: `POST https://<url-sso-minedec>/api/v1/access/evaluation`
- **Cabeceras (`Headers`)**:
  - `Authorization: Bearer <access_token_M2M>`
  - `Content-Type: application/json`
  - `X-Minedec-Request-Id: <uuid-de-trazabilidad>` *(recomendado para auditoría)*
- **Cuerpo de la Petición (`Request JSON`)**:

```json
{
  "email_autenticado": "juan.perez@educacion.gob.ec",
  "uuid_aplicacion": "550e8400-e29b-41d4-a716-446655440000",
  "host_solicitado": "calificaciones.educacion.gob.ec",
  "ruta_solicitada": "/api/v1/calificaciones/registro",
  "metodo_http": "POST",
  "atributos_contexto": {
    "ip_origen": "186.46.120.15",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "dispositivo_gestionado": true,
    "request_id": "req-9f8e7d6c-5b4a-3210"
  }
}
```

> [!WARNING]
> **Normalización de `ruta_solicitada`**: Envía siempre la ruta limpia (ej. `/api/v1/calificaciones/registro`, sin query strings `?foo=bar`). El SSO rechaza automáticamente con `400 Bad Request` rutas maliciosas o ambiguas que contengan `..`, `%2F` o `%00`.

- **Cuerpo de la Respuesta (`Response JSON — HTTP 200 OK`)**:

```json
{
  "autorizado": true,
  "codigo_decision": "AUTHZ_PERMITTED",
  "numero_identificacion": "0912345675",
  "tipo_identificacion": "CEDULA",
  "roles": [
    "DOCENTE_TITULAR",
    "TUTOR_CURSO"
  ],
  "permisos": [
    "CALIFICACIONES_REGISTRAR",
    "CALIFICACIONES_CONSULTAR"
  ],
  "contexto_territorial": {
    "amie_titular": "09H00123",
    "amies_asignados": [
      "09H00123",
      "09H00456"
    ],
    "nivel_jurisdiccion": "INSTITUCIONAL",
    "codigo_jurisdiccion": "09H00123",
    "zona": "ZONA_8",
    "distrito": "09D05"
  },
  "assertion_jwt": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im1pbmVkZWMtcGRwLWtleS0yMDI2LTAxIiwidHlwIjoiSldUIn0...",
  "politicas_evaluadas": [
    "RUTA_PROTEGIDA:/api/v1/calificaciones/*",
    "RBAC:DOCENTE_TITULAR",
    "ABAC:VIGENCIA_ACTIVA"
  ],
  "cache_ttl_segundos": 300,
  "timestamp": "2026-10-21T14:50:00.125Z"
}
```

---

### 2.7 Cierre de sesión

1. **Botón «Salir» de tu aplicación**: borra la sesión local y redirige el navegador al cierre de sesión central:
   ```
   https://login.sso.<dominio>/logout?id_token_hint=<id_token>&post_logout_redirect_uri=<URL POST_LOGOUT registrada>&state=<valor>
   ```
2. **Aviso de cierre de sesión central (*Back-Channel Logout*)**: cuando el usuario cierra sesión en otra aplicación o el Ministerio lo da de baja, el SSO envía un `POST` de servidor a servidor a tu URL `BACKCHANNEL_LOGOUT` con un parámetro `logout_token` (JWT firmado). Tu aplicación debe:
   - validar firma (`/jwks`), `iss`, `aud` (tu `SSO_OIDC_CLIENT_ID`) y `iat`, y que incluya el evento `http://schemas.openid.net/event/backchannel-logout`;
   - invalidar las sesiones locales de ese usuario (`sub` o `sid`);
   - responder `200 OK`.
3. **Si no implementas el aviso**, tu aplicación debe revalidar la sesión con el SSO como máximo cada **300 segundos** (por ejemplo, con la consulta de autorización), para que una baja surta efecto en máximo 5 minutos.

---

### 2.8 Reglas Críticas que Debe Cumplir tu Aplicación

1. **Tratar `numero_identificacion` y códigos `AMIE` siempre como texto (`string` / `VARCHAR`)**:
   - Las cédulas y códigos territoriales de las provincias `01` a `09` empiezan con **`0`** (ej. `"0912345675"`, `"09H00123"`). **Nunca los conviertas a `number` o `integer`** porque perderías el cero inicial.
   - Guarda `numero_identificacion` como llave de referencia del usuario en tus tablas de negocio (auditoría, registros creados, trámites).
2. **Significado de `codigo_decision` cuando el SSO responde `200 OK`**:
   - `AUTHZ_PERMITTED` (`autorizado: true`): Tiene el rol, permiso y vigencia requeridos.
   - `AUTHZ_PUBLIC_ROUTE` (`autorizado: true`): La ruta está marcada como pública en la Consola del SSO.
   - `AUTHZ_AUTHENTICATED_ROUTE` (`autorizado: true`): La ruta solo exige tener sesión institucional activa.
   - `AUTHZ_DENIED_POLICY` (`autorizado: false`): El usuario está activo, pero no tiene el rol o permiso para esa pantalla/acción -> **Tu app debe responder `403 Forbidden`**.
   - `AUTHZ_USER_SUSPENDED` (`autorizado: false`): La cuenta fue suspendida o dada de baja -> **Tu app debe responder `403 Forbidden` y cerrar su sesión**.
   - `AUTHZ_OUTSIDE_VALIDITY_WINDOW` (`autorizado: false`): El contrato o encargo temporal del usuario expiró -> **Tu app debe responder `403 Forbidden`**.
3. **Política obligatoria *Fail-Close* ante errores HTTP o caídas de red**:
   - **`401 Unauthorized`**: Tu token M2M expiró -> Pide uno nuevo en `/api/v1/oauth/token` y reintenta 1 sola vez.
   - **`400` / `403` / `404`**: Deniega el acceso (`403 Forbidden`).
   - **`500` / `503` o Timeout de red (`> 3 s`)**: **PROHIBIDO dar acceso por defecto**. Si el SSO no responde o falla, tu aplicación debe bloquear la operación y devolver `503 Service Unavailable` (*Fail-Close*).
4. **Si usas caché local en tu aplicación (`<= 300 segundos`)**:
   - El tiempo de vida en tu caché **jamás puede superar `cache_ttl_segundos` (máximo 300 segundos / 5 minutos)**. Así se garantiza que cuando el Ministerio suspenda a un funcionario, pierda acceso en toda la institución en máximo 5 minutos.
5. **Secretos**: lee `SSO_OIDC_CLIENT_SECRET` y `SSO_CLIENT_SECRET` desde Secret Manager en tiempo de ejecución. Se rotan cada `<= 90 días` con un periodo de gracia en el que funcionan el secreto nuevo y el anterior, así que no necesitas volver a desplegar.
6. **Sin contraseñas locales**: tu aplicación ya no almacena ni valida contraseñas.

---

### 2.9 Migrar una aplicación legada

| Hoy tu aplicación… | Con el SSO… |
| :--- | :--- |
| Inicia sesión con **CAS** (por ejemplo, SIEE) | Quita el cliente CAS e inicia sesión con OIDC contra el SSO (secciones 2.1 y 2.2). |
| Inicia sesión contra el **Directorio Activo** o un formulario propio (por ejemplo, SGA) | Quita el login propio e inicia sesión con OIDC contra el SSO. |
| Consulta permisos en un **servicio propio** (por ejemplo, el servicio web de Seguridades) | Registra sus roles y permisos en la Consola del SSO y consulta `/api/v1/access/evaluation` (sección 2.6). |
| Identifica al usuario por **correo** | Vincula por `numero_identificacion` (sección 2.4). |
| Guarda contraseñas locales | Deja de guardarlas. |

---

### 2.10 Patrón 2: aplicaciones detrás del proxy perimetral (PEP)

Si tu aplicación usa el patrón 2, **no implementas las secciones 2.1, 2.2, 2.5, 2.6 ni 2.7**: el PEP inicia sesión en el SSO, consulta los permisos por cada ruta y aplica el cierre de sesión. Tu aplicación:

1. Recibe la identidad validada en cabeceras que solo puede escribir el PEP (por ejemplo, el número de identificación del usuario) y **rechaza cualquier petición que no venga del PEP**.
2. Vincula al usuario con su base de datos (sección 2.4).
3. Deja de mostrar su propio formulario de inicio de sesión.

---

### 2.11 Lista de verificación de integración (patrón 1)

- [ ] Recibí `SSO_OIDC_ISSUER_URL`, `SSO_OIDC_CLIENT_ID`, `SSO_OIDC_CLIENT_SECRET`, `SSO_APP_UUID`, `SSO_CLIENT_ID` y `SSO_CLIENT_SECRET`, y los leo desde Secret Manager.
- [ ] Registré en el SSO mis URL exactas `LOGIN_CALLBACK`, `POST_LOGOUT` y `BACKCHANNEL_LOGOUT`.
- [ ] El botón «Ingresar con Google» inicia el flujo OIDC con PKCE `S256`, `state` y `nonce`.
- [ ] El canje del código se hace en el backend y valido firma, `iss`, `aud`, `exp` y `nonce` del `id_token`.
- [ ] Vinculo al usuario por `numero_identificacion`, guardado como texto.
- [ ] Consulto `/api/v1/access/evaluation` en cada ruta protegida, con caché de `<= 300 s` y *fail-close*.
- [ ] El botón «Salir» cierra la sesión local y la central; atiendo el *back-channel logout* o revalido cada `<= 300 s`.
- [ ] Quité el login anterior (CAS, Directorio Activo o formulario) y las contraseñas locales.
- [ ] Probé en QA: inicio de sesión; ingreso a una segunda aplicación sin pedir credenciales; `redirect_uri` no registrada rechazada; token de otra aplicación rechazado; usuario sin permiso (`403`); SSO caído (`503`); cierre de sesión central.
