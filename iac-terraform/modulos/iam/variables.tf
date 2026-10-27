variable "tipo_recurso" {
  description = "Tipo de recurso GCP al que se otorga el IAM: proyecto, carpeta u organizacion."
  type        = string

  validation {
    condition     = contains(["proyecto", "carpeta", "organizacion"], var.tipo_recurso)
    error_message = "El valor debe ser: proyecto, carpeta u organizacion."
  }
}

variable "recurso_id" {
  description = <<-EOT
    Identificador del recurso:
      - proyecto:      project_id  (ej: "mi-proyecto-001")
      - carpeta:       ID numérico (ej: "123456789")       — el prefijo folders/ se agrega automáticamente
      - organizacion:  ID numérico (ej: "123456789012")
  EOT
  type        = string
}

variable "email" {
  description = "Correo electrónico de la cuenta a la que se otorgan los roles (ej: sa@proyecto.iam.gserviceaccount.com)"
  type        = string
}

variable "tipo_cuenta" {
  description = "Tipo de cuenta IAM: user, serviceAccount, group o domain."
  type        = string
  default     = "serviceAccount"

  validation {
    condition     = contains(["user", "serviceAccount", "group", "domain"], var.tipo_cuenta)
    error_message = "El valor debe ser: user, serviceAccount, group o domain."
  }
}

variable "roles" {
  description = "Lista de roles IAM a otorgar. Usar el formato completo: roles/viewer, roles/editor, roles/storage.admin, etc."
  type        = list(string)

  validation {
    condition     = length(var.roles) > 0
    error_message = "Debe especificarse al menos un rol."
  }
}
