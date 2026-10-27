# Checklist de Calidad de Requerimientos (Integral — Seguridad y Arquitectura): Base de Identidades (Esquema MINEDEC_Perfil) y Catálogos del PIP

**Purpose**: Validar la completitud, claridad, consistencia, medibilidad y cobertura de riesgos de los requerimientos de negocio y seguridad escritos en `spec.md` para `001-modelo-identidades-perfil` (Compuerta de Revisión de Arquitectura y Seguridad — *Unit Tests for Requirements*)  
**Created**: 2026-10-14  
**Updated**: 2026-10-15  
**Feature**: [spec.md](../spec.md)

**Note**: Este checklist fue adaptado al alcance atómico de **`001-modelo-identidades-perfil`** con nivel de rigor **Compuerta de Revisión de Arquitectura y Seguridad (`Q2: A`)** y frontera de trazabilidad enfocada en **[`spec.md`](../spec.md) (`Q3: B`)**. Todos los ítems (`30/30`) han sido verificados y aprobados.

---

## Completitud de Requerimientos (Requirement Completeness)

- [x] CHK001 - ¿Están especificados explícitamente los 21 atributos canónicos (5 estándar del directorio y 16 personalizados de `MINEDEC_Perfil`) junto con su obligatoriedad universal o condicional para las cuatro poblaciones (`ESTUDIANTE`, `DOCENTE`, `ADMINISTRATIVO`, `EXTERNO`)? [Completeness, Spec §FR-002, §FR-006]
- [x] CHK002 - ¿Define la especificación las reglas completas de generación y preservación del identificador inmutable `idInterno` tanto cuando proviene del directorio institucional como cuando llega vacío o se origina en `REGISTRO_CALIENTE`? [Completeness, Spec §FR-001, §Clarifications]
- [x] CHK003 - ¿Están documentados todos los valores semilla iniciales y las reglas de dependencia jerárquica entre `tipoUsuario` y `subtipoUsuario` para los catálogos parametrizables gobernados en la plataforma? [Completeness, Spec §FR-004, §Assumptions]
- [x] CHK004 - ¿Define la especificación los requerimientos completos de separación entre la identidad de la persona física (`PersonaIdentidad`) y la vinculación tributaria/organizacional por `RUC` (`VinculacionOrganizacionRuc`), tanto para personas naturales con RUC como para representantes de personas jurídicas? [Completeness, Spec §FR-001, §FR-003, §Key Entities]
- [x] CHK005 - ¿Están definidos todos los estados del ciclo de vida de una anomalía en la Bandeja de Anomalías (`ABIERTA`, `LISTA_PARA_CERRAR`, `RESUELTA`), los orígenes de resolución (`AUTO_SINCRONIZACION`, `MANUAL_ADMIN`) y los campos de trazabilidad (`valorAnterior`, `valorNuevo`, `anomaliaAnteriorId`)? [Completeness, Spec §FR-013, §Key Entities]
- [x] CHK006 - ¿Están especificados todos los eventos del ciclo de vida de la identidad y los catálogos que deben generar obligatoriamente un registro en la bitácora de auditoría inmutable? [Completeness, Spec §FR-014]
- [x] CHK007 - ¿Están especificadas las interfaces de consulta y gestión requeridas para que el Motor de Autorización (PDP), el Sincronizador (`002-sincronizador-conciliacion-gws`) y la Consola de Administración (PAP) interactúen con el PIP? [Completeness, Spec §FR-015]

---

## Claridad y Precisión de Reglas de Dominio (Requirement Clarity)

