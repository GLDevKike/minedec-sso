# Authorization, Security & Schema Alignment Checklist: Motor de Autorización Central (motor-pdp)

**Purpose**: Gate formal de calidad de requerimientos ("Unit Tests for Requirements") previo a `/speckit-tasks` y revisión por pares (PR Review), cubriendo Evaluación Híbrida RBAC×ABAC (`DA-12`), Seguridad Criptográfica M2M/JWKS (`<= 90 días`), Paridad Relacional 1FN/3FN/BCNF (AlloyDB + Redis L2 `<= 300 s`) y Resiliencia *Fail-Close*.
**Created**: 2026-10-23
**Feature**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/Conecta%20MINEDEC/specs/004-motor-pdp-autorizacion/spec.md) | [plan.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/Conecta%20MINEDEC/specs/004-motor-pdp-autorizacion/plan.md) | [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/Conecta%20MINEDEC/specs/004-motor-pdp-autorizacion/data-model.md) | [motor-pdp-api.openapi.yaml](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/Conecta%20MINEDEC/specs/004-motor-pdp-autorizacion/contracts/motor-pdp-api.openapi.yaml)

**Note**: Este checklist ha sido generado mediante `/speckit-checklist` con alcance acotado exclusivamente al servicio `motor-pdp`, la migración DDL `005` y la invalidación reactiva vía Cloud Pub/Sub (excluyendo los flujos administrativos de escritura de `api-pap` y `frontend` SPA).

---

## Requirement Completeness (Completitud de Requerimientos)

- [x] CHK001 ¿Están completamente especificados los campos de entrada obligatorios y opcionales de `POST /api/v1/access/evaluation` (incluyendo la condicionalidad mutua entre `uuid_aplicacion` y `host_solicitado`, y la opcionalidad de `email_autenticado`)? [Completeness, Spec §FR-001, §FR-002]
- [x] CHK002 ¿Están documentados los 6 códigos formales de decisión (`AUTHZ_PERMITTED`, `AUTHZ_PUBLIC_ROUTE`, `AUTHZ_AUTHENTICATED_ROUTE`, `AUTHZ_DENIED_POLICY`, `AUTHZ_USER_SUSPENDED`, `AUTHZ_OUTSIDE_VALIDITY_WINDOW`) junto con la variante de Modo Sombra (`AUTHZ_PERMITTED_SHADOW_MODE`)? [Completeness, Spec §FR-005, §FR-012]
- [x] CHK003 ¿Especifica el requerimiento de la aserción `X-Minedec-Assertion` (`assertion_jwt`) todos los claims obligatorios (`iss`, `sub`, `aud`, `jti`, `iat`, `exp`, `identificacion`, `roles`, `permisos`, `capacidades_crud`, `jurisdiccion`, `amie_titular`, `amies_asignados`) y el tiempo de vida máximo de `60 segundos`? [Completeness, Spec §FR-006]
- [x] CHK004 ¿Están definidos los dos métodos de autenticación M2M (`client_secret_basic` y `client_secret_post`) y el formato de respuesta OAuth 2.0 `client_credentials` en `POST /api/v1/oauth/token`? [Completeness, Spec §FR-007]
- [x] CHK005 ¿Documenta el modelo de datos las 4 capacidades CRUD booleanas (`puede_crear`, `puede_leer`, `puede_editar`, `puede_eliminar`) en `rol_permiso` y su correspondencia con `accion_crud_requerida` en `ruta_permiso_requerido`? [Completeness, Spec §FR-004, Data Model §3.4]

## Requirement Clarity (Claridad y Desambiguación)

- [x] CHK006 ¿Está definida sin ambigüedad la regla de resolución cuando un usuario satisface simultáneamente múltiples `grupo_logico` activos o asignaciones directas (unión aditiva `bool_or` sin duplicados de roles, perfiles `perfil` / `perfil_rol` / `grupo_logico_perfil`, permisos atómicos y capacidades CRUD)? [Clarity, Spec §Clarifications, §FR-004, Data Model §3.4–§3.6]
- [x] CHK007 ¿Está cuantificada y desambiguada la diferencia semántica entre `modo_evaluacion_permisos = 'ANY'` (OR lógico) y `modo_evaluacion_permisos = 'ALL'` (AND lógico) en `ruta_catalogo`? [Clarity, Spec §FR-004, Data Model §3.3]
- [x] CHK008 ¿Está especificado de forma determinista el orden de precedencia para coincidencia de rutas (`1. EXACTA`, `2. PREFIJO`, `3. EXTENSION`, desempatado por `orden_especificidad`) y el fallback a `politica_ruta_defecto`? [Clarity, Spec §FR-003, Data Model §3.3]
- [x] CHK009 ¿Define claramente la especificación el comportamiento cuando `email_autenticado` es nulo o vacío frente a rutas `PUBLICA` (`AUTHZ_PUBLIC_ROUTE` sin requerir identidad) frente a rutas `AUTENTICADA` o `PROTEGIDA` (`AUTHZ_DENIED_POLICY`)? [Clarity, Spec §Clarifications, §FR-001, §FR-005]
- [x] CHK010 ¿Está formalizada la gramática recursiva del AST JSON (`regla_cruce_abac_rbac`) con sus operadores lógicos (`AND`, `OR`) y comparadores (`EQUALS`, `NOT_EQUALS`, `IN`, `CONTAINS`, `EXISTS`) sobre los 21 atributos GWS? [Clarity, Spec §FR-004, Data Model §3.5]

