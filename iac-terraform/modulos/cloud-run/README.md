# Módulo: Cloud Run

Crea un servicio de Cloud Run v2 (`google_cloud_run_v2_service`) con soporte para variables de entorno, secretos, conectividad VPC y configuración de autoescalado.

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

Estas variables deben configurarse como **variables de entorno** (Environment Variables) en el workspace de TFC. Son necesarias para la autenticación dinámica con GCP mediante Workload Identity Federation.

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` para habilitar la autenticación dinámica |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP que ejecutará el plan/apply |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider (formato: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`) |

---

## Variables de Terraform en el Workspace

Estas variables deben configurarse como **Terraform Variables** en el workspace de TFC.

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Nombre del servicio de Cloud Run |
| `project_id` | `string` | ID del proyecto GCP donde se despliega el servicio |
| `region` | `string` | Región donde se despliega el servicio (ej: `us-central1`) |
| `image` | `string` | URL completa de la imagen de contenedor (ej: `us-central1-docker.pkg.dev/proyecto/repo/imagen:tag`) |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `ingress` | `string` | `"INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` | Política de ingreso: `INGRESS_TRAFFIC_ALL`, `INGRESS_TRAFFIC_INTERNAL_ONLY` o `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` |
| `service_account` | `string` | `null` | Email de la service account que ejecuta el contenedor. Si se omite, usa la SA por defecto de Compute |
| `min_instances` | `number` | `0` | Número mínimo de instancias (permite escalar a cero) |
| `max_instances` | `number` | `10` | Número máximo de instancias |
| `cpu` | `string` | `"1"` | CPUs asignadas al contenedor (ej: `"1"`, `"2"`, `"4"`) |
| `memory` | `string` | `"512Mi"` | Memoria asignada al contenedor (ej: `"512Mi"`, `"1Gi"`) |
| `cpu_idle` | `bool` | `true` | Si es `false`, la CPU siempre está activa aunque no haya requests |
| `container_port` | `number` | `8080` | Puerto que expone el contenedor |
| `timeout_seconds` | `number` | `300` | Tiempo máximo de respuesta de una request en segundos |
| `env_vars` | `map(string)` | `{}` | Variables de entorno en texto plano (clave/valor) |
| `env_secrets` | `map(object)` | `{}` | Variables de entorno inyectadas desde Secret Manager. Cada entrada acepta `secret` (ID del secreto) y `version` (número o `"latest"`) |
| `vpc_connector` | `string` | `null` | Nombre o self-link del conector VPC Serverless (VPC Access) |
| `vpc_egress` | `string` | `null` | Política de egreso VPC: `ALL_TRAFFIC` o `PRIVATE_RANGES_ONLY` |
| `invokers` | `list(string)` | `[]` | Lista de miembros IAM con permiso `roles/run.invoker` (ej: `["allUsers"]`, `["serviceAccount:sa@proj.iam.gserviceaccount.com"]`) |
| `labels` | `map(string)` | `{}` | Etiquetas clave/valor aplicadas al servicio |
| `deletion_protection` | `bool` | `true` | Protege el servicio contra borrado accidental. `region` es inmutable en Cloud Run — si necesitas cambiarla (o cualquier otro cambio que fuerce reemplazo), primero pon esto en `false` y aplica; solo en un segundo `apply` Terraform podrá destruir/recrear el servicio. |

---

## Outputs

| Output | Descripción |
|---|---|
| `service_id` | ID completo del servicio Cloud Run |
| `service_name` | Nombre del servicio |
| `uri` | URL pública del servicio Cloud Run |

---

## Ejemplo de uso como módulo

```hcl
module "cloud_run" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/cloud-run/v1.0"

  name       = "api-backend"
  project_id = "mi-proyecto-001"
  region     = "us-central1"
  image      = "us-central1-docker.pkg.dev/mi-proyecto-001/contenedores/api:v1.2.0"

  ingress          = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  service_account  = "sa-cloud-run@mi-proyecto-001.iam.gserviceaccount.com"
  min_instances    = 1
  max_instances    = 20
  cpu              = "2"
  memory           = "1Gi"
  timeout_seconds  = 60

  env_vars = {
    ENVIRONMENT = "produccion"
    LOG_LEVEL   = "info"
  }

  env_secrets = {
    DB_PASSWORD = {
      secret  = "db-password"
      version = "latest"
    }
  }

  vpc_connector = "projects/mi-proyecto-001/locations/us-central1/connectors/vpc-connector"
  vpc_egress    = "PRIVATE_RANGES_ONLY"

  labels = {
    ambiente = "produccion"
    equipo   = "backend"
  }
}
```
