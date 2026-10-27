# Infraestructura como Código (IaC) — MINEDEC Subcomponente C2.2 (SSO)

Repositorio central de **Terraform HCL (`1.5.7`)** para el **Subcomponente C2.2 (Sistema de Autenticación Centralizado SSO)** del Ministerio de Educación, Deporte y Cultura (MINEDEC), desplegado de forma 100% nativa mediante **Google Cloud Infrastructure Manager (`config.googleapis.com`)**.

---

## Modelo de Proyectos y Red Compartida (Shared VPC)

La infraestructura se despliega en tres ambientes sobre Google Cloud (`us-east1`), consumiendo la **Shared VPC** administrada de forma centralizada por el equipo de redes:

| Ambiente | Proyecto de Servicio SSO (C2.2) | Proyecto Host de Red Compartida (Shared VPC) |
|---|---|---|
| **Desarrollo (`des`)** | `mec-003-sso-des` | `mec-003-sha-net-des` |
| **Preproducción (`pre`)** | `mec-003-sso-pre` | `mec-003-sha-net-pre` |
| **Producción (`pro`)** | `mec-003-sso-pro` | `mec-003-sha-net-pro-511014` |

> **Nota sobre el stack `host`**: A diferencia de otros proyectos donde el repositorio IaC administra el proyecto host de red, en MINEDEC la Shared VPC (`mec-003-sha-net-*`) es administrada por un equipo dedicado. Por ello, este repositorio despliega únicamente los **3 stacks de servicio** (`devops`, `data` y `apps`) dentro de `mec-003-sso-{des,pre,pro}`.

---

## Arquitectura en 3 Capas

1. **`modulos/` (Módulos Atómicos)**:
   - `alloydb`: Clúster e instancias primaria/read-pool de AlloyDB for PostgreSQL 16 sobre Private Services Access (PSA).
   - `apigee`: Organización, instancias y environment groups de Apigee X.
   - `artifact-registry`: Repositorios Docker (`sso-containers`) con políticas de limpieza e IAM.
   - `cloud-run`: Servicios Cloud Run v2 (`sso-sincronizador`) con Direct VPC Egress.
   - `cloud-run-job`: Jobs Cloud Run v2 (`sso-conciliacion-job`, `sso-publicador-job`) con Direct VPC Egress.
   - `cloud-sql`: Instancias Cloud SQL opcionales.
   - `cloud-tasks`: Colas de Cloud Tasks (`sso-workspace-sync-queue`) con rate limit `<= 28 req/s`.
   - `gcs`: Buckets de Cloud Storage con acceso uniforme y ciclo de vida.
   - `gke`: Clúster GKE privado sobre subred compartida con Workload Identity.
   - `memorystore-redis`: Instancia Memorystore for Redis (`REDIS_7_0`) para caché L2 (`TTL <= 300s`) y sesiones de `sso-oidc`.
   - `secret-manager`: Secretos en Google Secret Manager con etiquetas de rotación `<= 90 días` (cero valores en texto plano en Terraform).
   - `vpc`: Módulo de referencia de VPC y subredes.

2. **`plantillas/` (Stacks por Rol)**:
   - `devops`: APIs base, cuentas de servicio de mínimo privilegio (`sa-sso-core`, `sa-sso-sync`, `sa-sso-sync-job`, `sa-sso-publicador`), contenedores de secretos en Secret Manager, buckets operativos (`blueprints`) y Artifact Registry (`sso-containers`).
   - `data`: AlloyDB for PostgreSQL 16, Memorystore for Redis, dataset BigQuery de auditoría append-only (`auditoria_sso`), bucket de archivo forense (`audit-worm`), tópicos/suscripciones de Cloud Pub/Sub (`sso-cache-invalidation`, `sso-workspace-identity-events`) y colas de Cloud Tasks (`sso-workspace-sync-queue`).
   - `apps`: Clúster GKE privado (`sso-gke-*`), Cloud Run Services (`sso-sincronizador`) y Cloud Run Jobs (`sso-conciliacion-job`, `sso-publicador-job`).

3. **`despliegues/<ambiente>/<stack>/` (Raíces de Despliegue)**:
   - `despliegues/des/{devops,data,apps}`
   - `despliegues/pre/{devops,data,apps}`
   - `despliegues/pro/{devops,data,apps}`

---

## Empaquetado y Validación Local

Google Cloud Infrastructure Manager recibe un directorio autocontenido por cada deployment. El script [`scripts/bundle.sh`](scripts/bundle.sh) ensambla en `build/<stack>/` la raíz del despliegue junto con `plantillas/` y `modulos/`:

```bash
bash scripts/bundle.sh des devops
bash scripts/bundle.sh des data
bash scripts/bundle.sh des apps
```
