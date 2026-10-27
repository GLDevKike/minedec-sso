# Investigación Técnica y Decisiones de Diseño (`research.md`) — Feature `005-autenticacion-m2m-rotacion`

**Rama**: `spec/005-autenticacion-m2m-rotacion`  
**Fecha**: 2026-10-26  
**Alcance**: Autenticación Máquina a Máquina (`OAuth 2.0 Client Credentials`), ciclo de vida completo de credenciales M2M con rotación dual (`<= 90 días`), invalidación inmediata de tokens M2M en vuelo (`<= 300 s`) y gobierno del catálogo JWKS `RS256` segregado (`servicio_emisor = 'MOTOR_PDP'`).

---

## 1. Verificación Obligatoria en Google Developer Knowledge (`retrieving-developer-knowledge`)

En cumplimiento estricto de `AGENTS.md` y la Constitución MINEDEC v2.11.0, todas las decisiones sobre rotación de secretos en Google Secret Manager, permisos IAM de cuentas de servicio y verificación de tokens JWT/JWKS en puertas de enlace perimetrales (Apigee X / Envoy) fueron verificadas contra la documentación oficial vigente mediante el servidor MCP `google-developer-knowledge`:

| Recurso Documental Autoritativo (`documents/...`) | Hallazgo Oficial Aplicado al Diseño |
|---|---|
| `documents/docs.cloud.google.com/secret-manager/docs/rotation-recommendations` | **Recomendaciones de Rotación sin Tiempo de Inactividad (*Zero-Downtime Rotation*)**: Google Cloud establece que los consumidores no deben fijar (*pin*) versiones estáticas en código y que durante la rotación debe mantenerse una ventana de convivencia donde la versión anterior siga habilitada (*enabled*) para validación mientras las instancias adoptan la nueva versión, deshabilitando o destruyendo la versión anterior únicamente después de que expire la ventana de propagación. Esto sustenta la arquitectura de doble hash (`secreto_activo_hash` + `secreto_anterior_hash` con `gracia_hasta`) en `credencial_m2m` y el doble estado (`ACTIVA_FIRMA` + `GRACIA_VERIFICACION` antes de `RETIRADA`) en `llave_jwks_rotacion`. |
| `documents/docs.cloud.google.com/secret-manager/docs/secret-rotation` | **Rotación Basada en Calendario y Notificaciones Pub/Sub**: Secret Manager publica notificaciones `SECRET_ROTATE` en Cloud Pub/Sub según `rotation_period` y `next_rotation_time`, permitiendo orquestar rotaciones periódicas (`<= 90 días`) donde se añade una nueva versión del secreto (`SecretVersion`) y se actualiza el catálogo operativo sin reiniciar los contenedores de GKE Autopilot. |
| `documents/docs.cloud.google.com/secret-manager/regional-secrets/about-rotation-schedules-rs` | **Frecuencia y Ventanas de Rotación**: Los cronogramas de rotación definen `rotation_period` (en este proyecto `<= 90 días` / `7776000s` por mandato constitucional) y permiten desacoplar la creación de la nueva versión criptográfica del retiro definitivo de la versión saliente. |
| `documents/docs.cloud.google.com/iam/docs/roles-permissions/secretmanager` | **Segregación de Mínimo Privilegio en IAM (`roles/secretmanager.secretAccessor`)**: El rol `roles/secretmanager.secretAccessor` otorga exclusivamente `secretmanager.versions.access` sobre el payload del secreto, sin permisos para listar todos los secretos del proyecto ni destruir versiones (`secretmanager.versions.destroy`). La cuenta `sa-sso-core` utiliza acceso de mínimo privilegio para leer las versiones de llaves privadas `RS256` referenciadas en `llave_jwks_rotacion.secret_manager_version`. |
| `documents/docs.cloud.google.com/apigee/docs/api-platform/reference/policies/verify-jwt-policy` | **Verificación de JWT con `PublicKey/JWKS` en Apigee X (`VerifyJWT`)**: La política `VerifyJWT` de Apigee X descarga el conjunto de llaves públicas desde una URI JWKS (`<PublicKey><JWKS uri="..."/></PublicKey>`), selecciona automáticamente la llave pública cuyo `kid` coincide con la cabecera del JWT (`RS256`) y mantiene en caché el JWKS. Por ello, durante una rotación de llaves en `motor-pdp`, la llave saliente debe permanecer publicada en `GET /api/v1/.well-known/jwks.json` bajo `estado_llave = 'GRACIA_VERIFICACION'` hasta que expiren los JWT firmados con ese `kid` y la caché JWKS del verificador, antes de pasar a `RETIRADA`. |
| `documents/docs.cloud.google.com/apigee/docs/api-platform/reference/policies/jwt-policies-overview` | **Estándares JWS y Cabecera `kid`**: Apigee X y Envoy validan firmas `RS256` e inspeccionan las reclamaciones estándar (`iss`, `sub`, `aud`, `exp`, `iat`, `jti`) junto con el identificador `kid` del encabezado JWS para resolver la llave pública exacta dentro del JWKS sin reiniciar los proxies. |

---

## 2. Decisiones Técnicas Clave

