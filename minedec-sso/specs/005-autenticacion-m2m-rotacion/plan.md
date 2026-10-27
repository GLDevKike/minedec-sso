# Plan de Implementación: Autenticación M2M (`Client Credentials`), Catálogo JWKS Segregado y Rotación Dual (`005-autenticacion-m2m-rotacion`)

**Rama**: `spec/005-autenticacion-m2m-rotacion` | **Fecha**: 2026-10-26 | **Especificación**: [`spec.md`](./spec.md)  
**Entrada**: Especificación de funcionalidad `specs/005-autenticacion-m2m-rotacion/spec.md`, modelo relacional `docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml` e investigación técnica `specs/005-autenticacion-m2m-rotacion/research.md`.

## Resumen Ejecutivo

Implementar de extremo a extremo en el microservicio `motor-pdp` (`../microservicios/motor-pdp`) y en las migraciones SQL de AlloyDB el subsistema de **Autenticación Máquina a Máquina (`OAuth 2.0 Client Credentials`), Ciclo de Vida y Rotación Dual de Credenciales M2M (`<= 90 días`), Revocación de Emergencia con Invalidación Inmediata de Tokens en Vuelo (`<= 300 s`) y Gobierno Completo del Catálogo JWKS `RS256` Segregado (`servicio_emisor = 'MOTOR_PDP'`)**.

## Contexto Técnico

- **Lenguaje / Versión**: TypeScript 5.8+ (`strict: true`) sobre Node.js 22 LTS (`node:22-alpine`).
- **Arquitectura y DI**: Arquitectura Hexagonal (Puertos y Adaptadores) + principios SOLID + DRY (`@minedec/shared`) + Inyección de Dependencias con `InversifyJS` confinada 100 % al Composition Root (`src/container.ts`), manteniendo `src/domain/` y `src/application/` 100 % libres de decoradores (`@injectable`, `@inject`).
- **Dependencias Principales**: `express` (v5), `inversify`, `zod`, `jose` (firma y verificación `RS256` de tokens M2M y `assertion_jwt`), `pg` + `pg-format` (AlloyDB for PostgreSQL 16), `ioredis` (Memorystore for Redis L2), `helmet`, `pino`, `@minedec/shared`.
- **Almacenamiento**:
  - **AlloyDB for PostgreSQL 16**: Tablas `credencial_m2m`, `llave_jwks_rotacion` y `auditoria_evento` (`append-only` con encadenamiento `SHA-256`).
  - **Memorystore for Redis (Caché L2)**: Clave de revocación reactiva `minedec:pdp:m2m_revoked:{client_id}` (`TTL <= 300 s`) y caché de decisiones/bundles.
  - **Google Secret Manager**: Custodia de versiones de llaves privadas `RS256` (`secret_manager_version`) y secretos M2M consumidos por clientes autorizados.
- **Pruebas y Calidad**: `Jest + Supertest` con cobertura obligatoria `>= 70 %` en líneas, funciones, ramas y sentencias.
- **Plataforma Objetivo**: GKE Autopilot en los proyectos de servicio `mec-003-sso-des`, `mec-003-sso-pre` y `mec-003-sso-pro` sobre la Shared VPC (`mec-003-sha-net-*`, o VPC local equivalente en `mec-003-sso-des` para pruebas), utilizando exclusivamente la segmentación oficial de red de 3 máscaras (`/24` para la subred primaria `snet-sso-ue1` de GKE + Cloud Run Direct VPC Egress, `/23` dividido en dos `/24` contiguos para Private Services Access `psa-sso-sql-<ambiente>` de AlloyDB/Cloud SQL y `psa-sso-<ambiente>` de Redis, y `/20` dividido en dos `/21` contiguos para los rangos secundarios GKE `pods` y `services`).
- **Restricciones de Rendimiento y Observabilidad**: Prohibición absoluta de calcular duraciones (`Date.now() - startedAt`) o exponer campos de latencia en respuestas HTTP de Node.js (Principio V.4 y XIII).

## Documentación Oficial Verificada en Google Developer Knowledge

