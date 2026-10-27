---
type: Platform Vision
title: Alcance y Visión Estratégica del Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (C2.2)
description: Define el propósito, alcance exclusivo del Subcomponente C2.2, límites frente a C2.3, fuentes oficiales y principios rectores del Sistema de Autenticación Centralizado SSO (Conecta MINEDEC).
tags:
  - c2.2
  - conecta-minedec
  - sso
  - alcance
  - zero-trust
  - pdp
  - pap
  - pip
timestamp: 2026-10-21T14:45:00Z
---

# Alcance y Visión Estratégica del Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (Subcomponente C2.2)

## 1. Propósito de la Plataforma y Equivalencia de Nombre Oficial

El **Sistema de Autenticación Centralizado SSO** (también denominado **Conecta MINEDEC** en la arquitectura del Subcomponente C2.3 y en el repositorio técnico) es la Plataforma Central de Autenticación y Autorización del Ministerio de Educación, Deporte y Cultura (MINEDEC), desarrollada dentro del **Componente 2 — Subcomponente C2.2**.

> [!NOTE]
> **Equivalencia terminológica oficial (`C2-49`, `C2-50` y `C2-59`)**: En el historial de revisiones de `C2-49 Documento de Análisis Funcional.pdf` (v0.4, pág. 42) y en `C2-50 Documento de Arquitectura.pdf` (v0.1) se actualizó la denominación de la plataforma de *«Conecta MINEDEC»* a **«Sistema de Autenticación Centralizado SSO»**, mientras que `C2-59 Documento de Arquitectura (App legadas).pdf` (v0.1) mantiene la denominación **«Conecta MINEDEC»** y la hoja de cálculo de atributos emplea el alias preliminar *«AURA»*. Los tres términos se refieren exactamente al mismo núcleo del **Subcomponente C2.2**.

Su objetivo es consolidar la gestión de acceso institucional y el control centralizado de permisos bajo un modelo **Zero Trust**, eliminando silos de credenciales por aplicación y garantizando el cumplimiento estricto del **Esquema Gubernamental de Seguridad de la Información (EGSI v2)** y la **Ley Orgánica de Protección de Datos Personales (LOPDP)** del Ecuador.

En la arquitectura general del ecosistema:

- **Google Cloud Identity / Google Workspace** actúa como el **Proveedor de Identidad Único (IdP)** para la autenticación primaria (incluyendo políticas de contraseñas, MFA/2SV y Acceso Contextual) de la población interna (`D-01`, `DA-01`).
- **Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (C2.2)** actúa como el **Punto de Decisión de Políticas (PDP)**, **Punto de Administración de Políticas (PAP)** y **Punto de Información de Políticas (PIP)** para todo el ecosistema de aplicaciones del Ministerio (`DA-02`, `DA-04`).

---

## 2. Fuentes Documentales Oficiales (`knowledge/fuentes-oficiales/`)

Toda la base de conocimiento (`knowledge/`) se encuentra sincronizada con los cuatro entregables oficiales resguardados en la carpeta `knowledge/fuentes-oficiales/`:

1. `knowledge/fuentes-oficiales/C2-49 Documento de Análisis Funcional.pdf` (**v0.4 — 15/10/2026**): Análisis funcional y de requerimientos (63 RF y 42 RNF) de los Subcomponentes C2.2 y C2.3.
2. `knowledge/fuentes-oficiales/C2-50 Documento de Arquitectura.pdf` (**v0.1 — 10/10/2026**): Arquitectura de solución del Subcomponente C2.2 (`minedec-sso-pdp-core`).
3. `knowledge/fuentes-oficiales/C2-59 Documento de Arquitectura (App legadas).pdf` (**v0.1 — 14/10/2026**): Arquitectura de integración de las 2 aplicaciones del Subcomponente C2.3 y su frontera de contrato con C2.2.
4. `knowledge/fuentes-oficiales/Matriz de Atributos GWS _ SSO (3).xlsx`: Matriz maestra canónica de los 21 atributos (`5` estándar de Google + `16` de `customSchemas.MINEDEC_Perfil`), catálogos cerrados, jerarquía de OUs y scopes API.

