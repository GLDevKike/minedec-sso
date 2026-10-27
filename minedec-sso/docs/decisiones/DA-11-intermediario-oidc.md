# DA-11 · El SSO como intermediario OIDC para el inicio de sesión

| Campo | Valor |
| :--- | :--- |
| Estado | **Aprobada**: decisión de arquitectura adoptada para C2.2 y C2.3 |
| Fecha | 21/10/2026 |
| Responsable | Álvaro Narváez |
| Documentos afectados | C2-50 (Arquitectura C2.2), C2-59 (Arquitectura C2.3), `docs/Guía de integración SSO.md`, base de conocimiento (`knowledge/arquitectura`) |
| Reemplaza | La propuesta de un `GOOGLE_CLIENT_ID` institucional compartido por todas las aplicaciones del patrón 1 |

---

## 1. Contexto

En el diseño actual (C2-50 v0.1), cada aplicación del **patrón 1 (integración nativa)** inicia sesión directamente contra Google Cloud Identity con un cliente OAuth propio. El SSO solo interviene después, para autorizar (`/api/v1/access/evaluation`).

Dos condiciones del proyecto hacen que ese diseño no escale:

1. **El SSO vive en un único proyecto de Google Cloud.**
2. **El patrón 1 no se limita a las dos aplicaciones de C2.3**: cualquier aplicación nueva o con código propio puede usarlo, y el parque del Ministerio tiene cientos de aplicaciones.

## 2. Problema: límites de Google

| Límite | Valor | Fuente |
| :--- | :--- | :--- |
| Clientes OAuth por proyecto | Tope fijo, no publicado y no ampliable; en la práctica, alrededor de 100 | Respuesta de soporte de Google Cloud en Google Groups (no documentado oficialmente) |
| URL de retorno (redirect URI) por cliente OAuth | 100 | Fuentes de terceros (WorkOS); no documentado oficialmente |
| Dominios distintos en URL de retorno y de origen por proyecto | 10 (se cuenta el dominio de segundo nivel) | Ayuda de Google Cloud: *Domain Limit Exceeded FAQ* |
| Clientes OAuth sin uso | Se eliminan tras 6 meses de inactividad (aviso con 30 días) | Ayuda de Google Cloud: administración de clientes OAuth |
| Creación de clientes OAuth | Solo desde la consola; no hay API ni recurso de Terraform | Documentación de Google Cloud |

> **Nota:** la cuota «100 clientes OAuth por proyecto» de la página de cuotas de IAM corresponde a **Workforce Identity Federation**, no a los clientes OAuth de *APIs y servicios*. No debe citarse como límite de estos últimos.

Consecuencias:

- **Un cliente OAuth por aplicación** en el proyecto del SSO se agota cerca de las 100 aplicaciones, exige crearlos a mano y expone a las aplicaciones de poco uso al borrado automático.
- **Un `GOOGLE_CLIENT_ID` compartido** tampoco alcanza (100 URL de retorno) y además:
  - comparte el secreto del cliente entre todos los equipos: si se filtra en una aplicación, se compromete en todas y rotarlo obliga a cambiarlas a la vez;
  - todos los ID Token llevan el mismo `aud`, así que un token emitido para una aplicación es válido en las demás;
  - el MINEDEC no puede bloquear ni auditar una aplicación por separado en Google Workspace.

## 3. Opciones evaluadas

| Opción | Descripción | Ventajas | Desventajas | Dictamen |
| :--- | :--- | :--- | :--- | :--- |
| **A. SSO como intermediario OIDC** | El SSO expone su propio proveedor OIDC. Solo el SSO tiene cliente en Google; cada aplicación se registra en la consola del SSO. | Sin límites de Google; aislamiento por aplicación (`aud` y secreto propios); alta desde la consola del SSO; sesión central y cierre de sesión coordinado. | El SSO entra en el camino del inicio de sesión; hay que construir y operar el proveedor OIDC. | **Adoptada** |
| B. Clientes de Google por aplicación en varios proyectos | Proyectos auxiliares solo para alojar clientes OAuth (~80 por proyecto). | No cambia la arquitectura. | Alta manual sin API, borrado por inactividad, gestión de decenas de proyectos; contradice «un único proyecto». | Descartada |
| C. Clientes de Google compartidos por grupo | Pocos clientes, cada uno con hasta 100 URL de retorno. | Pocos clientes que administrar. | Secreto y `aud` compartidos dentro del grupo (riesgo de la «llave maestra»). | Descartada |

## 4. Decisión

Se adopta la **opción A**: el SSO actúa como **intermediario OIDC** (*identity broker*) entre las aplicaciones y Google Cloud Identity.

- Google sigue autenticando (contraseña y 2SV); el usuario sigue viendo «Ingresar con Google».
- Las aplicaciones del patrón 1 usan OIDC estándar (Authorization Code + PKCE S256) **contra el SSO**, no contra Google.
- El PEP del patrón 2 también inicia sesión a través del intermediario, como un cliente más.
- Resultado: **un único cliente OAuth en Google para todo el ecosistema**, en el proyecto del SSO.

