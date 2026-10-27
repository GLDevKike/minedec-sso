# Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (Subcomponente C2.2)

Monorepo unificado que agrupa los **8 repositorios** del Subcomponente C2.2:

| Ruta | Descripción |
|------|-------------|
| [\minedec-sso/\](./minedec-sso) | Gobernanza (Constitución 2.11.0), base de conocimiento OKF (\knowledge/\), especificaciones Spec Kit (\specs/001..005/\) y esquemas DBML (\docs/esquemas-bd/\). |
| [\iac-terraform/\](./iac-terraform) | Infraestructura como Código en Terraform 1.5.7 (\modulos/\, \plantillas/\, \despliegues/{des,pre,pro}/{devops,data,apps}\) para Google Cloud Infrastructure Manager. |
| [\microservicios/shared/\](./microservicios/shared) | Paquete transversal \@minedec/shared\ (criptografía RS256/SHA-256, validación Zod, errores RFC 9457, telemetría W3C, SQL seguro). |
| [\microservicios/pip-identity-service/\](./microservicios/pip-identity-service) | Servicio interno de Directorio PIP (\GET /internal/v1/identities/*\, caché L2 Redis + PostgreSQL 16). |
| [\microservicios/sincronizador/\](./microservicios/sincronizador) | Servicio Cloud Run de ingesta de eventos desde Google Workspace / Cloud Identity (solo lectura). |
| [\microservicios/conciliacion-job/\](./microservicios/conciliacion-job) | Cloud Run Job de conciliación programada y purga de revocaciones (\<= 300 s\). |
| [\microservicios/sso-oidc/\](./microservicios/sso-oidc) | Identity Broker OIDC (\Node.js 22 + Express 5 + oidc-provider\) ante Google Cloud Identity (\DA-11\). |
| [\microservicios/motor-pdp/\](./microservicios/motor-pdp) | Motor de Autorización Central PDP RBAC/ABAC (\/api/v1/access/evaluation\ y \/api/v1/oauth/token\ M2M). |