Conforme a la regla obligatoria de verificación contra `google-developer-knowledge` (`AGENTS.md`), este plan se respalda en los siguientes documentos oficiales consultados:

1. `documents/docs.cloud.google.com/secret-manager/docs/rotation-recommendations` (rotación sin tiempo de inactividad con convivencia de versión activa y versión previa en gracia).
2. `documents/docs.cloud.google.com/secret-manager/docs/secret-rotation` (flujo de rotación periódica de secretos con Cloud Scheduler y Pub/Sub).
3. `documents/docs.cloud.google.com/secret-manager/regional-secrets/about-rotation-schedules-rs` (configuración de `rotation_period` `<= 90 días`).
4. `documents/docs.cloud.google.com/iam/docs/roles-permissions/secretmanager` (principio de mínimo privilegio con `roles/secretmanager.secretAccessor`).
5. `documents/docs.cloud.google.com/apigee/docs/api-platform/reference/policies/verify-jwt-policy` (consumo y caché de endpoints JWKS `RS256` por `kid` en el PEP Apigee X).
6. `documents/docs.cloud.google.com/apigee/docs/api-platform/reference/policies/jwt-policies-overview` (verificación de cabeceras JWS `kid` y claims estándar en JWT).

## Verificación de Cumplimiento Constitucional (*Constitution Check*)

| Principio Constitucional (v2.11.0) | Estado | Mecanismo de Cumplimiento en Feature `005` |
|---|---|---|
| **III / XVIII. Arquitectura Hexagonal + DI limpia en Composition Root** | CUMPLE | `IssueM2mTokenUseCase`, `ProvisionM2mCredentialUseCase`, `RotateM2mCredentialSecretUseCase`, `ExpireM2mCredentialGraceUseCase`, `RevokeM2mCredentialUseCase`, `GetPdpJwksUseCase`, `RotatePdpJwksKeyUseCase`, `RetirePdpJwksKeyUseCase` y `RevokePdpJwksKeyUseCase` son clases TypeScript puras sin `@injectable()` ni `@inject()`, ensambladas únicamente en `src/container.ts`. |
| **IV / IX / XVI. Cero Secretos en Código/BD y Rotación `<= 90 días`** | CUMPLE | `credencial_m2m` persiste exclusivamente hashes `SHA-256` (`CHAR(64)`) en `secreto_activo_hash` y `secreto_anterior_hash`; `llave_jwks_rotacion` persiste solo el JWK público y `secret_manager_version`; invariante `expira_rotacion_en <= NOW() + 90 días` y comparación `crypto.timingSafeEqual`. |
| **V.4 / XIII. Cero Telemetría de Latencia en Node.js** | CUMPLE | Ningún controlador ni caso de uso calcula tiempos de ejecución ni inyecta campos `latency_ms` / `duration_ms` en payloads o cabeceras HTTP. |
| **X. Revocación Verificable `<= 300 s` y `Fail-Close`** | CUMPLE | La revocación de emergencia de un `client_id` M2M invalida en tiempo real (`<= 300 s`) los tokens Bearer en vuelo en `m2mBearerAuthMiddleware` mediante verificación en caché L2 Redis + repositorio. |
| **XIV. Consultas SQL 100 % Parametrizadas + Allowlist** | CUMPLE | Todas las consultas en `AlloyDbM2mCredentialRepository` y `AlloyDbPdpJwksKeyRepository` usan parámetros posicionales `$1..$n` y validan identificadores con `assertSafeSqlIdentifier`. |
| **XV. Auditoría Forense Inmutable de 3 Capas** | CUMPLE | Todos los eventos M2M y JWKS se escriben transaccionalmente en `auditoria_evento` con bloqueo consultivo `pg_advisory_xact_lock` y cadena `SHA-256`. |

## Estructura del Proyecto y Artefactos

### 1. Gobernanza y Especificaciones (`minedec-sso`)

