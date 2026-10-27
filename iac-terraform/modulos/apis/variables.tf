variable "project_id" {
  description = "ID del proyecto GCP donde se habilitarán las APIs."
  type        = string
}

variable "apis" {
  description = "Lista de APIs a habilitar. Usar el nombre completo del servicio (ej: compute.googleapis.com)."
  type        = list(string)
}

variable "disable_on_destroy" {
  description = "Si es true, deshabilita las APIs cuando el recurso se destruye con terraform destroy. Recomendado: false para evitar deshabilitar APIs en uso por otros recursos."
  type        = bool
  default     = false
}

variable "disable_dependent_services" {
  description = "Si es true, deshabilita también los servicios que dependen de las APIs eliminadas al hacer destroy."
  type        = bool
  default     = false
}
