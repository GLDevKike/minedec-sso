---
type: Domain Model
title: Actores, Poblaciones de Usuarios y Ciclo de Vida de Identidades
description: Modela las cuatro poblaciones de usuarios del ecosistema MINEDEC, el alcance exclusivo de personas naturales (RF-GI-03, RF-UEX-02), el identificador natural único (Cédula/Pasaporte/Código MINEDEC) y los 3 roles administrativos de la consola (C2-50 Tabla 13).
tags:
  - actores
  - poblaciones
  - identidad
  - cedula
  - codigo-minedec
  - usuarios-externos
  - c2-49
  - c2-50
timestamp: 2026-10-21T14:54:00Z
---

# Actores, Poblaciones de Usuarios y Ciclo de Vida de Identidades (`C2-49` v0.4 y `C2-50` v0.1)

## 1. Poblaciones de Usuarios del Ecosistema (`RF-GI-01` a `RF-GI-15`)

El ecosistema de autenticación y autorización atiende a cuatro poblaciones diferenciadas por su naturaleza jurídica, volumen y mecanismo de aprovisionamiento:

| Población | Volumen Estimado | Dominio / Credencial de Ingreso | Fuente de Aprovisionamiento | Licenciamiento Workspace | Tratamiento en AlloyDB (C2.2) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Estudiantes** | ~2.106.969 | `estudiante.edu.ec` | Subcomponente **C1.4** desde el sistema de matrícula. | Sí (Education Fundamentals / equivalente). | **Sin filas individuales de asignación de roles** (`DA-08`). Se sincroniza su ficha de identidad y su acceso se evalúa dinámicamente vía reglas ABAC / Grupos Lógicos sobre `tipo_usuario`, `codigo_amie`, `grado_curso` y `nivel_academico`. |
| **2. Docentes y Directivos** | ~160.000 | `[Dominio Docentes - D-21]` | Administrado por MINEDEC (Talento Humano / Distributivo, `D-10`). | Sí | Ficha de identidad sincronizada + asignaciones contextuales (`asignacion_contexto`) con `amie_titular`, `amies_asignados` (`RF-GI-13`), múltiples cargos (`RF-GI-12`), vigencias y roles específicos. |
| **3. Personal Administrativo** | ~10.000 | `[Dominio Administrativos - D-21]` | Administrado por MINEDEC (Planta Central, Zonas, Distritos, `D-10`). | Sí | Ficha de identidad sincronizada + asignaciones contextuales con `nivel_jurisdiccion` (`NACIONAL`, `ZONAL`, `DISTRITAL`, `CIRCUITAL`, `INSTITUCIONAL`), `codigo_jurisdiccion`, `zona`, `distrito`, roles y perfiles (`RF-GI-11`). |
| **4. Usuarios Externos (Ciudadanos y Representantes Legales)** | ~76.000 por convocatoria | Ingreso por **Número de Identificación** (no correo institucional). | Registro en convocatorias / servicios ciudadanos (`D-02`, `D-15`, `BR-01`). | **No reciben licencia** de Google Workspace (`RF-AUT-13`). | Ficha de persona natural externa en AlloyDB vinculada a su `CEDULA` o `PASAPORTE` y, cuando aplica, vinculaciones contextuales a organizaciones mediante **RUC** (`RF-UEX-02` a `RF-UEX-08`, `D-14`). |

---

## 2. Identificador Natural Único y Reglas de Identificación (`RF-GI-03`, `RF-GI-15`, `RF-UEX-05`)

El correo electrónico es únicamente la credencial de inicio de sesión ante el IdP; el **identificador natural único e inmutable** de toda persona natural dentro del Sistema de Autenticación Centralizado SSO / Conecta MINEDEC y hacia las aplicaciones integradas es la dupla `(tipo_identificacion, numero_identificacion)`:

1. **`CEDULA` (Cédula de identidad ecuatoriana)**:
   - Compuesta por **10 dígitos numéricos** (tipo `TEXT` estricto para preservar el `0` inicial de las provincias `01` a `09`).
   - El sistema valida obligatoriamente el código de provincia (`01` a `24` o `30` para ecuatorianos en el exterior) y el **dígito verificador (algoritmo Módulo 10)** antes de persistir o vincular cualquier registro (`RF-UEX-05`).
   - Cuando una persona natural con régimen `HONORARIOS_PROFESIONALES` o `CONTRATISTA` provenga de la matriz con un número de RUC personal de 13 dígitos terminado en `001`, se normaliza a sus primeros 10 dígitos como `CEDULA`.
2. **`PASAPORTE`**:
   - Cadena alfanumérica estandarizada (en mayúsculas, sin espacios ni caracteres especiales) para ciudadanos extranjeros con documento de viaje válido.
3. **`CODIGO_MINEDEC`**:
   - Identificador temporal asignado por el Ministerio a personas que aún no cuentan con cédula ni pasaporte (con alcance extensible a las carteras de Deporte y Cultura según la brecha `BR-18`).
   - **Transición 1 a 1 a Cédula (`RF-GI-15`, `R-06`)**: Cuando la persona obtiene su cédula ecuatoriana, el sistema ejecuta una actualización transaccional 1 a 1 que reemplaza el `CODIGO_MINEDEC` por la `CEDULA` como clave natural primaria, conservando la referencia histórica en `codigo_minedec_anterior` y **preservando intacto el `id_interno (UUID v4)` y todo el historial de accesos, asignaciones y trazas de auditoría**.

---

