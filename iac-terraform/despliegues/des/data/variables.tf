variable "project_id" {
  description = "ID del proyecto de servicio SSO."
  type        = string
}

variable "region" {
  description = "Región del segmento."
  type        = string
}

variable "labels" {
  description = "Etiquetas comunes aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

# ─────────────────────────────────────────────
# RED COMPARTIDA
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC."
  type        = string
}

variable "host_network_name" {
  description = "Nombre de la VPC del proyecto host."
  type        = string
}

variable "host_data_subnet_name" {
  description = "Nombre de la subred del host para servicios de datos."
  type        = string
  default     = null
}

# ─────────────────────────────────────────────
# BUCKETS DE AUDITORÍA Y DATOS
# ─────────────────────────────────────────────

variable "lake_buckets" {
  description = "Buckets de almacenamiento de auditoría forense y datos."
  type = map(object({
    name               = string
    location           = optional(string, null)
    storage_class      = optional(string, "STANDARD")
    versioning_enabled = optional(bool, false)
    force_destroy      = optional(bool, false)
    retention_policy = optional(object({
      retention_period = number
      is_locked        = optional(bool, false)
    }), null)
    lifecycle_rules = optional(list(object({
      action_type           = string
      storage_class         = optional(string, null)
      age_days              = optional(number, null)
      with_state            = optional(string, null)
      num_newer_versions    = optional(number, null)
      matches_storage_class = optional(list(string), null)
    })), [])
  }))
  default = {}
}

# ─────────────────────────────────────────────
# BIGQUERY, PUB/SUB Y CLOUD TASKS
# ─────────────────────────────────────────────

variable "bigquery_datasets" {
  description = "Datasets de BigQuery a crear. La clave es el dataset_id."
  type = map(object({
    location                   = optional(string, null)
    friendly_name              = optional(string, null)
    description                = optional(string, "")
    delete_contents_on_destroy = optional(bool, false)
    deletion_protection        = optional(bool, true)
    labels                     = optional(map(string), {})
  }))
  default = {}
}

variable "pubsub_topics" {
  description = "Topics de Pub/Sub y sus subscriptions."
  type = map(object({
    message_retention_duration = optional(string, "604800s")
    labels                     = optional(map(string), {})
    subscriptions = optional(map(object({
      ack_deadline_seconds       = optional(number, 10)
      message_retention_duration = optional(string, "604800s")
      retain_acked_messages      = optional(bool, false)
      enable_message_ordering    = optional(bool, false)
      push_endpoint              = optional(string, null)
      expiration_ttl             = optional(string, null)
      labels                     = optional(map(string), {})
    })), {})
  }))
  default = {}
}

variable "cloud_tasks_queues" {
  description = "Colas de Cloud Tasks para sincronización con control de tasa (<= 28 req/s)."
  type = map(object({
    max_dispatches_per_second = optional(number, 25)
    max_concurrent_dispatches = optional(number, 10)
    max_attempts              = optional(number, 5)
    min_backoff               = optional(string, "2s")
    max_backoff               = optional(string, "300s")
    max_doublings             = optional(number, 4)
  }))
  default = {}
}

# ─────────────────────────────────────────────
# ALLOYDB FOR POSTGRESQL 16 (PIP PRIMARIO Y AUDITORÍA)
# ─────────────────────────────────────────────

variable "enable_alloydb" {
  description = "Despliega el clúster AlloyDB for PostgreSQL 16 con IP privada (PSA) sobre la Shared VPC."
  type        = bool
  default     = false
}

variable "alloydb_cluster_id" {
  description = "Identificador del clúster AlloyDB."
  type        = string
  default     = "sso-alloydb-des"
}

variable "alloydb_allocated_ip_range" {
  description = "Nombre del rango PSA reservado en la VPC compartida para AlloyDB."
  type        = string
  default     = null
}

variable "alloydb_availability_type" {
  description = "Tipo de disponibilidad de AlloyDB: REGIONAL o ZONAL."
  type        = string
  default     = "ZONAL"
}

variable "alloydb_primary_cpu_count" {
  description = "Número de vCPUs de la instancia primaria de AlloyDB."
  type        = number
  default     = 2
}

variable "alloydb_enable_read_pool" {
  description = "Habilita instancia de Read Pool en AlloyDB."
  type        = bool
  default     = false
}

variable "alloydb_deletion_protection" {
  description = "Protección contra borrado del clúster AlloyDB."
  type        = bool
  default     = false
}

