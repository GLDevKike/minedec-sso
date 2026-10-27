---
type: Decision Matrix
title: Matriz de Brechas, Decisiones Arquitectónicas y Riesgos Técnicos (D-01 a D-21, DA-01 a DA-11, BR-01 a BR-20 y R-01 a R-07)
description: Registro canónico de decisiones cerradas, decisiones arquitectónicas (DA-01..DA-11), decisiones pendientes (D-02..D-21), brechas (BR-01..BR-20) y riesgos técnicos (R-01..R-07) según C2-49 v0.4, C2-50 v0.1 y DA-11.
tags:
  - decisiones
  - brechas
  - riesgos
  - d-01
  - da-01
  - da-11
  - br-01
  - r-01
  - arquitectura
  - c2.2
timestamp: 2026-10-21T23:40:00Z
---

# Matriz de Brechas, Decisiones Arquitectónicas y Riesgos Técnicos (`C2-49` v0.4, `C2-50` v0.1 y `DA-11`)

Este documento consolida el catálogo oficial de decisiones resueltas, decisiones arquitectónicas (`DA-01` a `DA-11`), decisiones pendientes de confirmación institucional (`D-02` a `D-21`), brechas (`BR-01` a `BR-20`) y riesgos técnicos (`R-01` a `R-07`) extraídos de `knowledge/fuentes-oficiales/C2-49 Documento de Análisis Funcional.pdf` (v0.4), `knowledge/fuentes-oficiales/C2-50 Documento de Arquitectura.pdf` (v0.1) y `docs/decisiones/DA-11-intermediario-oidc.md`.

---

## 1. Decisiones Arquitectónicas Resueltas (`C2-49` Sección 5.1)

| Código | Tema | Estado | Decisión Adoptada e Impacto en C2.2 |
| :--- | :--- | :--- | :--- |
| **`D-01` / `BR-09`** | Integración con Active Directory (`educacion.gob.ec` / M365) | **Resuelta (22/09/2026)** | **Descartada.** No se sincroniza ni federa Active Directory con el SSO porque GCDS es unidireccional y generaría doble contraseña. Google Cloud Identity / Workspace es el único IdP para usuarios internos. AD queda solo para login de estaciones Windows. |
| **`BR-06`** | Base de datos del Sistema de Autenticación Centralizado SSO | **Resuelta** | El sistema cuenta con su propia base de datos independiente (**AlloyDB for PostgreSQL 16**) como repositorio primario de permisos, contexto y auditoría, sin compartir esquemas de aplicaciones legadas. |
| **`BR-05`** | Nivel de granularidad de permisos | **Resuelta** | Se adopta un **modelo flexible por aplicación** que soporta tanto roles simples como permisos atómicos, perfiles, grupos lógicos y reglas ABAC contextuales. |
| **`D-04`** | Construcción del Sistema de Autenticación Centralizado SSO | **Resuelta** | **Desarrollo a medida sobre Google Cloud** (GKE Autopilot para PDP/PAP/SPA/PIP, Cloud Run Service/Jobs para sincronización y publicación, AlloyDB for PostgreSQL 16 y Memorystore for Redis). |
| **`D-05`** | Multi-institución sin dimensión «sede» | **Resuelta** | Se elimina la dimensión fija «sede» del modelo de autorización (`RF-GI-13`). El alcance territorial se expresa mediante atributos (`amie_titular`, `amies_asignados`, `nivel_jurisdiccion`, `codigo_jurisdiccion`, `zona`, `distrito`). |

---

## 2. Decisiones de Arquitectura del Subcomponente C2.2 (`DA-01` a `DA-11` — `C2-50` Sección 11.1 y `DA-11`)

