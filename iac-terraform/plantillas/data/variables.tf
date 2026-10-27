# ─────────────────────────────────────────────
# GENERALES
# ─────────────────────────────────────────────

variable "project_id" {
  description = "ID del proyecto de servicio donde se despliega la capa de datos y mensajería SSO."
  type        = string
}

variable "region" {
  description = "Región de los recursos de datos."
  type        = string
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

variable "apis_to_enable" {
  description = "APIs de GCP a habilitar en el proyecto para datos y mensajería."
  type        = list(string)
  default = [
    "compute.googleapis.com",
    "storage.googleapis.com",
    "bigquery.googleapis.com",
    "pubsub.googleapis.com",
    "cloudtasks.googleapis.com",
    "redis.googleapis.com",
    "servicenetworking.googleapis.com",
  ]
}

# ─────────────────────────────────────────────
# SHARED VPC
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC."
  type        = string
}

variable "host_vpc_self_link" {
  description = "Self-link de la VPC del host (projects/<host>/global/networks/<vpc>). Lo usan AlloyDB, Cloud SQL y Redis como red autorizada (PSA)."
  type        = string
}

variable "data_subnet_self_link" {
  description = "Self-link de la subred del host para servicios de datos (opcional)."
  type        = string
  default     = null
}

# ─────────────────────────────────────────────
# CLOUD KMS
# ─────────────────────────────────────────────

variable "enable_kms" {
  description = "Crea un key ring y una clave CMEK para buckets, BigQuery y Pub/Sub."
  type        = bool
  default     = false
}

variable "kms" {
  description = "Configuración de Cloud KMS. Solo aplica si enable_kms = true."
  type = object({
    key_ring_name   = string
    crypto_key_name = string
    rotation_period = optional(string, "7776000s")
  })
  default = null
}

# ─────────────────────────────────────────────
# BUCKETS DE DATOS Y AUDITORÍA (GCS)
# ─────────────────────────────────────────────

variable "lake_buckets" {
  description = "Buckets de almacenamiento de datos y auditoría forense."
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
# BIGQUERY (AUDITORÍA ANALÍTICA)
# ─────────────────────────────────────────────

variable "bigquery_datasets" {
  description = "Datasets de BigQuery a crear. La clave es el dataset_id."
  type = map(object({
    location                    = optional(string, null)
    friendly_name               = optional(string, null)
    description                 = optional(string, "")
    default_table_expiration_ms = optional(number, null)
    delete_contents_on_destroy  = optional(bool, false)
    deletion_protection         = optional(bool, true)
    labels                      = optional(map(string), {})
  }))
  default = {}
}

# ─────────────────────────────────────────────
# PUB/SUB
# ─────────────────────────────────────────────

variable "pubsub_topics" {
  description = "Topics de Pub/Sub y sus subscriptions (invalidación de caché L2, eventos Workspace, etc.)."
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

# ─────────────────────────────────────────────
# CLOUD TASKS
# ─────────────────────────────────────────────

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
# DATAFLOW (OPCIONAL)
# ─────────────────────────────────────────────

variable "enable_dataflow_sa" {
  description = "Crea la service account dedicada a jobs de Dataflow."
  type        = bool
  default     = false
}

variable "dataflow_sa" {
  description = "Configuración de la service account de Dataflow."
  type = object({
    account_id   = optional(string, "sa-dataflow")
    display_name = optional(string, "Service Account Dataflow")
    roles = optional(list(string), [
      "roles/dataflow.worker",
      "roles/storage.objectAdmin",
      "roles/bigquery.dataEditor",
      "roles/bigquery.jobUser",
      "roles/pubsub.subscriber",
      "roles/pubsub.viewer",
    ])
  })
  default = {}
}

# ─────────────────────────────────────────────
# ALLOYDB FOR POSTGRESQL 16 (PIP PRIMARIO Y AUDITORÍA)
# ─────────────────────────────────────────────

variable "enable_alloydb" {
  description = "Despliega un clúster AlloyDB for PostgreSQL 16 con IP privada (PSA) sobre la Shared VPC."
  type        = bool
  default     = false
}

variable "alloydb" {
  description = "Configuración de AlloyDB for PostgreSQL 16. Solo aplica si enable_alloydb = true."
  type = object({
    cluster_id           = string
    allocated_ip_range   = optional(string, null)
    availability_type    = optional(string, "REGIONAL")
    primary_cpu_count    = optional(number, 2)
    enable_read_pool     = optional(bool, false)
    read_pool_node_count = optional(number, 1)
    deletion_protection  = optional(bool, true)
  })
  default = null
}

# ─────────────────────────────────────────────
# CLOUD SQL (OPCIONAL)
# ─────────────────────────────────────────────

variable "enable_cloudsql" {
  description = "Despliega una instancia Cloud SQL con IP privada (PSA)."
  type        = bool
  default     = false
}

variable "cloudsql" {
  description = "Configuración de Cloud SQL. Solo aplica si enable_cloudsql = true."
  type = object({
    name                           = string
    database_version               = optional(string, "POSTGRES_16")
    tier                           = optional(string, "db-f1-micro")
    availability_type              = optional(string, "ZONAL")
    disk_size_gb                   = optional(number, 10)
    disk_type                      = optional(string, "PD_SSD")
    deletion_protection            = optional(bool, false)
    backup_enabled                 = optional(bool, false)
    pit_recovery_enabled           = optional(bool, false)
    transaction_log_retention_days = optional(number, 7)
    retained_backups               = optional(number, 7)
    query_insights_enabled         = optional(bool, false)
    databases                      = optional(list(string), [])
    database_flags                 = optional(map(string), {})
    allocated_ip_range             = optional(string, null)
    ipv4_enabled                   = optional(bool, false)
    use_private_network            = optional(bool, true)
    enable_schedule                = optional(bool, false)
    schedule_time_zone             = optional(string, "America/Bogota")
    start_cron                     = optional(string, "0 8,14 * * 1-5")
    stop_cron                      = optional(string, "0 13,17 * * 1-5")
  })
  default = null
}

# ─────────────────────────────────────────────
# MEMORYSTORE REDIS (CACHÉ L2 Y SESIONES OIDC)
# ─────────────────────────────────────────────

variable "enable_redis" {
  description = "Despliega una instancia Memorystore Redis con PSA."
  type        = bool
  default     = false
}

variable "redis" {
  description = "Configuración de Memorystore Redis. Solo aplica si enable_redis = true."
  type = object({
    name                    = string
    display_name            = optional(string, "")
    tier                    = optional(string, "BASIC")
    memory_size_gb          = optional(number, 1)
    redis_version           = optional(string, "REDIS_7_0")
    transit_encryption_mode = optional(string, "DISABLED")
    auth_enabled            = optional(bool, true)
    redis_configs           = optional(map(string), {})
  })
  default = null
}
