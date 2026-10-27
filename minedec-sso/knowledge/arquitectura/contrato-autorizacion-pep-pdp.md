---
type: API Contract
title: Contrato Formal Único de Autorización PEP–PDP, Cabeceras Oficiales y Pruebas PI-01..PI-08
description: Especificación técnica de POST /api/v1/oauth/token y POST /api/v1/access/evaluation (armonizando C2-50 Tabla 6/8/9 y C2-59 Tabla 7/8), las 11 cabeceras X-Minedec-* con JWT RS256 y la política Fail-Close.
tags:
  - api-contract
  - c2-50
  - c2-59
  - pep-pdp
  - authorize
  - oauth-token
  - x-minedec-assertion
  - rs256
  - fail-close
timestamp: 2026-10-21T14:50:00Z
---

# Contrato Formal Único de Autorización PEP–PDP y Cabeceras Oficiales (`C2-50` §5 y `C2-59` §4)

Tanto las aplicaciones integradas con el **Patrón 1 (Nativo)** como el **PEP Perimetral del Patrón 2** (Apigee X o Envoy Gateway) consumen exactamente el **mismo contrato REST/JSON** expuesto por el Motor de Autorización del **Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (C2.2)**.

---

## 1. Autenticación Máquina a Máquina (`POST /api/v1/oauth/token`) y Credenciales por Aplicación (`DA-11`)

Ningún consumidor puede invocar el motor de autorización de forma anónima (`RF-AUZ-12`).

- **Estándar**: `OAuth 2.0 Client Credentials Grant` (`RFC 6749 §4.4`).
- **Separación entre Credencial OIDC de Inicio de Sesión (`sso-oidc`) y Credencial M2M del Motor de Autorización (`motor-pdp`) conforme a `DA-11`**:
  1. **Login OIDC del Usuario en el Navegador (`SSO_OIDC_CLIENT_ID` + `SSO_OIDC_CLIENT_SECRET` contra `sso-oidc`)**:
     - Conforme a **`DA-11`** (*El SSO como intermediario OIDC*), **ninguna aplicación se conecta directamente a Google Cloud ni comparte un mismo `client_id` con otras aplicaciones**. Solo el servicio `sso-oidc` del SSO posee **1 único cliente OAuth 2.0 en Google Cloud** (evitando los límites no ampliables de Google Cloud sobre cantidad de clientes OAuth, `redirect_uris`, dominios por proyecto, eliminación por inactividad de 6 meses y falta de API/Terraform).
     - En el **Patrón 1**, cada aplicación recibe desde la Consola Web del SSO su propio `SSO_OIDC_CLIENT_ID` (y `SSO_OIDC_CLIENT_SECRET` almacenado como hash `SHA-256` en AlloyDB, junto con sus `redirect_uris` permitidas). Al iniciar sesión contra `sso-oidc` (`GET /authorize`, `POST /token`), la aplicación recibe un `id_token` firmado con `RS256` por el SSO cuyo claim **`aud` es exclusivamente el `SSO_OIDC_CLIENT_ID` de esa aplicación** (impidiendo reutilizar el token en otra aplicación) y que incluye `sub`, `email`, `email_verified` y `numero_identificacion`.
     - En el **Patrón 2**, el PEP Perimetral actúa como cliente OIDC registrado frente a `sso-oidc`.
  2. **Autenticación M2M Backend-a-Backend ante el Motor PDP (`SSO_CLIENT_ID` + `SSO_CLIENT_SECRET`)**:
     - Cada aplicación del **Patrón 1** recibe desde la Consola Web un `client_id` M2M único (vinculado a su `uuid_aplicacion`) y un `client_secret` generado criptográficamente por `api-pap` que **se muestra una sola vez** al Superadministrador y se almacena en la tabla `credencial_m2m` de **AlloyDB for PostgreSQL** únicamente como hash **SHA-256 (`CHAR(64)`)** (`documents/docs.cloud.google.com/alloydb/quotas`), con soporte de rotación cada `<= 90 días` con ventana de gracia dual (`ACTIVA` + `EN_ROTACION_GRACIA`). Al ser registros propios en PostgreSQL y no recursos de GCP, **no tienen ningún límite de cantidad en Google Cloud**.
     - El **PEP Perimetral (Patrón 2)** utiliza una credencial de plataforma autorizada para consultar por `host_solicitado`.
- **Respuesta de `/api/v1/oauth/token`**:
  - Devuelve un **Bearer Access Token (JWT `RS256` firmado por el PDP)** con vigencia de **3600 segundos (1 hora)** que codifica en sus claims el `client_id`, el tipo de consumidor (`APP_PATRON_1` o `PEP_PATRON_2`) y, en Patrón 1, el `uuid_aplicacion` autorizado.

---

## 2. Evaluación de Autorización en Tiempo Real (`POST /api/v1/access/evaluation`)

