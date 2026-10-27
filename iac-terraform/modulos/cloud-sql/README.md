# Módulo: Cloud SQL

Crea una instancia de Cloud SQL en GCP (`google_sql_database_instance`) con soporte para PostgreSQL, MySQL y SQL Server, alta disponibilidad regional, backups automáticos, point-in-time recovery y acceso privado.

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
| `name` | `string` | Nombre de la instancia de Cloud SQL |
| `project_id` | `string` | ID del proyecto GCP donde se crea la instancia |
| `region` | `string` | Región donde se despliega la instancia (ej: `us-central1`) |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `database_version` | `string` | `"POSTGRES_15"` | Versión del motor de base de datos: `POSTGRES_15`, `MYSQL_8_0`, `SQLSERVER_2019_STANDARD`, etc. |
| `tier` | `string` | `"db-g1-small"` | Tipo de máquina de la instancia (ej: `db-custom-2-7680`, `db-n1-standard-4`) |
| `availability_type` | `string` | `"REGIONAL"` | Alta disponibilidad: `REGIONAL` (standby en otra zona) o `ZONAL` (sin réplica) |
| `disk_size_gb` | `number` | `20` | Tamaño del disco en GB |
| `disk_type` | `string` | `"PD_SSD"` | Tipo de disco: `PD_SSD` o `PD_HDD` |
| `deletion_protection` | `bool` | `true` | Protege la instancia contra borrados accidentales |
| `backup_enabled` | `bool` | `true` | Habilita backups automáticos |
| `pit_recovery_enabled` | `bool` | `true` | Habilita Point-in-Time Recovery (requiere `backup_enabled = true`) |
| `backup_start_time` | `string` | `"03:00"` | Hora UTC de inicio de la ventana de backup (formato `HH:MM`) |
| `transaction_log_retention_days` | `number` | `7` | Días de retención de logs de transacciones para PITR |
| `retained_backups` | `number` | `7` | Número de backups automáticos retenidos |
| `ipv4_enabled` | `bool` | `false` | Asigna una IP pública a la instancia. Se recomienda `false` para instancias de producción |
| `private_network` | `string` | `null` | Self-link de la VPC para la IP privada (requiere Private Service Access configurado) |
| `ssl_mode` | `string` | `"ENCRYPTED_ONLY"` | Modo SSL: `ENCRYPTED_ONLY`, `TRUSTED_CLIENT_CERTIFICATE_REQUIRED` o `ALLOW_UNENCRYPTED_AND_ENCRYPTED` |
| `authorized_networks` | `list(object)` | `[]` | Redes autorizadas para acceso por IP pública. Cada objeto acepta `name`, `value` (CIDR) |
| `database_flags` | `map(string)` | `{}` | Flags de configuración del motor de base de datos (ej: `max_connections = "500"`) |
| `query_insights_enabled` | `bool` | `true` | Habilita Query Insights para análisis de rendimiento de consultas |
| `maintenance_day` | `number` | `7` | Día de la semana para la ventana de mantenimiento (1=Lunes … 7=Domingo) |
| `maintenance_hour` | `number` | `3` | Hora UTC de inicio de la ventana de mantenimiento (0–23) |
| `labels` | `map(string)` | `{}` | Etiquetas clave/valor aplicadas a la instancia |
| `databases` | `list(string)` | `[]` | Lista de nombres de bases de datos a crear en la instancia |
| `users` | `map(object)` | `{}` | Mapa de usuarios de base de datos a crear. Cada entrada acepta `password` (sensible). Gestionar con cuidado |

---

## Outputs

| Output | Descripción |
|---|---|
| `instance_id` | ID completo de la instancia de Cloud SQL |
| `instance_name` | Nombre de la instancia |
| `connection_name` | Nombre de conexión (usado con Cloud SQL Auth Proxy, formato: `proyecto:region:instancia`) |
| `private_ip` | Dirección IP privada de la instancia |
| `public_ip` | Dirección IP pública de la instancia (sólo si `ipv4_enabled = true`) |
| `database_names` | Lista de nombres de bases de datos creadas |
| `server_ca_cert` | Certificado CA del servidor (sensible) |

---

## Ejemplo de uso como módulo

```hcl
module "cloud_sql" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/cloud-sql/v1.0"

  name       = "db-produccion"
  project_id = "mi-proyecto-001"
  region     = "us-central1"

  database_version  = "POSTGRES_15"
  tier              = "db-custom-2-7680"
  availability_type = "REGIONAL"
  disk_size_gb      = 100
  disk_type         = "PD_SSD"
  deletion_protection = true

  backup_enabled               = true
  pit_recovery_enabled         = true
  backup_start_time            = "03:00"
  transaction_log_retention_days = 7
  retained_backups             = 14

  ipv4_enabled    = false
  private_network = module.vpc.self_link
  ssl_mode        = "ENCRYPTED_ONLY"

  query_insights_enabled = true

  database_flags = {
    "max_connections"   = "500"
    "log_min_duration_statement" = "1000"
  }

  maintenance_day  = 7
  maintenance_hour = 3

  databases = ["app_db", "analytics_db"]

  users = {
    "app_user" = {
      password = var.db_app_password
    }
  }

  labels = {
    ambiente = "produccion"
    equipo   = "backend"
  }
}
```
