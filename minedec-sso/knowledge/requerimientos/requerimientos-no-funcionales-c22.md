---
type: Non-Functional Specification
title: Catálogo Oficial de Requerimientos No Funcionales (C2-49 v0.4 — 42 RNF) y Controles DevSecOps
description: Define los 42 requerimientos no funcionales oficiales de C2-49 v0.4 (RNF-SEG, RNF-REN, RNF-DIS, RNF-MAN, RNF-USA, RNF-INT), la eliminación de umbrales fijos en milisegundos (sujetos a D-06), el techo duro de revocación <= 300 s y los controles de la Constitución v2.8.0.
tags:
  - rnf
  - c2-49
  - rendimiento
  - disponibilidad
  - ciberseguridad
  - devsecops
  - egsi-v2
  - lopdp
timestamp: 2026-10-21T14:48:00Z
---

# Catálogo Oficial de Requerimientos No Funcionales (`C2-49` v0.4 — 42 RNF) y Controles DevSecOps

Este documento consolida los **42 Requerimientos No Funcionales (`RNF-*`)** vigentes en `knowledge/fuentes-oficiales/C2-49 Documento de Análisis Funcional.pdf` (**v0.4 — 15/10/2026**) junto con los controles de arquitectura de `C2-50 Documento de Arquitectura.pdf` (**v0.1**) y la **Constitución del Proyecto (`v2.8.0`)**.

---

## 1. Seguridad y Cumplimiento Normativo (`RNF-SEG-01` a `RNF-SEG-10` — 10 RNF)

| Código | Nombre Oficial (`C2-49` v0.4) | Especificación y Materialización en C2.2 |
| :--- | :--- | :--- |
| **`RNF-SEG-01`** | **Cifrado en tránsito (TLS 1.2 / TLS 1.3)** | Todo tráfico externo e interno utiliza obligatoriamente **TLS 1.2 o TLS 1.3**, deshabilitando TLS 1.0/1.1 y suites débiles (3DES/SWEET32). |
| **`RNF-SEG-02`** | **Cifrado en reposo (AES-256)** | Todos los datos en AlloyDB, Memorystore for Redis, Cloud Storage, Secret Manager y BigQuery se almacenan cifrados en reposo con **AES-256**. |
| **`RNF-SEG-03`** | **Gestión segura de secretos y claves criptográficas** | Cero secretos en código, `.tfvars` o imágenes Docker. El 100% de secretos y llaves RSA (`RS256`) reside en **Google Secret Manager** con rotación periódica `<= 90 días` y ventana de gracia dual. Los `client_secret` M2M se persisten en AlloyDB solo como hash **SHA-256 (`CHAR(64)`)**. |
| **`RNF-SEG-04`** | **Protección contra vulnerabilidades web (OWASP Top 10)** | Validación estricta de esquemas con `Zod`, consultas SQL 100% parametrizadas (`$1, $2`), listas blancas para identificadores SQL (`pg-format` `%I`), cabeceras HTTP seguras (`HSTS`, `CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`), prohibición de `localStorage` para tokens y WAF **Google Cloud Armor** con reglas OWASP ModSecurity CRS. |
| **`RNF-SEG-05`** | **Cumplimiento de la LOPDP (Protección de Datos Personales)** | Aplicación de los principios de minimización, finalidad, confidencialidad y trazabilidad de datos personales de la **LOPDP**, incluyendo protección reforzada de datos de estudiantes menores de edad (`representanteLegalCedula`). |
| **`RNF-SEG-06`** | **Cumplimiento del EGSI v2** | Alineación integral con los controles de control de acceso, criptografía, registro de eventos y seguridad en las operaciones del **Esquema Gubernamental de Seguridad de la Información (EGSI v2)**. |
| **`RNF-SEG-07`** | **Principio de mínimo privilegio y segregación de funciones** | Segregación en **10 cuentas de servicio IAM dedicadas** sin llaves JSON estáticas (`Workload Identity` y `signJwt` sobre `sa-workspace-reader`), y separación estricta en consola entre *Superadministrador*, *Administrador de Aplicativo* y *Auditor*. |
| **`RNF-SEG-08`** | **Pruebas de seguridad y remediación de vulnerabilidades** | Ejecución obligatoria de análisis estático (**SAST**), análisis de composición de software (**SCA** sin vulnerabilidades críticas/altas abiertas), detección de secretos (**Gitleaks**) y pruebas dinámicas (**DAST / Ethical Hacking**) previas al paso a producción. |
| **`RNF-SEG-09`** | **Cierre de red de las aplicaciones integradas perimetralmente (Patrón 2)** | Los servidores backend de las aplicaciones del Patrón 2 deben cerrar el acceso directo desde Internet o redes no autorizadas y **aceptar tráfico exclusivamente desde el rango IP de la subred `proxy-only` del PEP perimetral**, impidiendo saltar el control de autorización o inyectar cabeceras `X-Minedec-*` falsas (`R-03`, `PI-03`). |
| **`RNF-SEG-10`** | **Comportamiento seguro ante falla del servicio de autorización (`Fail-Close`)** | Si el motor de autorización (PDP) no responde, devuelve error `5xx` o supera el tiempo de espera, **tanto el PEP perimetral como el paquete estándar SP/RP deben denegar el acceso por defecto (`HTTP 503 Service Unavailable`)**. Jamás se permite acceso en modo abierto (`DA-10`, `PI-06`). |

