---
type: Architecture Overview
title: Componentes del Núcleo Central del Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (C2.2)
description: Describe la topología técnica de C2-50 v0.1 y DA-11, los 5 microservicios en GKE Autopilot (sso-oidc, PDP, PAP, SPA y PIP) sobre Node.js 22 LTS + Express + oidc-provider, la caché L2 en Memorystore Redis, AlloyDB 16 y los patrones de integración C2.2/C2.3.
tags:
  - arquitectura
  - c2-50
  - da-11
  - gke-autopilot
  - alloydb
  - redis
  - sso-oidc
  - pdp
  - pap
  - pip
timestamp: 2026-10-21T23:40:00Z
---

# Componentes del Núcleo Central del Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (`C2-50` v0.1 y `DA-11`)

## 1. Arquitectura de Referencia Desacoplada (NIST / XACML + Intermediario OIDC — `C2-50` §2 y `DA-11`)

La solución del **Subcomponente C2.2 (`minedec-sso-pdp-core`)** materializa el plano central de intermediación de inicio de sesión (`sso-oidc`, `DA-11`), decisión (`motor-pdp`), administración (`api-pap` + `frontend`) e información de políticas (`pip-identity-service`) bajo el modelo estándar **PEP / PDP / PAP / PIP**:

```mermaid
flowchart TB
    subgraph IdP["Plano de Identidad Primario (Google Cloud Identity / Workspace)"]
        GCI["Google Cloud Identity (Dominios Institucionales — D-01, D-21)"]
        GAL["Audit Logs de Workspace"]
    end

    subgraph PEP_Plane["Plano de Cumplimiento (PEP — Consumidores del Contrato C2.2)"]
        P1["Aplicaciones Patrón 1 (Integración Nativa + Paquete SP/RP)"]
        P2["PEP Perimetral Patrón 2 (Apigee X / Envoy Gateway + IAP)"]
    end

    subgraph C22["Subcomponente C2.2 — Proyecto GCP: minedec-sso-pdp-core"]
        subgraph GKE["GKE Autopilot Privado (Workload Identity: sa-conecta)"]
            OIDC["Servicio Intermediario OIDC sso-oidc (Node.js 22 LTS / TS 5 / oidc-provider — DA-11)"]
            PDP["Motor de Autorización PDP (Node.js 22 LTS / TypeScript 5 / Express)"]
            PAP_API["API de Administración PAP (Node.js 22 LTS / TypeScript 5 / Express)"]
            SPA["Consola Web Administrativa SPA (React 18 + Vite)"]
            PIP_SVC["Servicio de Identidades PIP (Node.js 22 LTS / TypeScript 5 / Express)"]
        end

        subgraph Data["Capa de Datos y Aceleración (PIP Primario + Estado OIDC)"]
            REDIS["Memorystore for Redis HA (Caché L2 TTL <= 300s + Sesión Central OIDC)"]
            ALLOY["AlloyDB for PostgreSQL 16 HA (Identidad + Clientes OIDC/M2M + Permisos + Auditoría)"]
        end

        subgraph Async["Plano Asíncrono de Sincronización y Gobierno (Cloud Run)"]
            SYNC_SVC["Sincronizador Eventos (Cloud Run Service + Cloud Tasks <= 28 req/s)"]
            SYNC_JOB["Conciliación Masiva (Cloud Run Job particionado)"]
            PUB_JOB["Orquestador de Publicación (Cloud Run Job: sa-publicador)"]
            CAT_SVC["Sondeador de Estado Perimetral (Cloud Run Service: sa-catalogo)"]
        end
    end

    GCI <-->|1 Único Cliente OAuth 2.0 en GCP| OIDC
    P1 <-->|OIDC PKCE S256 (aud por App) / Logout| OIDC
    P2 <-->|OIDC PKCE S256 / Logout| OIDC
    P1 -->|POST /api/v1/access/evaluation + Bearer JWT M2M| PDP
    P2 -->|POST /api/v1/access/evaluation + Bearer JWT M2M| PDP
    OIDC <-->|Sesión central / códigos efímeros| REDIS
    OIDC <-->|Catálogo de clientes OIDC| ALLOY
    OIDC <-->|Resolución Identidad| PIP_SVC
    PDP <-->|Caché L2| REDIS
    PDP <-->|Resolución Identidad / Contexto| PIP_SVC
    PIP_SVC <--> REDIS
    PIP_SVC <--> ALLOY
    PDP -->|Cache Miss / Auditoría| ALLOY
    SPA -->|Detrás de Cloud IAP + Cloud Armor| PAP_API
    PAP_API <--> ALLOY
    PAP_API -->|Invalidación inmediata| REDIS
    PAP_API -->|Encola despliegue| PUB_JOB
    GAL -->|Logging Sink → Pub/Sub → Cloud Tasks| SYNC_SVC
    SYNC_SVC -->|Upsert idempotente| ALLOY
    SYNC_SVC -->|Purga caché + sesión OIDC| REDIS
    SYNC_JOB -->|Conciliación nocturna| ALLOY
```

