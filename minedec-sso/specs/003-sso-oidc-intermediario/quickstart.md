# Quickstart & Guía de Verificación: Servicio Intermediario Central de Inicio de Sesión Único (Identity Broker OIDC)

**Feature**: `003-sso-oidc-intermediario` | **Date**: 2026-10-26 | **Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/003-sso-oidc-intermediario/spec.md) | **Data Model**: [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/003-sso-oidc-intermediario/data-model.md) | **OpenAPI Contract**: [sso-oidc-api.openapi.yaml](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/003-sso-oidc-intermediario/contracts/sso-oidc-api.openapi.yaml)

---

## 1. Requisitos del Entorno de Desarrollo

- **Node.js**: v22 LTS (`node:22-alpine`) y **TypeScript**: v5.8+ (`strict: true`) en repositorios independientes (`../microservicios/shared`, `../microservicios/pip-identity-service`, `../microservicios/sincronizador`, `../microservicios/conciliacion-job`, `../microservicios/sso-oidc`) consumiendo `@minedec/shared` desde el **GitLab NPM Package Registry** (`https://git.sitimapa.co/api/v4/projects/<PROJECT_ID>/packages/npm/`)
- **Base de Datos Local**: PostgreSQL 16 / AlloyDB Omni (puerto `5432`)
- **Caché L2 y Almacenamiento de Sesiones OIDC**: Redis 7.x (puerto `6379`)
- **Runner de Pruebas (`Constitución V`)**: `Jest + Supertest` (100 % único runner unitario e integración, cobertura `>= 70 %`)
- **Inyección de Dependencias (`Constitución V` y `VI`)**: `InversifyJS` (`inversify`) configurado exclusivamente en `../microservicios/sso-oidc/src/container.ts` (Composition Root), manteniendo `domain/` y `application/` 100 % libres de decoradores `@injectable()` / `@inject()`.

---

## 2. Inicialización Rápida

```powershell
# 1. Compilar el paquete transversal @minedec/shared e instalar dependencias en sso-oidc
cd ..\microservicios\shared
npm ci
npm run build

cd ..\sso-oidc
npm ci

# 2. Levantar PostgreSQL 16 y Redis 7 para pruebas de integración
docker compose -f docker-compose.dev.yml up -d postgres redis

# 3. Ejecutar migraciones DDL estáticas versionadas (incluyendo 004_sso_oidc_broker_schema.sql)
npm run db:migrate
npm run db:seed:catalogs

# 4. Ejecutar suite completa de pruebas unitarias e integración con Jest + Supertest (meta >= 70% cobertura)
npm run test:coverage
```

---

## 3. Escenarios de Verificación Ejecutables

### Escenario 1: Inicio de Sesión OIDC + PKCE (`S256`), Federación con Único Cliente Google y Sesión Central Silenciosa Multi-Aplicación con Audiencia (`aud`) Exclusiva y Cero Roles (`US-1`, `US-2`, `FR-001`..`FR-006`, `FR-008`, `FR-009`, `SC-001`..`SC-003`)

Verifica que:
- `GET /.well-known/openid-configuration` anuncie los endpoints públicos de `https://login.sso.<dominio>`, soporte exclusivo de `code_challenge_methods_supported: ["S256"]`, `id_token_signing_alg_values_supported: ["RS256"]` y soporte de Back-Channel Logout.
- `GET /authorize` valide estrictamente `client_id` y coincidencia exacta de `redirect_uri` contra `cliente_oidc_redirect_uri` (soportando `>= 250` URIs sin límite de 100 de GCP, `SC-002`) y rechace cualquier solicitud sin `code_challenge` (`S256`) o con `redirect_uri` no registrada (sin redirigir nunca a un dominio externo no registrado).
- `GET /callback` valide criptográficamente el `id_token` de Google Cloud Identity, acepte cuentas de los subdominios institucionales (`@educacion.gob.ec`, `@estudiantes.educacion.gob.ec`, `@deporte.gob.ec`, `@cultura.gob.ec`), rechace cuentas de dominios externos (`@gmail.com`) con postura `fail-close`, cree la sesión central en Redis (`minedec:oidc:session:{sessionId}`) y emita un `code` de uso único (`TTL <= 60 s`).
- `POST /token` verifique `code_verifier` (`S256`), bloquee el reuso de un `code` ya consumido (`invalid_grant`, `SC-006`) y emita un `id_token` firmado con `RS256` que contenga `aud = client_id` exclusivo de la aplicación solicitante, `sub = id_interno`, `(tipo_identificacion, numero_identificacion)` canónico y **cero reclamos de roles o permisos** (`SC-003`).
- Cuando la misma persona navega a una segunda aplicación integrada, `GET /authorize` reutilice la sesión central activa en Redis sin volver a redirigir a Google y emita un nuevo `id_token` con `aud` exclusivo para la segunda aplicación.

