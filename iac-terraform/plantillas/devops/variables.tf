# ─────────────────────────────────────────────
# GENERALES
# ─────────────────────────────────────────────

variable "project_id" {
  description = "ID del proyecto de servicio SSO."
  type        = string
}

variable "region" {
  description = "Región de los recursos de DevOps y Seguridad."
  type        = string
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

variable "apis_to_enable" {
  description = "APIs de GCP a habilitar en el proyecto."
  type        = list(string)
  default = [
    "compute.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "config.googleapis.com",
    "cloudbuild.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
  ]
}

# ─────────────────────────────────────────────
# SHARED VPC Y VPC LOCAL (PRUEBAS / SEGMENTACIÓN OFICIAL /20, /23, /24)
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC (o el propio proyecto SSO cuando se usa VPC local)."
  type        = string
}

variable "enable_host_iam" {
  description = "Concede compute.networkUser sobre la subred devops del host a la SA de Google APIs del proyecto cuando se despliega VM de GitLab."
  type        = bool
  default     = false
}

variable "enable_local_vpc" {
  description = "Aprovisiona una VPC local autónoma con los 3 segmentos oficiales (/24 para subred primaria snet-sso-ue1, /23 dividido en 2x/24 para Private Services Access de Cloud SQL/AlloyDB + Redis, y /20 dividido en 2x/21 para GKE pods + services) cuando aún no se utiliza la Shared VPC externa."
  type        = bool
  default     = false
}

variable "local_vpc" {
  description = "Configuración de la VPC local usando exclusivamente los 3 segmentos oficiales de red (/20, /23, /24). Solo aplica si enable_local_vpc = true."
  type = object({
    network_name          = optional(string, "vpc-mec-sha-des")
    routing_mode          = optional(string, "REGIONAL")
    subnet_name           = optional(string, "snet-sso-ue1")
    subnet_cidr           = optional(string, "10.10.2.0/24")
    pods_range_name       = optional(string, "pods")
    pods_cidr             = optional(string, "10.10.16.0/21")
    services_range_name   = optional(string, "services")
    services_cidr         = optional(string, "10.10.24.0/21")
    psa_range_name        = optional(string, "psa-sso-des")
    psa_address           = optional(string, "10.10.1.0")
    psa_prefix_length     = optional(number, 24)
    psa_sql_range_name    = optional(string, "psa-sso-sql-des")
    psa_sql_address       = optional(string, "10.10.0.0")
    psa_sql_prefix_length = optional(number, 24)
    router_name           = optional(string, "rtr-sso-des-ue1")
    nat_name              = optional(string, "nat-sso-des-ue1")
  })
  default = null
}

# ─────────────────────────────────────────────
# SERVICE ACCOUNTS (IDENTIDADES DE CARGAS SSO)
# ─────────────────────────────────────────────

variable "service_accounts" {
  description = <<-EOT
    Cuentas de servicio dedicadas de mínimo privilegio para el Subcomponente C2.2 SSO
    (ej: sa-sso-core, sa-sso-sync, sa-sso-sync-job, sa-sso-publicador).
    La clave del mapa es el account_id.
  EOT
  type = map(object({
    display_name           = string
    description            = optional(string, "")
    roles                  = optional(list(string), [])
    workload_identity_ksas = optional(list(string), [])
  }))
  default = {}
}

# ─────────────────────────────────────────────
# SECRET MANAGER (ROTACIÓN <= 90 DÍAS)
# ─────────────────────────────────────────────

variable "secret_ids" {
  description = "Lista de identificadores de secretos a aprovisionar en Secret Manager (sin valores en texto plano)."
  type        = list(string)
  default     = []
}

# ─────────────────────────────────────────────
# BUCKETS
# ─────────────────────────────────────────────

variable "buckets" {
  description = "Buckets de GCS a crear (artefactos, blueprints, etc.)."
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

# ─────────────────────────────────────────────
# ARTIFACT REGISTRY
# ─────────────────────────────────────────────

variable "artifact_registry_repositories" {
  description = "Repositorios de Artifact Registry a crear (ej: sso-containers). La clave es el repository_id."
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
  default = {}
}

# ─────────────────────────────────────────────
# VM DE GITLAB (OPCIONAL)
# ─────────────────────────────────────────────

variable "enable_gitlab_vm" {
  description = "Despliega la VM de GitLab self-managed. Deshabilitado por defecto."
  type        = bool
  default     = false
}

variable "gitlab_vm" {
  description = "Configuración de la VM de GitLab. Solo aplica si enable_gitlab_vm = true."
  type = object({
    name             = string
    zone             = string
    subnet_self_link = string

    machine_type      = optional(string, "e2-standard-2")
    boot_image        = optional(string, "ubuntu-os-cloud/ubuntu-2204-lts")
    boot_disk_size_gb = optional(number, 50)
    boot_disk_type    = optional(string, "pd-balanced")

    data_disk_size_gb = optional(number, 100)
    data_disk_type    = optional(string, "pd-balanced")

    service_account_id = optional(string, "sa-gitlab")
    service_account_roles = optional(list(string), [
      "roles/logging.logWriter",
      "roles/monitoring.metricWriter",
      "roles/artifactregistry.writer",
    ])

    network_tags        = optional(list(string), ["gitlab"])
    metadata            = optional(map(string), {})
    labels              = optional(map(string), {})
    deletion_protection = optional(bool, false)
  })
  default = null
}
