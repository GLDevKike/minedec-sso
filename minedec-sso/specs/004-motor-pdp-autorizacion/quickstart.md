# Guía de Validación Rápida: Motor de Autorización Central (motor-pdp)

**Feature**: `004-motor-pdp-autorizacion`  
**Date**: 2026-10-26  
**Status**: Ready for Implementation  
**Spec**: [spec.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/004-motor-pdp-autorizacion/spec.md) | **Data Model**: [data-model.md](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/004-motor-pdp-autorizacion/data-model.md) | **OpenAPI Contract**: [motor-pdp-api.openapi.yaml](file:///C:/Users/anarvaez/Documents/Projects/MINEDEC/SSO/Desarrollo/minedec-sso/specs/004-motor-pdp-autorizacion/contracts/motor-pdp-api.openapi.yaml)

---

## 1. Requisitos Previos y Entorno de Pruebas

Para ejecutar las validaciones locales de esta feature se requiere:
- Node.js 22 LTS y repositorios independientes en `../microservicios/shared` (`@minedec/shared` publicado en GitLab NPM Package Registry) y `../microservicios/motor-pdp` (`c2-sso/microservicios/motor-pdp`).
- Instancia local de pruebas de PostgreSQL 16 (AlloyDB compatible) y Redis 7.x.
- Variables de entorno de prueba configuradas (`PORT=8081`, `DATABASE_URL=...`, `REDIS_URL=...`, `NODE_ENV=test`).

Comando de inicio del servicio en modo desarrollo/pruebas:
```powershell
cd ..\microservicios\shared
npm ci
npm run build

cd ..\motor-pdp
npm ci
npm run dev
```

---

## 2. Escenarios de Validación Extremo a Extremo

### Escenario 1: Emisión de Token de Acceso M2M con Rotación Dual (`POST /api/v1/oauth/token`)

**Objetivo**: Probar la autenticación backend-a-backend de una aplicación cliente o PEP.

**Petición cURL**:
```bash
curl -X POST http://localhost:8081/api/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=client-calificaciones-backend&client_secret=secreto-m2m-calificaciones"
```

**Resultado esperado (HTTP 200 OK)**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6InBkcC1rZXktMDEiLC...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "pdp:evaluate"
}
```

**Verificación de rotación dual**:
- Invocar el endpoint con `secreto_anterior` durante la ventana `gracia_hasta`: debe responder `200 OK`.
- Invocar con secreto incorrecto o tras expirar la gracia: debe responder `401 Unauthorized`.

---

### Escenario 2: Evaluación Exitosa de Ruta Protegida con Aserción Criptográfica (`POST /api/v1/access/evaluation`)

**Objetivo**: Validar el cruce híbrido RBAC + ABAC para un docente titular que registra notas.

**Petición cURL**:
```bash
curl -X POST http://localhost:8081/api/v1/access/evaluation \
  -H "Authorization: Bearer <TOKEN_M2M_OBTENIDO>" \
  -H "Content-Type: application/json" \
  -H "X-Minedec-Request-Id: req-test-001" \
  -d '{
    "email_autenticado": "docente.titular@educacion.gob.ec",
    "uuid_aplicacion": "550e8400-e29b-41d4-a716-446655440000",
    "ruta_solicitada": "/api/v1/calificaciones/registro",
    "metodo_http": "POST",
    "atributos_contexto": {
      "ip_origen": "186.46.120.15",
      "user_agent": "Mozilla/5.0",
      "dispositivo_gestionado": true
    }
  }'
```

**Resultado esperado (HTTP 200 OK)**:
```json
{
  "autorizado": true,
  "codigo_decision": "AUTHZ_PERMITTED",
  "numero_identificacion": "1712345678",
  "tipo_identificacion": "CEDULA",
  "roles": ["DOCENTE_TITULAR"],
  "permisos": ["CALIFICACIONES_REGISTRAR"],
  "contexto_territorial": {
    "amie_titular": "17H00123",
    "amies_asignados": ["17H00123"],
    "nivel_jurisdiccion": "INSTITUCIONAL",
    "codigo_jurisdiccion": "17H00123",
    "zona": "ZONA_9",
    "distrito": "17D05"
  },
  "assertion_jwt": "eyJhbGciOiJSUzI1NiIsImtpZCI6InBkcC1rZXktMDEi...",
  "politicas_evaluadas": [
    "RUTA_PROTEGIDA:/api/v1/calificaciones/registro",
    "RBAC:DOCENTE_TITULAR",
    "ABAC:AMIE_COINCIDENTE"
  ],
  "cache_ttl_segundos": 300,
  "timestamp": "2026-10-26T14:30:00.125Z"
}
```

---

### Escenario 3: Denegación de Acceso por Política de Negocio (`AUTHZ_DENIED_POLICY`)

**Objetivo**: Probar que un usuario sin el rol o permiso requerido reciba `autorizado: false` con HTTP 200.

**Petición cURL**:
```bash
curl -X POST http://localhost:8081/api/v1/access/evaluation \
  -H "Authorization: Bearer <TOKEN_M2M_OBTENIDO>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_autenticado": "estudiante.regular@estudiantes.educacion.gob.ec",
    "uuid_aplicacion": "550e8400-e29b-41d4-a716-446655440000",
    "ruta_solicitada": "/api/v1/calificaciones/registro",
    "metodo_http": "POST"
  }'