---

## 3. Límites Estrictos de Alcance de este Repositorio (`C2.2` vs `C2.3`)

> [!IMPORTANT]
> Este repositorio y su ciclo de desarrollo abarcan **exclusivamente el Subcomponente C2.2 (Sistema de Autenticación Centralizado SSO / Conecta MINEDEC)**. El Subcomponente C2.3 (modificación e integración de las 2 aplicaciones legadas piloto descritas en `C2-59`) **no forma parte de este repositorio**.

| Subcomponente | Estado en este proyecto | Qué incluye |
| :--- | :--- | :--- |
| **C2.2 — Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (Núcleo Central PDP/PAP/PIP)** | **EN ALCANCE (100%)** | • **4 servicios en GKE Autopilot** (`C2-50` Tabla 2) sobre **Node.js 22 LTS + TypeScript 5 (`strict: true`) + Express**:<br>  1. **Motor de Autorización (PDP)**: `POST /api/v1/access/evaluation`, `POST /api/v1/oauth/token`, `GET /api/v1/.well-known/jwks.json`.<br>  2. **API de Administración (PAP)**: Gestión de aplicaciones, rutas, credenciales M2M, roles, permisos, perfiles, grupos lógicos y auditoría.<br>  3. **Consola Web Administrativa (SPA)**: React 18 + Vite + TypeScript para *Superadministrador*, *Administrador de Aplicativo* y *Auditor*.<br>  4. **Servicio de Identidades (PIP)**: API interna del Directorio Único de Identidades y resolución de contexto.<br>• Esquema relacional 3FN, migraciones y repositorio primario en **AlloyDB for PostgreSQL 16 HA**.<br>• Capa de aceleración y caché L2 en **Memorystore for Redis HA** (`TTL <= 300 s`).<br>• Sincronizador de Identidades en casi tiempo real (**Cloud Run Service** + **Cloud Tasks**) y Job de conciliación masiva (**Cloud Run Job**).<br>• Orquestador de publicación de aplicaciones (`sa-publicador` en **Cloud Run Job** + **Infrastructure Manager**) y sondeador de estado (`sa-catalogo` en **Cloud Run Service**).<br>• Paquete estándar reutilizable SP/RP (OIDC + PKCE `S256` / SAML 2.0 + cliente de autorización + suite de 8 pruebas de conformidad `PI-01` a `PI-08`). |
| **C2.3 — Integración de 2 Aplicaciones Existentes (`C2-59`)** | **FUERA DE ALCANCE** | • Refactorización del código fuente interno de las 2 aplicaciones institucionales seleccionadas.<br>• Migración de sus tablas locales de usuarios.<br>• Pruebas funcionales internas de negocio de dichas aplicaciones. |

Aunque en esta etapa no se intervienen las aplicaciones del Subcomponente C2.3, **el Subcomponente C2.2 deja implementados y listos todos los contratos (`POST /api/v1/access/evaluation`, `POST /api/v1/oauth/token`), las 11 cabeceras firmadas (`X-Minedec-Assertion`), el flujo de aprovisionamiento perimetral y el paquete estándar SP/RP** para que cualquier aplicación (Patrón 1 o Patrón 2) pueda registrarse, gobernarse y operar desde la consola administrativa sin requerir cambios en el núcleo de C2.2.

---

## 4. Decisiones Arquitectónicas Fundamentales (`C2-49` y `C2-50`)

