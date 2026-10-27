# Módulo: subred

Crea una subred dentro de una VPC en GCP (`google_compute_subnetwork`), con soporte para rangos secundarios y VPC Flow Logs.

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

Estas variables deben configurarse como **variables de entorno** (Environment Variables) en el workspace de TFC. Son necesarias para la autenticación dinámica con GCP mediante Workload Identity Federation.

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` para habilitar la autenticación dinámica |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP que ejecutará el plan/apply |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider (formato: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`) |

---

## Variables de Terraform requeridas en el Workspace

Estas variables deben configurarse como **Terraform Variables** en el workspace de TFC.

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Nombre de la subred |
| `project_id` | `string` | ID del proyecto GCP |
| `region` | `string` | Región donde se crea la subred (ej: `us-central1`) |
| `network` | `string` | Self-link o nombre de la VPC a la que pertenece |
| `ip_cidr_range` | `string` | Rango CIDR principal de la subred (ej: `10.0.0.0/24`) |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `private_ip_google_access` | `bool` | `true` | Habilita acceso a Google APIs desde VMs sin IP pública |
| `description` | `string` | `""` | Descripción de la subred |
| `secondary_ip_ranges` | `list(object)` | `[]` | Rangos secundarios de IP (útil para GKE Pods/Services) |
| `enable_flow_logs` | `bool` | `false` | Habilita VPC Flow Logs |
| `flow_logs_interval` | `string` | `"INTERVAL_5_SEC"` | Intervalo de agregación de flow logs |
| `flow_logs_sampling` | `number` | `0.5` | Tasa de muestreo de flow logs (0.0 a 1.0) |
| `flow_logs_metadata` | `string` | `"INCLUDE_ALL_METADATA"` | Metadatos incluidos en los flow logs |

---

## Ejemplo de uso como módulo

```hcl
module "subred" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos base/subred/v1.0"

  name          = "subred-produccion"
  project_id    = "mi-proyecto-001"
  region        = "us-central1"
  network       = module.vpc.self_link
  ip_cidr_range = "10.0.1.0/24"

  secondary_ip_ranges = [
    { range_name = "pods",     ip_cidr_range = "10.100.0.0/16" },
    { range_name = "services", ip_cidr_range = "10.200.0.0/20" },
  ]
}
```