---

## 2. Rendimiento, Respuesta Ágil y Escalabilidad (`RNF-REN-01` a `RNF-REN-08` — 8 RNF)

> [!IMPORTANT]
> **Eliminación de métricas fijas en milisegundos (`C2-49` v0.4)**: En la versión 0.4 de `C2-49 Documento de Análisis Funcional.pdf` se retiraron de los RNF los umbrales fijos en milisegundos (`< 300 ms`, `< 50 ms`, `< 1,5 s`, `< 2 s`) que figuraban en borradores previos. El requerimiento oficial exige que los servicios respondan de manera **ágil y sin degradación perceptible para el usuario** bajo los objetivos de nivel de servicio que confirme el Ministerio en la decisión **`D-06`**. En consecuencia, las respuestas JSON de las APIs no incluyen campos calculados de latencia por petición (`latenciaTotalMs` / `latenciaMs`), evitando sobrecarga innecesaria en el runtime de Node.js y delegando la telemetría agregada a Google Cloud Monitoring / OpenTelemetry.

| Código | Nombre Oficial (`C2-49` v0.4) | Estrategia Arquitectónica en C2.2 |
| :--- | :--- | :--- |
| **`RNF-REN-01`** | **Tiempo de respuesta en el inicio de sesión único (SSO)** | Respuesta ágil en la autenticación federada delegando el flujo OIDC/SAML directamente en Google Cloud Identity sin consultas síncronas bloqueantes (`D-06`). |
| **`RNF-REN-02`** | **Tiempo de respuesta en la evaluación de autorización (`/api/v1/access/evaluation`)** | Evaluación en muy baja latencia respaldada por la caché L2 en **Memorystore for Redis** (`TTL <= 300 s`), precompilación de grupos lógicos en memoria e índices compuestos en AlloyDB (`D-06`). |
| **`RNF-REN-03`** | **Tiempo de respuesta en la Consola Web de Administración** | Consultas paginadas en la API PAP, índices B-Tree en AlloyDB y entrega optimizada de activos estáticos de la SPA (`D-06`). |
| **`RNF-REN-04`** | **Capacidad de concurrencia y atención de picos de demanda** | Atención fluida de picos masivos de operación institucional (inicio de clases, matrículas, cierre de quimestre y convocatorias externas) para la población de ~2,28M de usuarios internos y ~76k externos. |
| **`RNF-REN-05`** | **Protección y respeto de cuotas de las APIs de Google Workspace** | **Cero llamadas a Google Admin SDK en el camino crítico** de login/autorización + regulación estricta al **70% de la cuota (`<= 28 req/s`)** mediante Cloud Tasks y gobernador distribuido en Redis (`R-02`). |
| **`RNF-REN-06`** | **Eficiencia de la caché de autorización** | Uso de Memorystore for Redis como capa L2 con claves por identidad (`pip:id:*`) y por aplicación, combinando alta tasa de aciertos con invalidación por eventos en `< 5 s` y techo duro de `TTL <= 300 s`. |
| **`RNF-REN-07`** | **Escalabilidad horizontal automática** | Escalado horizontal automático (**HPA**) de los pods *stateless* en GKE Autopilot (PDP, PAP, SPA, PIP) y escalado sin servidor en Cloud Run (`sa-sync`, `sa-catalogo`). |
| **`RNF-REN-08`** | **Desempeño en procesos masivos de carga y conciliación** | Ejecución en segundo plano fuera de horario pico mediante **Cloud Run Jobs** (`sa-sync-job`) particionados por dominio y `orgUnitPath` con páginas de 500 usuarios (`users.list`) y `pageToken` persistido en AlloyDB, sin impactar el rendimiento del motor PDP. |

