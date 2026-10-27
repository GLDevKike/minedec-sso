variable "name" {
  type        = string
  description = "Nombre del bucket (globalmente único en GCP)"
}

variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}

variable "location" {
  type        = string
  default     = "US"
  description = "Región o multi-región del bucket (ej: US, EU, us-central1)"
}

variable "storage_class" {
  type        = string
  default     = "STANDARD"
  description = "Clase de almacenamiento del bucket: STANDARD, NEARLINE, COLDLINE o ARCHIVE"

  validation {
    condition     = contains(["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"], var.storage_class)
    error_message = "El valor debe ser STANDARD, NEARLINE, COLDLINE o ARCHIVE."
  }
}

variable "kms_key_name" {
  type        = string
  default     = null
  description = <<-EOT
    ID completo de la clave Cloud KMS con la que se cifran por defecto los objetos
    (CMEK). Null = cifrado gestionado por Google.

    El service agent de Cloud Storage del proyecto necesita
    roles/cloudkms.cryptoKeyEncrypterDecrypter sobre la clave ANTES de crear el bucket.
  EOT
}

variable "lifecycle_rules" {
  description = <<-EOT
    Reglas de ciclo de vida del bucket. Útiles para controlar costo: mover objetos
    antiguos a clases más baratas o eliminar versiones no actuales.

    Ejemplo:
      lifecycle_rules = [
        { action_type = "SetStorageClass", storage_class = "NEARLINE", age_days = 30 },
        { action_type = "Delete", age_days = 365 },
      ]
  EOT
  type = list(object({
    action_type           = string
    storage_class         = optional(string, null)
    age_days              = optional(number, null)
    with_state            = optional(string, null)
    num_newer_versions    = optional(number, null)
    matches_storage_class = optional(list(string), null)
  }))
  default = []
}

variable "public_read" {
  type        = bool
  default     = false
  description = "Si true, otorga roles/storage.objectViewer a allUsers (necesario para servir contenido público vía LB)"
}

variable "versioning_enabled" {
  type        = bool
  default     = false
  description = "Habilitar versionamiento de objetos"
}

variable "website_main_page" {
  type        = string
  default     = null
  description = "Página principal del sitio estático (ej: index.html)"
}

variable "website_not_found_page" {
  type        = string
  default     = null
  description = "Página de error 404 (ej: 404.html)"
}

variable "cors_origins" {
  type        = list(string)
  default     = null
  description = "Orígenes permitidos para CORS (ej: [\"https://ejemplo.com\"])"
}

variable "cors_methods" {
  type        = list(string)
  default     = ["GET", "HEAD"]
  description = "Métodos HTTP permitidos en CORS"
}

variable "cors_response_headers" {
  type        = list(string)
  default     = ["Content-Type"]
  description = "Headers de respuesta permitidos en CORS"
}

variable "cors_max_age_seconds" {
  type        = number
  default     = 3600
  description = "Tiempo máximo de caché para preflight CORS en segundos"
}

variable "force_destroy" {
  type        = bool
  default     = false
  description = "Si true, permite destruir el bucket aunque contenga objetos"
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Etiquetas del bucket"
}

variable "retention_policy" {
  description = "Política de retención WORM del bucket (retention_period en segundos e is_locked)"
  type = object({
    retention_period = number
    is_locked        = optional(bool, false)
  })
  default = null
}