1. **Descarte de Active Directory (`D-01` / `BR-09` / `DA-01` — Resuelta el 22/09/2026)**:
   - Se descartó la integración o sincronización con Active Directory (`educacion.gob.ec` / Microsoft 365) dentro del SSO porque Google Cloud Directory Sync (GCDS) opera en un solo sentido y obligaría al usuario a manejar dos contraseñas distintas.
   - Active Directory se mantiene únicamente para el inicio de sesión local en estaciones de trabajo Windows del personal administrativo, fuera del alcance del SSO.
2. **Operación en Modo de Solo Lectura frente a Google Cloud Identity (`RF-GI-05`, `RNF-REN-05`, `DA-05`)**:
   - El Sistema de Autenticación Centralizado SSO **no crea, modifica, suspende ni elimina** cuentas ni grupos en Google Workspace.
   - Consume el directorio exclusivamente en modo lectura (`admin.directory.user.readonly` vía `sa-workspace-reader` con `signJwt`) y mantiene una copia local sincronizada en AlloyDB para garantizar **cero llamadas a las APIs de Google en el camino crítico** de inicio de sesión o evaluación de autorización.
3. **Personas Naturales e Identificador Natural Único (`RF-GI-01` a `RF-GI-15`, `RF-UEX-02`)**:
   - El sistema autentica y autoriza **exclusivamente personas naturales** (no existen cuentas compartidas por persona jurídica/`RUC`; un representante legal se autentica siempre con su propia `CEDULA` y actúa contextualmente vinculado al `RUC` de la organización según `D-14`).
   - En negocio, el identificador natural que vincula a la persona en todas las aplicaciones del MINEDEC es su `(tipo_identificacion, numero_identificacion)` (`CEDULA`, `PASAPORTE` o `CODIGO_MINEDEC`), mientras que en la base de datos física la clave primaria técnica inmutable es `id_interno (UUID v4)`.
4. **Separación Estricta entre Identidad Estable y Contexto Dinámico (`D-04`, `D-05`, `DA-04`)**:
   - En Google Cloud Identity (`MINEDEC_Perfil`) solo se almacenan **21 atributos estables** de la persona (5 estándar + 16 personalizados).
   - Los atributos dinámicos y multi-valuados de autorización (cargos adicionales, múltiples códigos AMIE asignados, nivel de jurisdicción, zona, distrito, vigencias temporales y suplencias) residen exclusivamente en **AlloyDB**.
   - Se eliminó la dimensión fija «sede» del modelo de autorización (`D-05`, `RF-GI-13`) en favor de los atributos territoriales oficiales (`amie_titular`, `amies_asignados`, `nivel_jurisdiccion`, `codigo_jurisdiccion`, `zona`, `distrito`).
5. **Tiempos de Respuesta Ágiles sin Métricas Fijas en Milisegundos y Techo Duro de Revocación (`<= 300 s`)**:
   - En `C2-49` v0.4 se eliminaron los umbrales fijos en milisegundos (`< 300 ms`, `< 50 ms`, etc.) de los requerimientos no funcionales (`RNF-REN-*`), estableciendo que la plataforma debe responder de forma ágil y sin degradación perceptible (sujeto a los objetivos de nivel de servicio de `D-06`), evitando sobrecarga innecesaria en las respuestas HTTP.
   - Se mantiene como **límite duro absoluto e invariable** la ventana máxima de **`<= 300 segundos (5 minutos)`** para que cualquier revocación de permisos o suspensión de cuenta surta efecto en todas las aplicaciones (`RF-GI-06`, `RF-AUT-06`, `DA-06`, `PI-07`).

---

## 5. Documentos Relacionados en la Base de Conocimiento

- [Matriz de Brechas, Decisiones y Riesgos Arquitectónicos](brechas-y-decisiones.md)
- [Componentes del Núcleo PDP Core (C2.2)](../arquitectura/componentes-pdp-core.md)
- [Contrato Formal de Autorización PEP–PDP](../arquitectura/contrato-autorizacion-pep-pdp.md)
- [Requerimientos Funcionales del Subcomponente C2.2](../requerimientos/requerimientos-funcionales-c22.md)
