# DA-12 · Nombre del endpoint de decisión de autorización

| Campo | Valor |
| :--- | :--- |
| Estado | **Aprobada** |
| Fecha | 22/10/2026 |
| Responsable | Álvaro Narváez |
| Documentos afectados | C2-50 (Arquitectura C2.2), C2-59 (Arquitectura C2.3), `docs/Guía de integración SSO.md`, constitución, base de conocimiento (`knowledge/`) y esquemas DBML |
| Reemplaza | `POST /api/v1/authorize` |

---

## 1. Contexto

Con la `DA-11`, el SSO expone dos endpoints con el mismo nombre en servicios distintos:

| Servicio | Endpoint | Propósito |
| :--- | :--- | :--- |
| Intermediario OIDC (`sso-oidc`) | `GET /authorize` | Inicia el inicio de sesión (nombre fijado por OpenID Connect; no se puede cambiar). |
| Motor de autorización (PDP) | `POST /api/v1/authorize` | Decide si una persona puede ejecutar una acción sobre un recurso. |

Los equipos que integran aplicaciones confunden ambos endpoints, porque los dos se llaman «authorize» pero hacen cosas distintas.

## 2. Decisión

El endpoint de decisión del motor de autorización se denomina **`POST /api/v1/access/evaluation`**.

- El nombre sigue la especificación *Authorization API 1.0* de OpenID AuthZEN, que define `/access/v1/evaluation` para consultar a un punto de decisión de políticas.
- Solo cambia la ruta. Los campos de la solicitud (`email_autenticado`, `uuid_aplicacion`, `host_solicitado`, `ruta_solicitada`, `metodo_http`, `atributos_contexto`) y de la respuesta (`autorizado`, `codigo_decision`, `roles`, `permisos`, `contexto_territorial`, `assertion_jwt`, `cache_ttl_segundos`) no cambian.
- `POST /api/v1/oauth/token` (credenciales M2M) no cambia.
- El `/authorize` del intermediario OIDC no cambia.

## 3. Consecuencias

- No se rompe código: el motor de autorización (spec 004) aún no está implementado.
- Se actualizan la constitución, `AGENTS.md`, la `DA-11`, la guía de integración, la base de conocimiento, los esquemas DBML y el modelo de datos de la spec 001.
- En los documentos C2-50 y C2-59 se reemplaza la ruta y se registra esta decisión en la tabla de decisiones de arquitectura del C2-50.
- Adoptar también el formato de solicitud de AuthZEN (`subject`, `action`, `resource`, `context`) queda para evaluarse al especificar la 004.

## 4. Referencias

- OpenID Foundation. *Authorization API 1.0* (OpenID AuthZEN). https://openid.net/specs/authorization-api-1_0.html
- OpenID Foundation. *OpenID Connect Core 1.0*. https://openid.net/specs/openid-connect-core-1_0.html
