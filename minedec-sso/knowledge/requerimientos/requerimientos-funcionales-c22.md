---
type: Functional Specification
title: Catálogo Oficial de Requerimientos Funcionales (C2-49 v0.4 — 63 RF)
description: Consolida los 63 requerimientos funcionales oficiales (RF-GI, RF-AUT, RF-AUZ, RF-UEX, RF-ADM, RF-INT y RF-AUD) de C2-49 Documento de Análisis Funcional.pdf (v0.4) y las 8 pruebas de conformidad PI-01..PI-08.
tags:
  - requerimientos-funcionales
  - c2-49
  - rf-gi
  - rf-aut
  - rf-auz
  - rf-uex
  - rf-adm
  - rf-int
  - rf-aud
  - c2.2
timestamp: 2026-10-21T14:47:00Z
---

# Catálogo Oficial de Requerimientos Funcionales (`C2-49 Documento de Análisis Funcional.pdf` v0.4)

Este documento consolida de forma íntegra los **63 requerimientos funcionales vigentes** en `knowledge/fuentes-oficiales/C2-49 Documento de Análisis Funcional.pdf` (**v0.4 — 15/10/2026**):
- **54 requerimientos exclusivos del Subcomponente C2.2** (Sistema de Autenticación Centralizado SSO / Conecta MINEDEC).
- **7 requerimientos compartidos (`C2.2 · C2.3`)**: `RF-AUT-01`, `RF-AUT-05`, `RF-AUT-06`, `RF-INT-03`, `RF-INT-06`, `RF-INT-09` y `RF-AUD-01`.
- **2 requerimientos exclusivos del Subcomponente C2.3**: `RF-INT-01` y `RF-INT-10` (incluidos como referencia de frontera).

*(Nota: Los códigos no secuenciales fueron retirados en revisiones previas al consolidar reglas de negocio; en particular, `RF-INT-02` fue retirado explícitamente en la v0.4).*

---

