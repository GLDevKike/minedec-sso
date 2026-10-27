# ─────────────────────────────────────────────
# GENERALES
# ─────────────────────────────────────────────

variable "project_id" {
  description = "ID del proyecto de servicio donde se crean las cargas de trabajo."
  type        = string
}

variable "region" {
  description = "Región de las cargas de trabajo. Debe coincidir con la región de las subredes del host."
  type        = string
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas a todos los recursos que las soporten."
  type        = map(string)
  default     = {}
}

variable "apis_to_enable" {
  description = "APIs de GCP a habilitar en el proyecto de servicio."
  type        = list(string)
  default = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
  ]
}

# ─────────────────────────────────────────────
# SHARED VPC — red provista por el proyecto host
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC."
  type        = string
}

variable "host_vpc_self_link" {
  description = "Self-link de la VPC del proyecto host (ej: projects/<host>/global/networks/<vpc>)."
  type        = string
}

variable "cloud_run_subnet_self_link" {
  description = "Self-link de la subred del host usada por Cloud Run Services y Jobs con direct VPC egress."
  type        = string
  default     = null
}

variable "enable_host_iam" {
  description = "Concede en el proyecto host el IAM que GCP exige a los service agents sobre la Shared VPC."
  type        = bool
  default     = false
}

# ─────────────────────────────────────────────
# GKE
# ─────────────────────────────────────────────

variable "enable_gke" {
  description = "Despliega el clúster GKE privado."
  type        = bool
  default     = false
}

variable "cluster" {
  description = "Configuración del clúster GKE. Solo aplica si enable_gke = true."
  type = object({
    name                  = string
    node_subnet_self_link = string
    pods_range_name       = string
    services_range_name   = string

    master_ipv4_cidr_block  = optional(string, null)
    enable_private_nodes    = optional(bool, true)
    enable_private_endpoint = optional(bool, false)
    master_authorized_networks = optional(list(object({
      cidr_block   = string
      display_name = string
    })), [])

    release_channel           = optional(string, "REGULAR")
    deletion_protection       = optional(bool, true)
    enable_managed_prometheus = optional(bool, true)
    maintenance_start_time    = optional(string, null)
    maintenance_end_time      = optional(string, null)
    maintenance_recurrence    = optional(string, "FREQ=WEEKLY;BYDAY=SA,SU")
    labels                    = optional(map(string), {})

    node_pools = map(object({
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
  })
  default = null
}

# ─────────────────────────────────────────────
# ARTIFACT REGISTRY (OPCIONAL EN APPS)
# ─────────────────────────────────────────────

variable "artifact_registry_repositories" {
  description = "Repositorios de Artifact Registry adicionales a crear desde el stack apps."
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
# CLOUD RUN SERVICES
# ─────────────────────────────────────────────

variable "cloud_run_services" {
  description = "Servicios de Cloud Run (ej: sso-sincronizador)."
  type = map(object({
    image           = string
    ingress         = optional(string, "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER")
    service_account = optional(string, null)
    min_instances   = optional(number, 0)
    max_instances   = optional(number, 10)
    cpu             = optional(string, "1")
    memory          = optional(string, "512Mi")
    cpu_idle        = optional(bool, true)
    container_port  = optional(number, 8080)
    timeout_seconds = optional(number, 300)
    env_vars        = optional(map(string), {})
    env_secrets = optional(map(object({
      secret  = string
      version = optional(string, "latest")
    })), {})
    invokers            = optional(list(string), [])
    labels              = optional(map(string), {})
    vpc_egress          = optional(string, "PRIVATE_RANGES_ONLY")
    vpc_network_tags    = optional(list(string), [])
    deletion_protection = optional(bool, false)
  }))
  default = {}
}

# ─────────────────────────────────────────────
# CLOUD RUN JOBS
# ─────────────────────────────────────────────

variable "cloud_run_jobs" {
  description = "Jobs de Cloud Run v2 (ej: sso-conciliacion-job, sso-publicador-job)."
  type = map(object({
    image           = string
    service_account = optional(string, null)
    cpu             = optional(string, "1")
    memory          = optional(string, "1Gi")
    max_retries     = optional(number, 1)
    timeout_seconds = optional(number, 3600)
    parallelism     = optional(number, 1)
    task_count      = optional(number, 1)
    env_vars        = optional(map(string), {})
    env_secrets = optional(map(object({
      secret  = string
      version = optional(string, "latest")
    })), {})
    invokers            = optional(list(string), [])
    labels              = optional(map(string), {})
    vpc_egress          = optional(string, "PRIVATE_RANGES_ONLY")
    vpc_network_tags    = optional(list(string), [])
    deletion_protection = optional(bool, false)
  }))
  default = {}
}

# ─────────────────────────────────────────────
# APIGEE
# ─────────────────────────────────────────────

variable "enable_apigee" {
  description = "Despliega Apigee X. Deshabilitado por defecto."
  type        = bool
  default     = false
}

variable "enable_apigee_host_iam" {
  description = "Concede compute.networkUser a la SA de Apigee en el proyecto host."
  type        = bool
  default     = false
}

variable "apigee" {
  description = "Configuración de Apigee X. Solo aplica si enable_apigee = true."
  type = object({
    name             = string
    analytics_region = optional(string, null)
    runtime_type     = optional(string, "CLOUD")
    billing_type     = optional(string, "EVALUATION")
    description      = optional(string, "")
    cmek_key_name    = optional(string, null)

    instances = map(object({
      location                 = string
      description              = optional(string, "")
      ip_range                 = optional(string, null)
      peering_cidr_range       = optional(string, "SLASH_22")
      disk_encryption_key_name = optional(string, null)
      environments             = optional(list(string), [])
    }))

    environments = optional(map(object({
      description    = optional(string, "")
      type           = optional(string, null)
      min_node_count = optional(number, null)
      max_node_count = optional(number, null)
    })), {})

    envgroups = optional(map(object({
      hostnames    = list(string)
      environments = optional(list(string), [])
    })), {})
  })
  default = null
}

# ─────────────────────────────────────────────
# CLOUD ARMOR WAF (SSO OIDC)
# ─────────────────────────────────────────────

variable "enable_cloud_armor_waf" {
  description = "Despliega la política de seguridad Cloud Armor WAF para sso-oidc."
  type        = bool
  default     = true
}

variable "waf_policy_name" {
  description = "Nombre de la política de seguridad Cloud Armor WAF para sso-oidc."
  type        = string
  default     = "sso-oidc-waf-policy"
}
