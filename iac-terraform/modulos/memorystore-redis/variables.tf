variable "name" {
  type        = string
  description = "Nombre de la instancia Redis"
}
variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}
variable "region" {
  type        = string
  description = "Región de la instancia"
}
variable "display_name" {
  type        = string
  default     = ""
  description = "Nombre visible de la instancia"
}
variable "network" {
  type        = string
  description = "Self-link de la VPC (se usa Private Service Access)"
}
variable "reserved_ip_range" {
  type        = string
  default     = null
  description = "Rango IP reservado para la instancia (CIDR /29)"
}
variable "memory_size_gb" {
  type        = number
  default     = 1
  description = "Tamaño de memoria en GB"
}

variable "tier" {
  type    = string
  default = "STANDARD_HA"
  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.tier)
    error_message = "Debe ser BASIC (sin HA) o STANDARD_HA (con réplica)."
  }
}

variable "redis_version" {
  type        = string
  default     = "REDIS_7_0"
  description = "Versión de Redis (ej: REDIS_7_0, REDIS_6_X)"
}

variable "transit_encryption_mode" {
  type        = string
  default     = "SERVER_AUTHENTICATION"
  description = "Cifrado en tránsito: SERVER_AUTHENTICATION o DISABLED"
}

variable "auth_enabled" {
  type        = bool
  default     = true
  description = "Habilitar autenticación con AUTH token"
}
variable "redis_configs" {
  type        = map(string)
  default     = {}
  description = "Configuración Redis (ej: { maxmemory-policy = 'allkeys-lru' })"
}
variable "maintenance_day" {
  type        = string
  default     = null
  description = "Día de mantenimiento (MONDAY, TUESDAY...)"
}
variable "maintenance_hour" {
  type        = number
  default     = 2
  description = "Hora de inicio de mantenimiento (UTC, 0-23)"
}
variable "labels" {
  type        = map(string)
  default     = {}
  description = "Etiquetas de la instancia"
}
