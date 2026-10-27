---
type: Canonical Reference
title: Matriz Maestra Canónica de Atributos GWS, Catálogos Cerrados, OUs y Scopes API
description: Especificación íntegra extraída de Matriz de Atributos GWS _ SSO (3).xlsx con los 21 atributos exactos de customSchemas.MINEDEC_Perfil, obligatoriedad por población, catálogos cerrados, jerarquía de OUs y scopes DWD.
tags:
  - matriz-atributos-gws
  - minedec-perfil
  - catalogos
  - enums
  - rbac
  - abac
  - ous
timestamp: 2026-10-14T15:27:00Z
---

# Matriz Maestra Canónica de Atributos GWS (`Matriz de Atributos GWS _ SSO (3).xlsx`)

Este documento incorpora de manera íntegra la **Matriz Maestra Canónica de Atributos (`C2.2 & C2.3`)** definida en `knowledge/fuentes-oficiales/Matriz de Atributos GWS _ SSO (3).xlsx`.

> [!NOTE]
> **Equivalencia terminológica (`AURA` = `Conecta MINEDEC` = `Sistema de Autenticación Centralizado SSO`)**: En la hoja de cálculo se denomina preliminarmente **«AURA»** a la capa central de enriquecimiento y autorización que en `C2-49` (v0.4) y `C2-50` (v0.1) se denomina oficialmente **Sistema de Autenticación Centralizado SSO** y en `C2-59` (v0.1) **Conecta MINEDEC (Subcomponente C2.2)**. Con Cloud IAP o autenticación OIDC básica, al borde solo llegan el `email`, el `sub` (ID de Google) y el dominio `hd`; el resto de atributos para el cruce **RBAC + ABAC** se resuelve y enriquece a través del núcleo de C2.2.

---

## 1. Hoja 1: Los 21 Atributos Canónicos (`Estándar Google` + `customSchemas.MINEDEC_Perfil`)

### 1.1 Definición Técnica, Claims y Función en el Cruce RBAC + ABAC