- [x] CHK008 - ¿Están definidos sin ambigüedad los formatos, longitudes exactas, reglas de preservación de ceros a la izquierda (provincias `01` a `09`) y algoritmos de validación para `CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC` y `RUC`? [Clarity, Spec §FR-003, §Edge Cases]
- [x] CHK009 - ¿Es inequívoca la tabla de derivación determinística de `nivelAcademico` a partir de `gradoCurso` para la totalidad de los 17 valores del catálogo `gradoCurso`, incluyendo el comportamiento de sobrescritura ante valores discrepantes? [Clarity, Spec §FR-005, §Edge Cases]
- [x] CHK010 - ¿Está definida con precisión la regla de prelación para determinar si un `ESTUDIANTE` es menor de edad (priorizando `fechaNacimiento < 18 años` cuando existe y aplicando la regla por catálogo `gradoCurso`/`subtipoUsuario` en su ausencia) para exigir `representanteLegalCedula`? [Clarity, Spec §FR-006, §Clarifications]
- [x] CHK011 - ¿Especifica claramente la regla de negocio para personal `ADMINISTRATIVO` cuál es la condición exacta que determina si labora en un plantel educativo (haciendo obligatorio `codigoInstitucion`) frente a una dependencia administrativa (`codigoDependenciaAdmin`)? [Clarity, Spec §FR-006]
- [x] CHK012 - ¿Está claramente diferenciada la severidad `BLOQUEANTE` (`SIN_IDENTIFICACION_VALIDA`, `COLISION_IDENTIFICADOR`, `VIGENCIA_INVALIDA`) frente a la severidad `RESTRINGIDA` (`ATRIBUTO_OBLIGATORIO_FALTANTE`, `FORMATO_AMIE_INVALIDO`) y el nivel exacto de acceso que permite o deniega cada una? [Clarity, Spec §FR-013, §US-4]
- [x] CHK013 - ¿Está definido sin ambigüedad el nivel de acceso temporal (`RESTRINGIDA` limitado a rutas `AUTENTICADA` con vigencia máxima `<= 300 s`) otorgado a una `PersonaIdentidad` provisional en estado `PENDIENTE_IDENTIFICACION` durante el `REGISTRO_CALIENTE`? [Clarity, Spec §FR-012, §US-4]
- [x] CHK014 - ¿Están claramente especificados cuáles de los 21 atributos son considerados "atributos de acceso" cuya modificación en el repositorio central obliga a emitir una invalidación inmediata de caché? [Clarity, Spec §FR-009]

---

## Consistencia Interna de la Especificación (Requirement Consistency)

- [x] CHK015 - ¿Son consistentes las reglas del modelo de identidad entre `FR-001`, `FR-003` y la sección `Key Entities` al establecer que `PersonaIdentidad` solo admite documentos personales (`CEDULA`, `PASAPORTE`, `CODIGO_MINEDEC`) mientras que `RUC` se normaliza hacia `VinculacionOrganizacionRuc`? [Consistency, Spec §FR-001, §FR-003, §Key Entities]
- [x] CHK016 - ¿Existe total consistencia entre `FR-006`, `FR-013` y los escenarios de aceptación de `US-1`/`US-4` respecto a que la falta de `representanteLegalCedula` en estudiantes menores de edad se clasifica siempre con severidad `RESTRINGIDA` (no bloqueante)? [Consistency, Spec §FR-006, §FR-013, §US-1, §US-4]
- [x] CHK017 - ¿Son consistentes los subtipos de usuario que exigen vigencia temporal obligatoria (`fechaInicioVigencia` y `fechaFinVigencia`) entre el catálogo de `FR-004`, la matriz de obligatoriedad de `FR-006` y los casos borde de expiración? [Consistency, Spec §FR-004, §FR-006, §Edge Cases]
- [x] CHK018 - ¿Son consistentes los requerimientos de preservación y desactivación de sedes complementarias (`amies_asignados`) cuando `docenteMultisede = true` frente a cuando cambia a `docenteMultisede = false` entre `US-3`, `Edge Cases` y `FR-010`? [Consistency, Spec §US-3, §Edge Cases, §FR-010]
- [x] CHK019 - ¿Está claramente delimitada la frontera entre `001-modelo-identidades-perfil` (modelo de identidad en dos niveles, validador de 21 atributos, `REGISTRO_CALIENTE`, transición `CODIGO_MINEDEC` → `CEDULA`, multisede y bandeja de anomalías) y `002-sincronizador-conciliacion-gws` (pipeline asíncrono de 3 capas desde el directorio institucional y control de cuotas)? [Consistency, Spec §Contexto MINEDEC, §Assumptions]

---

## Calidad y Medibilidad de Criterios de Aceptación (Acceptance Criteria Quality & Measurability)