## 1. Gestión de Identidades y Sincronización (`RF-GI` — 11 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-GI-01`** | `C2.2` | Alta | **Reconocimiento de fuente de identidad para usuarios internos** | Reconocer a **Google Cloud Identity / Google Workspace** como el único proveedor de identidad (IdP) para las tres poblaciones internas (estudiantes, docentes/directivos y administrativos), descartando cualquier integración con Active Directory (`D-01`). |
| **`RF-GI-03`** | `C2.2` | Alta | **Identificación por número de identificación** | Identificar a toda persona natural dentro del ecosistema por su número de identificación oficial (`CEDULA`, `PASAPORTE` o `CODIGO_MINEDEC`), independientemente del correo electrónico con el que inicie sesión. |
| **`RF-GI-05`** | `C2.2` | Alta | **Consumo del directorio en modo de solo lectura** | Consultar Google Cloud Identity estrictamente en modo de **solo lectura** (`admin.directory.user.readonly`); el Sistema de Autenticación Centralizado SSO jamás crea, modifica, suspende ni elimina cuentas o grupos en Google Workspace. |
| **`RF-GI-06`** | `C2.2` | Alta | **Propagación del estado de la cuenta** | Reflejar la suspensión, baja o desactivación de una cuenta en todas las aplicaciones integradas dentro de una ventana máxima obligatoria de **`<= 300 segundos (5 minutos)`**, revocando permisos e invalidando sesiones/caché en Redis. |
| **`RF-GI-07`** | `C2.2` | Alta | **Coexistencia de múltiples cuentas para una misma persona** | Permitir que una misma persona natural (`numero_identificacion` único) posea múltiples cuentas de autenticación (ej. docente en un dominio y administrativo en otro, o usuario externo) vinculadas a la misma identidad. |
| **`RF-GI-09`** | `C2.2` | Alta | **Atributos de identidad del usuario** | Sincronizar y gestionar los atributos de identidad y filiación del usuario (nombres, apellidos, correo principal, tipo y número de identificación, unidad organizativa, estado y atributos del esquema `MINEDEC_Perfil`). |
| **`RF-GI-10`** | `C2.2` | Alta | **Atributos de contexto laboral y educativo** | Gestionar los atributos contextuales necesarios para la autorización: tipo y subtipo de usuario, cargo o función, grado/curso, nivel académico, viceministerio/cartera y fechas de inicio y fin de vigencia. |
| **`RF-GI-11`** | `C2.2` | Alta | **Atributos de alcance territorial y organizacional** | Gestionar el alcance territorial de cada usuario: código AMIE principal (`amie_titular`), establecimientos adicionales (`amies_asignados`), dependencia administrativa, nivel y código de jurisdicción (`NACIONAL`, `ZONAL`, `DISTRITAL`, `CIRCUITAL`, `INSTITUCIONAL`), zona, distrito y circuito (`D-10`). |
| **`RF-GI-12`** | `C2.2` | Alta | **Asignación a múltiples cargos** | Permitir que un servidor público (docente, directivo o administrativo) mantenga múltiples cargos o funciones activas simultáneamente (titular, encargo, subrogación, comisión de servicios) con vigencias independientes. |
| **`RF-GI-13`** | `C2.2` | Alta | **Asignación a múltiples instituciones educativas** | Permitir que un docente o directivo (`docenteMultisede = true`) esté asignado a múltiples instituciones educativas (códigos AMIE) con roles o funciones específicas en cada plantel, sin utilizar una dimensión fija «sede» (`D-05`). |
| **`RF-GI-15`** | `C2.2` | Media | **Identificación temporal mediante Código MINEDEC y actualización a cédula** | Soportar `CODIGO_MINEDEC` para personas que aún no poseen cédula ni pasaporte (con alcance extensible a Deporte y Cultura según `BR-18`) y proveer un proceso transaccional de actualización 1 a 1 hacia `CEDULA` que preserve el 100% del historial de roles, asignaciones y auditoría (`codigo_minedec_anterior`). |

---