---

## 2. Componentes Internos del Subcomponente C2.2 (`C2-50` Tabla 2 y `DA-11`)

| Componente C2.2 | Plataforma de Ejecución | Stack Tecnológico Ratificado (`C2-50` + `DA-11`) | Responsabilidad Principal |
| :--- | :--- | :--- | :--- |
| **1. Servicio de Login e Intermediario OIDC (`sso-oidc` — `DA-11`)** | **GKE Autopilot** (expuesto públicamente detrás del External Application Load Balancer + Cloud Armor en `login.sso.<dominio>`, sin IAP delante) | **Node.js 22 LTS + TypeScript 5 (`strict: true`) + Express + `oidc-provider`** (certificado por la OpenID Foundation) | Actúa como intermediario OIDC (*Identity Broker*) entre todas las aplicaciones (Patrón 1 y PEP Patrón 2) y Google Cloud Identity. Posee **el único cliente OAuth 2.0 en Google Cloud**. Expone `GET /.well-known/openid-configuration`, `GET /authorize`, `GET /callback`, `POST /token`, `GET /jwks` y `GET/POST /logout`. Emite ID Tokens firmados con `RS256` (claves en Secret Manager) con `aud` exclusivo por aplicación (`sub`, `email`, `email_verified`, `numero_identificacion`), lee clientes OIDC desde AlloyDB y gestiona la sesión central y códigos de un solo uso en Memorystore for Redis. |
| **2. Motor de Autorización (`motor-pdp` — PDP Central)** | **GKE Autopilot** (clúster privado regional con HPA) | **Node.js 22 LTS + TypeScript 5 (`strict: true`) + Express** | Expone `POST /api/v1/oauth/token`, `POST /api/v1/access/evaluation` y `GET /api/v1/.well-known/jwks.json`. Evalúa en tiempo real y con respuesta ágil (`RNF-REN-02`, `D-06`) el catálogo de rutas (`RF-AUZ-17`), RBAC, Grupos Lógicos (`DA-08`) y ABAC territorial, y firma `X-Minedec-Assertion` (`RS256`, vigencia 60 s). |
| **3. API de Administración (`api-pap` — PAP)** | **GKE Autopilot** (mismo clúster, publicado detrás de Cloud IAP + Cloud Armor) | **Node.js 22 LTS + TypeScript 5 + Express** | Gestiona el ciclo de vida de aplicaciones, clientes OIDC por aplicación (`DA-11`), credenciales M2M, catálogo de rutas, roles, permisos, perfiles, grupos lógicos, asignaciones contextuales (`asignacion_contexto`), transición `CODIGO_MINEDEC` → `CEDULA` (`RF-GI-15`) y consultas/exportación de auditoría. |
| **4. Consola Web Administrativa (`frontend` — SPA)** | Servida detrás del mismo **External Application Load Balancer + Cloud IAP** que la API PAP | **React 18 + TypeScript 5 + Vite + Tailwind CSS / shadcn/ui** | Interfaz diferenciada para los **3 roles administrativos (`C2-50` Tabla 13)**: **Superadministrador** (gobierno de aplicaciones, clientes OIDC/M2M, rutas públicas y publicación), **Administrador de Aplicativo** (roles, permisos y reglas de sus aplicaciones asignadas) y **Auditor** (consulta y exportación de auditoría en solo lectura). |
| **5. Servicio de Identidades (`pip-identity-service` — PIP)** | **GKE Autopilot** (Ingress interno en el clúster privado) | **Node.js 22 LTS + TypeScript 5 + Express** | Servicio interno de resolución de identidades y contexto (`GET /internal/v1/identities/resolve`, reconciliación 1 a 1 `CODIGO_MINEDEC` → `CEDULA` y revocación/suspensión con invalidación en Redis). |
| **6. Repositorio Primario de Permisos y Clientes (PIP DB)** | **AlloyDB for PostgreSQL 16** (Instancia Primaria HA Regional + Read Pool opcional) | PostgreSQL 16 + Migraciones estáticas parametrizadas (`$1, $2`) | Almacena la copia local sincronizada de identidades (`MINEDEC_Perfil`), contexto territorial, catálogo de aplicaciones, clientes OIDC (`redirect_uris`, `post_logout_redirect_uris`), credenciales M2M, rutas, reglas RBAC/ABAC, cola de publicaciones y tabla inmutable de auditoría (`auditoria_evento` con hash `SHA-256`). |
| **7. Capa de Aceleración, Caché L2 y Sesión OIDC** | **Memorystore for Redis** (Alta Disponibilidad regional) | Redis 7.x (`TTL <= 300 s` para caché de autorización + estado temporal OIDC) | Almacena fichas de atributos, decisiones/permisos precalculados (`TTL <= 300 s`, `DA-06`), códigos de autorización de un solo uso y la sesión central de `sso-oidc` (`DA-11`). |
| **8. Sincronizador de Identidades en Casi Tiempo Real** | **Cloud Run Service** precedido por **Cloud Logging Sink → Pub/Sub → Cloud Tasks** | **Node.js 22 LTS + TypeScript 5 + Express** (`sa-sync`) | Procesa eventos de creación, modificación y suspensión de cuentas en Workspace respetando el tope del 70% de cuota (`<= 28 req/s`), actualiza AlloyDB de forma idempotente y purga Redis en `< 5 s`. |
| **9. Conciliador Masivo de Identidades** | **Cloud Run Job** disparado por **Cloud Scheduler** | **Node.js 22 LTS + TypeScript 5** (`sa-sync-job`) | Ejecuta la carga inicial y conciliación nocturna de los ~2,28 millones de cuentas particionando tareas paralelas por dominio y `orgUnitPath` con `pageToken` persistido en AlloyDB. |
| **10. Orquestador de Publicación (`sa-publicador`) y Sondeador (`sa-catalogo`)** | **Cloud Run Job** (`sa-publicador`) y **Cloud Run Service** (`sa-catalogo`) | **Node.js 22 LTS + TypeScript 5** + **Infrastructure Manager (Terraform `>= 1.5.0`)** | Empaqueta la declaración de aplicaciones del Patrón 2 (`apps.auto.tfvars.json`), valida con `pg_try_advisory_lock` que el Preview no destruya recursos ajenos, aplica cambios en Infrastructure Manager y sondea en solo lectura el estado real de certificados, DNS y backends (`RF-ADM-08`). |
| **11. Paquete Estándar Reutilizable SP/RP** | Librería interna versionada entregada por C2.2 (`RF-INT-03`) | **TypeScript / Módulos adaptadores** + Suite `PI-01..PI-08` | Encapsula el flujo OIDC (`Authorization Code + PKCE S256` contra `sso-oidc`), SAML 2.0 (`SP-Initiated`), obtención/renovación de token M2M y cliente hacia `POST /api/v1/access/evaluation` con validación JWKS `RS256`, caché local breve y política **Fail-Close** (`RNF-SEG-10`). |

