variable "name" {
  description = "Nombre del Cloud Router"
  type        = string
}

variable "project_id" {
  description = "ID del proyecto"
  type        = string
}

variable "region" {
  description = "Región del Cloud Router"
  type        = string
}

variable "network" {
  description = "Self-link o nombre de la VPC asociada"
  type        = string
}

variable "description" {
  description = "Descripción del Cloud Router"
  type        = string
  default     = ""
}

variable "bgp" {
  description = "Configuración BGP del router"
  type = object({
    asn               = number
    advertise_mode    = optional(string, "DEFAULT")
    advertised_groups = optional(list(string))
    advertised_ip_ranges = optional(list(object({
      range       = string
      description = optional(string)
    })), [])
  })
  default = null
}