| ID | Categoría | `fieldName` (API Google) | `displayName` | Tipo | Indexado | Visibilidad | Claim OIDC / SAML | Qué Resuelve en el Cruce RBAC + ABAC | Vía de Entrega |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1.0** | Estándar Google | `primaryEmail` | Correo Institucional Principal | `STRING` | N/A | N/A | `email` / `nameID` | **Autenticación / SSO Principal** (`@estudiante.edu.ec` / `@educacion.gob.ec`) | Vía 2 (SAML) / JWT IAP (`email`) |
| **2.0** | Estándar Google | `name.givenName` | Nombres del Usuario | `STRING` | N/A | N/A | `given_name` | **Identidad / Perfil** (`primerNombre + segundoNombre`) | Vía 2 (SAML) / Vía 1 (Conecta MINEDEC) |
| **3.0** | Estándar Google | `name.familyName` | Apellidos del Usuario | `STRING` | N/A | N/A | `family_name` | **Identidad / Perfil** (`primerApellido + segundoApellido`) | Vía 2 (SAML) / Vía 1 (Conecta MINEDEC) |
| **4.0** | Estándar Google | `orgUnitPath` | Unidad Organizativa (OU) | `STRING` | N/A | N/A | `org_unit_path` | **Seguridad / Políticas / MFA** (derivado automáticamente de `gradoCurso` y `tipoUsuario`) | Vía 3: Gobernanza interna Google |
| **5.0** | Estándar Google | `suspended` | Estado de Cuenta (Suspendida) | `BOOL` | N/A | N/A | `is_suspended` | **Ciclo de Vida (Bajas / Bloqueos)** inmediato ante cese o desvinculación | Vía 3: Gobernanza interna Google |
| **6.0** | `MINEDEC_Perfil` | `idInterno` | Identificador Único Inmutable | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `uid` | **Identificador Maestro Inmutable (`UUID v4`)**: llave opaca universal que evita romper sesiones y tablas cuando un menor cambia de `CODIGO_MINEDEC` a `CEDULA`. | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **7.0** | `MINEDEC_Perfil` | `tipoIdentificacion` | Tipo de Documento de Identidad | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `doc_type` | **Validación Registral**: `CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`, `RUC` | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **8.0** | `MINEDEC_Perfil` | `numeroIdentificacion` | Número de Documento / Cédula | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `doc_number` / `cedula` | **Clave Natural de Negocio**: texto estricto (conserva cero inicial en provincias `01` a `09`). `CEDULA` (10 dígitos Módulo 10), `RUC` (13 dígitos). | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **9.0** | `MINEDEC_Perfil` | `tipoUsuario` | Tipo de Usuario | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `user_type` | **RBAC (Roles Base) / Enrutamiento IdP**: `ESTUDIANTE`, `DOCENTE`, `ADMINISTRATIVO`, `EXTERNO`. | Vía 2 (SAML) y Grupos Dinámicos / Vía 1 (Conecta MINEDEC) |
| **10.0** | `MINEDEC_Perfil` | `subtipoUsuario` | Régimen Laboral / Condición Jurídica | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `user_subtype` | **RBAC / Políticas Laborales**: relación jurídica o laboral desacoplada del cargo funcional (`REGULAR`, `LOSEP`, `COD_TRABAJO`, `BECARIO`, etc.). | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **11.0** | `MINEDEC_Perfil` | `cargoFuncion` | Cargo o Función Específica | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `role` / `job_title` | **RBAC Fino (Aplicaciones)**: rol de función dentro del establecimiento o sede (17 valores canónicos). | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **12.0** | `MINEDEC_Perfil` | `gradoCurso` | Código de Grado o Curso (Fuente Maestra) | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `grade_code` | **Fuente Maestra Académica**: de este código (`EGB_1`..`SUPERIOR_3`) se derivan automáticamente `nivelAcademico` y `orgUnitPath`. | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **13.0** | `MINEDEC_Perfil` | `nivelAcademico` | Nivel Educativo (Derivado) | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `academic_level` | **ABAC Académico**: derivado sin intervención manual desde `gradoCurso` (`EGB_PREPARATORIA`..`EDUCACION_SUPERIOR`, `SIN_NIVEL`). | Vía 2 (SAML) / Vía 1 (Conecta MINEDEC) |
| **14.0** | `MINEDEC_Perfil` | `codigoInstitucion` | Código AMIE Institución Educativa | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `amie_code` | **ABAC Territorial / Escuela**: formato `^[0-9]{2}[A-Z][0-9]{5}$` (ej. `17H00001`). Aplica a estudiantes y docentes en plantel escolar. | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **15.0** | `MINEDEC_Perfil` | `codigoDependenciaAdmin` | Código Dependencia Administrativa | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `admin_code` | **ABAC Administrativo**: separado del código AMIE; representa la sede administrativa ministerial (`PLANTA_CENTRAL`, `ZONA_9`, `DIST_17D01`). | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **16.0** | `MINEDEC_Perfil` | `zonaDistritoCircuito` | Ámbito Territorial (Zona / Distrito / Circuito) | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `territory_scope` | **ABAC Scoping Territorial**: `ZONA_[0-9]{1,2} \| DIST_[0-9]{2}D[0-9]{2} \| CIRC_[0-9]{2}`. Restringe acceso de Rectores y Distritos a su jurisdicción. | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **17.0** | `MINEDEC_Perfil` | `viceministerio` | Viceministerio / Cartera Ministerial | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `portfolio` | **ABAC (Segregación Multicartera)**: `EDUCACION`, `DEPORTE`, `CULTURA`. | Vía 3 (Grupos dinámicos) / Vía 1 (Conecta MINEDEC) |
| **18.0** | `MINEDEC_Perfil` | `docenteMultisede` | Docente en Múltiples Instituciones | `BOOL` | **SÍ** | `ADMINS_AND_SELF` | `is_multisite` | **Gestión de Plazas Múltiples**: indica si el docente labora en más de un plantel (`TRUE`/`FALSE`). Si es `TRUE`, las sedes complementarias (`amies_asignados`) se resuelven en Conecta MINEDEC (AlloyDB). | Vía 1: Enriquecimiento vía Conecta MINEDEC |
| **19.0** | `MINEDEC_Perfil` | `fechaInicioVigencia` | Fecha de Inicio de Vigencia | `DATE` | NO | `ADMINS_AND_SELF` | `valid_from` | **Activación Programada / Vigencia ABAC** (`YYYY-MM-DD`): obligatoria para `EXTERNO` y subtipos temporales (`BECARIO`, `DEVENGANTE`, `PASANTE`, `CONTRATISTA`, `HONORARIOS_PROFESIONALES`). | Vía 3 / Evaluado en Conecta MINEDEC |
| **20.0** | `MINEDEC_Perfil` | `fechaFinVigencia` | Fecha de Fin de Vigencia / Expiración | `DATE` | NO | `ADMINS_AND_SELF` | `valid_to` | **Desactivación Programada / Vigencia ABAC** (`YYYY-MM-DD`): obligatoria para `EXTERNO` y subtipos temporales. | Vía 3 / Evaluado en Conecta MINEDEC |
| **21.0** | `MINEDEC_Perfil` | `representanteLegalCedula` | Cédula del Representante Legal | `STRING` | **SÍ** | `ADMINS_AND_SELF` | `guardian_id` | **Tutela Legal de Menores (LOPDP)**: 10 dígitos Módulo 10; obligatoria para estudiantes menores de edad (consentimiento y autorrecuperación). | Vía 1: Enriquecimiento vía Conecta MINEDEC |

