# Módulo: vpc

Crea una red VPC en GCP (`google_compute_network`) sin subredes automáticas.

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
| `name` | `string` | Nombre de la VPC |
| `project_id` | `string` | ID del proyecto GCP donde se crea la VPC |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `description` | `string` | `""` | Descripción de la VPC |
| `routing_mode` | `string` | `"GLOBAL"` | Modo de enrutamiento dinámico: `REGIONAL` o `GLOBAL` |
| `mtu` | `number` | `1460` | MTU de la red: `1460` (estándar) o `1500` (Jumbo Frames) |

---

## Ejemplo de uso como módulo

```hcl
module "vpc" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos base/vpc/v1.0"

  name         = "vpc-produccion"
  project_id   = "mi-proyecto-001"
  routing_mode = "GLOBAL"
}
```
