variable "name" {
  type        = string
  description = "Nombre del clúster GKE"
}
variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}
variable "region" {
  type        = string
  description = "Región del clúster (regional = alta disponibilidad)"
}
variable "network" {
  type        = string
  description = "Self-link de la VPC"
}
variable "subnetwork" {
  type        = string
  description = "Self-link de la subred"
}
variable "pods_range_name" {
  type        = string
  description = "Nombre del rango secundario para Pods"
}
variable "services_range_name" {
  type        = string
  description = "Nombre del rango secundario para Services"
}

variable "release_channel" {
  type    = string
  default = "REGULAR"
  validation {
    condition     = contains(["RAPID", "REGULAR", "STABLE", "UNSPECIFIED"], var.release_channel)
    error_message = "Debe ser RAPID, REGULAR, STABLE o UNSPECIFIED."
  }
}

variable "enable_private_nodes" {
  type        = bool
  default     = true
  description = "Habilitar nodos privados (sin IP pública)"
}
variable "enable_private_endpoint" {
  type        = bool
  default     = false
  description = "Habilitar endpoint privado del control plane"
}
variable "master_ipv4_cidr_block" {
  type        = string
  default     = null
  description = "CIDR del control plane (null usa Private Service Connect sin consumir segmento /28 adicional)"
}

variable "master_authorized_networks" {
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default     = []
  description = "Redes autorizadas para acceder al control plane"
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Proteger el clúster contra borrado accidental"
}

variable "maintenance_start_time" {
  type        = string
  default     = null
  description = "Inicio de la ventana de mantenimiento en formato RFC3339 (ej: '2026-01-01T03:00:00Z'). Null = sin ventana personalizada."
}

variable "maintenance_end_time" {
  type        = string
  default     = null
  description = "Fin de la ventana de mantenimiento en formato RFC3339 (ej: '2026-01-01T07:00:00Z'). Requerido si maintenance_start_time está definido."
}

variable "maintenance_recurrence" {
  type        = string
  default     = "FREQ=WEEKLY;BYDAY=SA,SU"
  description = "Regla de recurrencia RRULE para la ventana de mantenimiento (ej: 'FREQ=WEEKLY;BYDAY=SA,SU' para fines de semana)."
}
variable "enable_managed_prometheus" {
  type        = bool
  default     = true
  description = "Habilita o deshabilita Google Cloud Managed Service for Prometheus."
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Etiquetas del clúster"
}

variable "node_pools" {
  description = <<-EOT
    Mapa de node pools a crear.

    spot / preemptible son mutuamente excluyentes:
      - spot: VMs de excedente sin límite de 24h, mismo descuento que preemptible,
        recomendado para cargas tolerantes a interrupciones (GCP puede reclamar la VM
        con ~30s de aviso, sin garantía de disponibilidad).
      - preemptible: VMs de excedente clásicas, terminan forzosamente a las 24h.
    Deja ambos en false para nodos on-demand (bajo demanda, sin descuento).
  EOT
  type = map(object({
    machine_type       = optional(string, "e2-medium")
    disk_size_gb       = optional(number, 100)
    disk_type          = optional(string, "pd-standard")
    initial_node_count = optional(number, 1)
    min_node_count     = optional(number, 1)
    max_node_count     = optional(number, 3)
    service_account    = optional(string, null)
    max_pods_per_node  = optional(number, 110)
    spot               = optional(bool, false)
    preemptible        = optional(bool, false)
    labels             = optional(map(string), {})
    tags               = optional(list(string), [])
  }))

  validation {
    condition     = alltrue([for k, v in var.node_pools : !(v.spot && v.preemptible)])
    error_message = "Un node pool no puede ser 'spot' y 'preemptible' a la vez (son mutuamente excluyentes en la API de GCP)."
  }
}