---

## 3. Patrones de Integración Soportados por C2.2 (`C2-50` §3, `C2-59` §3 y `DA-11`)

El Sistema de Autenticación Centralizado SSO / Conecta MINEDEC gobierna simultáneamente aplicaciones bajo dos patrones arquitectónicos (`DA-03`, `DA-11`) sin cambiar su motor ni su contrato:

### 3.1 Patrón 1 — Integración Nativa (Con el Paquete Estándar SP/RP)
- Destinado a aplicaciones modernas o con código fuente accesible que integran directamente el paquete estándar SP/RP (`RF-INT-03`) o librerías OIDC estándar (`openid-client`, `Authlib`).
- La aplicación delega el login en el **intermediario OIDC del SSO (`sso-oidc`, `login.sso.<dominio>`)** mediante **OIDC con PKCE (`S256`)** (`RF-AUT-05`, `DA-11`), el cual a su vez autentica al usuario frente a **Google Cloud Identity** y devuelve a la aplicación un `id_token` firmado con `RS256` cuyo `aud` es exclusivo de esa aplicación (`SSO_OIDC_CLIENT_ID`). Alternativamente soporta **SAML 2.0 `SP-Initiated`** (`RF-AUT-04`).
- Una vez autenticado el usuario, el backend de la aplicación se autentica ante el PDP usando su credencial M2M (`POST /api/v1/oauth/token`) y consulta `POST /api/v1/access/evaluation` enviando `uuid_aplicacion` (o `host_solicitado` según armonización con `C2-59`), `email_autenticado`, `ruta_solicitada` y `metodo_http`.