```
Patrón 1:  Aplicación ──┐
                        ├──→ SSO (intermediario OIDC) ──→ Google Cloud Identity
Patrón 2:  PEP ─────────┘
```

## 5. Diseño

### 5.1 Componente

Nuevo servicio **`sso-oidc` (proveedor OIDC del SSO)**:

- **Tecnología:** Node.js 22 y TypeScript, sobre `oidc-provider` (librería con certificación de la OpenID Foundation). No se implementa el protocolo desde cero.
- **Datos:** registro de clientes (aplicaciones, `client_id`, hash del secreto y URL de retorno) en AlloyDB, en el mismo catálogo de aplicaciones de la consola; estado temporal (códigos de un solo uso, interacciones y sesión central) en Memorystore for Redis.
- **Llaves:** llaves de firma RS256 en Secret Manager, publicadas en el JWKS del SSO y rotadas con ventana de gracia.
- **Auditoría:** inicios y cierres de sesión, emisión de tokens y errores, con el mismo esquema de auditoría del SSO.

### 5.2 Endpoints

| Endpoint | Uso |
| :--- | :--- |
| `GET /.well-known/openid-configuration` | Descubrimiento: las librerías de las aplicaciones se configuran solas. |
| `GET /authorize` | Inicio del login: valida la aplicación y su URL de retorno, y redirige a Google. |
| `GET /callback` | Retorno desde Google (única URL de retorno registrada en Google). |
| `POST /token` | Canje del código por el ID Token emitido por el SSO para esa aplicación (`aud` = `client_id` de la aplicación). |
| `GET /jwks` | Llaves públicas del SSO. |
| `GET/POST /logout` | Cierre de sesión central y aviso a las aplicaciones (front-channel o back-channel logout). |

### 5.3 Flujo de inicio de sesión

1. El usuario abre la aplicación y pulsa «Ingresar con Google».
2. La aplicación redirige al `/authorize` del SSO con su `client_id`, PKCE, `state` y `nonce`.
3. Si no hay sesión central, el SSO redirige a Google (OIDC con su único cliente).
4. Google autentica (contraseña y 2SV) y devuelve el código al `/callback` del SSO.
5. El SSO canjea el código con Google, valida el ID Token de Google (firma, `iss`, `aud`, `hd` contra los dominios autorizados y `email_verified`) y crea la sesión central.
6. El SSO devuelve a la aplicación un código propio; la aplicación lo canjea en `/token` y recibe un ID Token firmado por el SSO.
7. La aplicación consulta la autorización en `/api/v1/access/evaluation`, como hasta ahora.

Con sesión central activa, el paso 3 se omite: el usuario que ya entró a una aplicación no vuelve a Google al abrir otra.

### 5.4 Despliegue

- **Proyecto y clúster:** el mismo proyecto de Google Cloud y el mismo clúster GKE Autopilot del SSO.
- **Exposición:** a diferencia del PDP, debe ser accesible desde Internet, porque el navegador llega a él. Va detrás del balanceador externo con Cloud Armor, en un dominio como `login.sso.<dominio>` (nombre definitivo con D-18 y D-21).
- **Escalado:** varias réplicas en distintas zonas y escalado horizontal automático.
- **Cliente de Google:** tipo «Interno» si todos los usuarios pertenecen a la misma organización de Google Workspace (sin verificación ni tope de usuarios). Si hubiera varios tenants (D-21), tipo «Externo» con verificación de la aplicación por Google.

### 5.5 Cuotas y peticiones

| Concepto | Valor |
| :--- | :--- |
| Clientes OAuth en Google | 1 |
| URL de retorno en Google | 1 |
| Dominios en Google | 1 |
| Llamadas a Google por inicio de sesión | 1 canje de código (ninguna si hay sesión central) |
| Llamadas a la Directory API en el login | 0 (sin cambios) |
| Peticiones al SSO por inicio de sesión | 3 (`/authorize`, `/callback`, `/token`); el JWKS queda en caché |
| Aplicaciones registrables | Sin límite (registros en AlloyDB) |

Para el pico de inicio de año escolar (unos 4 millones de accesos), el SSO recibiría del orden de 12 millones de peticiones al día. El volumen de canjes con Google se reduce por la sesión central. Las cifras se validan en las pruebas de carga con los niveles de servicio de D-06.

### 5.6 Qué se crea por aplicación

| Elemento | Dónde | Patrón 1 | Patrón 2 |
| :--- | :--- | :--- | :--- |
| Cliente OIDC del SSO (`client_id`, secreto, URL de retorno) | AlloyDB, desde la consola | Sí | No (el PEP es un único cliente) |
| Credencial M2M para `/api/v1/oauth/token` | AlloyDB, desde la consola | Sí | No (credencial de plataforma del PEP) |
| Ficha, rutas, roles y permisos | AlloyDB, desde la consola | Sí | Sí |
| Infraestructura perimetral (ruta, certificado, NEG) | Google Cloud, con Terraform | No | Sí |
| Cliente OAuth de Google | Google Cloud | **No** | **No** |