---

### 1.2 Matriz de Obligatoriedad por Población (Columnas `P`, `Q`, `R`, `S` de Hoja 1)

| ID | `fieldName` | Obligatorio: `ESTUDIANTE` | Obligatorio: `DOCENTE` | Obligatorio: `ADMINISTRATIVO` | Obligatorio: `EXTERNO` |
| :--- | :--- | :---: | :---: | :---: | :---: |
| 1.0 a 8.0 | `primaryEmail`, `givenName`, `familyName`, `orgUnitPath`, `suspended`, `idInterno`, `tipoIdentificacion`, `numeroIdentificacion` | **SÍ** | **SÍ** | **SÍ** | **SÍ** |
| 9.0 | `tipoUsuario` | **SÍ** | **SÍ** | **SÍ** | **SÍ** |
| 10.0 | `subtipoUsuario` | NO (`REGULAR` por defecto) | **SÍ** | **SÍ** | **SÍ** |
| 11.0 | `cargoFuncion` | NO | **SÍ** | **SÍ** | **SÍ** |
| 12.0 | `gradoCurso` | **SÍ** | NO | NO | NO |
| 13.0 | `nivelAcademico` | **SÍ** (derivado) | NO | NO | NO |
| 14.0 | `codigoInstitucion` (AMIE) | **SÍ** | **SÍ** | NO | NO |
| 15.0 | `codigoDependenciaAdmin` | NO | NO | **SÍ** | NO |
| 16.0 | `zonaDistritoCircuito` | **SÍ** | **SÍ** | **SÍ** | NO |
| 17.0 | `viceministerio` | **SÍ** | **SÍ** | **SÍ** | **SÍ** |
| 18.0 | `docenteMultisede` | NO | **SÍ** | NO | NO |
| 19.0 | `fechaInicioVigencia` | NO | **CONDICIONAL** (temporales) | **CONDICIONAL** (temporales) | **SÍ** |
| 20.0 | `fechaFinVigencia` | NO | **CONDICIONAL** (temporales) | **CONDICIONAL** (temporales) | **SÍ** |
| 21.0 | `representanteLegalCedula` | **CONDICIONAL** (menores de edad) | NO | NO | NO |