| Código | Decisión de Arquitectura | Sustento y Materialización en C2.2 |
| :--- | :--- | :--- |
| **`DA-01`** | **Google Cloud Identity como único IdP interno** | Alinea `D-01`; elimina federación con Active Directory y delega autenticación primaria, MFA y Acceso Contextual a Google Cloud Identity. |
| **`DA-02`** | **Separación estricta entre IdP y motor de autorización (PDP)** | Google responde *quién es el usuario*; el Sistema de Autenticación Centralizado SSO (`POST /api/v1/access/evaluation`) decide *qué puede hacer y en qué ámbito*. Los roles jamás viajan en el token de Google. |
| **`DA-03`** | **Doble patrón de integración (Patrón 1 Nativo y Patrón 2 Perimetral PEP)** | Permite integrar tanto aplicaciones modernas con código accesible (mediante el paquete estándar SP/RP) como aplicaciones legadas sin tocar su código (mediante PEP perimetral en Apigee X o Envoy Gateway + IAP). |
| **`DA-04`** | **AlloyDB for PostgreSQL 16 como repositorio primario (PIP)** | Provee alta disponibilidad regional, baja latencia transaccional e integridad relacional para identidades, catálogo de aplicaciones, reglas RBAC/ABAC y auditoría inmutable. |
| **`DA-05`** | **Sincronización local de identidades en modo solo lectura** | Garantiza cero llamadas a Google Admin SDK en el camino crítico de login/autorización y respeta el límite del 70% de cuota (`<= 28 req/s`) mediante Cloud Logging Sink → Pub/Sub → Cloud Tasks → Cloud Run y Cloud Run Jobs nocturnos. |
| **`DA-06`** | **Caché L2 en Memorystore for Redis con `TTL <= 300 s` e invalidación por eventos** | Acelera la evaluación de autorización y garantiza como techo duro absoluto que cualquier revocación o suspensión surta efecto en `<= 300 segundos` (`< 5 s` en camino nominal vía Pub/Sub). |
| **`DA-07`** | **Aserción de contexto firmada (`X-Minedec-Assertion` con `RS256`)** | Impide la suplantación o alteración de las cabeceras `X-Minedec-*` en tránsito hacia los backends del Patrón 2 mediante un JWT firmado con clave privada RSA (vigencia de 60 s y `aud = uuid_aplicacion`). |
| **`DA-08`** | **Grupos lógicos dinámicos para la población estudiantil (~2,1 millones)** | Evita insertar millones de filas en tablas de asignación de roles (`usuario_rol_aplicacion`), evaluando en memoria los atributos académicos y territoriales de los estudiantes. |
| **`DA-09`** | **Publicación de aplicaciones gobernada por Infrastructure Manager (`sa-publicador`)** | Desacopla la consola web de la modificación directa de infraestructura GCP; `sa-publicador` ejecuta despliegues secuenciales con bloqueo consultivo (`pg_try_advisory_lock`) y validación anti-destrucción sobre el Preview de Terraform. |
| **`DA-10`** | **Comportamiento `fail-close` ante fallo del motor de autorización** | Si el PDP no responde o devuelve error `5xx`, tanto el PEP perimetral (`503 Service Unavailable`) como el paquete estándar SP/RP deniegan el acceso sin excepción (`RNF-SEG-10`). |
| **`DA-11`** | **El SSO como intermediario OIDC (*Identity Broker*) mediante `sso-oidc` (`oidc-provider`)** | Evita los límites no ampliables de clientes OAuth 2.0 en Google Cloud (~100 clientes/proyecto, 100 `redirect_uris`/cliente, 10 dominios/proyecto, borrado por inactividad a los 6 meses y ausencia de API/Terraform) y evita compartir un mismo `client_id` entre aplicaciones. Solo `sso-oidc` tiene **1 cliente OAuth 2.0 en Google Cloud**; cada aplicación del Patrón 1 y el PEP del Patrón 2 se registran como clientes OIDC en AlloyDB y reciben ID Tokens (`RS256`) con `aud` exclusivo por aplicación, habilitando además sesión central en Redis y cierre de sesión único (`GET/POST /logout`). |

---

## 3. Decisiones Pendientes de Confirmación Institucional (`D-02` a `D-21` — `C2-49` §5.2 y `C2-50` Tabla 19)