## 2. Autenticación Única y Gestión de Sesiones (`RF-AUT` — 13 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-AUT-01`** | `C2.2·C2.3` | Alta | **Inicio de sesión único (SSO)** | Permitir que el usuario autenticado una sola vez acceda a las distintas aplicaciones integradas sin volver a ingresar credenciales durante la vigencia de su sesión. |
| **`RF-AUT-02`** | `C2.2` | Alta | **Enrutamiento de autenticación según el tipo de usuario** | Dirigir automáticamente el flujo de autenticación hacia Google Cloud Identity (para los 3 dominios internos: estudiantes, docentes y administrativos, `D-21`) o hacia el mecanismo de usuarios externos (`D-02`). |
| **`RF-AUT-03`** | `C2.2` | Alta | **Entrega de atributos de identidad y autorización a las aplicaciones** | Entregar a las aplicaciones consumidoras la identidad verificada (`numero_identificacion`, `tipo_identificacion`, `email`), los roles/permisos aplicables y el `contexto_territorial` mediante el contrato de autorización y las cabeceras `X-Minedec-*`. |
| **`RF-AUT-04`** | `C2.2` | Alta | **Soporte para SAML 2.0** | Soportar el protocolo **SAML 2.0 (`SP-Initiated`)** como mecanismo estándar alternativo para aplicaciones que requieran aserciones SAML. |
| **`RF-AUT-05`** | `C2.2·C2.3` | Alta | **Soporte para OpenID Connect (OIDC) con PKCE** | Soportar **OpenID Connect (`Authorization Code Flow` con `PKCE S256`)** como protocolo principal recomendado de autenticación federada. |
| **`RF-AUT-06`** | `C2.2·C2.3` | Alta | **Cierre de sesión único (SLO)** | Soportar el cierre de sesión invalidando de inmediato la sesión local en la aplicación/PEP y garantizando la revalidación/expiración del contexto en un máximo de `<= 300 segundos` (`D-11`). |
| **`RF-AUT-07`** | `C2.2` | Alta | **Autenticación multifactor (MFA) para usuarios con acceso sensible** | Exigir MFA (2SV en Google Cloud Identity) para personal administrativo, directivos, usuarios con acceso a datos sensibles y poblaciones definidas en `D-07`. |
| **`RF-AUT-08`** | `C2.2` | Alta | **MFA obligatorio para administradores del sistema** | Exigir obligatoriamente MFA para todos los usuarios con roles de **Superadministrador**, **Administrador de Aplicativo** y **Auditor** al ingresar a la Consola Web o API PAP. |
| **`RF-AUT-09`** | `C2.2` | Media | **Políticas de acceso contextual** | Evaluar señales de contexto (`ip_origen`, `user_agent`, `dispositivo_gestionado`, ubicación/red y horario) en coordinación con Google Cloud Identity y el motor PDP. |
| **`RF-AUT-10`** | `C2.2` | Alta | **Expiración de sesión por inactividad y tiempo máximo** | Aplicar tiempos configurables de expiración por inactividad y duración máxima de sesión, exigiendo reautenticación al vencer. |
| **`RF-AUT-11`** | `C2.2` | Media | **Recuperación de contraseña en autoservicio** | Permitir la recuperación segura de acceso en autoservicio (delegada en Google Workspace para internos y mediante correo/cédula del representante legal para externos y menores). |
| **`RF-AUT-12`** | `C2.2` | Alta | **Protección contra ataques de fuerza bruta** | Bloquear temporalmente o aplicar controles progresivos (CAPTCHA, limitación de tasa en Cloud Armor / IdP) ante múltiples intentos fallidos consecutivos de inicio de sesión o consumo de API. |
| **`RF-AUT-13`** | `C2.2` | Alta | **Separación del licenciamiento para usuarios externos** | Garantizar que la autenticación de usuarios externos (ciudadanos y representantes legales) no consuma licencias de Google Workspace destinadas al personal o estudiantado interno (`D-02`). |

---

