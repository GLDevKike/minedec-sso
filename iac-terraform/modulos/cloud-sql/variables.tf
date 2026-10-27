variable "name" {
  type        = string
  description = "Nombre de la instancia Cloud SQL"
}
variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}
variable "region" {
  type        = string
  description = "Región de la instancia"
}

variable "database_version" {
  type        = string
  default     = "POSTGRES_16"
  description = "Versión del motor: POSTGRES_16, POSTGRES_15, POSTGRES_14, MYSQL_8_0, SQLSERVER_2019_STANDARD, etc."
}

variable "tier" {
  type        = string
  default     = "db-f1-micro"
  description = "Tipo de máquina (ej: db-f1-micro, db-g1-small, db-n1-standard-2, db-custom-4-15360)"
}

variable "availability_type" {
  type        = string
  default     = "REGIONAL"
  description = "REGIONAL = alta disponibilidad con failover automático. ZONAL = instancia única."
  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.availability_type)
    error_message = "Debe ser REGIONAL o ZONAL."
  }
}

variable "disk_size_gb" {
  type        = number
  default     = 20
  description = "Tamaño inicial del disco en GB"
}
variable "disk_type" {
  type        = string
  default     = "PD_SSD"
  description = "Tipo de disco: PD_SSD o PD_HDD"
}
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Proteger la instancia contra borrado accidental"
}

variable "backup_enabled" {
  type        = bool
  default     = true
  description = "Habilitar backups automáticos"
}
variable "pit_recovery_enabled" {
  type        = bool
  default     = true
  description = "Habilitar point-in-time recovery"
}
variable "backup_start_time" {
  type        = string
  default     = "03:00"
  description = "Hora de inicio de backups (UTC, formato HH:MM)"
}
variable "transaction_log_retention_days" {
  type        = number
  default     = 7
  description = "Días de retención de logs de transacciones"
}
variable "retained_backups" {
  type        = number
  default     = 7
  description = "Número de backups a retener"
}

variable "ipv4_enabled" {
  type        = bool
  default     = false
  description = "Habilitar IP pública. Se recomienda false (usar IP privada)"
}
variable "allocated_ip_range" {
  type        = string
  default     = null
  description = "Nombre del rango PSA asignado del que toma IP la instancia. Si es null, GCP elige cualquier rango del peering (puede ocupar rangos reservados para otros servicios, p. ej. Apigee)"
}

variable "private_network" {
  type        = string
  default     = null
  description = "Self-link de la VPC para IP privada"
}
variable "ssl_mode" {
  type        = string
  default     = "ENCRYPTED_ONLY"
  description = "ENCRYPTED_ONLY o TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
}

variable "authorized_networks" {
  type = list(object({
    name = string
    cidr = string
  }))
  default     = []
  description = "Redes autorizadas para IP pública (solo si ipv4_enabled = true)"
}

variable "database_flags" {
  type        = map(string)
  default     = {}
  description = "Flags del motor de base de datos"
}
variable "query_insights_enabled" {
  type        = bool
  default     = true
  description = "Habilitar Query Insights para monitoreo de consultas"
}
variable "maintenance_day" {
  type        = number
  default     = 7
  description = "Día de mantenimiento (1=Lunes, 7=Domingo)"
}
variable "maintenance_hour" {
  type        = number
  default     = 3
  description = "Hora de mantenimiento (UTC, 0-23)"
}
variable "labels" {
  type        = map(string)
  default     = {}
  description = "Etiquetas de la instancia"
}

variable "databases" {
  type        = list(string)
  default     = []
  description = "Nombres de bases de datos a crear"
}
variable "users" {
  description = "Mapa de usuarios a crear. La clave es el nombre de usuario. Las contraseñas se almacenan en el estado de Terraform — usar Secret Manager para gestionarlas de forma segura."
  type = map(object({
    password = string
    type     = optional(string, "BUILT_IN")
  }))
  default = {}
}