> [!NOTE]
> Para no bloquear el desarrollo del Subcomponente C2.2, todas las decisiones pendientes se implementan mediante **tablas de configuración en AlloyDB, variables de entorno o adaptadores desacoplados (`Strategy/Adapter`)**.

| Código | Brecha Asociada | Decisión Pendiente | Opciones / Propuesta Recomendada | Cómo lo soporta C2.2 sin retrabajo |
| :--- | :--- | :--- | :--- | :--- |
| **`D-02`** | `BR-01` | Mecanismo de autenticación para **Usuarios Externos** (~76.000 ciudadanos por convocatoria y representantes legales) | 1. **Google Cloud Identity Platform (CIAM)** *(recomendado en `C2-50`)*.<br>2. Cloud Identity Free.<br>3. Repositorio local en el SSO. | Adaptador desacoplado (`ExternalIdentityProviderAdapter`) que resuelve siempre al usuario externo por `(tipo_identificacion, numero_identificacion)` sin consumir licencias de Google Workspace (`RF-AUT-13`). |
| **`D-03`** | `BR-02` | Alternativa tecnológica definitiva del **PEP Perimetral (Patrón 2)** | • **Alternativa 1 (Recomendada)**: Apigee X.<br>• **Alternativa 2 (Evolutiva)**: GKE Gateway API (Envoy + Cloud IAP + `ext_authz`). | El contrato `POST /api/v1/access/evaluation`, las 11 cabeceras `X-Minedec-*` y las plantillas de `sa-publicador` soportan ambas alternativas sin cambios en el motor PDP. |
| **`D-06`** | `BR-16` | Acuerdos de Nivel de Servicio (**SLA, RTO, RPO**) y umbrales de rendimiento | Propuesta en `C2-49`: disponibilidad `99,5%` en horario hábil (`99,9%` objetivo de arquitectura en `C2-50`), `RTO <= 4 h`, `RPO <= 1 h` y respuesta ágil sin degradación. | Clúster GKE Autopilot Regional HA, AlloyDB HA Regional con PITR, Memorystore Redis HA y umbrales de alerta parametrizables en Cloud Monitoring. |
| **`D-07`** | `BR-17` | Alcance y obligatoriedad de **MFA (2SV)** para docentes y estudiantes | Obligatorio confirmado para administrativos, directivos y administradores de consola (`RF-AUT-07`, `RF-AUT-08`). Pendiente gradualidad para docentes y estudiantes (en la Matriz GWS se exige en Bachillerato). | La política de MFA se gobierna por Unidad Organizativa (`orgUnitPath`) en Google Workspace y el PDP recibe la señal contextual sin acoplarse a reglas fijas en código. |
| **`D-10`** | `BR-10` | Fuente autoritativa de cargos, establecimientos AMIE y asignaciones territoriales | Sistema de Talento Humano / Distributivo (API, vistas o carga controlada) vs carga administrativa en consola. | Soportar tanto endpoints/jobs de ingesta hacia `asignacion_contexto` como gestión administrativa en la Consola Web con auditoría completa. |
| **`D-11`** | `BR-11` | Alcance del **Cierre de Sesión Único (SLO)** | Cierre de sesión central en el intermediario OIDC (`sso-oidc` `GET/POST /logout`) + avisos Front-Channel/Back-Channel a las aplicaciones y expiración corta en caché (`<= 300 s`), sin cerrar obligatoriamente la cuenta de Google/Gmail del usuario (parametrizable). | Gracias a `DA-11`, `sso-oidc` mantiene la sesión central del SSO en Redis y expone `GET/POST /logout`, permitiendo invalidar la sesión del SSO, notificar a las aplicaciones y purgar Redis (`RF-AUT-06`), parametrizando si se redirige o no al logout global de Google. |
| **`D-12`** | `BR-12` | Periodo de retención de logs de auditoría en línea y en archivo frío | Propuesta recomendada: **1 año en línea** (AlloyDB / BigQuery / Cloud Logging) y **5 a 7 años en archivo frío inmutable** (Cloud Storage WORM). | Retención configurable por variables de Terraform en los buckets WORM de Cloud Storage, particiones de BigQuery y mantenimiento de AlloyDB (`RF-AUD-03`). |
| **`D-13`** | `BR-13` | Herramienta **SIEM** institucional y mecanismo de integración | Exportación vía **Cloud Logging Sink → Cloud Pub/Sub** (JSON estructurado) o colector Syslog/HTTPS. | Todos los eventos de auditoría se emiten en formato JSON estructurado listos para enrutar mediante Log Sink a Pub/Sub o BigQuery (`RF-AUD-08`). |
| **`D-14`** | `BR-14` | Flujo de acreditación de **Representantes Legales de organizaciones externas (RUC)** | Validación contra fuente externa (SRI / Superintendencia), aprobación por analista ministerial o carga controlada. | Modelo de datos con tabla `vinculacion_organizacion_ruc` donde la persona natural (`CEDULA`) actúa en contexto de un `RUC` con estado y vigencia (`RF-UEX-02`, `RF-UEX-08`). |
| **`D-15`** | `BR-15` | Flujo de alta y actualización de **Usuarios Externos** | Autoservicio con validación de identidad vs alta desde las aplicaciones de negocio del Ministerio. | API y flujo de registro desacoplados que validan `CEDULA` (Módulo 10) o `PASAPORTE` y notifican al usuario (`RF-UEX-04` a `RF-UEX-07`). |
| **`D-16`** | `BR-07` | Selección oficial de las **2 aplicaciones existentes del Subcomponente C2.3** | Pendiente de acta formal del MINEDEC (fuera del alcance de código de este repositorio C2.2). | El catálogo de aplicaciones de C2.2 permite registrar cualquier aplicación en Patrón 1 o Patrón 2 desde la consola web. |
| **`D-17`** | `BR-19` | Ubicación física de las aplicaciones C2.3 y dimensionamiento de **conectividad híbrida** | HA VPN vs Dedicated/Partner Interconnect redundante (`99,99%`, `RNF-DIS-05`) y rangos CIDR sin traslape. | Direccionamiento IP, subredes y endpoints de Hybrid NEG 100% parametrizados en variables de Terraform e inyectados desde el catálogo (`apps.auto.tfvars.json`). |
| **`D-18`** | `BR-07` | Patrón de integración (`Patrón 1` o `Patrón 2`) asignado a cada una de las 2 aplicaciones C2.3 | Se define por aplicación tras levantar su ficha técnica (`C2-59`). | Conecta MINEDEC soporta ambos patrones simultáneamente sobre el mismo endpoint `POST /api/v1/access/evaluation`. |
| **`D-19`** | `BR-07` | Estrategia de migración de usuarios y roles históricos de las 2 aplicaciones C2.3 | Cruce por `numero_identificacion` (`CEDULA`) y carga inicial de roles hacia AlloyDB. | Herramientas de carga controlada de asignaciones y buscador/reconciliación por `numero_identificacion` en la API PAP. |
| **`D-20`** | `BR-07` | Ventana de corte (*cutover*) y plan de reversión de las 2 aplicaciones C2.3 | Ejecución gradual mediante estados `PUBLICADA_PILOTO` → `CORTE_REALIZADO` con rollback por DNS/configuración. | Máquina de estados completa en la consola y en `sa-publicador`. |
| **`D-21`** | `BR-08` / `BR-20` | Dominios definitivos de Google Workspace para Docentes y Administrativos y topología de tenants | • Estudiantes: `estudiante.edu.ec` (confirmado).<br>• Docentes y Administrativos: `[POR CONFIRMAR]`. | Prohibido quemar dominios en código; se leen dinámicamente de la tabla `catalogo_dominio_gws` en AlloyDB (`RF-GI-03`). Si existen tenants separados (`BR-20`), se parametriza una cuenta `sa-workspace-reader` por tenant. |