---

## 3. Disponibilidad, Continuidad y Conectividad Híbrida (`RNF-DIS-01` a `RNF-DIS-05` — 5 RNF)

| Código | Nombre Oficial (`C2-49` v0.4) | Especificación e Implementación en C2.2 |
| :--- | :--- | :--- |
| **`RNF-DIS-01`** | **Nivel de disponibilidad del servicio (SLA)** | Propuesta de **`99,5%` mensual en horario hábil** en `C2-49` (y arquitectura diseñada para soportar hasta **`99,9%`** en `C2-50`), sujeta a confirmación formal en la decisión **`D-06`**, mediante despliegue multi-zona en GKE Autopilot Regional, AlloyDB HA Regional y Memorystore Redis HA. |
| **`RNF-DIS-02`** | **Objetivo de Tiempo de Recuperación (`RTO`)** | Propuesta de **`<= 4 horas`** ante contingencia mayor (sujeta a **`D-06`**), respaldada por infraestructura 100% declarativa en Terraform gestionada por Infrastructure Manager. |
| **`RNF-DIS-03`** | **Objetivo de Punto de Recuperación (`RPO`)** | Propuesta de **`<= 1 hora`** (sujeta a **`D-06`**), respaldada por copias de seguridad continuas y recuperación a un punto en el tiempo (**PITR**) en AlloyDB for PostgreSQL 16. |
| **`RNF-DIS-04`** | **Continuidad operativa durante despliegues y cambios de políticas** | Actualizaciones de software mediante `RollingUpdate` con `PodDisruptionBudget` y sondas `readiness/liveness`, y actualización de reglas RBAC/ABAC y catálogo de aplicaciones en caliente sin interrumpir el servicio. |
| **`RNF-DIS-05`** | **Alta disponibilidad y segregación de la conectividad híbrida** | La conectividad privada entre Google Cloud y el centro de datos donde residan las aplicaciones on-premise (Cloud Interconnect o HA VPN) debe configurarse con **redundancia de alta disponibilidad (`99,99%`)** y mantener **enlaces/túneles independientes entre los ambientes de producción (`prod`) y preproducción (`nonprod`)** (`D-17`, `BR-19`). |

---

## 4. Mantenibilidad y Operación (`RNF-MAN-01` a `RNF-MAN-08` — 8 RNF)

| Código | Nombre Oficial (`C2-49` v0.4) | Materialización en C2.2 |
| :--- | :--- | :--- |
| **`RNF-MAN-01`** | **Arquitectura modular y desacoplada** | Arquitectura Hexagonal + principios SOLID + paquete compartido `@minedec/shared` (`c2-sso/microservicios/shared`) + Inyección de Dependencias con `InversifyJS` confinada al Composition Root. |
| **`RNF-MAN-02`** | **Parametrización sin cambios de código** | Dominios de Workspace (`D-21`), reglas por aplicación, vigencias y catálogos administrables en base de datos / variables de entorno sin recompilar. |
| **`RNF-MAN-03`** | **Observabilidad, monitoreo y alertas operativas** | Logs estructurados en JSON (`pino`) hacia Cloud Logging y métricas e indicadores en Cloud Monitoring con alertas proactivas. |
| **`RNF-MAN-04`** | **Trazabilidad distribuida extremo a extremo** | Correlación de peticiones entre PEP, GKE (PDP/PAP/PIP) y Cloud Run mediante cabeceras **`W3C traceparent`**, `X-Cloud-Trace-Context` y `X-Minedec-Request-Id`. |
| **`RNF-MAN-05`** | **Automatización de pruebas y calidad de código** | Suite automatizada con **Jest + Supertest** (cobertura `>= 70%`), **Playwright** para E2E de consola y las **8 pruebas de conformidad (`PI-01` a `PI-08`)**. |
| **`RNF-MAN-06`** | **Despliegue automatizado e Infraestructura como Código (IaC)** | Pipeline CI/CD en **GitLab CI/CD** (`.gitlab-ci.yml`) para repositorios de código (`c2-sso/microservicios/*`) e **Infrastructure Manager** con **Terraform `1.5.7`** en repositorio separado (`c2-sso/devops/iac-terraform`). |
| **`RNF-MAN-07`** | **Separación de ambientes (`dev`, `qa/staging`, `prod`)** | Aislamiento estricto de proyectos, credenciales, bases de datos y redes entre ambientes no productivos y producción. |
| **`RNF-MAN-08`** | **Documentación técnica, contratos OpenAPI y transferencia** | Contratos **OpenAPI 3.1** actualizados, guía de integración del paquete estándar SP/RP, runbooks operativos y base de conocimiento en formato OKF (`knowledge/`). |

