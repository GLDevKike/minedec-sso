# Tasks: Autenticación M2M (`Client Credentials`), Catálogo JWKS Segregado y Rotación Dual (`005-autenticacion-m2m-rotacion`)

**Input**: Documentos de diseño en `/specs/005-autenticacion-m2m-rotacion/` ([plan.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/plan.md), [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/spec.md), [research.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/research.md), [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/data-model.md), [contracts/m2m-oauth-jwks-api.openapi.yaml](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/contracts/m2m-oauth-jwks-api.openapi.yaml), [quickstart.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/005-autenticacion-m2m-rotacion/quickstart.md)) y base de conocimiento OKF (`knowledge/index.md`)
**Prerequisites**: `plan.md` (requerido), `spec.md` (requerido para historias de usuario), `research.md`, `data-model.md`, `contracts/m2m-oauth-jwks-api.openapi.yaml`, `quickstart.md`

**Tests**: Las pruebas automatizadas unitarias e integración (`Jest + Supertest`) son **obligatorias** por la Constitución MINEDEC v2.11.0 (`cobertura >= 70 %` en líneas, funciones, ramas y sentencias) y por `SC-001` a `SC-006` de `spec.md`.

**Organization**: Las tareas están agrupadas por fases (Setup/Foundational, Historias de Usuario `US1` a `US4` en orden de prioridad `P1`, y Pruebas Automatizadas / Convergencia) para permitir implementación y validación independiente de cada incremento.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias bloqueantes en progreso).
- **[Story]**: Etiqueta de historia de usuario a la que pertenece la tarea (`[US1]` a `[US4]`). Las fases Setup, Foundational y Polish/Convergence no llevan etiqueta `[USX]`.
- Incluye rutas de archivo exactas en cada descripción para la arquitectura multirrepositorio en GitLab (`git.sitimapa.co`).

---

## Phase 1: Setup & Foundational (Gobernanza, Esquema SQL y Contratos)

- [X] T001 [P] Crear los artefactos Spec Kit de la funcionalidad `005-autenticacion-m2m-rotacion` (`spec.md`, `research.md`, `plan.md`, `data-model.md`, `quickstart.md`, `contracts/m2m-oauth-jwks-api.openapi.yaml` y `checklists/requirements.md`) en `specs/005-autenticacion-m2m-rotacion/`
- [X] T002 [P] Actualizar `.specify/feature.json` y la sección gestionada `SPECKIT START` / `SPECKIT END` en `AGENTS.md` registrando la feature `005-autenticacion-m2m-rotacion`
- [X] T003 Crear la migración SQL `../microservicios/pip-identity-service/migrations/006_m2m_credentials_jwks_lifecycle_audit.sql` ampliando el constraint `ck_auditoria_tipo_evento` de `auditoria_evento` con los eventos del ciclo de vida M2M y JWKS (`PDP_CREDENCIAL_M2M_CREADA`, `PDP_CREDENCIAL_M2M_ROTADA`, `PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA`, `PDP_CREDENCIAL_M2M_REVOCADA`, `PDP_JWKS_RETIRADO`) e índices operativos de expiración/rotación
- [X] T004 Extender los puertos del dominio en `../microservicios/motor-pdp/src/domain/ports/pdp.ports.ts` (`M2mCredentialRepositoryPort`, `PdpJwksKeyRepositoryPort`, `PdpL2CachePort` y `PdpTransactionalSecurityAuditRecord`) manteniendo 0 % de decoradores e imports de infraestructura

---

## Phase 2: User Story 1 - Emisión de Tokens M2M (`Client Credentials`) y Aislamiento de Alcance (Priority: P1)

- [X] T005 [US1] Verificar y reforzar en `../microservicios/motor-pdp/src/application/use-cases/issue-m2m-token.use-case.ts` la emisión de tokens `OAuth 2.0 Client Credentials` (`POST /api/v1/oauth/token`) con comparación en tiempo constante (`crypto.timingSafeEqual`), validación de expiración de rotación (`expira_rotacion_en > NOW()`) y auditoría transaccional `PDP_TOKEN_M2M_EMITIDO` / `PDP_TOKEN_M2M_RECHAZADO`
- [X] T006 [US1] Verificar el aislamiento estricto de alcance por aplicación en `../microservicios/motor-pdp/src/application/use-cases/evaluate-access.use-case.ts` (`403 FORBIDDEN_M2M_SCOPE` cuando un token `APLICACION_PATRON_1` intenta evaluar otra aplicación distinta a su `aplicacion_id`)

---

## Phase 3: User Story 2 - Ciclo de Vida y Rotación Dual de Secretos M2M (`<= 90 días`) sin Caída de Servicio (Priority: P1)

