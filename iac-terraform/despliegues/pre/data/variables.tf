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
  default     = "sso-alloydb-pre"
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
  default     = "sso-redis-pre"
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