## 3. Motor de Autorización Centralizada (`RF-AUZ` — 12 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-AUZ-01`** | `C2.2` | Alta | **Gestión de aplicaciones registradas** | Mantener el registro centralizado de todas las aplicaciones integradas (UUID, código, nombre, host, patrón de integración, estado operativo y configuración técnica). |
| **`RF-AUZ-02`** | `C2.2` | Alta | **Gestión de permisos atómicos por aplicación** | Permitir definir permisos granulares por aplicación vinculados a acciones o rutas/métodos HTTP específicos (ej. `CALIFICACIONES_REGISTRAR`). |
| **`RF-AUZ-03`** | `C2.2` | Alta | **Gestión de roles por aplicación** | Permitir crear y mantener roles propios de cada aplicación como agrupaciones de permisos atómicos. |
| **`RF-AUZ-04`** | `C2.2` | Alta | **Gestión de perfiles de usuario** | Permitir definir perfiles reutilizables que agrupen uno o varios roles para facilitar la asignación funcional. |
| **`RF-AUZ-05`** | `C2.2` | Alta | **Asignación de roles con alcance contextual (RBAC + ABAC)** | Permitir que la asignación de roles esté acotada por condiciones de atributos (`viceministerio`, `codigoInstitucion`, `zona`, `distrito`, `nivelAcademico`, `subtipoUsuario`). |
| **`RF-AUZ-06`** | `C2.2` | Alta | **Grupos lógicos basados en reglas de atributos** | Evaluar reglas declarativas de atributos en memoria para otorgar roles dinámicamente sin requerir filas individuales por usuario (indispensable para los ~2,1 millones de estudiantes, `DA-08`). |
| **`RF-AUZ-07`** | `C2.2` | Alta | **Evaluación de autorización por aplicación y contexto** | Evaluar en cada solicitud a `POST /api/v1/access/evaluation` si el usuario está activo y autorizado para la aplicación, ruta, método HTTP y contexto territorial solicitado. |
| **`RF-AUZ-10`** | `C2.2` | Alta | **Asignación directa de roles e inclusión/exclusión** | Permitir asignar roles directamente a personas específicas (`usuario_rol_aplicacion`) así como gestionar excepciones controladas. |
| **`RF-AUZ-12`** | `C2.2` | Alta | **Servicio de consulta de autorización en tiempo real** | Exponer la API REST de alta velocidad (`POST /api/v1/access/evaluation` y `POST /api/v1/oauth/token`) con caché L2 en Memorystore Redis (`TTL <= 300 s`) y emisión de `X-Minedec-Assertion` (`RS256`). |
| **`RF-AUZ-13`** | `C2.2` | Alta | **Vigencia temporal de asignaciones** | Soportar fechas de inicio (`vigente_desde`) y fin (`vigente_hasta`) en asignaciones de roles y contextos (encargos, subrogaciones, contratos temporales), activando y revocando el permiso automáticamente sin intervención manual. |
| **`RF-AUZ-16`** | `C2.2` | Media | **Carga masiva de asignaciones** | Proveer mecanismos de carga masiva controlada y validada (CSV/JSON o API) para asignaciones de roles y contextos territoriales, registrando auditoría detallada por lote. |
| **`RF-AUZ-17`** | `C2.2` | Alta | **Catálogo de rutas por aplicación y evaluación por ruta y método HTTP** | Permitir configurar para cada aplicación una regla por defecto (`PUBLICA`, `AUTENTICADA` o `PROTEGIDA`) y excepciones por ruta (`EXACTA`, `PREFIJO`, `EXTENSION`) y método HTTP, aplicando **normalización obligatoria de la ruta** y rechazando con `HTTP 400` cualquier ruta ambigua (`%2F`, `..`, `%00`). |

---

## 4. Gestión de Usuarios Externos (`RF-UEX` — 6 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-UEX-02`** | `C2.2` | Alta | **Identificación de representantes legales como personas naturales vinculadas a un RUC** | Garantizar que **no existan cuentas de personas jurídicas**: todo representante legal es una **persona natural identificada por su `CEDULA`** que se autentica con su identidad personal y actúa contextualmente vinculada al **RUC (13 dígitos)** de la organización que representa (`D-14`). |
| **`RF-UEX-04`** | `C2.2` | Alta | **Registro de usuarios externos** | Permitir el alta de ciudadanos externos y representantes legales con sus datos de identificación (`CEDULA` o `PASAPORTE`), nombres, apellidos y correo personal de contacto (`D-15`). |
| **`RF-UEX-05`** | `C2.2` | Alta | **Validación de formato de identificación ecuatoriana** | Validar algorítmicamente el formato y dígito verificador (**Módulo 10** para cédula de 10 dígitos y validación de RUC de 13 dígitos para la organización vinculada) antes de aceptar el registro. |
| **`RF-UEX-06`** | `C2.2` | Media | **Verificación de correo electrónico** | Verificar la titularidad del correo electrónico de contacto del usuario externo mediante enlace o código de confirmación de un solo uso con vigencia limitada. |
| **`RF-UEX-07`** | `C2.2` | Alta | **Vigencia temporal de cuentas externas** | Asociar una ventana de vigencia (`fechaInicioVigencia` / `fechaFinVigencia`) a las cuentas o habilitaciones de usuarios externos según la convocatoria o trámite, deshabilitando el acceso automáticamente al expirar. |
| **`RF-UEX-08`** | `C2.2` | Alta | **Vinculación entre persona natural y organización externa** | Gestionar la relación N:M entre la persona natural (`CEDULA`) y una o más organizaciones externas (`RUC`) con estado de acreditación y fechas de vigencia (`D-14`). |