---

## 2. Hoja 4: Catálogos y Enumeraciones Canónicas Cerradas

Estos catálogos representan las **listas cerradas autorizadas** para validación con `Zod` en las APIs de Conecta MINEDEC y en las migraciones de AlloyDB:

### 2.1 Catálogos de Identidad, Régimen, Cartera y Cargo (`RBAC`)

| 1. `tipoIdentificacion` | 2. `tipoUsuario` | 3. `subtipoUsuario` (Régimen / Condición) | 4. `cargoFuncion` (RBAC Fino — 17 valores) | 6. `viceministerio` (Cartera) |
| :--- | :--- | :--- | :--- | :--- |
| • `CEDULA`<br>• `PASAPORTE`<br>• `CODIGO_MINEDEC`<br>• `RUC` | • `ESTUDIANTE`<br>• `DOCENTE`<br>• `ADMINISTRATIVO`<br>• `EXTERNO` | • `REGULAR`<br>• `LOSEP`<br>• `COD_TRABAJO`<br>• `HONORARIOS_PROFESIONALES`<br>• `BECARIO`<br>• `DEVENGANTE`<br>• `PASANTE`<br>• `CONTRATISTA`<br>• `JUBILADO`<br>• `REPRESENTANTE_LEGAL`<br>• `DIRECTIVO`<br>• `ADMINISTRATIVO_SEDE` | • `DOCENTE_AULA`<br>• `RECTOR`<br>• `VICERRECTOR`<br>• `INSPECTOR_GENERAL`<br>• `SUBINSPECTOR`<br>• `DOCENTE_TUTOR`<br>• `ORIENTADOR_DECE`<br>• `ASESOR_EDUCATIVO`<br>• `ANALISTA_DISTRITAL`<br>• `COORDINADOR_ZONAL`<br>• `DIRECTOR_PLANTA_CENTRAL`<br>• `SUPER_ADMIN_MINEDEC`<br>• `AUDITOR_SISTEMAS`<br>• `TECNICO_SOPORTE`<br>• `CONSULTOR_EXTERNO`<br>• `PROVEEDOR_TI`<br>• `AUDITOR_CONTROL_INTERNO` | • `EDUCACION`<br>• `DEPORTE`<br>• `CULTURA` |

### 2.2 Catálogo 5: Jerarquía Académica Maestra (`gradoCurso` → `nivelAcademico` → `orgUnitPath`) y Hoja 2 (`Jerarquía de OUs`)

En Conecta MINEDEC y en el aprovisionamiento de Workspace, `gradoCurso` es la **fuente maestra** de la cual se derivan determinísticamente `nivelAcademico` y la ruta de Unidad Organizativa (`orgUnitPath`):

