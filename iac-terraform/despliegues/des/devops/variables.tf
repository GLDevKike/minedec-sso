variable "project_id" {
  description = "ID del proyecto de servicio SSO."
  type        = string
}

variable "region" {
  description = "Región del segmento."
  type        = string
}

variable "labels" {
  description = "Etiquetas comunes aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

# ─────────────────────────────────────────────
# RED COMPARTIDA / VPC LOCAL (/20, /23, /24)
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC (o el propio proyecto SSO cuando se usa VPC local)."
  type        = string
}

variable "enable_host_iam" {
  description = "Concede compute.networkUser en el proyecto host (solo si aplica VM GitLab)."
  type        = bool
  default     = false
}

variable "enable_local_vpc" {
  description = "Aprovisiona la VPC local en el proyecto SSO con los 3 segmentos oficiales (/20, /23, /24)."
  type        = bool
  default     = false
}

variable "local_vpc" {
  description = "Configuración de la VPC local usando exclusivamente los 3 segmentos oficiales de red (/20, /23, /24)."
  type = object({
    network_name        = optional(string, "vpc-mec-sha-des")
    routing_mode        = optional(string, "REGIONAL")
    subnet_name         = optional(string, "snet-sso-ue1")
    subnet_cidr         = optional(string, "10.10.0.0/24")
    pods_range_name     = optional(string, "pods")
    pods_cidr           = optional(string, "10.10.16.0/20")
    services_range_name = optional(string, "services")
    services_cidr       = optional(string, "10.10.2.0/24")
    psa_range_name      = optional(string, "psa-sso-des")
    psa_address         = optional(string, "10.10.1.0")
    psa_prefix_length   = optional(number, 24)
    router_name         = optional(string, "rtr-sso-des-ue1")
    nat_name            = optional(string, "nat-sso-des-ue1")
  })
  default = null
}

# ─────────────────────────────────────────────
# SERVICE ACCOUNTS Y SECRET MANAGER (SSO C2.2)
# ─────────────────────────────────────────────

variable "service_accounts" {
  description = "Cuentas de servicio dedicadas de mínimo privilegio para el Subcomponente C2.2 SSO."
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

# ─────────────────────────────────────────────
# BUCKETS Y ARTIFACT REGISTRY
# ─────────────────────────────────────────────

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