```powershell
cd ..\microservicios\sso-oidc
npx jest tests/unit/oidc/pkce-and-redirect-uri-validator.spec.ts
npx jest tests/integration/oidc/authorize-callback-token-flow.spec.ts
npx jest tests/integration/oidc/multi-app-silent-sso-isolation.spec.ts
```

---

### Escenario 2: Resolución en el PIP y Reintento Corto Local Acotado (`<= 3 s`) en `REGISTRO_CALIENTE` con `Fail-Close` (`US-3`, `FR-007`, `Clarificación Q1`)

Verifica que:
- Cuando una cuenta institucional válida recién creada en Google Workspace inicia sesión por primera vez y aún no posee `numero_identificacion` en el PIP, `sso-oidc` dispare `REGISTRO_CALIENTE` (encolando la reconciliación prioritaria de `5 req/s` en `sso-sync-priority-hot-reg`) y ejecute un reintento corto acotado de hasta `3 segundos` consultando exclusivamente el PIP local / Redis (`0` llamadas directas a Google Admin SDK desde `sso-oidc`).
- **Subcaso 2A (Consolidación en `<= 3 s`)**: Si el sincronizador consolida `numero_identificacion` dentro de la ventana de `3 s`, `sso-oidc` completa el login y emite el `id_token` completo en el mismo intento.
- **Subcaso 2B (Persistencia en `PENDIENTE_IDENTIFICACION` tras `3 s` — `Fail-Close`)**: Si transcurridos los `3 s` la cuenta sigue sin `numero_identificacion`, `sso-oidc` deniega la emisión del `id_token` (`HTTP 403`) y devuelve el mensaje claro en español con opción de reintentar inicio de sesión.

```powershell
cd ..\microservicios\sso-oidc
npx jest tests/integration/oidc/hot-registration-bounded-wait.spec.ts
```

---

### Escenario 3: Cierre de Sesión Único Híbrido (SLO con OIDC Back-Channel Logout + Expiración `<= 300 s`) y Revocación Inmediata (`< 5 s` / Techo Duro `<= 300 s`) en Dos Niveles (`US-4`, `FR-010`, `FR-011`, `SC-004`, `Clarificación Q2`)

Verifica que:
- Al invocar `GET /logout` o `POST /logout`, `sso-oidc` destruya inmediatamente la sesión central en Redis, envíe asíncronamente peticiones `POST` con `logout_token` firmado con `RS256` a todas las URIs `BACKCHANNEL_LOGOUT` activas de las aplicaciones participantes y redirija al `post_logout_redirect_uri` validado.
- Al recibir un evento `POST /internal/v1/oidc/events/identity-revoked` desde `sso-pip-cache-invalidation`:
  - Si la baja es de una **`CuentaInstitucional`**, purgue en `< 5 s` únicamente las sesiones y códigos de esa cuenta, preservando las sesiones activas de otras cuentas de la misma `PersonaIdentidad`.
  - Si la baja es de la **`PersonaIdentidad`** raíz, purgue en cascada todas las sesiones de todas sus cuentas institucionales.
