variable "project_id" {
  description = "ID del proyecto de servicio SSO."
  type        = string
}

variable "region" {
  description = "RegiÃ³n del segmento."
  type        = string
}

variable "labels" {
  description = "Etiquetas comunes aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# RED COMPARTIDA
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC."
  type        = string
}

variable "enable_host_iam" {
  description = "Concede compute.networkUser en el proyecto host (solo si aplica VM GitLab)."
  type        = bool
  default     = false
}

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# SERVICE ACCOUNTS Y SECRET MANAGER (SSO C2.2)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

variable "service_accounts" {
  description = "Cuentas de servicio dedicadas de mÃ­nimo privilegio para el Subcomponente C2.2 SSO."
  type = map(object({
    display_name           = string
    description            = optional(string, "")
    roles                  = optional(list(string), [])
    workload_identity_ksas = optional(list(string), [])
  }))
  default = {}
}

variable "secret_ids" {
  description = "Identificadores de secretos en Secret Manager (sin valores en texto plano)."
  type        = list(string)
  default     = []
}

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# BUCKETS Y ARTIFACT REGISTRY
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

variable "buckets" {
  description = "Buckets de GCS a crear."
  type = map(object({
    name               = string
    location           = optional(string, null)
    storage_class      = optional(string, "STANDARD")
    versioning_enabled = optional(bool, true)
    force_destroy      = optional(bool, false)
    labels             = optional(map(string), {})
    lifecycle_rules = optional(list(object({
      action_type           = string
      storage_class         = optional(string, null)
      age_days              = optional(number, null)
      with_state            = optional(string, null)
      num_newer_versions    = optional(number, null)
      matches_storage_class = optional(list(string), null)
    })), [])
  }))
  default = {}
}

variable "artifact_registry_repositories" {
  description = "Repositorios de Artifact Registry a crear. La clave es el repository_id."
  type = map(object({
    format      = optional(string, "DOCKER")
    description = optional(string, "")
    labels      = optional(map(string), {})
    readers     = optional(list(string), [])
    writers     = optional(list(string), [])
  }))
  default = {}
}
