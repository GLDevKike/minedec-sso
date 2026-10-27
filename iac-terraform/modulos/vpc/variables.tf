variable "name" {
  description = "Nombre de la VPC"
  type        = string
}

variable "project_id" {
  description = "ID del proyecto donde se crea la VPC"
  type        = string
}

variable "description" {
  description = "Descripción de la VPC"
  type        = string
  default     = ""
}

variable "routing_mode" {
  description = "Modo de enrutamiento dinámico: REGIONAL o GLOBAL"
  type        = string
  default     = "GLOBAL"

  validation {
    condition     = contains(["REGIONAL", "GLOBAL"], var.routing_mode)
    error_message = "El valor debe ser REGIONAL o GLOBAL."
  }
}

variable "mtu" {
  description = "MTU de la red (1460 estándar, 1500 para Jumbo Frames)"
  type        = number
  default     = 1460

  validation {
    condition     = contains([1460, 1500], var.mtu)
    error_message = "El MTU debe ser 1460 o 1500."
  }
}