### Decisión 1: Ciclo de Vida Completo y Rotación Dual de Secretos M2M (`credencial_m2m`)
- **Decisión**: Implementar en `AlloyDbM2mCredentialRepository` y `ManageM2mCredentialsUseCase` las 4 operaciones del ciclo de vida de `credencial_m2m`:
  1. **Aprovisionamiento (`createCredential`)**: Genera un secreto CSPRNG de `32 bytes` (`256 bits`) codificado en `base64url` (`m2m_sec_<random>`), calcula su resumen `SHA-256` (`CHAR(64)`), valida el invariante `ck_m2m_patron_alcance` (`APLICACION_PATRON_1` exige `aplicacion_id UUID`; `PEP_PATRON_2` exige `aplicacion_id = NULL`), fija `expira_rotacion_en = NOW() + <= 90 días` y devuelve el secreto en texto plano **una única vez**.
  2. **Rotación Dual (`rotateCredentialSecret`)**: Desplaza el `secreto_activo_hash` actual hacia `secreto_anterior_hash`, registra el hash del nuevo secreto en `secreto_activo_hash`, cambia `estado_credencial` a `'EN_ROTACION_GRACIA'`, establece `gracia_hasta = NOW() + graceWindowSeconds` (por defecto `86400 s` = 24 h) y renueva `expira_rotacion_en <= NOW() + 90 días`.
  3. **Cierre de Ventana de Gracia (`expireGraceWindow`)**: Limpia `secreto_anterior_hash = NULL` y `gracia_hasta = NULL` y restablece `estado_credencial = 'ACTIVA'`, invalidando definitivamente el secreto anterior.
  4. **Revocación de Emergencia (`revokeCredentialEmergency`)**: Cambia inmediatamente `estado_credencial = 'REVOCADA'`, limpia `secreto_anterior_hash = NULL` y `gracia_hasta = NULL` y registra la revocación en caché L2 Redis.
- **Justificación**: Satisface el Principio IX y XVI de la Constitución (cero secretos en texto plano en AlloyDB, rotación `<= 90 días` y ventana de gracia dual sin interrupción de tráfico entre el PEP / aplicaciones Patrón 1 y el PDP).
- **Alternativas descartadas**:
  - *Reemplazo destructivo inmediato del secreto*: Descartado porque causaría errores `401 Unauthorized` en todas las instancias de Apigee X / Envoy o aplicaciones Patrón 1 mientras se propaga el nuevo secreto.
  - *Almacenamiento del secreto cifrado reversible en AlloyDB*: Descartado porque un secreto M2M actúa como credencial de autenticación verificable; basta almacenar su resumen `SHA-256` irreversible y comparar con `crypto.timingSafeEqual`.

### Decisión 2: Invalidación Inmediata (`<= 300 s`) de Tokens M2M en Vuelo ante Revocación de Credencial
- **Decisión**: Como los tokens M2M emitidos en `POST /api/v1/oauth/token` tienen un `TTL` de hasta `3600 s` (`1 hora`), `createM2mBearerAuthMiddleware` verificará no solo la firma `RS256` del JWT, sino también el estado de revocación del `client_id` en la caché L2 (`IoRedisPdpL2CacheAdapter.isM2mClientRevoked(clientId)`) y en el repositorio de credenciales (`estado_credencial !== 'REVOCADA'` y `expira_rotacion_en > NOW()`). Al ejecutar `RevokeM2mCredentialUseCase`, se escribe la clave `minedec:pdp:m2m_revoked:{client_id}` en Redis y se actualiza `estado_credencial = 'REVOCADA'` en AlloyDB.
- **Justificación**: Garantiza el cumplimiento estricto del SLA de revocación `<= 300 segundos` (`RF-AUT-06`, `PI-07`, Principio X) incluso para tokens M2M de 1 hora de duración.
- **Alternativas descartadas**:
  - *Reducir el TTL del token M2M a 60 segundos*: Incrementaría innecesariamente la carga de firmas RSA sobre `/api/v1/oauth/token`.
  - *Confiar únicamente en la expiración `exp` del JWT*: Violaría el límite duro de `300 s` cuando se revoca una credencial M2M comprometida.

### Decisión 3: Distinción entre Retiro Planificado (`RETIRADA`) y Revocación de Emergencia (`REVOCADA`) en `llave_jwks_rotacion`
- **Decisión**: Incorporar el caso de uso `RetirePdpJwksKeyUseCase` (`POST /internal/v1/pdp/jwks/:kid/retire`) y el método `retireGraceKey(kid)` en `PdpJwksKeyRepositoryPort` / `AlloyDbPdpJwksKeyRepository`, permitiendo que una llave en estado `GRACIA_VERIFICACION` pase limpiamente a `RETIRADA` (`retirada_en = NOW()`) con evento de auditoría `PDP_JWKS_RETIRADO`, diferenciándolo de la baja por incidente de seguridad `REVOCADA` (`PDP_JWKS_REVOCADO_EMERGENCIA`).
- **Justificación**: El modelo canónico DBML (`etapa-3-seguridad-m2m-jwks-publicador.dbml`) define explícitamente los 4 estados (`ACTIVA_FIRMA`, `GRACIA_VERIFICACION`, `RETIRADA`, `REVOCADA`). Distinguir en auditoría forense un retiro programado post-rotación de una revocación por compromiso criptográfico es indispensable para el equipo SOC y los auditores.