## Requirement Consistency & Schema Parity (Consistencia y Paridad DBML / DDL)

- [x] CHK011 ¿Son consistentes los nombres de tablas y columnas de Etapa 1 referenciados por `motor-pdp` (`persona_identidad.id_interno`, `cuenta_institucional.email_principal`, `cuenta_institucional.suspended_en_gws`, `asignacion_contexto.activo`, `anomalia_identidad.estado_anomalia`) entre `spec.md`, `data-model.md`, los 4 archivos `.dbml` y las migraciones reales `001`..`004`? [Consistency, Spec §Key Entities, Data Model §2]
- [x] CHK012 ¿Coincide la definición de `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` y `llave_jwks_rotacion` en `data-model.md` y en los diagramas DBML exactamente con `migrations/004_sso_oidc_broker_schema.sql`? [Consistency, Data Model §3.1, §3.8]
- [x] CHK013 ¿Es consistente el scope M2M por defecto (`pdp:evaluate` conforme a `DA-12`) entre `spec.md`, `data-model.md`, `motor-pdp-api.openapi.yaml` y `etapa-3-seguridad-m2m-jwks-publicador.dbml`? [Consistency, Spec §FR-007, Data Model §3.7]
- [x] CHK014 ¿Existe consistencia entre la segregación criptográfica `servicio_emisor = 'MOTOR_PDP'` en `llave_jwks_rotacion` y el contrato del endpoint `GET /api/v1/.well-known/jwks.json` para no exponer llaves de `SSO_OIDC`? [Consistency, Spec §FR-013, Data Model §3.8]
- [x] CHK015 ¿Están alineadas las restricciones BCNF compuestas (`(aplicacion_id, ruta_id)`, `(aplicacion_id, permiso_id)`, `(aplicacion_id, rol_id)`, `(aplicacion_id, grupo_id)`) y el índice único parcial `uq_usuario_rol_ambito_activo` (`UNIQUE NULLS NOT DISTINCT WHERE activo = true`) entre `data-model.md` y los esquemas DBML? [Consistency, Data Model §3.3–§3.6]

## Acceptance Criteria Quality & Measurability (Calidad y Medibilidad de Criterios)

- [x] CHK016 ¿Es objetivamente verificable el criterio de aceptación del límite duro de revocación e invalidación de caché L2 (`TTL <= 300 segundos` y purga reactiva por Pub/Sub) en las claves `minedec:pdp:bundle:{aplicacion_codigo}` y `minedec:pdp:decision:{aplicacion_codigo}:{id_interno}:{cuenta_id}:{version_catalogo}`? [Measurability, Spec §FR-014, §SC-003]
- [x] CHK017 ¿Son medibles y verificables los criterios de rotación criptográfica dual (`<= 90 días`, `EN_ROTACION_GRACIA`, `gracia_hasta` para secretos M2M y llaves JWKS `RS256`) sin caída de servicio? [Measurability, Spec §FR-008, §FR-013, §SC-004]
- [x] CHK018 ¿Define la especificación criterios objetivos para auditar las decisiones de evaluación (`PDP_EVALUACION_PERMIT`, `PDP_EVALUACION_DENY`, `PDP_EVALUACION_SHADOW_PERMIT`) de forma asíncrona en streaming hacia BigQuery (`bq_auditoria_analitica_append_only`) y GCS WORM sin bloquear `auditoria_evento` en el camino crítico (`RNF-REN-01..06`, `D-06`), y soporta `modo_sombra` tanto en `aplicacion` como en `ruta_catalogo`? [Acceptance Criteria, Spec §FR-012, §FR-015, Data Model §3.1, §3.3, §6]

## Scenario & Edge Case Coverage (Cobertura de Escenarios y Casos Borde)