```

**Resultado esperado (HTTP 200 OK)**:
```json
{
  "autorizado": false,
  "codigo_decision": "AUTHZ_DENIED_POLICY",
  "numero_identificacion": "1723456789",
  "tipo_identificacion": "CEDULA",
  "roles": ["ESTUDIANTE_REGULAR"],
  "permisos": [],
  "contexto_territorial": { ... },
  "assertion_jwt": "...",
  "politicas_evaluadas": [
    "RUTA_PROTEGIDA:/api/v1/calificaciones/registro",
    "DENEGADO_FALTA_PERMISO:CALIFICACIONES_REGISTRAR"
  ],
  "cache_ttl_segundos": 300,
  "timestamp": "2026-10-26T14:30:00.200Z"
}
```

---

### Escenario 4: Detección y Rechazo de Rutas Maliciosas / Path Traversal (`400 Bad Request`)

**Objetivo**: Verificar que secuencias ambiguas o de evasión de rutas sean neutralizadas inmediatamente.

**Petición cURL**:
```bash
curl -X POST http://localhost:8081/api/v1/access/evaluation \
  -H "Authorization: Bearer <TOKEN_M2M_OBTENIDO>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_autenticado": "docente.titular@educacion.gob.ec",
    "uuid_aplicacion": "550e8400-e29b-41d4-a716-446655440000",
    "ruta_solicitada": "/api/v1/calificaciones/..%2Fadmin%00/config",
    "metodo_http": "POST"
  }'
```

**Resultado esperado (HTTP 400 Bad Request)**:
```json
{
  "error": "BAD_REQUEST",
  "message": "Ruta solicitada ambigua o contiene secuencias no permitidas",
  "timestamp": "2026-10-26T14:30:00.300Z"
}
```

---

### Escenario 5: Validación de Políticas en Modo Sombra (*Shadow Mode*)

**Objetivo**: Comprobar que en una aplicación con `modo_sombra = true`, una solicitud denegada por política devuelva `autorizado: true` para no cortar tráfico, marcando la decisión proyectada y auditándola.

**Petición cURL**:
```bash
curl -X POST http://localhost:8081/api/v1/access/evaluation \
  -H "Authorization: Bearer <TOKEN_M2M_APP_SOMBRA>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_autenticado": "usuario.prueba@educacion.gob.ec",
    "uuid_aplicacion": "uuid-app-en-modo-sombra",
    "ruta_solicitada": "/api/v1/nuevo-modulo/accion",
    "metodo_http": "POST"
  }'
```

**Resultado esperado (HTTP 200 OK)**:
```json
{
  "autorizado": true,
  "codigo_decision": "AUTHZ_PERMITTED_SHADOW_MODE",
  "metadatos_depuracion": {
    "modo_sombra_activo": true,
    "decision_proyectada": "AUTHZ_DENIED_POLICY"
  },
  ...
}
```

---

### Escenario 6: Publicación de JWKS Exclusivo del PDP (`GET /api/v1/.well-known/jwks.json`)

**Objetivo**: Verificar que los clientes puedan descargar las claves públicas RSA activas y en periodo de gracia para verificar `assertion_jwt`.

**Petición cURL**:
```bash
curl -X GET http://localhost:8081/api/v1/.well-known/jwks.json
```

**Resultado esperado (HTTP 200 OK)**:
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "pdp-key-2026-10",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

---

### Escenario 7: Resiliencia y Postura Fail-Close ante Caída de Componentes

**Objetivo**: Simular la pérdida de conectividad con Redis y AlloyDB para asegurar que el sistema jamás abra accesos por omisión.

**Simulación**:
1. Detener el contenedor de base de datos o simular falla de socket.
2. Enviar petición a `POST /api/v1/access/evaluation`.

**Resultado esperado (HTTP 503 Service Unavailable)**:
```json
{
  "error": "SERVICE_UNAVAILABLE",
  "message": "Servicio de autorización no disponible temporalmente (Fail-Close)",
  "timestamp": "2026-10-26T14:30:00.500Z"
}
```

---

## 3. Comandos de Prueba Automatizada (Jest + Supertest)

Ejecución de la suite completa de pruebas unitarias y de integración del motor PDP en su repositorio independiente:
```powershell
cd ..\microservicios\motor-pdp

# Ejecutar tests de motor-pdp
npm test

# Ejecutar con cobertura de código (mínimo 70 % requerido en .gitlab-ci.yml)
npm test -- --coverage
```
