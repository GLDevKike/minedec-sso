# Módulo: Memorystore Redis

Crea una instancia de Memorystore para Redis en GCP (`google_redis_instance`) con acceso privado mediante Private Service Access, cifrado en tránsito y autenticación habilitados por defecto.

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
| `name` | `string` | Nombre de la instancia de Redis |
| `project_id` | `string` | ID del proyecto GCP donde se crea la instancia |
| `region` | `string` | Región donde se despliega la instancia (ej: `us-central1`) |
| `network` | `string` | Self-link o nombre de la VPC donde se conecta la instancia (via Private Service Access) |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `display_name` | `string` | `""` | Nombre visible de la instancia |
| `reserved_ip_range` | `string` | `null` | Rango CIDR `/29` reservado para la instancia (ej: `10.0.100.0/29`). Si se omite, GCP asigna uno automáticamente |
| `memory_size_gb` | `number` | `1` | Capacidad de memoria en GB |
| `tier` | `string` | `"STANDARD_HA"` | Nivel de servicio: `STANDARD_HA` (alta disponibilidad con réplica) o `BASIC` (sin réplica) |
| `redis_version` | `string` | `"REDIS_7_0"` | Versión de Redis: `REDIS_7_0`, `REDIS_6_X`, etc. |
| `transit_encryption_mode` | `string` | `"SERVER_AUTHENTICATION"` | Modo de cifrado en tránsito: `SERVER_AUTHENTICATION` o `DISABLED` |
| `auth_enabled` | `bool` | `true` | Habilita autenticación mediante AUTH string |
| `redis_configs` | `map(string)` | `{}` | Parámetros de configuración de Redis (ej: `maxmemory-policy = "allkeys-lru"`) |
| `maintenance_day` | `string` | `null` | Día de la semana para la ventana de mantenimiento (ej: `"TUESDAY"`) |
| `maintenance_hour` | `number` | `2` | Hora UTC de inicio de la ventana de mantenimiento (0–23) |
| `labels` | `map(string)` | `{}` | Etiquetas clave/valor aplicadas a la instancia |

> **Nota:** Este módulo usa **Private Service Access** como modo de conexión. La VPC debe tener configurada la conexión de servicios privados (`google_service_networking_connection`) antes de crear la instancia.

---

## Outputs

| Output | Descripción |
|---|---|
| `instance_id` | ID completo de la instancia de Redis |
| `host` | IP privada de la instancia (dirección de conexión) |
| `port` | Puerto de la instancia (por defecto `6379`) |
| `auth_string` | Cadena de autenticación AUTH (sensible) |
| `redis_version` | Versión de Redis de la instancia |

---

## Ejemplo de uso como módulo

```hcl
module "redis" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/memorystore-redis/v1.0"

  name       = "cache-produccion"
  project_id = "mi-proyecto-001"
  region     = "us-central1"
  network    = module.vpc.self_link

  display_name              = "Cache de sesiones - Producción"
  reserved_ip_range         = "10.0.100.0/29"
  memory_size_gb            = 4
  tier                      = "STANDARD_HA"
  redis_version             = "REDIS_7_0"
  transit_encryption_mode   = "SERVER_AUTHENTICATION"
  auth_enabled              = true

  redis_configs = {
    "maxmemory-policy" = "allkeys-lru"
    "notify-keyspace-events" = ""
  }

  maintenance_day  = "SUNDAY"
  maintenance_hour = 3

  labels = {
    ambiente = "produccion"
    equipo   = "backend"
  }
}
```