> [!NOTE]
> **Nombre del endpoint (`DA-12`)**: la evaluación se publica en `POST /api/v1/access/evaluation` (antes `/api/v1/authorize`), alineada con la *Authorization API 1.0* de OpenID AuthZEN, para no confundirla con el `GET /authorize` del intermediario `sso-oidc` (`DA-11`), que inicia el inicio de sesión y no decide permisos. Solo cambia la ruta: los campos de la solicitud y de la respuesta se mantienen. Ver `docs/decisiones/DA-12-endpoint-evaluacion-autorizacion.md`.

### 2.1 Cuerpo de la Solicitud (`Request JSON` — Armonización `C2-50` Tabla 6 y `C2-59` Tabla 7)

> [!IMPORTANT]
> **Compatibilidad dual `uuid_aplicacion` / `host_solicitado` (`C2-50` vs `C2-59`)**:
> - En `C2-50` (Tabla 6), las aplicaciones del **Patrón 1** envían `uuid_aplicacion` y el PEP del **Patrón 2** envía `host_solicitado`.
> - En `C2-59` (Tabla 7), el ejemplo unificado envía `host_solicitado` en ambos patrones junto con el Bearer Token M2M de la aplicación.
> - Por diseño, el endpoint `POST /api/v1/access/evaluation` de C2.2 **acepta cualquiera de los dos campos (`uuid_aplicacion` o `host_solicitado`, o ambos)** y valida que correspondan a la aplicación autorizada en el Bearer Token M2M.
> - Asimismo, propaga tanto la cabecera estándar **`W3C traceparent`** (`C2-59` §6.6) como **`X-Minedec-Request-Id`** (`C2-50` Tabla 8).

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

### 2.2 Cuerpo de la Respuesta Exitosa (`Response JSON — HTTP 200 OK`)

Tanto cuando el acceso es **permitido** (`"autorizado": true`) como cuando es **denegado por política de negocio** (`"autorizado": false`), el endpoint responde con código HTTP **`200 OK`** y la siguiente estructura canónica (sin campos de latencia en milisegundos, conforme a `C2-49` v0.4 y `C2-50` Tabla 7):

