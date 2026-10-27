# Módulo: ncc

Crea un hub de Network Connectivity Center (NCC) en GCP (`google_network_connectivity_hub`). El hub es el punto central al que se conectan los spokes de VPC, VPN, etc.

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
| `name` | `string` | Nombre del hub NCC |
| `project_id` | `string` | ID del proyecto GCP donde se crea el hub |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `description` | `string` | `""` | Descripción del hub |
| `labels` | `map(string)` | `{}` | Etiquetas clave/valor para el hub |

---

## Ejemplo de uso como módulo

```hcl
module "ncc" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos base/ncc/v1.0"

  name       = "hub-corporativo"
  project_id = "mi-proyecto-conectividad"

  labels = {
    ambiente = "produccion"
  }
}
```