```text
specs/005-autenticacion-m2m-rotacion/
├── spec.md                                    # Especificación funcional (US1..US4, FR-001..FR-012, SC-001..SC-006)
├── research.md                                # Investigación y citas de Google Developer Knowledge
├── plan.md                                    # Este plan de implementación
├── data-model.md                              # Modelo relacional 3FN/BCNF (credencial_m2m, llave_jwks_rotacion) y claves Redis L2
├── quickstart.md                              # Guía de verificación de extremo a extremo
├── checklists/
│   └── requirements.md                        # Checklist de calidad y seguridad OWASP / Constitución
├── contracts/
│   └── m2m-oauth-jwks-api.openapi.yaml        # Contrato OpenAPI 3.1 completo
└── tasks.md                                   # Lista ordenada de tareas de implementación (T001..T030)
```

### 2. Microservicio Motor PDP (`../microservicios/motor-pdp`) y Migraciones SQL (`../microservicios/pip-identity-service/migrations`)

```text
../microservicios/pip-identity-service/migrations/
└── 006_m2m_credentials_jwks_lifecycle_audit.sql  # Ampliación de ck_auditoria_tipo_evento e índices para ciclo M2M y JWKS

../microservicios/motor-pdp/
├── src/
│   ├── domain/
│   │   ├── entities/pdp-domain.entities.ts       # Entidades M2mClientCredential, M2mTokenClaims, PdpSigningKeyRecord
│   │   ├── errors/pdp-domain.errors.ts           # Errores tipados de dominio M2M y JWKS
│   │   └── ports/pdp.ports.ts                    # M2mCredentialRepositoryPort, PdpJwksKeyRepositoryPort, PdpL2CachePort, PdpAuditPort
│   ├── application/
│   │   └── use-cases/
│   │       ├── issue-m2m-token.use-case.ts       # Emisión OAuth 2.0 Client Credentials con timingSafeEqual y ventana de gracia
│   │       ├── manage-m2m-credentials.use-case.ts # Provisión CSPRNG, rotación dual <= 90d, cierre de gracia y revocación de emergencia
│   │       └── manage-pdp-jwks.use-case.ts       # Publicación JWKS, rotación RS256, retiro limpio (RETIRADA) y revocación (REVOCADA)
│   ├── infrastructure/
│   │   ├── cache/ioredis-pdp-l2-cache.adapter.ts # Marca e inspección de revocación M2M en caché L2 (TTL <= 300 s)
│   │   ├── crypto/jose-pdp-assertion-signer.adapter.ts # Firma/verificación RS256 con llaves segregadas MOTOR_PDP
│   │   ├── database/repositories/
│   │   │   ├── alloydb-m2m-credential.repository.ts # CRUD + rotación dual + expiración de gracia + revocación SQL parametrizada
│   │   │   └── alloydb-pdp-jwks-key.repository.ts   # Listado, rotación, retiro limpio (RETIRADA) y revocación (REVOCADA)
│   │   └── http/
│   │       ├── controllers/
│   │       │   ├── oauth-token.controller.ts     # POST /api/v1/oauth/token
│   │       │   ├── m2m-credentials.controller.ts # POST /internal/v1/pdp/m2m/credentials/*
│   │       │   └── pdp-jwks.controller.ts        # GET /api/v1/.well-known/jwks.json y POST /internal/v1/pdp/jwks/*
│   │       ├── middlewares/
│   │       │   └── m2m-bearer-auth.middleware.ts # Verificación de firma RS256 + bloqueo inmediato de credenciales revocadas
│   │       └── schemas/pdp-zod.schemas.ts        # Esquemas Zod para provisión/rotación M2M y JWKS
│   ├── types.ts                                  # Símbolos de inyección del Composition Root
│   ├── container.ts                              # Binding limpio en InversifyJS sin decoradores en dominio/aplicación
│   └── app.ts                                    # Rutas Express 5 + Helmet Nivel A + Fail-Close
└── tests/
    ├── unit/
    │   └── manage-m2m-credentials.use-case.spec.ts
    └── integration/
        ├── oauth-token.controller.spec.ts
        ├── m2m-credentials-lifecycle.controller.spec.ts
        └── pdp-jwks-rotation.controller.spec.ts
```