---

## 5. Consola Web de Administración (`RF-ADM` — 7 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-ADM-01`** | `C2.2` | Alta | **Consola web de administración** | Proveer una aplicación web SPA en español (detrás de Cloud IAP + Cloud Armor) para administrar centralizadamente aplicaciones, rutas, roles, permisos, perfiles, grupos lógicos, usuarios y auditoría. |
| **`RF-ADM-02`** | `C2.2` | Alta | **Búsqueda unificada de usuarios** | Permitir buscar usuarios por número de identificación (`CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`), correo electrónico o nombres/apellidos, consolidando todas las cuentas vinculadas a la misma persona natural. |
| **`RF-ADM-03`** | `C2.2` | Alta | **Vista consolidada de accesos de un usuario** | Mostrar en una sola ficha la identidad de la persona, sus cuentas asociadas, sus atributos de `MINEDEC_Perfil`, su contexto territorial activo y todas las aplicaciones/roles a los que tiene acceso (incluyendo un simulador/evaluador de políticas). |
| **`RF-ADM-04`** | `C2.2` | Alta | **Suspensión o bloqueo inmediato desde la consola** | Permitir bloquear o revocar de emergencia el acceso de un usuario o aplicación desde la consola, purgando de inmediato la caché en Memorystore Redis (`<= 300 s` máximo garantizado, `< 5 s` nominal). |
| **`RF-ADM-05`** | `C2.2` | Media | **Tablero de indicadores operativos** | Presentar métricas de operación en la consola: total de usuarios sincronizados por población, autenticaciones/autorizaciones recientes, estado de colas de sincronización, anomalías de identidad y estado de aplicaciones publicadas (`sa-catalogo`). |
| **`RF-ADM-07`** | `C2.2` | Alta | **Administración delegada por aplicación y segregación de roles** | Segregar estrictamente las funciones entre **Superadministrador** (Seguridad Informática: alta de apps, reglas por defecto, rutas públicas, credenciales M2M, publicación en infraestructura y asignación de administradores), **Administrador de Aplicativo** (restringido exclusivamente a roles, permisos, perfiles, grupos lógicos y rutas protegidas de sus aplicaciones asignadas) y **Auditor** (`C2-50` Tabla 13: consulta y exportación de auditoría en solo lectura). |
| **`RF-ADM-08`** | `C2.2` | Alta | **Publicación de aplicaciones desde la consola con control de cambios** | Permitir al Superadministrador solicitar desde la consola la publicación, actualización, suspensión o retiro de aplicaciones mediante **Google Cloud Infrastructure Manager** (`sa-publicador`), generando el artefacto declarativo (`apps.auto.tfvars.json`), ejecutando **vista previa obligatoria (`Preview`) con regla anti-destrucción**, garantizando **una sola ejecución a la vez** (`pg_try_advisory_lock`), informando pasos externos pendientes (`sa-catalogo`) y permitiendo reversión a versiones previas. |

---

