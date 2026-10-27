variable "name" {
  description = "Nombre del hub de Network Connectivity Center"
  type        = string
}

variable "project_id" {
  description = "ID del proyecto donde se crea el hub"
  type        = string
}

variable "description" {
  description = "Descripción del hub NCC"
  type        = string
  default     = ""
}

variable "preset_topology" {
  description = <<-EOT
    Topología predefinida del hub:
      - MESH  → todos los spokes se comunican entre sí (malla completa)
      - STAR  → topología estrella: GCP crea automáticamente los grupos 'center' y 'edge'.
                Los spokes center se comunican con todos; los spokes edge solo con center.
  EOT
  type        = string
  default     = "MESH"

  validation {
    condition     = contains(["MESH", "STAR"], var.preset_topology)
    error_message = "El valor debe ser MESH o STAR."
  }
}

variable "labels" {
  description = "Mapa de etiquetas para el hub"
  type        = map(string)
  default     = {}
}