- [X] T007 [US2] Extender `AlloyDbM2mCredentialRepository` en `../microservicios/motor-pdp/src/infrastructure/database/repositories/alloydb-m2m-credential.repository.ts` con consultas 100 % parametrizadas (`$1..$n`) para `createCredential`, `rotateCredentialSecret` (`ACTIVA` -> `EN_ROTACION_GRACIA` moviendo `secreto_activo_hash` a `secreto_anterior_hash`), `expireGraceWindow` (`EN_ROTACION_GRACIA` -> `ACTIVA` limpiando `secreto_anterior_hash = NULL` y `gracia_hasta = NULL`) y `revokeCredentialEmergency`
- [X] T008 [US2] Implementar los casos de uso puros (100 % libres de decoradores) `ProvisionM2mCredentialUseCase`, `RotateM2mCredentialSecretUseCase` y `ExpireM2mCredentialGraceUseCase` en `../microservicios/motor-pdp/src/application/use-cases/manage-m2m-credentials.use-case.ts`, generando secretos CSPRNG (`>= 256 bits`), persistiendo solo hashes `SHA-256` (`CHAR(64)`), devolviendo `client_secret_unica_vez` una sola vez y auditando `PDP_CREDENCIAL_M2M_CREADA`, `PDP_CREDENCIAL_M2M_ROTADA` y `PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA`
- [X] T009 [US2] Agregar los esquemas de validación `zod` (`ProvisionM2mCredentialSchema` y `RotateM2mCredentialSchema`) en `../microservicios/motor-pdp/src/infrastructure/http/schemas/pdp-zod.schemas.ts`
- [X] T010 [US2] Implementar el controlador HTTP `M2mCredentialsController` en `../microservicios/motor-pdp/src/infrastructure/http/controllers/m2m-credentials.controller.ts` exponiendo `POST /internal/v1/pdp/m2m/credentials`, `POST /internal/v1/pdp/m2m/credentials/:clientId/rotate` y `POST /internal/v1/pdp/m2m/credentials/:clientId/expire-grace`

---

## Phase 4: User Story 3 - Revocación de Emergencia M2M (`< 1 h`) e Invalidación Inmediata de Tokens en Vuelo (`<= 300 s`) (Priority: P1)

- [X] T011 [US3] Extender `IoRedisPdpL2CacheAdapter` en `../microservicios/motor-pdp/src/infrastructure/cache/ioredis-pdp-l2-cache.adapter.ts` con `markM2mClientRevoked(clientId, ttlSeconds)` (`minedec:pdp:m2m_revoked:{client_id}`) e `isM2mClientRevoked(clientId)` respetando el límite duro `TTL <= 300 s` y degradación `Fail-Close`
- [X] T012 [US3] Implementar `RevokeM2mCredentialUseCase` en `../microservicios/motor-pdp/src/application/use-cases/manage-m2m-credentials.use-case.ts` y su endpoint `POST /internal/v1/pdp/m2m/credentials/:clientId/revoke` en `../microservicios/motor-pdp/src/infrastructure/http/controllers/m2m-credentials.controller.ts`, actualizando `estado_credencial = 'REVOCADA'`, marcando la revocación en caché L2 Redis y registrando `PDP_CREDENCIAL_M2M_REVOCADA`
- [X] T013 [US3] Actualizar `createM2mBearerAuthMiddleware` en `../microservicios/motor-pdp/src/infrastructure/http/middlewares/m2m-bearer-auth.middleware.ts` para verificar en cada petición a `POST /api/v1/access/evaluation` que el `client_id` del token Bearer no esté revocado en caché L2 ni en `M2mCredentialRepositoryPort`, rechazando de inmediato (`401 Unauthorized`) cualquier token en vuelo perteneciente a una credencial revocada

---

## Phase 5: User Story 4 - Gobierno Completo del Catálogo JWKS `RS256` Segregado (`MOTOR_PDP`) (Priority: P1)

- [X] T014 [US4] Extender `AlloyDbPdpJwksKeyRepository` en `../microservicios/motor-pdp/src/infrastructure/database/repositories/alloydb-pdp-jwks-key.repository.ts` con `retireGraceKey(kid)` para transicionar limpiamente llaves en `GRACIA_VERIFICACION` hacia `RETIRADA` (`retirada_en = NOW()`) asegurando aislamiento `servicio_emisor = 'MOTOR_PDP'`
- [X] T015 [US4] Implementar `RetirePdpJwksKeyUseCase` en `../microservicios/motor-pdp/src/application/use-cases/manage-pdp-jwks.use-case.ts` (con auditoría `PDP_JWKS_RETIRADO`) y exponer `POST /internal/v1/pdp/jwks/:kid/retire` en `../microservicios/motor-pdp/src/infrastructure/http/controllers/pdp-jwks.controller.ts`
- [X] T016 [US4] Conectar todos los nuevos casos de uso y controladores en el Composition Root (`../microservicios/motor-pdp/src/types.ts`, `../microservicios/motor-pdp/src/container.ts` y `../microservicios/motor-pdp/src/app.ts`) sin utilizar decoradores en las capas de dominio ni aplicación

---

## Phase 6: Pruebas Automatizadas, Cobertura (`>= 70 %`) y Convergencia

- [X] T017 [P] Crear suite de pruebas unitarias `../microservicios/motor-pdp/tests/unit/manage-m2m-credentials.use-case.spec.ts` validando entropía CSPRNG, invariantes de patrón, rotación dual, cierre de gracia y revocación
- [X] T018 [P] Crear suite de pruebas de integración `../microservicios/motor-pdp/tests/integration/m2m-credentials-lifecycle.controller.spec.ts` verificando el flujo completo de extremo a extremo (provisión -> emisión de token -> rotación dual sin caída -> cierre de gracia -> revocación de emergencia con rechazo inmediato de token Bearer en vuelo en `/api/v1/access/evaluation`)
- [X] T019 [P] Ampliar `../microservicios/motor-pdp/tests/integration/pdp-jwks-rotation.controller.spec.ts` para verificar el retiro limpio de llaves en gracia (`POST /internal/v1/pdp/jwks/:kid/retire` -> `RETIRADA` + evento `PDP_JWKS_RETIRADO`) además de la rotación y revocación de emergencia
- [X] T020 Ejecutar `npm test` y `npm run build` en `../microservicios/motor-pdp` verificando `0` errores de compilación TypeScript y cobertura global `>= 70 %`