## 6. Integración de Aplicaciones y Paquete Estándar (`RF-INT` — 5 Vigentes + 1 Retirado)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-INT-01`** | `C2.3` | Alta | **Integración de las dos aplicaciones existentes seleccionadas** | Integrar las 2 aplicaciones institucionales seleccionadas (`D-16`) al Sistema de Autenticación Centralizado SSO *(alcance del Subcomponente C2.3, documentado en `C2-59`)*. |
| ~~`RF-INT-02`~~ | — | — | *(Retirado en v0.4)* | *(Retirado en la versión 0.4 del documento de análisis funcional).* |
| **`RF-INT-03`** | `C2.2·C2.3` | Alta | **Especificación y paquete estándar de integración reutilizable** | Entregar como parte de C2.2 la especificación OpenAPI 3.1, el **paquete estándar reutilizable SP/RP** (OIDC + PKCE `S256`, SAML 2.0, cliente M2M de `/api/v1/access/evaluation`, validación JWKS `RS256` y política `fail-close`) y la **suite de 8 pruebas de conformidad (`PI-01` a `PI-08`)**. |
| **`RF-INT-06`** | `C2.2·C2.3` | Alta | **Vinculación de usuarios existentes mediante número de identificación** | Vincular las cuentas y registros históricos de las aplicaciones con la identidad centralizada utilizando el `numero_identificacion` (`CEDULA`, `PASAPORTE` o `CODIGO_MINEDEC`) como llave maestra de cruce (`D-19`). |
| **`RF-INT-09`** | `C2.2·C2.3` | Alta | **Plan de transición y reversión por aplicación** | Soportar el paso gradual por estados (`PUBLICADA_PILOTO` → `CORTE_REALIZADO`) y la capacidad de reversión controlada sin pérdida de datos (`D-20`). |
| **`RF-INT-10`** | `C2.3` | Alta | **Integración perimetral mediante Punto de Cumplimiento (Patrón 2)** | Permitir integrar aplicaciones legadas mediante el PEP perimetral en dos niveles progresivos: nivel **«Protegida»** (control de acceso por ruta en el PEP sin tocar el código de la app) o nivel **«Integrada»** (la app delega su login y consume la identidad inyectada en `X-Minedec-Identificacion` y `X-Minedec-Assertion`). |

### Las 8 Pruebas de Conformidad Obligatorias del Paquete Estándar (`PI-01` a `PI-08` — `RF-INT-03`, `C2-50` Tabla 15 y `C2-59` Tabla 11)

| Código | Prueba de Conformidad | Criterio de Aceptación Verificable |
| :--- | :--- | :--- |
| **`PI-01`** | **Flujo OIDC + PKCE `S256`** | Inicio de sesión exitoso con `code_challenge_method = S256`; rechazo de flujos sin PKCE o con `state`/`nonce` inválido. |
| **`PI-02`** | **Flujo SAML 2.0 `SP-Initiated`** | Validación de firma XML de la aserción SAML, audiencia, ventana temporal y prevención de *replay* (`InResponseTo`). |
| **`PI-03`** | **Anti-spoofing de cabeceras y validación de `X-Minedec-Assertion`** | El PEP elimina cualquier cabecera `X-Minedec-*` enviada por el cliente externo e inyecta cabeceras limpias con JWT `RS256` (`exp = 60 s`, `aud = uuid_aplicacion`). |
| **`PI-04`** | **Autorización permitida con enriquecimiento territorial** | Para un usuario con rol/ABAC válido, `/api/v1/access/evaluation` retorna `HTTP 200`, `autorizado: true`, `numero_identificacion`, `roles`, `permisos` y `contexto_territorial`. |
| **`PI-05`** | **Autorización denegada por política (`403 Forbidden`)** | Para un usuario autenticado sin el rol o ámbito territorial requerido, `/api/v1/access/evaluation` retorna `autorizado: false` y el PEP/aplicación responde `403 Forbidden`. |
| **`PI-06`** | **Comportamiento `Fail-Close` ante caída o error del PDP (`503`)** | Si el motor PDP devuelve `5xx` o supera el timeout, el PEP responde `503 Service Unavailable` y la aplicación bloquea el acceso (jamás permite paso por defecto). |
| **`PI-07`** | **Revocación efectiva en `<= 300 segundos`** | Al suspender una cuenta o revocar un rol, el acceso queda bloqueado en `< 5 s` (camino nominal vía Pub/Sub → Redis) y nunca después de **`300 segundos`** (camino degradado por TTL duro de Redis). |
| **`PI-08`** | **Normalización y rechazo de rutas ambiguas (`400 Bad Request`)** | Peticiones con rutas ambiguas (`%2F`, `..`, doble codificación o `%00`) son rechazadas con `HTTP 400 Bad Request` y registradas en auditoría. |