- [x] CHK019 ¿Están especificados los requisitos de rechazo perimetral (`HTTP 400 Bad Request` y auditoría de intento de evasión) ante rutas con secuencias ambiguas o *path traversal* (`..`, `%2e%2e`, `%2F`, `%5C`, `%00`, barras múltiples)? [Edge Case, Spec §FR-003, §Edge Cases]
- [x] CHK020 ¿Cubre la especificación el escenario de una cuenta institucional en estado `PENDIENTE_IDENTIFICACION` (`PROVISIONAL-<google_sub_id>`) o con `suspended_en_gws = true` / `estado_persona != 'ACTIVO'` intentando evaluar una ruta protegida? [Coverage, Exception Flow, Spec §FR-005, §FR-010, Data Model §2.1]
- [x] CHK021 ¿Están definidos los requerimientos de evaluación temporal cuando la fecha actual se encuentra fuera de la ventana `[fecha_inicio_vigencia, fecha_fin_vigencia]` tanto a nivel de `cuenta_institucional` como de `usuario_rol_aplicacion` (`AUTHZ_OUTSIDE_VALIDITY_WINDOW`)? [Edge Case, Spec §FR-005, §FR-009]
- [x] CHK022 ¿Contempla el modelo el escenario de docentes multisede (`docente_multisede = true`) con múltiples registros activos en `asignacion_contexto` (diferenciando `es_titular = true` de `amies_asignados`) y el acotamiento territorial en `usuario_rol_aplicacion`? [Coverage, Spec §User Story 2, Data Model §2.3, §3.6]
- [x] CHK023 ¿Está definido el comportamiento cuando una aplicación consultada no existe o su `estado_ciclo_vida` en AlloyDB es distinto de `PUBLICADO` (`BORRADOR`, `SUSPENDIDO`, `DESPUBLICADO`)? [Edge Case, Spec §FR-011, Data Model §3.1]
- [x] CHK024 ¿Documenta el modelo de datos tanto los clientes M2M de aplicaciones Patrón 1 (`tipo_cliente = 'APLICACION_PATRON_1'`, `aplicacion_id NOT NULL`) como el cliente M2M transversal del PEP perimetral Patrón 2 (`tipo_cliente = 'PEP_PATRON_2'`, `aplicacion_id NULL`)? [Coverage, Data Model §3.7]

## Non-Functional Requirements & Constitutional Compliance (RNF y Cumplimiento Constitucional)

- [x] CHK025 ¿Está explícitamente especificada la postura *Fail-Close* (`HTTP 503 Service Unavailable` con `Retry-After` y denegación total de acceso) cuando tanto Memorystore for Redis como AlloyDB for PostgreSQL no están disponibles o exceden el tiempo límite? [Non-Functional, Recovery/Exception Flow, Spec §FR-011, §SC-006]
- [x] CHK026 ¿Prohíben explícitamente los requerimientos, el plan técnico y los esquemas DBML cualquier cálculo de duración por petición (`Date.now() - startedAt`, `latencia_ms`, `latencia_total_ms`) en el código Node.js y en las respuestas HTTP (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII)? [Non-Functional, Consistency, Spec §FR-016, Plan §Performance Goals]
- [x] CHK027 ¿Prohíben los requerimientos y las proyecciones de caché Redis L2 cualquier modelado de `RUC` societario o personas jurídicas (`vinculaciones_ruc`, `rucs_vinculados`), garantizando el alcance exclusivo de personas naturales con clave natural `CEDULA` inmutable? [Non-Functional, Consistency, Spec §Assumptions, Data Model §4]
- [x] CHK028 ¿Exigen los requerimientos almacenamiento exclusivo de hashes SHA-256 en `credencial_m2m`, comparación en tiempo constante (`crypto.timingSafeEqual`) y custodia de llaves privadas `RS256` en Google Secret Manager (`Principio IX`)? [Non-Functional, Security, Spec §FR-007, §FR-008, §FR-013]

## Dependencies, Assumptions & Exclusion Boundaries (Dependencias y Fronteras de Alcance)

- [x] CHK029 ¿Están claramente delimitadas las fronteras de alcance excluyendo la administración de políticas (`api-pap` / `frontend` SPA) y la modificación de aplicaciones legadas (Subcomponente C2.3), e identificando la sincronización multirrepositorio entre `conecta-minedec-backend` y `minedec-sso-terraform`? [Boundaries, Spec §Assumptions, Plan §Summary]
- [x] CHK030 ¿Están citados los documentos autoritativos de la base OKF (`knowledge/index.md`, `DA-11`, `DA-12`) y de Google Developer Knowledge (`documents/docs.cloud.google.com/...`) en `spec.md`, `plan.md` y `research.md` conforme al Principio V.13? [Traceability, Dependency, Spec §Referencias OKF, Plan §Constitution Check]

---

## Notes

- Marcar cada ítem como completado (`[x]`) tras validar la trazabilidad del requerimiento o durante la revisión de PR.
- Todos los ítems evalúan la calidad, completitud y consistencia de los requerimientos y esquemas antes de generar `/speckit-tasks`.