- Si transcurrieron `> 300 s` desde la última validación contra el PIP (`minedec:oidc:reval:{sessionId}` expirada), cualquier solicitud `GET /authorize` revalide obligatoriamente el estado de la cuenta en el PIP y rechace cuentas inactivas/suspendidas dentro del techo duro de **`<= 300 segundos`** (`RF-GI-06`, `RF-AUT-06`, `PI-07`, `SC-004`).

```powershell
cd ..\microservicios\sso-oidc
npx jest tests/integration/oidc/slo-and-revocation-300s-sla.spec.ts
```

---

### Escenario 4: Rotación Criptográfica Dual (`<= 90 Días`) y Revocación de Emergencia (`< 1 h`) Segregada por `servicio_emisor = 'SSO_OIDC'` (`US-5`, `FR-012`, `FR-013`, `SC-005`, `Clarificación Q3`)

Verifica que:
- `GET /jwks` en `sso-oidc` publique exclusivamente las claves públicas con `servicio_emisor = 'SSO_OIDC'` y `estado_llave IN ('ACTIVA_FIRMA', 'GRACIA_VERIFICACION')`, sin exponer jamás llaves de `MOTOR_PDP` ni llaves en estado `RETIRADA` o `REVOCADA`.
- Al rotar la llave (`POST /internal/v1/oidc/jwks/rotate`), los nuevos `id_token` se firmen con el nuevo `kid` (`ACTIVA_FIRMA`) mientras los `id_token` emitidos minutos antes sigan siendo verificables con el `kid` anterior en `GRACIA_VERIFICACION`.
- Al revocar de emergencia una llave (`POST /internal/v1/oidc/jwks/{kid}/revoke` con `REVOCADA`), desaparezca inmediatamente de `GET /jwks`.
- Los clientes confidenciales en `EN_ROTACION_GRACIA` puedan autenticarse en `POST /token` tanto con el secreto nuevo (`secreto_activo_hash`) como con el anterior (`secreto_anterior_hash`) mientras `NOW() <= gracia_hasta`.

```powershell
cd ..\microservicios\sso-oidc
npx jest tests/integration/oidc/jwks-and-client-secret-rotation.spec.ts
```

---

### Escenario 5: Paridad 1:1 SQL/DBML (`004_sso_oidc_broker_schema.sql`), Pureza Hexagonal (`InversifyJS`), Cero Cálculo de Latencia en Node.js e Infraestructura en `../iac-terraform` (`Constitución v2.11.0`)

Verifica que:
1. Las tablas `aplicacion`, `cliente_oidc`, `cliente_oidc_redirect_uri` y `llave_jwks_rotacion` (con `servicio_emisor` y `REVOCADA`) coincidan 1:1 entre `migrations/004_sso_oidc_broker_schema.sql`, `docs/esquemas-bd/etapa-2-autorizacion-pdp-pap-rbac-abac.dbml`, `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml` y `ALLOWED_PIP_SQL_IDENTIFIERS`.
2. `../microservicios/sso-oidc/src/container.ts` resuelva todas sus dependencias con `InversifyJS` manteniendo `domain/` y `application/` 100 % libres de decoradores.
3. Ningún archivo de `../microservicios/sso-oidc/src/` calcule duraciones por petición (`Date.now() - startedAt`, `performance.now()`, `process.hrtime()`) ni exponga campos de latencia en respuestas HTTP (`RNF-REN-01..06`, `D-06`, Principio V.4 y Principio XIII).
4. `../microservicios/sso-oidc/Dockerfile` utilice `node:22-alpine` con `USER node`, `.gitlab-ci.yml` utilice el runner institucional `gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com` (publicando en `sso-containers`), y el repositorio `../iac-terraform` valide los recursos de GKE Autopilot (`sa-sso-core`), External Application Load Balancer + Cloud Armor WAF (`sso-oidc-waf-policy`, `sin IAP delante`), Secret Manager y Shared VPC (`mec-003-sha-net-{des,pre,pro-511014}`) con `sa-infra-manager`.

```powershell
cd ..\microservicios\sso-oidc
npx jest tests/unit/sql-schema-alignment.spec.ts
npx jest tests/unit/container-wiring.spec.ts
npx jest tests/unit/devops-iac-alignment.spec.ts
```