### 3.2 Patrón 2 — Integración Perimetral mediante PEP (`RF-INT-10`, `D-03`, `DA-11`)
- Destinado a aplicaciones legadas, cajas negras o en transición donde un **Punto de Cumplimiento Perimetral (PEP)** en GCP intercepta todo el tráfico antes de llegar al servidor on-premise o nube:
  - **Alternativa 1 (Recomendada)**: **Apigee X** actuando como proxy perimetral inteligente.
  - **Alternativa 2 (Evolutiva)**: **GKE Gateway API (Envoy)** con **Cloud IAP** y filtro **`ext_authz`**.
- El PEP actúa como cliente OIDC frente a `sso-oidc` (`DA-11`), invoca `POST /api/v1/access/evaluation` enviando `host_solicitado`, **elimina cualquier cabecera `X-Minedec-*` que venga desde Internet** (anti-spoofing, `PI-03`), inyecta las 11 cabeceras oficiales firmadas (`X-Minedec-Assertion`) y enruta hacia el backend por un **Internal Regional Application Load Balancer con Hybrid NEG** (cuyos servidores solo aceptan tráfico desde la subred `proxy-only` del PEP según `RNF-SEG-09`).
- Soporta dos niveles progresivos de adopción configurables desde la consola (`RF-INT-10`):
  1. **Nivel «Protegida»**: El PEP controla el acceso por ruta sin modificar una sola línea de código de la aplicación legada.
  2. **Nivel «Integrada»**: La aplicación legada desactiva su pantalla de login propia y confía en la identidad inyectada en `X-Minedec-Identificacion` + `X-Minedec-Assertion`.

---

## 4. Documentos Relacionados

- [Contrato Formal de Autorización PEP–PDP](contrato-autorizacion-pep-pdp.md)
- [Sincronización de Identidades y Protección de Cuotas](sincronizacion-identidades-cuotas.md)
- [Gobierno y Ciclo de Vida de Aplicaciones desde la Consola](gobierno-ciclo-vida-aplicaciones.md)
- [Infraestructura GCP, Red Híbrida y Matriz IAM de C2.2](infraestructura-permisos-c22.md)
