# Guía Rápida de Verificación (`quickstart.md`) — Feature `005-autenticacion-m2m-rotacion`

## 1. Ejecución de la Suite de Pruebas Unitarias e Integración (`Jest + Supertest`)

Desde el repositorio del microservicio `../microservicios/motor-pdp`:

```powershell
cd ..\microservicios\motor-pdp
npm test
```

La suite ejecuta:
- Pruebas unitarias de `ManageM2mCredentialsUseCase` (provisión CSPRNG, rotación dual `<= 90 días`, cierre de ventana de gracia y revocación de emergencia).
- Pruebas de integración de `POST /api/v1/oauth/token` (`oauth-token.controller.spec.ts`): Basic Auth, Body Auth, comparación en tiempo constante `timingSafeEqual`, ventana de gracia dual, bloqueo de clientes revocados/expirados y aislamiento de alcance `APLICACION_PATRON_1` vs `PEP_PATRON_2`.
- Pruebas de integración del ciclo de vida completo de credenciales M2M (`m2m-credentials-lifecycle.controller.spec.ts`): provisión inicial, rotación dual sin *downtime*, cierre de ventana de gracia y revocación de emergencia con invalidación inmediata de tokens M2M en vuelo en `POST /api/v1/access/evaluation`.
- Pruebas de integración del catálogo JWKS `RS256` (`pdp-jwks-rotation.controller.spec.ts`): publicación segregada `MOTOR_PDP`, rotación dual `ACTIVA_FIRMA` → `GRACIA_VERIFICACION`, retiro limpio `RETIRADA` y revocación de emergencia `REVOCADA`.

---

## 2. Flujo Manual de Verificación con `curl`

### 2.1 Aprovisionar una Credencial M2M (`APLICACION_PATRON_1`)

```bash
curl -X POST http://localhost:8081/internal/v1/pdp/m2m/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "m2m-siga-patron1",
    "tipo_cliente": "APLICACION_PATRON_1",
    "aplicacion_id": "11111111-2222-4333-8444-555555555555",
    "scopes_permitidos": "pdp:evaluate",
    "expires_in_days": 90
  }'
```

Respuesta (`201 Created`): entrega `client_secret_unica_vez` por única vez y persiste solo `secreto_activo_hash` (`SHA-256`).

### 2.2 Solicitar Token OAuth 2.0 `Client Credentials`

```bash
curl -X POST http://localhost:8081/api/v1/oauth/token \
  -u "m2m-siga-patron1:<client_secret_unica_vez>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&scope=pdp:evaluate"
```

### 2.3 Rotar el Secreto M2M con Ventana de Gracia Dual (`EN_ROTACION_GRACIA`)

```bash
curl -X POST http://localhost:8081/internal/v1/pdp/m2m/credentials/m2m-siga-patron1/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "grace_window_seconds": 86400,
    "expires_in_days": 90
  }'
```

Durante la ventana de gracia, tanto el secreto anterior como el nuevo `client_secret_unica_vez` emiten tokens válidos en `POST /api/v1/oauth/token`.

### 2.4 Cerrar la Ventana de Gracia (`ACTIVA`)

```bash
curl -X POST http://localhost:8081/internal/v1/pdp/m2m/credentials/m2m-siga-patron1/expire-grace
```

### 2.5 Revocar de Emergencia una Credencial M2M (`REVOCADA`)

```bash
curl -X POST http://localhost:8081/internal/v1/pdp/m2m/credentials/m2m-siga-patron1/revoke
```

Invalida de inmediato tanto `POST /api/v1/oauth/token` como cualquier `access_token` Bearer previamente emitido para `m2m-siga-patron1`.

### 2.6 Rotar, Retirar y Revocar Llaves JWKS (`MOTOR_PDP`)

```bash
# Consultar JWKS público
curl -i http://localhost:8081/api/v1/.well-known/jwks.json

# Rotar llave activa (la anterior pasa a GRACIA_VERIFICACION)
curl -X POST http://localhost:8081/internal/v1/pdp/jwks/rotate \
  -H "Content-Type: application/json" \
  -d '{"kid": "pdp-rs256-2026-q4"}'

# Retirar limpiamente la llave en gracia tras expirar cachés JWKS
curl -X POST http://localhost:8081/internal/v1/pdp/jwks/pdp-rs256-2026-q3/retire

# Revocar de emergencia una llave comprometida (< 1 h)
curl -X POST http://localhost:8081/internal/v1/pdp/jwks/pdp-rs256-2026-q4/revoke
```
