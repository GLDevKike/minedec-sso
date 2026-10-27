# Modelo de Datos Relacional y Caché (`data-model.md`) — Feature `005-autenticacion-m2m-rotacion`

**Rama**: `spec/005-autenticacion-m2m-rotacion`  
**Fuente Canónica DBML**: [`docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml`](../../docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml)  
**Motor Relacional**: AlloyDB for PostgreSQL 16 (`1FN / 3FN / BCNF`)  
**Motor de Caché L2**: Memorystore for Redis (`TTL <= 300 s`)

---

## 1. Entidades Relacionales en AlloyDB for PostgreSQL 16

### 1.1 Tabla `credencial_m2m` (Clientes OAuth 2.0 `Client Credentials`)

Almacena las credenciales de máquina a máquina autorizadas para solicitar tokens en `POST /api/v1/oauth/token` e invocar `POST /api/v1/access/evaluation`. Cumple estrictamente la prohibición constitucional de almacenar secretos en texto plano (solo hashes `SHA-256` hexadecimales de 64 caracteres).

| Columna | Tipo SQL | Restricciones | Descripción |
|---|---|---|---|
| `credencial_id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Identificador único interno de la credencial M2M. |
| `aplicacion_id` | `UUID` | `NULL REFERENCES aplicacion(aplicacion_id)` | Obligatorio cuando `tipo_cliente = 'APLICACION_PATRON_1'`; `NULL` cuando `tipo_cliente = 'PEP_PATRON_2'`. |
| `tipo_cliente` | `VARCHAR(32)` | `NOT NULL` | `'APLICACION_PATRON_1'` o `'PEP_PATRON_2'`. |
| `client_id` | `VARCHAR(128)` | `NOT NULL UNIQUE` | Identificador público del cliente OAuth 2.0 M2M. |
| `secreto_activo_hash` | `CHAR(64)` | `NOT NULL` | Resumen `SHA-256` (`hex` minúscula) del `client_secret` activo. |
| `secreto_anterior_hash` | `CHAR(64)` | `NULL` | Resumen `SHA-256` del secreto previo válido durante la ventana de rotación dual. |
| `gracia_hasta` | `TIMESTAMPTZ` | `NULL` | Límite temporal de validez de `secreto_anterior_hash` durante `EN_ROTACION_GRACIA`. |
| `expira_rotacion_en` | `TIMESTAMPTZ` | `NOT NULL` | Fecha máxima de rotación obligatoria (`<= creado_en / actualizado_en + 90 días`). |
| `scopes_permitidos` | `VARCHAR(255)` | `NOT NULL DEFAULT 'pdp:evaluate'` | Scopes autorizados separados por espacio. |
| `estado_credencial` | `VARCHAR(32)` | `NOT NULL DEFAULT 'ACTIVA'` | `'ACTIVA'`, `'EN_ROTACION_GRACIA'` o `'REVOCADA'`. |
| `creado_en` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Timestamp de provisión inicial. |
| `actualizado_en` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Timestamp de última rotación o cambio de estado. |

**Invariantes de Integridad (`CHECK` Constraints)**:
- `ck_m2m_tipo_cliente`: `tipo_cliente IN ('APLICACION_PATRON_1', 'PEP_PATRON_2')`
- `ck_m2m_estado`: `estado_credencial IN ('ACTIVA', 'EN_ROTACION_GRACIA', 'REVOCADA')`
- `ck_m2m_patron_alcance`: `(tipo_cliente = 'APLICACION_PATRON_1' AND aplicacion_id IS NOT NULL) OR (tipo_cliente = 'PEP_PATRON_2' AND aplicacion_id IS NULL)`
- `ck_m2m_rotacion_90_dias`: `expira_rotacion_en <= creado_en + INTERVAL '90 days'` (o `actualizado_en + INTERVAL '90 days'` tras rotaciones subsecuentes).
- `ck_m2m_gracia_coherente`: `(secreto_anterior_hash IS NULL AND gracia_hasta IS NULL) OR (secreto_anterior_hash IS NOT NULL AND gracia_hasta IS NOT NULL AND estado_credencial = 'EN_ROTACION_GRACIA')`

### 1.2 Tabla `llave_jwks_rotacion` (Catálogo Segregado de Llaves `RS256`)

Almacena los metadatos y llaves públicas `RS256` segregadas por `servicio_emisor` (`SSO_OIDC` vs `MOTOR_PDP`). Las llaves privadas jamás se almacenan en AlloyDB; residen en Google Secret Manager (`secret_manager_version`).

| Columna | Tipo SQL | Restricciones | Descripción |
|---|---|---|---|
| `kid` | `VARCHAR(64)` | `PRIMARY KEY` | Identificador único de la llave (`Key ID`) incluido en la cabecera JWS. |
| `servicio_emisor` | `VARCHAR(32)` | `NOT NULL DEFAULT 'MOTOR_PDP'` | `'SSO_OIDC'` o `'MOTOR_PDP'`. `motor-pdp` filtra e inserta exclusivamente `'MOTOR_PDP'`. |
| `algoritmo` | `VARCHAR(16)` | `NOT NULL DEFAULT 'RS256'` | Único algoritmo permitido: `'RS256'`. |
| `secret_manager_version` | `VARCHAR(255)` | `NOT NULL` | Ruta de versión en Secret Manager (`projects/*/secrets/*/versions/*`). |
| `public_jwk_json` | `JSONB` | `NOT NULL` | JWK público (`kty: 'RSA'`, `use: 'sig'`, `alg: 'RS256'`, `kid`, `n`, `e`). |
| `estado_llave` | `VARCHAR(32)` | `NOT NULL` | `'ACTIVA_FIRMA'`, `'GRACIA_VERIFICACION'`, `'RETIRADA'` o `'REVOCADA'`. |
| `activada_en` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Fecha de activación de la llave. |
| `expira_rotacion_en` | `TIMESTAMPTZ` | `NOT NULL` | Límite de rotación obligatoria (`<= activada_en + INTERVAL '90 days'`). |
| `retirada_en` | `TIMESTAMPTZ` | `NULL` | Timestamp en que la llave pasó a `RETIRADA` o `REVOCADA`. |

### 1.3 Tabla `auditoria_evento` (Eventos Transaccionales Encadenados `SHA-256`)

Nuevos tipos de evento incorporados al catálogo de auditoría forense (`ck_auditoria_tipo_evento`):
- `PDP_TOKEN_M2M_EMITIDO`
- `PDP_TOKEN_M2M_RECHAZADO`
- `PDP_CREDENCIAL_M2M_CREADA`
- `PDP_CREDENCIAL_M2M_ROTADA`
- `PDP_CREDENCIAL_M2M_GRACIA_EXPIRADA`
- `PDP_CREDENCIAL_M2M_REVOCADA`
- `PDP_JWKS_ROTADO`
- `PDP_JWKS_RETIRADO`
- `PDP_JWKS_REVOCADO_EMERGENCIA`

---

## 2. Estructuras en Memorystore for Redis (Caché L2)

| Patrón de Clave Redis | Tipo | TTL Máximo | Propósito |
|---|---|---|---|
| `minedec:pdp:m2m_revoked:{client_id}` | `STRING` (`"1"`) | `<= 300 s` | Marca de revocación reactiva para bloquear de inmediato tokens Bearer M2M en vuelo pertenecientes a un `client_id` revocado. |
| `minedec:pdp:bundle:{aplicacion_codigo}` | `STRING` (`JSON`) | `<= 300 s` | Bundle compilado de políticas RBAC+ABAC de una aplicación. |
| `minedec:pdp:decision:{aplicacion_codigo}:{id_interno}:{cuenta_id}:{version_catalogo}` | `STRING` (`JSON`) | `<= 300 s` | Decisión de autorización precalculada por sujeto y versión de catálogo. |