```json
{
  "autorizado": true,
  "codigo_decision": "AUTHZ_PERMITTED",
  "numero_identificacion": "1712345678",
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
    "amie_titular": "17H00123",
    "amies_asignados": [
      "17H00123",
      "17H00456"
    ],
    "nivel_jurisdiccion": "INSTITUCIONAL",
    "codigo_jurisdiccion": "17H00123",
    "zona": "ZONA_9",
    "distrito": "17D05"
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

### 2.3 Catálogo de Códigos de Decisión (`codigo_decision`)

| Código de Decisión | Valor de `autorizado` | Significado |
| :--- | :--- | :--- |
| `AUTHZ_PERMITTED` | `true` | El usuario está activo y cumple los roles/permisos/reglas ABAC exigidos para la ruta protegida (`PI-04`). |
| `AUTHZ_PUBLIC_ROUTE` | `true` | La ruta solicitada coincide con una excepción o regla por defecto `PUBLICA` en el catálogo de rutas. |
| `AUTHZ_AUTHENTICATED_ROUTE` | `true` | La ruta solo exige sesión válida de un usuario activo (`AUTENTICADA`), sin requerir rol específico adicional. |
| `AUTHZ_DENIED_POLICY` | `false` | El usuario está autenticado y activo, pero no posee el rol, permiso o condición ABAC requerida para la ruta/método (`PI-05`). |
| `AUTHZ_USER_SUSPENDED` | `false` | La cuenta del usuario figura suspendida en Workspace o con estado inactivo/desvinculado (`PI-07`). |
| `AUTHZ_OUTSIDE_VALIDITY_WINDOW` | `false` | Los roles o asignaciones contextuales del usuario existen pero se encuentran fuera de su ventana `vigente_desde` / `vigente_hasta` (`RF-AUZ-13`). |

---

## 3. Semántica de Códigos de Estado HTTP y Política Fail-Close (`C2-50` Tabla 9)

| Código HTTP | Escenario (`C2-50` Tabla 9) | Comportamiento Obligatorio del Consumidor (PEP / App Patrón 1) |
| :--- | :--- | :--- |
| **`200 OK`** | Evaluación completada correctamente (`autorizado: true` o `autorizado: false`). | Si `autorizado == true`, permitir el paso (e inyectar cabeceras en Patrón 2). Si `autorizado == false`, devolver `403 Forbidden` al usuario final (`PI-04`, `PI-05`). |
| **`400 Bad Request`** | Faltan campos obligatorios, formato inválido o **`ruta_solicitada` ambigua/maliciosa** tras la normalización (ej. `%2F`, `%00`, `..` fuera de raíz). | Rechazar la petición del cliente con `400 Bad Request` y registrar alerta de intento de manipulación de ruta (`RF-AUZ-17`, `PI-08`). |
| **`401 Unauthorized`** | Falta el Bearer Token M2M, firma inválida o token expirado. | Renovar el token en `POST /api/v1/oauth/token` y reintentar una vez; si persiste, denegar acceso (**Fail-Close**). |
| **`403 Forbidden`** | Una credencial M2M de la Aplicación A intenta consultar decisiones para la Aplicación B (`uuid_aplicacion` / `host_solicitado` distinto al autorizado en el token). | Denegar inmediatamente el acceso y generar evento de seguridad crítico en auditoría. |
| **`404 Not Found`** | La aplicación indicada en `uuid_aplicacion` o `host_solicitado` **no existe, no está publicada o se encuentra en estado `SUSPENDIDA`** (`C2-50` Tabla 9). | Denegar el acceso de inmediato (`404` / `403`). |
| **`500 Internal Server Error` / Timeout** | Fallo interno no recuperable en el PDP o indisponibilidad simultánea de Redis y AlloyDB. | **Política Estricta Fail-Close (`DA-10`, `RNF-SEG-10`, `PI-06`)**: El PEP responde **`503 Service Unavailable`** y la aplicación Patrón 1 bloquea la operación. **Jamás se permite acceso por defecto ante error.** |

---

## 4. Las 11 Cabeceras Oficiales Inyectadas en el Patrón 2 (`C2-50` Tabla 8 y `C2-59` Tabla 8)

En el **Patrón 2 (Integración Perimetral)**, el PEP debe **eliminar primero cualquier cabecera entrante con prefijo `X-Minedec-*`** enviada por el navegador o cliente externo (`PI-03`), y luego inyectar hacia el backend las siguientes **11 cabeceras HTTP oficiales** (usando exclusivamente caracteres **ASCII** y códigos estandarizados, nunca tildes ni textos largos):

| # | Nombre de la Cabecera HTTP | Contenido / Formato (Solo ASCII) | Ejemplo |
| :--- | :--- | :--- | :--- |
| 1 | `X-Minedec-Identificacion` | Número de identificación natural del usuario (`numero_identificacion`). | `1712345678` |
| 2 | `X-Minedec-Tipo-Identificacion` | Tipo de documento: `CEDULA`, `PASAPORTE` o `CODIGO_MINEDEC`. | `CEDULA` |
| 3 | `X-Minedec-Email` | Correo electrónico autenticado del usuario. | `juan.perez@educacion.gob.ec` |
| 4 | `X-Minedec-Roles` | Lista de códigos de roles activos separados por coma. | `DOCENTE_TITULAR,TUTOR_CURSO` |
| 5 | `X-Minedec-AMIE` | Código AMIE titular del usuario (`amie_titular`), si aplica. | `17H00123` |
| 6 | `X-Minedec-AMIEs` | Lista de todos los códigos AMIE asignados separados por coma. | `17H00123,17H00456` |
| 7 | `X-Minedec-Jurisdiccion` | Nivel y código de jurisdicción (`{nivel}:{codigo}`). | `INSTITUCIONAL:17H00123` |
| 8 | `X-Minedec-Zona` | Código de la Zona administrativa. | `ZONA_9` |
| 9 | `X-Minedec-Distrito` | Código del Distrito educativo. | `17D05` |
| 10 | `X-Minedec-Request-Id` | Identificador único de trazabilidad extremo a extremo de la petición (correlacionado con `W3C traceparent`). | `req-9f8e7d6c-5b4a-3210` |
| 11 | `X-Minedec-Assertion` | **JWT firmado con `RS256` por el PDP** (`DA-07`), con `aud = uuid_aplicacion`, `exp = +60 segundos` y los mismos claims de identidad/roles/contexto para que el backend pueda verificar criptográficamente que las cabeceras no fueron alteradas en tránsito. | `eyJhbGciOiJSUzI1NiIs...` |

> [!TIP]
> El PDP expone además el endpoint **`GET /api/v1/.well-known/jwks.json`** con las claves públicas RSA activas (incluyendo la clave en ventana de gracia `ROTACION_GRACIA`) para que cualquier backend o el paquete SP/RP verifique localmente la firma `RS256` de `X-Minedec-Assertion` y de los tokens M2M sin llamadas adicionales por red.

---

## 5. Documentos Relacionados

- [Componentes del Núcleo Central del Sistema de Autenticación Centralizado SSO (C2.2)](componentes-pdp-core.md)
- [Catálogo Oficial de Requerimientos Funcionales (`C2-49` v0.4 — incluye `PI-01..PI-08`)](../requerimientos/requerimientos-funcionales-c22.md)
- [Modelo de Autorización Híbrido RBAC + ABAC](../dominio/modelo-autorizacion-rbac-abac.md)
- [Gobierno y Ciclo de Vida de Aplicaciones desde la Consola](gobierno-ciclo-vida-aplicaciones.md)
