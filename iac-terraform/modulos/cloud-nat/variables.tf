variable "name" {
  description = "Nombre del Cloud NAT"
  type        = string
}

variable "project_id" {
  description = "ID del proyecto GCP"
  type        = string
}

variable "region" {
  description = "Región del Cloud NAT (debe coincidir con la región del Cloud Router)"
  type        = string
}

variable "router" {
  description = "Nombre del Cloud Router al que se asocia el NAT"
  type        = string
}

variable "nat_ip_allocate_option" {
  description = "Modo de asignación de IPs para NAT: AUTO_ONLY (IPs efímeras de GCP) o MANUAL_ONLY (IPs reservadas)"
  type        = string
  default     = "AUTO_ONLY"

  validation {
    condition     = contains(["AUTO_ONLY", "MANUAL_ONLY"], var.nat_ip_allocate_option)
    error_message = "El valor debe ser AUTO_ONLY o MANUAL_ONLY."
  }
}

variable "source_subnetwork_ip_ranges_to_nat" {
  description = "Alcance del NAT: ALL_SUBNETWORKS_ALL_IP_RANGES, ALL_SUBNETWORKS_ALL_PRIMARY_IP_RANGES o LIST_OF_SUBNETWORKS"
  type        = string
  default     = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  validation {
    condition = contains([
      "ALL_SUBNETWORKS_ALL_IP_RANGES",
      "ALL_SUBNETWORKS_ALL_PRIMARY_IP_RANGES",
      "LIST_OF_SUBNETWORKS"
    ], var.source_subnetwork_ip_ranges_to_nat)
    error_message = "Valor inválido para source_subnetwork_ip_ranges_to_nat."
  }
}

variable "min_ports_per_vm" {
  description = "Número mínimo de puertos NAT asignados por VM"
  type        = number
  default     = 64
}

variable "subnetworks" {
  description = "Subredes específicas cuando source_subnetwork_ip_ranges_to_nat es LIST_OF_SUBNETWORKS"
  type = list(object({
    name                    = string
    source_ip_ranges_to_nat = list(string)
  }))
  default = []
}

variable "log_config_enable" {
  description = "Habilitar logs del Cloud NAT"
  type        = bool
  default     = false
}

variable "log_config_filter" {
  description = "Filtro de logs: ALL, ERRORS_ONLY o TRANSLATIONS_ONLY"
  type        = string
  default     = "ERRORS_ONLY"
}