---

## 7. Auditoría y Trazabilidad (`RF-AUD` — 9 Requerimientos)

| Código | Subcomp. | Prioridad | Nombre Oficial | Especificación Funcional (`C2-49` v0.4) |
| :--- | :---: | :---: | :--- | :--- |
| **`RF-AUD-01`** | `C2.2·C2.3` | Alta | **Registro de eventos de autenticación y autorización** | Registrar cada inicio/cierre de sesión, intento fallido y decisión de autorización (`POST /api/v1/access/evaluation`) con fecha/hora UTC, `request_id` / `traceparent`, `numero_identificacion`, `email`, `ip_origen`, aplicación, ruta, método y resultado. |
| **`RF-AUD-02`** | `C2.2` | Alta | **Registro de cambios administrativos** | Auditar toda creación, modificación o eliminación en la consola o API PAP (aplicaciones, rutas, roles, permisos, asignaciones, publicaciones, transiciones `CODIGO_MINEDEC` → `CEDULA`), guardando el actor, motivo, **valor anterior y valor nuevo**. |
| **`RF-AUD-03`** | `C2.2` | Alta | **Conservación y retención de registros de auditoría** | Conservar los registros de auditoría en línea y en almacenamiento frío conforme a los plazos institucionales y legales (`D-12`: 1 año en línea y 5 a 7 años en archivo frío WORM). |
| **`RF-AUD-04`** | `C2.2` | Alta | **Inmutabilidad de los registros de auditoría** | Impedir la alteración o eliminación de pistas de auditoría mediante permisos exclusivos `INSERT/SELECT` en AlloyDB con encadenamiento **SHA-256**, BigQuery `append-only` y archivo WORM bloqueado en Cloud Storage. |
| **`RF-AUD-05`** | `C2.2` | Media | **Consulta y filtrado de auditoría en consola** | Permitir a Superadministradores y **Auditores** buscar y filtrar eventos por rango de fechas, número de identificación, correo, aplicación, tipo de evento y resultado. |
| **`RF-AUD-06`** | `C2.2` | Media | **Exportación de reportes de auditoría** | Permitir exportar consultas de auditoría desde la consola en formatos estándar (CSV / JSON) dejando traza de quién realizó la exportación. |
| **`RF-AUD-07`** | `C2.2` | Media | **Reportes de cumplimiento y recertificación de accesos** | Generar reportes de usuarios con roles privilegiados, cuentas externas próximas a vencer y asignaciones activas por aplicación/jurisdicción para revisiones periódicas de Seguridad Informática. |
| **`RF-AUD-08`** | `C2.2` | Alta | **Integración con plataforma SIEM** | Emitir todos los eventos de seguridad y auditoría en formato JSON estructurado hacia **Cloud Logging / Cloud Pub/Sub** para su ingesta en tiempo real por el SIEM institucional (`D-13`). |
| **`RF-AUD-09`** | `C2.2` | Alta | **Alertamiento ante eventos de seguridad y riesgo** | Generar alertas automáticas ante patrones anómalos: múltiples intentos fallidos de autenticación/autorización, accesos desde ubicaciones inusuales, cambios de privilegios fuera de ventana autorizada, fallos de validación anti-destrucción o desactivación de MFA. |

---

## 8. Documentos Relacionados

- [Requerimientos No Funcionales y Controles de Ciberseguridad (`C2-49` v0.4)](requerimientos-no-funcionales-c22.md)
- [Matriz de Brechas, Decisiones y Riesgos Arquitectónicos](../vision-general/brechas-y-decisiones.md)
- [Contrato Formal de Autorización PEP–PDP](../arquitectura/contrato-autorizacion-pep-pdp.md)
- [Modelo de Autorización Híbrido RBAC + ABAC](../dominio/modelo-autorizacion-rbac-abac.md)