*(Nota: En la numeración histórica de `C2-49` v0.4 no existen los códigos `D-08` ni `D-09`, pasando directamente de `D-07` a `D-10`; las brechas `BR-03` y `BR-04` fueron absorbidas en la arquitectura y `BR-18` documenta la extensión de `CODIGO_MINEDEC` para las carteras de Deporte y Cultura en `RF-GI-15`).*

---

## 4. Riesgos Técnicos y Controles de Mitigación (`R-01` a `R-07` — `C2-50` Sección 11.2)

| Código | Riesgo Técnico Identificado | Nivel | Mitigación Arquitectónica en C2.2 |
| :--- | :--- | :---: | :--- |
| **`R-01`** | Latencia o indisponibilidad del motor de autorización (PDP) afectando el tráfico de las aplicaciones | Alto | Despliegue multi-zona en **GKE Autopilot Regional** con HPA, **AlloyDB HA**, caché **Memorystore for Redis HA** (`TTL <= 300 s`) y caché breve en el paquete SP/RP. |
| **`R-02`** | Agotamiento de cuotas de **Google Admin SDK Directory API** (`2.400 req/min`) durante picos de matrícula o inicio de clases | Alto | **Cero llamadas a Google en el camino crítico** de login/autorización + gobernador en **Cloud Tasks / Redis (`<= 28 req/s`, 70% de cuota)** + conmutación a lote (`users.list` de 500 usuarios) + backoff exponencial con jitter. |
| **`R-03`** | Suplantación de identidad o inyección de cabeceras `X-Minedec-*` desde clientes externos hacia aplicaciones del Patrón 2 | Crítico | El PEP **elimina (`strip`) toda cabecera entrante `X-Minedec-*`**, inyecta cabeceras limpias con `X-Minedec-Assertion` firmada con **`RS256` (`exp = 60 s`, `aud = uuid_aplicacion`)** y el firewall del backend solo acepta tráfico desde la subred `proxy-only` del PEP (`RNF-SEG-09`, `PI-03`). |
| **`R-04`** | Condiciones de carrera o destrucción accidental de infraestructura al publicar aplicaciones desde la consola web | Alto | Ejecución secuencial exclusiva mediante **bloqueo consultivo en AlloyDB (`pg_try_advisory_lock`)** en `sa-publicador`, vista previa obligatoria (`Preview`) en Infrastructure Manager y **regla anti-destrucción** que aborta cualquier borrado fuera de un flujo explícito de despublicación. |
| **`R-05`** | Evasión de reglas de autorización por rutas ambiguas, *path traversal* (`..`) o doble codificación URL (`%2F`) | Alto | Tubería obligatoria de **normalización de rutas** antes de evaluar el catálogo y rechazo inmediato con **`HTTP 400 Bad Request`** ante cualquier ruta ambigua (`RF-AUZ-17`, `PI-08`). |
| **`R-06`** | Pérdida de trazabilidad histórica cuando un estudiante menor de edad o extranjero cambia de `CODIGO_MINEDEC` a `CEDULA` | Medio | Clave primaria técnica inmutable `id_interno (UUID v4)` en `persona_identidad` + procedimiento transaccional 1 a 1 que actualiza la identificación a `CEDULA` preservando `codigo_minedec_anterior` y el 100% de roles y auditoría (`RF-GI-15`). |
| **`R-07`** | Demora en la revocación efectiva de accesos ante desvinculación o suspensión de cuenta en Google Workspace | Alto | Purga inmediata de Redis disparada por eventos de auditoría vía **Cloud Pub/Sub** (`< 5 s` en camino nominal) y **techo duro absoluto `<= 300 s`** garantizado por el TTL de Redis (`RF-GI-06`, `PI-07`). |

---

## 5. Documentos Relacionados

- [Alcance y Visión Estratégica del Sistema de Autenticación Centralizado SSO (C2.2)](alcance-conecta-minedec-c22.md)
- [Catálogo de Requerimientos Funcionales (`C2-49` v0.4)](../requerimientos/requerimientos-funcionales-c22.md)
- [Requerimientos No Funcionales y Controles de Ciberseguridad (`C2-49` v0.4)](../requerimientos/requerimientos-no-funcionales-c22.md)
- [Sincronización de Identidades y Protección de Cuotas](../arquitectura/sincronizacion-identidades-cuotas.md)