| Código `gradoCurso` (Fuente Maestra) | `nivelAcademico` (Derivado) | Grados Comprendidos | Ruta Oficial `orgUnitPath` en Google Workspace | Políticas de Seguridad y Servicios en Workspace (TDR Anexo 1, Pág. 35) |
| :--- | :--- | :--- | :--- | :--- |
| `EGB_1` | `EGB_PREPARATORIA` | 1.° de EGB | `/MINEDEC/Estudiantes/EducacionMedia/EGB Preparatoria` | Servicios externos bloqueados; YouTube restringido estricto; sin correo externo; supervisión total. |
| `EGB_2`, `EGB_3`, `EGB_4` | `EGB_ELEMENTAL` | 2.°, 3.° y 4.° de EGB | `/MINEDEC/Estudiantes/EducacionMedia/EGB Elemental` | Acceso a Classroom y Drive protegido; correo restringido solo a dominio institucional `@estudiante.edu.ec`. |
| `EGB_5`, `EGB_6`, `EGB_7` | `EGB_MEDIA` | 5.°, 6.° y 7.° de EGB | `/MINEDEC/Estudiantes/EducacionMedia/EGB Media` | Herramientas colaborativas activas; navegación segura forzada; acceso controlado a Meet educativo. |
| `EGB_8`, `EGB_9`, `EGB_10` | `EGB_SUPERIOR` | 8.°, 9.° y 10.° de EGB | `/MINEDEC/Estudiantes/EducacionMedia/EGB Superior` | MFA / 2SV habilitado para autoservicio; Classroom, Meet, Chat interno protegido. |
| `BGU_1`, `BGU_2`, `BGU_3` | `BGU` | 1.°, 2.° y 3.° de BGU | `/MINEDEC/Estudiantes/EducacionMedia/Bachillerato` | **MFA / 2SV obligatorio**; acceso ampliado para orientación vocacional y pruebas estatales; Workspace Plus completo. |
| `SUPERIOR_1`, `SUPERIOR_2`, `SUPERIOR_3` | `EDUCACION_SUPERIOR` | Ciclo post-bachillerato | `/MINEDEC/Estudiantes/EducacionSuperior` | Políticas de usuario adulto; acceso federado a portales de becas y educación superior. |
| `SIN_NIVEL` | `SIN_NIVEL` | Registros sin nivel claro | `/MINEDEC/Estudiantes` | OU de tránsito/fallback. Se genera alerta diaria para auditoría y reclasificación. |

---

## 3. Hoja 3: Especificación de API Scopes de Google Workspace y Distinción C1 vs C2.2

La Hoja 3 lista los scopes de Admin SDK y Cloud Identity del ecosistema general, junto con los límites de cuota de la Directory API (`2.400 consultas/minuto por proyecto`, `10 altas/s por dominio`, `1 creación/actualización de OU/s`).

En la arquitectura del proyecto, la responsabilidad sobre estos scopes se divide estrictamente así:

| Scope OAuth 2.0 en Google | Método API | Componente que lo Utiliza | Uso en C1.4 (Aprovisionamiento) vs C2.2 (Conecta MINEDEC) |
| :--- | :--- | :--- | :--- |
| `.../auth/admin.directory.user.readonly` | `users.get`, `users.list` | **`sa-workspace-reader` (Subcomponente C2.2)** | **Único scope utilizado por el Sincronizador de Conecta MINEDEC (`sa-sync` / `sa-sync-job`)** para leer los 21 atributos en modo de solo lectura (`RF-GI-05`). |
| `.../auth/admin.directory.user`<br>`.../auth/admin.directory.orgunit`<br>`.../auth/admin.directory.userschema`<br>`.../auth/admin.directory.group`<br>`.../auth/admin.directory.group.member`<br>`.../auth/cloud-identity.groups` | `insert`, `patch`, `create`, `delete` | **Motor de Aprovisionamiento C1.4 / Administración GWS** | Usados por los flujos de aprovisionamiento de cuentas y grupos en Workspace (C1.4). Conecta MINEDEC (C2.2) **no escribe en Workspace**, salvo que se habilite un job específico de suspensión por expiración de vigencia si así se parametriza. |
| `.../auth/admin.reports.audit.readonly`<br>`.../auth/admin.reports.usage.readonly` | `activities.list`, `userUsageReport.get` | **Cloud Logging Sink / Reportes Looker** | Alimenta los eventos de auditoría hacia Pub/Sub para la sincronización incremental y métricas de adopción. |

---

## 4. Documentos Relacionados

- [Esquema de Identidad `MINEDEC_Perfil` y Modelo de Datos en AlloyDB](identidad-esquema-minedec-perfil.md)
- [Modelo de Autorización Híbrido RBAC + ABAC y Grupos Lógicos](modelo-autorizacion-rbac-abac.md)
- [Actores, Poblaciones de Usuarios y Ciclo de Vida de Identidades](actores-y-poblaciones.md)
