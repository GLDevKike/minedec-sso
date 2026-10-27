# Quickstart & Guía de Verificación: Base de Identidades (Esquema MINEDEC_Perfil) y Catálogos del PIP

**Feature**: `001-modelo-identidades-perfil` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/001-modelo-identidades-perfil/spec.md) | **Data Model**: [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/001-modelo-identidades-perfil/data-model.md)

---

## 1. Requisitos del Entorno de Desarrollo

- **Node.js**: v22 LTS (`node:22-alpine`) y **TypeScript**: v5.8+ (`strict: true`) en repositorios independientes (`../microservicios/shared` para `@minedec/shared` y `../microservicios/pip-identity-service`)
- **Registro de Paquetes**: GitLab NPM Package Registry (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`) para publicar y consumir `@minedec/shared`
- **Base de Datos Local**: PostgreSQL 16 / AlloyDB Omni (puerto `5432`)
- **Caché L2 Local**: Redis 7.x (puerto `6379`)
- **Runner de Pruebas (`Constitución V`)**: `Jest + Supertest` (100% único runner unitario e integración, cobertura `>= 70%`)
- **Inyección de Dependencias (`Constitución V` y `VI`)**: `InversifyJS` (`inversify`) configurado exclusivamente en `src/container.ts` (Composition Root) con `decorate(injectable(), ...)` externo, manteniendo `domain/` y `application/` 100% libres de decoradores.

---

## 2. Inicialización Rápida

```powershell
# 1. Compilar y probar el paquete transversal @minedec/shared
Set-Location ..\microservicios\shared
npm ci
npm run build
npm test

# 2. Instalar dependencias e inicializar pip-identity-service
Set-Location ..\pip-identity-service
npm ci

# 3. Levantar PostgreSQL 16 y Redis 7 para pruebas de integración
docker compose -f docker-compose.dev.yml up -d postgres redis

# 4. Ejecutar migraciones DDL estáticas versionadas y semillas del catálogo (D-03 + FO-DNTIC-20)
npm run db:migrate
npm run db:seed:catalogs

# 5. Ejecutar suite completa de pruebas unitarias e integración con Jest + Supertest (meta >= 70% cobertura)
npm run test:coverage
```

---

## 3. Escenarios de Verificación Ejecutables

### Escenario 1: Validación de los 21 Atributos, Ceros a la Izquierda (`01`–`09`), Homologación `FO-DNTIC-20` y Derivación Académica (`US-2`, `FR-002` a `FR-006`, `SC-001`)

Verifica que:
- Los códigos territoriales `codigoZona = "09"`, `codigoDistrito = "09D01"`, `codigoCircuito = "09D01C01"` y `codigoAMIE = "09H00123"` conserven sus ceros a la izquierda como cadenas exactas (`0%` de pérdida), y que si desde una extracción origen (`FO-DNTIC-20`) llega `ZONA = "9"`, se normalice automáticamente a `"09"`.
- `nivelAcademico` se derive determinísticamente a partir de `gradoCurso` (p. ej., `BGU_2` → `BGU`, `SUPERIOR_1` → `EDUCACION_SUPERIOR`) en el `100%` de los 17 valores del catálogo, y que los sinónimos de origen (`"8vo año Básica"` → `EGB_8`, `"TERCER NIVEL TECNOLÓGICO SUPERIOR"` → `EDUCACION_SUPERIOR`, `"NO APLICA JORNADA"` → `NO_APLICA`) se homologuen mediante `catalogo_atributo_minedec`.
- Para un estudiante con `fechaNacimiento` que indica `< 18 años` (o sin fecha de nacimiento pero con `gradoCurso = "EGB_8"` y `subtipoUsuario = "REGULAR"`), la falta de `representanteLegalCedula` abra una anomalía contextual `ATRIBUTO_OBLIGATORIO_FALTANTE` con efecto `RESTRINGIDA` (no bloqueante).
- Para personal `ADMINISTRATIVO`, se exija `codigoInstitucion` cuando `nivelEstructura` es `INSTITUCION_EDUCATIVA` y `codigoDependenciaAdmin` cuando es `PLANTA_CENTRAL`, `ZONA` o `DISTRITO`.

```powershell
npx jest tests/unit/domain/minedec-perfil-validator.spec.ts
```

---

### Escenario 2: Unificación Multi-Dominio en el Tenant Único de GWS y Normalización 3FN (`US-1`, `FR-001`, `FR-003`, `SC-002`, `SC-003`)

Verifica que:
- Una persona natural con cédula `0912345678` que posee simultáneamente cuentas en distintos subdominios poblacionales del único tenant de Google Workspace (`juan.perez@docentes.educacion.gob.ec` como `DOCENTE`, `juan.perez@educacion.gob.ec` como `ADMINISTRATIVO` y `juan.perez@estudiante.edu.ec` como `ESTUDIANTE`) se consolide en **un único registro `persona_identidad`** (`id_interno` UUID v4 inmutable) vinculado a sus filas en `cuenta_institucional` (`0` registros duplicados) y referenciando en 3FN a `catalogo_territorio_sede`.
- Si desde Google Workspace llega un profesional o contratista con un RUC de persona natural (`0912345678001`), el PIP extraiga y valide la `CEDULA` de 10 dígitos (`0912345678`) y unifique la `persona_identidad` bajo su cédula personal (y si llega un RUC jurídico con tercer dígito `6` o `9`, lo rechace con anomalía `SIN_IDENTIFICACION_VALIDA`).
- La consulta de resolución local (`POST /internal/v1/pip/identities/resolve`) responda desde caché L2 Redis en 1 salto con `0` llamadas salientes a Google Workspace.

```powershell
npx jest tests/integration/pip/multi-domain-unification.spec.ts
```

---

### Escenario 3: Preservación de Asignaciones Multisede (`US-3`, `FR-010`)

Verifica que cuando un docente tiene su sede primaria en `09H00123` (`origen_datos = 'GWS_PRIMARIO'`) y una segunda sede delegada en `09H00456` (`origen_datos = 'PAP_DELEGADO'`), cualquier actualización del perfil primario (`PUT /internal/v1/pip/identities/upsert`) actualice la sede primaria sin borrar ni sobrescribir la asignación `PAP_DELEGADO`, y que si `docenteMultisede` pasa a `false`, se desactiven las sedes complementarias conservando su historial.

```powershell
npx jest tests/integration/pip/multisede-context-preservation.spec.ts
```

---

### Escenario 4: Transición Unidireccional de `CODIGO_MINEDEC` a `CEDULA` e Inmutabilidad de `CEDULA` Consolidada (`US-3`, `FR-003`, `FR-011`, `SC-005`)

Verifica que cuando un estudiante extranjero o de primera infancia registrado con `tipoIdentificacion = 'CODIGO_MINEDEC'` actualiza su documento a `CEDULA`:
1. Se actualice la misma `persona_identidad` (`id_interno` UUID v4 intacto, protegiendo las llaves foráneas y la tabla `auditoria_evento` append-only) sin crear duplicados.
2. Se guarde el código previo en `codigo_minedec_anterior`.
3. Se purguen las claves de caché Redis tanto del `CODIGO_MINEDEC` anterior como de la nueva `CEDULA` en `< 5 s`.
4. Cualquier intento posterior de mutar una `CEDULA` ya consolidada o revertir `CEDULA` → `CODIGO_MINEDEC` sea rechazado y auditado (`Constitución X.2`).

```powershell
npx jest tests/integration/pip/codigo-minedec-to-cedula-transition.spec.ts
```

---

### Escenario 5: `REGISTRO_CALIENTE` con Identidad Provisional y Re-vinculación (`US-4`, `FR-012`)

Verifica que cuando un usuario recién creado en Google Workspace inicia sesión por OIDC antes de que llegue su evento de sincronización y el ID Token solo contiene `sub`, `email` y `name`:
1. `POST /internal/v1/pip/identities/resolve` **no invoque** la API de Google Workspace (`0` llamadas salientes en el camino crítico del login).
2. Cree la `cuenta_institucional` en `REGISTRO_CALIENTE` y una `persona_identidad` provisional en `PENDIENTE_IDENTIFICACION` con acceso `RESTRINGIDA` (solo rutas `AUTENTICADA` con TTL `<= 300 s`).
3. Emita la solicitud de sincronización prioritaria por cuenta (`prioritySyncQueued = true` hacia la cola `sso-sync-priority-hot-reg`).
4. Cuando `PUT /internal/v1/pip/identities/upsert` entregue los 21 atributos reales, re-vincule la cuenta a la `persona_identidad` existente (eliminando la provisional) o promueva la provisional a `ACTIVA`.

```powershell
npx jest tests/integration/pip/hot-registration-jit.spec.ts
```

---

### Escenario 6: Bandeja de Anomalías, Ciclo de Resolución y Purga de Caché (`US-4`, `US-5`, `FR-009`, `FR-013`, `SC-004`)

Verifica:
1. **Auto-resolución (`AUTO_SINCRONIZACION`)**: Cuando una cuenta con `FORMATO_AMIE_INVALIDO` o `SIN_IDENTIFICACION_VALIDA` recibe datos corregidos vía `PUT /internal/v1/pip/identities/upsert`, la anomalía pasa a `RESUELTA`, guarda `valor_anterior` y `valor_nuevo`, restaura el acceso y purga Redis vía `sso-pip-cache-invalidation` en `< 5 s`.
2. **Cierre explícito obligatorio para `COLISION_IDENTIFICADOR`**: Si dos cuentas comparten la misma cédula pero tienen nombres incompatibles, ambas quedan en `BLOQUEADA_ANOMALIA`. Si luego se corrige la cédula, la anomalía pasa a `LISTA_PARA_CERRAR`, pero **no desbloquea automáticamente** la identidad hasta que un Administrador de Seguridad invoque `POST /api/v1/admin/anomalies/{anomaliaId}/resolve` (`MANUAL_ADMIN`).
3. **Recurrencia enlazada**: Si una anomalía ya `RESUELTA` vuelve a ocurrir posteriormente, se crea un nuevo registro con `anomalia_anterior_id` apuntando al registro histórico previo.

```powershell
npx jest tests/integration/anomalies/anomaly-lifecycle.spec.ts
```

---

### Escenario 7: Auditoría de Esquema Relacional 3FN Pura y Defensa en Profundidad en AlloyDB (`FR-001`, `FR-003`, `FR-011`, `Constitución X.2 y XV`)

Verifica automáticamente que:
1. Las 8 tablas canónicas en 3FN (`dominio_institucional`, `catalogo_atributo_minedec`, `catalogo_territorio_sede`, `persona_identidad`, `cuenta_institucional`, `asignacion_contexto`, `anomalia_identidad`, `auditoria_evento`) y todas sus columnas coincidan 1:1 entre `migrations/001_init_pip_identity_schema.sql` y `docs/esquemas-bd/etapa-1-identidad-pip-auditoria.dbml`.
2. Todas las columnas utilizadas en sentencias `INSERT INTO` dentro de `migrations/002_seed_minedec_catalogs.sql`, los 4 repositorios PostgreSQL y `TransactionalAuditEventWriter` existan en el DDL y en la lista blanca `ALLOWED_PIP_SQL_IDENTIFIERS`.
3. Se encuentren activos los triggers de defensa en profundidad (`trg_enforce_cedula_immutability`, `trg_enforce_auditoria_append_only`), los índices únicos funcionales `LOWER()` y el bloqueo consultivo transaccional `pg_advisory_xact_lock(2026022001)` para la cadena SHA-256.

```powershell
npx jest tests/unit/sql-schema-alignment.spec.ts
```

---

### Escenario 8: Contenedorización `Non-Root`, Pipelines `.gitlab-ci.yml` e Infraestructura en 3 Capas en `iac-terraform` sobre Shared VPC (`Constitución v2.11.0`, Principios IV, XVI y XVIII)

Verifica la separación de responsabilidades entre los repositorios independientes en la rama `spec/001-modelo-identidades-perfil`:
1. **En `../microservicios/shared` y `../microservicios/pip-identity-service`**:
   - `@minedec/shared` define su publicación hacia el GitLab NPM Package Registry y es consumido como dependencia versionada por `pip-identity-service`.
   - `../microservicios/pip-identity-service/Dockerfile` construye en multi-stage sobre `node:22-alpine` y ejecuta con usuario sin privilegios (`USER node`).
   - `.gitlab-ci.yml` utiliza `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (metadata server, cero llaves JSON) para ejecutar `npm ci`, `npm run lint`, `npm audit`, pruebas con cobertura `>= 70%`, build de imagen y push a Artifact Registry (`sso-containers`) con `$CI_COMMIT_SHA`, sin archivos `.tf` en los repositorios de código.
2. **En `../iac-terraform` (`c2-sso/devops/iac-terraform`)**:
   - Estructura en **3 capas (`modulos/`, `plantillas/`, `despliegues/{des,pre,pro}/{devops,data,apps}`)** en Terraform HCL puro (`1.5.7`), empaquetada con `scripts/bundle.sh` y operando sobre la Shared VPC (`mec-003-sha-net-des`, `mec-003-sha-net-pre`, `mec-003-sha-net-pro-511014`) para los proyectos de servicio (`mec-003-sso-des`, `mec-003-sso-pre`, `mec-003-sso-pro`).
   - Pipeline `.gitlab-ci.yml` configurado para invocar Google Cloud Infrastructure Manager (`gcloud infra-manager previews create` y `gcloud infra-manager deployments apply`) mediante `sa-infra-manager@<project_id>.iam.gserviceaccount.com` y aprovisionar la cuenta de servicio `sa-sso-core`.

```powershell
# Validar formato y estructura de 3 capas en el repositorio de infraestructura
terraform -chdir="..\iac-terraform\modulos" fmt -check -recursive
terraform -chdir="..\iac-terraform\plantillas" fmt -check -recursive
terraform -chdir="..\iac-terraform\despliegues" fmt -check -recursive
npx jest tests/unit/devops-iac-alignment.spec.ts
```

---

### Escenario 9: Resiliencia ante Caídas de AlloyDB, OpenTelemetry, Logs Estandarizados y Diagnóstico en Lenguaje Natural para el Administrador (`T058`–`T060`)

Verifica que ante cualquier caída, mantenimiento o conmutación por error (Regional HA Failover) de AlloyDB for PostgreSQL 16 o degradación de dependencias:
1. **Explicación en Lenguaje Natural (`AdminIncidentDiagnosticReport`)**: El Administrador recibe tanto en `GET /internal/v1/pip/health/detailed`, como en las respuestas de error (`HTTP 503 Service Unavailable`) y en Cloud Logging (`jsonPayload.diagnosticoAdministrador`), un reporte claro en español que detalla:
   - **¿Qué pasó y por qué?** (`tituloLenguajeNatural` y `explicacionLenguajeNatural`).
   - **Impacto y Seguridad (`FAIL_CLOSE_ACTIVO`)**: Confirmación de que Conecta MINEDEC deniega de forma segura los accesos no verificables mientras las sesiones activas en Memorystore for Redis L2 continúan respondiendo dentro de su `TTL <= 300 s`.
   - **¿Cómo se levanta automáticamente la infraestructura?** (`comoSeLevantaYRecupera`): Conmutación HA Regional (`< 60 s`, `RPO = 0`), reconexión automática con retroceso exponencial en `PostgresDatabaseClient`, Respaldo Continuo (PITR 14 días) y respaldos diarios encriptados.
   - **Pasos de acción recomendados**: Comandos exactos `gcloud alloydb` para verificar estado, forzar failover o restaurar por PITR.
2. **OpenTelemetry y Logs Estandarizados**: Propagación de cabeceras `traceparent` (W3C) y `X-Cloud-Trace-Context`, instrumentación de spans (`withOtelSpan`) y formato estructurado compatible con Google Cloud Logging (`severity`, `logging.googleapis.com/trace`, `logging.googleapis.com/spanId`) con sanitización Zero-Secret.
3. **Monitoreo Proactivo y Alertas (`modulos/monitoring`)**: Métricas basadas en logs y políticas de alerta (`google_monitoring_alert_policy`) con documentación Markdown en lenguaje natural para el Administrador.

```powershell
npx jest tests/unit/observability-resilience.spec.ts
```