## 3. Coexistencia de Múltiples Cuentas para una Misma Persona (`RF-GI-07`)

Una misma persona natural (identificada por una única `CEDULA`) puede poseer **múltiples cuentas activas** en distintos dominios o poblaciones simultáneamente. Ejemplos reales en el MINEDEC:

- Un **docente** que además cumple funciones en **planta administrativa** (cuenta en dominio docente + cuenta en dominio administrativo).
- Un **servidor público** (docente o administrativo) que participa como **ciudadano externo o representante legal** de una organización en un trámite público.
- Un **estudiante** de educación nocturna/adultos que también interactúa como ciudadano externo.

### Reglas de Negocio en el Modelo de Datos de C2.2

- La entidad `persona_identidad` tiene como clave primaria técnica `id_interno (UUID v4)` y como restricción única natural `(tipo_identificacion, numero_identificacion)`.
- La entidad `cuenta_autenticacion` tiene como clave única `primary_email` (y `google_sub`) y una clave foránea `N:1` hacia `persona_identidad`.
- Al evaluar `POST /api/v1/access/evaluation`, el PDP recibe `email_autenticado`, resuelve la `persona_identidad` subyacente (`numero_identificacion`) y evalúa las políticas correspondientes al contexto de la cuenta y aplicación invocada, devolviendo siempre el `numero_identificacion` oficial a la aplicación consumidora (`RF-AUT-03`).

---

## 4. Usuarios Externos y Representación de Organizaciones por RUC (`RF-UEX-02` a `RF-UEX-08`, `D-14`)

Para las aplicaciones orientadas a la ciudadanía y entidades externas:

- El ciudadano se autentica utilizando su **número de identificación** (`CEDULA` o `PASAPORTE`), sin requerir una cuenta `@*.gob.ec` ni `@estudiante.edu.ec` y sin consumir licencias de Google Workspace (`RF-AUT-13`).
- **Representantes Legales de Organizaciones (`RF-UEX-02`, `RF-UEX-08`, `D-14`)**:
  - **No existen cuentas de personas jurídicas** ni cuentas genéricas compartidas por RUC.
  - Todo representante legal es una **persona natural identificada por su propia `CEDULA`**, quien inicia sesión con su identidad personal y actúa bajo el contexto del **RUC (13 dígitos)** de la organización a la cual está acreditada y vinculada (`vinculacion_organizacion_ruc`), con fecha de inicio, fecha de fin y estado de representación.

---

## 5. Los 3 Actores Administrativos de la Consola Web (`RF-ADM-07`, `C2-50` Tabla 13)

El acceso a la Consola Web y a la API de Administración (PAP) está protegido por **Cloud Identity-Aware Proxy (IAP)** con **MFA obligatorio (`RF-AUT-08`)** y segregado en **tres roles administrativos estrictos** (`C2-50` Tabla 13):

| Actor de Consola | Área Institucional | Permisos en el Sistema de Autenticación Centralizado SSO (C2.2) | Restricciones Estrictas |
| :--- | :--- | :--- | :--- |
| **1. Superadministrador** | Seguridad Informática / Infraestructura TI | • Registrar, configurar, publicar, suspender, revertir y despublicar aplicaciones (Patrón 1 y Patrón 2, `RF-ADM-08`).<br>• Generar y rotar credenciales M2M (`client_id` / `client_secret`) para aplicaciones Patrón 1.<br>• Definir la regla por defecto del catálogo de rutas (`autenticada`, `protegida`, `pública`) y las excepciones públicas (`RF-AUZ-17`).<br>• Asignar y revocar **Administradores de Aplicativo** y **Auditores**.<br>• Consultar auditoría global, anomalías y estado de sincronización. | Toda acción de publicación pasa por el orquestador asíncrono (`sa-publicador`) y queda registrada en la pista de auditoría inmutable (`RF-AUD-02`). |
| **2. Administrador de Aplicativo** | Líder Funcional / Responsable de cada Sistema | • Visualizar **exclusivamente** las aplicaciones que le fueron asignadas por un Superadministrador.<br>• Crear y administrar dentro de su aplicación: **roles, permisos atómicos, perfiles, grupos lógicos y reglas ABAC** sobre las rutas protegidas.<br>• Asignar roles y contextos territoriales/temporales a usuarios dentro de su aplicación. | • **No puede** ver ni modificar otras aplicaciones.<br>• **No puede** ver ni rotar credenciales M2M (`client_secret`), certificados TLS, IPs de backend ni configuraciones de red/infraestructura.<br>• **No puede** definir rutas públicas ni ejecutar despliegues perimetrales. |
| **3. Auditor** | Control Interno / Auditoría de Seguridad | • Consultar y filtrar la pista de auditoría inmutable de autenticaciones, autorizaciones y cambios administrativos (`RF-AUD-05`).<br>• Generar y exportar reportes de cumplimiento y recertificación de accesos (`RF-AUD-06`, `RF-AUD-07`). | • **Rol 100% de solo lectura**: no puede crear, modificar, suspender ni eliminar aplicaciones, rutas, roles, asignaciones ni usuarios. |

---

## 6. Documentos Relacionados

- [Esquema de Identidad `MINEDEC_Perfil` y Modelo de Datos en AlloyDB](identidad-esquema-minedec-perfil.md)
- [Modelo de Autorización Híbrido RBAC + ABAC](modelo-autorizacion-rbac-abac.md)
- [Gobierno y Ciclo de Vida de Aplicaciones desde la Consola](../arquitectura/gobierno-ciclo-vida-aplicaciones.md)