# ─────────────────────────────────────────────
# CLOUD SQL FOR POSTGRESQL 16 (PRUEBAS FINOPS CON HORARIO)
# ─────────────────────────────────────────────

variable "enable_cloudsql" {
  description = "Despliega la instancia Cloud SQL for PostgreSQL 16 (sustituto temporal económico de AlloyDB en des)."
  type        = bool
  default     = false
}

variable "cloudsql_name" {
  description = "Nombre de la instancia Cloud SQL."
  type        = string
  default     = "sso-postgres-des"
}

variable "cloudsql_database_version" {
  description = "Versión del motor PostgreSQL en Cloud SQL."
  type        = string
  default     = "POSTGRES_16"
}

variable "cloudsql_tier" {
  description = "Tier de máquina de Cloud SQL (db-f1-micro para el menor costo en pruebas)."
  type        = string
  default     = "db-f1-micro"
}

variable "cloudsql_availability_type" {
  description = "Tipo de disponibilidad de Cloud SQL: ZONAL o REGIONAL."
  type        = string
  default     = "ZONAL"
}

variable "cloudsql_disk_size_gb" {
  description = "Tamaño inicial de disco en GB para Cloud SQL."
  type        = number
  default     = 10
}

variable "cloudsql_disk_type" {
  description = "Tipo de disco para Cloud SQL: PD_SSD o PD_HDD."
  type        = string
  default     = "PD_SSD"
}

variable "cloudsql_allocated_ip_range" {
  description = "Nombre del rango PSA reservado en la VPC compartida para Cloud SQL."
  type        = string
  default     = null
}

variable "cloudsql_ipv4_enabled" {
  description = "Habilita IPv4 pública en Cloud SQL (solo para pruebas si PSA aún no está habilitado)."
  type        = bool
  default     = false
}

variable "cloudsql_use_private_network" {
  description = "Conecta Cloud SQL a la VPC compartida mediante PSA."
  type        = bool
  default     = true
}

variable "cloudsql_deletion_protection" {
  description = "Protección contra borrado de la instancia Cloud SQL."
  type        = bool
  default     = false
}

variable "cloudsql_backup_enabled" {
  description = "Habilita backups automáticos en Cloud SQL."
  type        = bool
  default     = false
}

variable "cloudsql_pit_recovery_enabled" {
  description = "Habilita Point-in-Time Recovery en Cloud SQL."
  type        = bool
  default     = false
}

variable "cloudsql_query_insights_enabled" {
  description = "Habilita Query Insights en Cloud SQL."
  type        = bool
  default     = false
}

variable "cloudsql_databases" {
  description = "Bases de datos iniciales a crear en Cloud SQL."
  type        = list(string)
  default     = ["sso_db"]
}

variable "cloudsql_enable_schedule" {
  description = "Habilita encendido y apagado automático de Cloud SQL con Cloud Scheduler."
  type        = bool
  default     = true
}

variable "cloudsql_schedule_time_zone" {
  description = "Zona horaria IANA para los jobs de Cloud Scheduler (ej. America/Bogota)."
  type        = string
  default     = "America/Bogota"
}

variable "cloudsql_start_cron" {
  description = "Expresión cron para encender Cloud SQL (L-V 08:00 y 14:00)."
  type        = string
  default     = "0 8,14 * * 1-5"
}

variable "cloudsql_stop_cron" {
  description = "Expresión cron para apagar Cloud SQL (L-V 13:00 y 17:00)."
  type        = string
  default     = "0 13,17 * * 1-5"
}

# ─────────────────────────────────────────────
# MEMORYSTORE REDIS (CACHÉ L2 Y SESIONES OIDC)
# ─────────────────────────────────────────────

variable "enable_redis" {
  description = "Despliega la instancia Memorystore Redis con PSA."
  type        = bool
  default     = false
}

variable "redis_name" {
  description = "Nombre de la instancia Memorystore Redis."
  type        = string
  default     = "sso-redis-des"
}

variable "redis_tier" {
  description = "Tier de Memorystore Redis: BASIC o STANDARD_HA."
  type        = string
  default     = "BASIC"
}

variable "redis_memory_size_gb" {
  description = "Tamaño de memoria en GB para Redis."
  type        = number
  default     = 1
}

# ─────────────────────────────────────────────
# CLOUD KMS
# ─────────────────────────────────────────────

variable "enable_kms" {
  description = "Crea una clave CMEK y la aplica a los buckets, datasets y topics."
  type        = bool
  default     = false
}
