# Módulo: router

Crea un Cloud Router en GCP (`google_compute_router`), con configuración BGP opcional para enrutamiento dinámico.

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
| `name` | `string` | Nombre del Cloud Router |
| `project_id` | `string` | ID del proyecto GCP |
| `region` | `string` | Región del Cloud Router (debe coincidir con la región de la VPN o NAT asociada) |
| `network` | `string` | Self-link o nombre de la VPC asociada al router |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `description` | `string` | `""` | Descripción del Cloud Router |
| `bgp` | `object` | `null` | Configuración BGP: `asn`, `advertise_mode`, `advertised_groups`, `advertised_ip_ranges` |

---

## Ejemplo de uso como módulo

```hcl
module "router" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos base/router/v1.0"

  name       = "router-produccion"
  project_id = "mi-proyecto-001"
  region     = "us-central1"
  network    = module.vpc.self_link

  bgp = {
    asn            = 64514
    advertise_mode = "DEFAULT"
  }
}
```
