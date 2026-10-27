variable "project_id" {
  description = "ID del proyecto GCP donde se alojan los secretos."
  type        = string
}

variable "secret_ids" {
  description = "Lista de identificadores de secretos a aprovisionar en Secret Manager."
  type        = list(string)
  default     = []
}

variable "accessor_members" {
  description = "Miembros IAM (ej: serviceAccount:sa-sso-core@...) con rol roles/secretmanager.secretAccessor sobre los secretos."
  type        = list(string)
  default     = []
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas a los contenedores de secretos."
  type        = map(string)
  default     = {}
}