---

## 5. Usabilidad y Accesibilidad (`RNF-USA-01` a `RNF-USA-06` — 6 RNF)

| Código | Nombre Oficial (`C2-49` v0.4) | Materialización en C2.2 |
| :--- | :--- | :--- |
| **`RNF-USA-01`** | **Idioma español e identidad visual institucional** | Todas las pantallas, mensajes de error y reportes de la Consola Web SPA se presentan íntegramente en **español** siguiendo el sistema de diseño institucional (`frontend/DESIGN.md`). |
| **`RNF-USA-02`** | **Diseño responsivo y compatibilidad de navegadores** | Interfaz adaptable a escritorio, portátil y tableta en las versiones vigentes de Chrome, Edge, Firefox y Safari. |
| **`RNF-USA-03`** | **Accesibilidad web (WCAG 2.1 Nivel AA)** | Contraste tipográfico, navegación por teclado, etiquetas ARIA y semántica HTML conforme a **WCAG 2.1 Nivel AA**. |
| **`RNF-USA-04`** | **Mensajes claros orientados a la acción** | Cuando se deniega un acceso o falla una validación, informar claramente la causa funcional o el código de correlación (`X-Minedec-Request-Id`) sin exponer trazas internas ni detalles de infraestructura. |
| **`RNF-USA-05`** | **Prevención de errores en operaciones críticas de consola** | Exigir confirmación explícita, vista previa del cambio (`Preview`) y motivo de auditoría antes de suspender aplicaciones, revocar accesos masivos o publicar cambios perimetrales. |
| **`RNF-USA-06`** | **Transparencia en la experiencia de redirección SSO** | Minimizar pasos innecesarios durante el inicio de sesión federado para que el usuario llegue directamente a la aplicación solicitada tras autenticarse. |

---

## 6. Interoperabilidad y Estándares Abiertos (`RNF-INT-01` a `RNF-INT-05` — 5 RNF)

| Código | Nombre Oficial (`C2-49` v0.4) | Materialización en C2.2 |
| :--- | :--- | :--- |
| **`RNF-INT-01`** | **Adhesión a estándares abiertos de identidad (`OIDC`, `OAuth 2.0`, `SAML 2.0`, `JWT/JWKS`)** | Uso exclusivo de estándares IETF/OASIS (`RFC 6749`, `RFC 7636 PKCE`, `RFC 7517 JWKS`, `RFC 7519 JWT`, `OIDC Core 1.0`, `SAML 2.0`) sin protocolos propietarios cerrados. |
| **`RNF-INT-02`** | **Independencia de lenguaje y tecnología de las aplicaciones clientes** | El contrato HTTP/JSON (`POST /api/v1/access/evaluation`) y las cabeceras estándar `X-Minedec-*` pueden ser consumidos desde Java, .NET, PHP, Python, Node.js o cualquier proxy inverso. |
| **`RNF-INT-03`** | **Versionamiento de APIs y compatibilidad hacia atrás** | Rutas versionadas bajo `/api/v1/...` y contratos OpenAPI 3.1 que garantizan estabilidad a las aplicaciones integradas. |
| **`RNF-INT-04`** | **Formato estándar de exportación de logs y eventos** | Eventos emitidos en JSON estructurado compatible con Cloud Logging, BigQuery y plataformas SIEM estándar (`RF-AUD-08`). |
| **`RNF-INT-05`** | **Sincronización e intercambio seguro de catálogos institucionales** | Interfaces estandarizadas para conciliar catálogos de instituciones (AMIE), jurisdicciones territoriales y dominios autorizados. |

---

## 7. Documentos Relacionados

- [Catálogo Oficial de Requerimientos Funcionales (`C2-49` v0.4)](requerimientos-funcionales-c22.md)
- [Infraestructura GCP, Red Híbrida y Matriz IAM de C2.2](../arquitectura/infraestructura-permisos-c22.md)
- [Contrato Formal de Autorización PEP–PDP](../arquitectura/contrato-autorizacion-pep-pdp.md)
