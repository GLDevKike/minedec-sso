variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}
variable "region" {
  type        = string
  description = "Región o multi-región del repositorio (ej: us-central1, us, europe)"
}

variable "repositories" {
  description = "Mapa de repositorios a crear. La clave es el repository_id."
  type = map(object({
    format      = optional(string, "DOCKER")
    description = optional(string, "")
    labels      = optional(map(string), {})
    readers     = optional(list(string), [])
    writers     = optional(list(string), [])
    cleanup_policies = optional(map(object({
      action = string
      condition = optional(object({
        tag_state             = optional(string, null)
        older_than            = optional(string, null)
        newer_than            = optional(string, null)
        tag_prefixes          = optional(list(string), [])
        package_name_prefixes = optional(list(string), [])
      }), null)
    })), {})
  }))
}