## 6. Consecuencias

**Positivas**

- Se eliminan los límites de Google para el número de aplicaciones.
- Cada aplicación queda aislada: `aud`, secreto y URL de retorno propios.
- El alta de aplicaciones del patrón 1 se hace desde la consola del SSO, sin acceso a Google Cloud.
- Inicio de sesión único real entre aplicaciones gracias a la sesión central.
- Mejora la respuesta al requisito de cierre único de sesión (SLO) del TDR: el SSO puede avisar a sus aplicaciones al cerrar la sesión central, aunque Google no implemente SLO.

**Negativas y mitigaciones**

| Riesgo | Mitigación |
| :--- | :--- |
| El SSO entra en el camino del inicio de sesión. | Alta disponibilidad regional, escalado automático y monitoreo. Con el diseño actual, sin el SSO tampoco hay autorización (cierre ante fallas), así que la dependencia práctica no cambia. |
| Nuevo componente expuesto a Internet. | Cloud Armor, TLS 1.2+, PKCE obligatorio, URL de retorno exactas, códigos de un solo uso con vida corta y librería certificada. |
| Esfuerzo de construcción y pruebas. | Uso de `oidc-provider`; nueva spec en el plan (ver sección 8). |

## 7. Puntos abiertos

1. **Aplicaciones SAML 2.0:** `oidc-provider` solo implementa OIDC. Las aplicaciones que solo admitan SAML siguen con una app SAML personalizada en Google Workspace por aplicación, o el SSO incorpora un IdP SAML en una fase posterior. Decidir con D-03 y el inventario de D-12.
2. **Tipo de cliente de Google (Interno o Externo):** depende de D-21.
3. **Contenido del ID Token del SSO:** se propone `sub`, `email`, `email_verified` y `numero_identificacion`. Los roles y el ámbito siguen saliendo de `/api/v1/access/evaluation` (DA-05).
4. **Duración de la sesión central** y su relación con la revalidación de 300 s (DA-06).
5. **Nombre del dominio de login** (D-18).

## 8. Impacto en documentos y plan

| Documento o artefacto | Cambio |
| :--- | :--- |
| C2-50, sección 5.3 y Tabla 2 | Agregar el componente `sso-oidc`. |
| C2-50, sección 5.4.2 | Flujos de autenticación a través del intermediario. |
| C2-50, sección 5.4.4 | Cierre de sesión central y aviso a las aplicaciones. |
| C2-50, secciones 5.7.1 y 5.8 | Credenciales por aplicación (cliente OIDC del SSO y credencial M2M) y paquete estándar apuntando al SSO. |
| C2-50, sección 5.9 | El PEP inicia sesión a través del intermediario. |
| C2-50, sección 5.10 | El patrón 1 se publica sin Terraform (activación inmediata en AlloyDB y Redis); el publicador solo interviene en el patrón 2. |
| C2-50, sección 5.12 | Exposición pública de `sso-oidc` detrás del balanceador externo. |
| C2-50, sección 5.14 | Nueva decisión DA-11. |
| C2-59, Figuras 1 y 2 (modelo C4) | La aplicación inicia sesión contra el SSO; Google solo se relaciona con el SSO. |
| C2-59, secciones 5.4 y 5.7 | Flujo OIDC contra el SSO; el secreto del cliente es el del SSO, no el de Google. |
| `docs/Guía de integración SSO.md` | `GOOGLE_CLIENT_ID` pasa a `SSO_OIDC_CLIENT_ID` (único por aplicación, emitido por el SSO); dominios autorizados como configuración (D-21); sin la mención a «Conecta MINEDEC». |
| `knowledge/arquitectura/*` | Sustituir el `GOOGLE_CLIENT_ID` institucional y corregir la cita de cuotas de IAM. |
| Cronograma | Nueva spec del proveedor OIDC (estimación pendiente). |

## 9. Fuentes

- Google Cloud, *IAM quotas and limits*: https://docs.cloud.google.com/iam/quotas
- Google Cloud Help, *Domain Limit Exceeded FAQ*: https://support.google.com/cloud/answer/7650096
- Google Cloud Help, *Manage OAuth clients* (borrado tras 6 meses sin uso): https://support.google.com/cloud/answer/15549257
- Google Groups, *Reaching a quota limit for the OAuth2 Client ID*: https://groups.google.com/g/google-appengine/c/9-LKNUBzSWk
- WorkOS, *Google OAuth's strict redirect URI matching*: https://workos.com/blog/google-oauths-strict-redirect-uri-matching
- OpenID Foundation, *OpenID Connect Core 1.0*: https://openid.net/specs/openid-connect-core-1_0.html
- `oidc-provider` (certificado por la OpenID Foundation): https://github.com/panva/node-oidc-provider
