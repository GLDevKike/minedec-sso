# Módulo: cloud-nat

Crea un gateway de Cloud NAT en GCP (`google_compute_router_nat`), asociado a un Cloud Router existente. Permite que VMs sin IP pública accedan a internet saliente.

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider |

---

## Variables de Terraform en el Workspace

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Nombre del Cloud NAT |
| `project_id` | `string` | ID del proyecto GCP |
| `region` | `string` | Región (debe coincidir con la del Cloud Router) |
| `router` | `string` | Nombre del Cloud Router al que se asocia |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `nat_ip_allocate_option` | `string` | `"AUTO_ONLY"` | `AUTO_ONLY`: IPs efímeras de GCP. `MANUAL_ONLY`: IPs reservadas. |
| `source_subnetwork_ip_ranges_to_nat` | `string` | `"ALL_SUBNETWORKS_ALL_IP_RANGES"` | Alcance del NAT. Ver valores válidos abajo. |
| `min_ports_per_vm` | `number` | `64` | Puertos mínimos asignados por VM |
| `subnetworks` | `list(object)` | `[]` | Subredes específicas (solo cuando `source_subnetwork_ip_ranges_to_nat = LIST_OF_SUBNETWORKS`) |
| `log_config_enable` | `bool` | `false` | Habilitar logs del NAT |
| `log_config_filter` | `string` | `"ERRORS_ONLY"` | Filtro: `ALL`, `ERRORS_ONLY`, `TRANSLATIONS_ONLY` |

### Valores de `source_subnetwork_ip_ranges_to_nat`

| Valor | Comportamiento |
|---|---|
| `ALL_SUBNETWORKS_ALL_IP_RANGES` | NAT para todas las subredes y todos sus rangos (primarios y secundarios) |
| `ALL_SUBNETWORKS_ALL_PRIMARY_IP_RANGES` | NAT solo para rangos primarios de todas las subredes |
| `LIST_OF_SUBNETWORKS` | NAT solo para las subredes listadas en `subnetworks` |

---

## Ejemplo de uso como módulo

```hcl
module "nat" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/cloud-nat/v1.0"

  name       = "nat-produccion"
  project_id = "mi-proyecto-001"
  region     = "us-central1"
  router     = module.router.router_name
}
```
