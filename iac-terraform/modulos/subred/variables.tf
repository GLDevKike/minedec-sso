variable "name" {
  description = "Nombre de la subred"
  type        = string
}

variable "project_id" {
  description = "ID del proyecto"
  type        = string
}

variable "region" {
  description = "Región donde se crea la subred"
  type        = string
}

variable "network" {
  description = "Self-link o nombre de la VPC a la que pertenece"
  type        = string
}

variable "ip_cidr_range" {
  description = "Rango CIDR principal de la subred"
  type        = string
}

variable "private_ip_google_access" {
  description = "Habilitar acceso privado a Google APIs desde instancias sin IP pública"
  type        = bool
  default     = true
}

variable "description" {
  description = "Descripción de la subred"
  type        = string
  default     = ""
}

variable "purpose" {
  description = <<-EOT
    Propósito de la subred. Null (default) = subred normal de cargas de trabajo.
    Valores especiales:
      - REGIONAL_MANAGED_PROXY → subred proxy-only para balanceadores regionales (Envoy gestionado)
      - PRIVATE_SERVICE_CONNECT → subred dedicada a endpoints PSC publicados
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.purpose == null || contains(["REGIONAL_MANAGED_PROXY", "PRIVATE_SERVICE_CONNECT"], coalesce(var.purpose, "null"))
    error_message = "El valor debe ser null, REGIONAL_MANAGED_PROXY o PRIVATE_SERVICE_CONNECT."
  }
}

variable "role" {
  description = "Rol de la subred proxy-only: ACTIVE (en uso) o BACKUP (reserva para migración). Solo aplica si purpose = REGIONAL_MANAGED_PROXY."
  type        = string
  default     = "ACTIVE"

  validation {
    condition     = contains(["ACTIVE", "BACKUP"], var.role)
    error_message = "El valor debe ser ACTIVE o BACKUP."
  }
}

variable "secondary_ip_ranges" {
  description = "Rangos secundarios de IP (útil para GKE)"
  type = list(object({
    range_name    = string
    ip_cidr_range = string
  }))
  default = []
}

variable "enable_flow_logs" {
  description = "Habilitar VPC Flow Logs"
  type        = bool
  default     = false
}

variable "flow_logs_interval" {
  description = "Intervalo de agregación de flow logs"
  type        = string
  default     = "INTERVAL_5_SEC"
}

variable "flow_logs_sampling" {
  description = "Tasa de muestreo de flow logs (0.0 a 1.0)"
  type        = number
  default     = 0.5
}

variable "flow_logs_metadata" {
  description = "Metadatos incluidos en flow logs"
  type        = string
  default     = "INCLUDE_ALL_METADATA"
}