- [x] CHK020 - ¿Están cuantificados con umbrales objetivos y verificables los criterios de éxito sobre integridad de los 21 atributos, preservación del `0` inicial (`0%` de pérdida) y exactitud de derivación de `nivelAcademico` (`100%`)? [Measurability, Spec §SC-001]
- [x] CHK021 - ¿Están definidos con métricas verificables la ausencia de llamadas al directorio externo en el flujo de inicio de sesión (`0 solicitudes`) y la latencia de resolución local (`< 15 ms` p95)? [Measurability, Spec §SC-002]
- [x] CHK022 - ¿Son objetivamente verificables los tiempos de invalidación de caché tanto ante cambios de estado/atributos (`< 5 s` p95 nominal, `<= 300 s` límite duro) como en resolución de anomalías y transición `CODIGO_MINEDEC` → `CEDULA` (`< 5 s`)? [Acceptance Criteria, Spec §FR-009, §FR-011, §FR-013, §SC-004, §SC-005]
- [x] CHK023 - ¿Define la especificación criterios medibles de latencia (`< 500 ms` p95 en consultas administrativas) y paginación/filtrado (`hasta 100 registros por página`) para las interfaces administrativas de `FR-015`? [Measurability, Spec §FR-015, §SC-006]

---

## Cobertura de Escenarios, Excepciones y Recuperación (Scenario & Recovery Coverage)

- [x] CHK024 - ¿Están especificados los requerimientos de flujo alternativo y recuperación cuando el repositorio central recibe los 21 atributos de una cuenta provisional en `REGISTRO_CALIENTE` y descubre que su `(tipoIdentificacion, numeroIdentificacion)` ya pertenece a una `PersonaIdentidad` existente (re-vinculación y eliminación del registro provisional)? [Coverage, Alternate Flow, Spec §FR-012, §US-4]
- [x] CHK025 - ¿Define la especificación qué ocurre si la resolución prioritaria de un `REGISTRO_CALIENTE` descubre que la cuenta carece de `(tipoIdentificacion, numeroIdentificacion)` válido (registro de anomalía `BLOQUEANTE` y revocación en `< 5 s`) o si no se completa antes de expirar la vigencia provisional (`<= 300 s` con `fail-close`)? [Exception Flow, Spec §FR-012, §FR-013, §US-4]
- [x] CHK026 - ¿Están cubiertos los requerimientos de transición de estado y bloqueo para anomalías `COLISION_IDENTIFICADOR` cuando el conflicto desaparece en el directorio origen (paso a `LISTA_PARA_CERRAR` manteniendo el bloqueo hasta el cierre explícito de un Administrador de Seguridad)? [Coverage, Exception Flow, Spec §FR-013, §US-4]
- [x] CHK027 - ¿Define la especificación el comportamiento esperado cuando una anomalía previamente marcada como `RESUELTA` vuelve a presentarse sobre la misma cuenta en una actualización posterior (apertura de nueva anomalía enlazada mediante `anomaliaAnteriorId`)? [Coverage, Recovery Flow, Spec §FR-013]

---

## Casos Borde y Seguridad (Edge Cases & Security Invariants)

- [x] CHK028 - ¿Define la especificación cómo debe proceder el sistema cuando una cuenta con `tipoUsuario = EXTERNO` o `subtipoUsuario` temporal alcanza su `fechaFinVigencia` sin que ocurra ningún evento de modificación en el directorio institucional (`suspended` permanece en `false`)? [Edge Case, Completeness, Spec §Edge Cases, §FR-009]
- [x] CHK029 - ¿Están especificados como invariantes absolutos de seguridad tanto la prohibición de escritura hacia el directorio institucional (`modo estrictamente de solo lectura`) como la prohibición de consultas en tiempo real al directorio externo durante el inicio de sesión o autorización (`0 solicitudes`)? [Non-Functional, Security, Spec §FR-007, §FR-008, §SC-002]
- [x] CHK030 - ¿Están claramente establecidos los requerimientos de política de fallo cerrado (`fail-close`) para todas las condiciones críticas de identidad (cuentas suspendidas, vigencias vencidas, colisiones de identificador y falta de identificación válida)? [Non-Functional, Security, Spec §Edge Cases, §FR-012, §FR-013]

---

## Notes

- **Estado**: **30/30 ítems verificados y aprobados (`100%`)** el `2026-10-15`.
- Trazabilidad: **30/30 ítems (100%)** incluyen referencias explícitas a secciones de [`spec.md`](../spec.md) (`FR-001` a `FR-015`, `SC-001` a `SC-006`, `US-1` a `US-5`) y dimensiones de calidad.
