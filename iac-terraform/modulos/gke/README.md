# Módulo: GKE Regional (v2.0)

Crea un clúster de GKE regional en modo privado con Workload Identity habilitado de forma fija (`google_container_cluster` + `google_container_node_pool`).

## Diferencias frente a v1.0

`v2.0` agrega soporte de **node pools Spot y Preemptible**: cada entrada de `node_pools` acepta ahora `spot` y `preemptible` (ambos `bool`, default `false`, mutuamente excluyentes — el módulo valida que no se activen los dos a la vez en el mismo pool). El resto del módulo es idéntico a `v1.0`.

`v1.0` no se modifica y sigue siendo la versión consumida por plantillas existentes (ej. `Plantillas/digital/digital-backend/v1.0`). Usar `v2.0` en plantillas nuevas que necesiten node pools de bajo costo/tolerantes a interrupciones.

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` para habilitar la autenticación dinámica |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP que ejecutará el plan/apply |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider |

---

## Variables de Terraform

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Nombre del clúster GKE |
| `project_id` | `string` | ID del proyecto GCP donde se crea el clúster |
| `region` | `string` | Región donde se despliega el clúster (ej: `us-central1`) |
| `network` | `string` | Self-link o nombre de la VPC |
| `subnetwork` | `string` | Self-link o nombre de la subred principal |
| `pods_range_name` | `string` | Nombre del rango secundario de la subred reservado para Pods |
| `services_range_name` | `string` | Nombre del rango secundario de la subred reservado para Services |
| `node_pools` | `map(object)` | Mapa de node pools. Ver campos abajo. |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `release_channel` | `string` | `"REGULAR"` | Canal de actualización del clúster: `RAPID`, `REGULAR`, `STABLE` o `UNSPECIFIED` |
| `enable_private_nodes` | `bool` | `true` | Los nodos no obtienen IP pública |
| `enable_private_endpoint` | `bool` | `false` | El endpoint del plano de control sólo es accesible de forma privada |
| `master_ipv4_cidr_block` | `string` | `"172.16.0.0/28"` | Rango CIDR del plano de control (privado) |
| `master_authorized_networks` | `list(object)` | `[]` | Bloques CIDR autorizados para acceder al endpoint del plano de control (`cidr_block`, `display_name`) |
| `deletion_protection` | `bool` | `true` | Protege el clúster contra borrados accidentales |
| `enable_managed_prometheus` | `bool` | `true` | Habilita Google Cloud Managed Service for Prometheus |
| `maintenance_start_time` / `maintenance_end_time` / `maintenance_recurrence` | `string` | `null` / `null` / `"FREQ=WEEKLY;BYDAY=SA,SU"` | Ventana de mantenimiento recurrente. Requiere `maintenance_start_time` y `maintenance_end_time` juntos. |
| `labels` | `map(string)` | `{}` | Etiquetas clave/valor aplicadas al clúster |

### Campos de cada entrada de `node_pools`

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `machine_type` | `string` | `"e2-medium"` | Tipo de máquina de los nodos |
| `disk_size_gb` | `number` | `100` | Tamaño de disco por nodo |
| `disk_type` | `string` | `"pd-standard"` | Tipo de disco (`pd-standard`, `pd-balanced`, `pd-ssd`) |
| `initial_node_count` | `number` | `1` | Número inicial de nodos |
| `min_node_count` / `max_node_count` | `number` | `1` / `3` | Rango de autoscaling del pool |
| `service_account` | `string` | `null` | SA usada por los nodos. `null` = SA default de Compute Engine |
| `max_pods_per_node` | `number` | `110` | Máximo de Pods por nodo |
| `spot` | `bool` | `false` | VM Spot — sin límite de 24h, mismo descuento que preemptible. Mutuamente excluyente con `preemptible`. |
| `preemptible` | `bool` | `false` | VM Preemptible clásica — termina forzosamente a las 24h. Mutuamente excluyente con `spot`. |
| `labels` / `tags` | `map(string)` / `list(string)` | `{}` / `[]` | Labels y network tags de los nodos |

> **Nota:** Workload Identity está habilitado de forma fija en este módulo. El `workload_pool` se construye automáticamente como `<project_id>.svc.id.goog`.

---

## Outputs

| Output | Descripción |
|---|---|
| `cluster_id` | ID completo del clúster |
| `cluster_name` | Nombre del clúster |
| `endpoint` | Endpoint del plano de control (IP o FQDN) |
| `workload_pool` | Nombre del Workload Identity Pool del clúster |
| `node_pool_ids` | Mapa con los IDs de cada node pool creado |

---

## Ejemplo de uso como módulo

```hcl
module "gke" {
  source = "../../../../Modulos-base/gke/v2.0"

  name                = "cluster-beliv"
  project_id          = "beliv-gke-prod-xxxx"
  region              = "us-central1"
  network             = module.vpc.self_link
  subnetwork          = module.subnets["subred-gke"].self_link
  pods_range_name     = "pods"
  services_range_name = "services"

  node_pools = {
    "on-demand" = {
      machine_type   = "e2-standard-4"
      min_node_count = 1
      max_node_count = 3
      labels         = { pool = "on-demand" }
    }
    "spot" = {
      machine_type   = "e2-standard-4"
      min_node_count = 0
      max_node_count = 5
      spot           = true
      labels         = { pool = "spot" }
      tags           = ["gke-spot"]
    }
  }

  release_channel     = "REGULAR"
  deletion_protection = true
}
```
