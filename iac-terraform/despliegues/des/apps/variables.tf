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
# RED COMPARTIDA
# ─────────────────────────────────────────────

variable "host_project_id" {
  description = "ID del proyecto host que provee la Shared VPC."
  type        = string
}

variable "host_network_name" {
  description = "Nombre de la VPC del proyecto host."
  type        = string
}

variable "host_subnet_names" {
  description = "Mapa identificador lógico → nombre de subred en el proyecto host ('gke' y 'apps')."
  type        = map(string)
}

variable "enable_host_iam" {
  description = "Concede compute.networkUser en el proyecto host si la SA de despliegue tiene permisos en el host."
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

variable "cluster_name" {
  description = "Nombre del clúster GKE."
  type        = string
}

variable "gke_secondary_range_names" {
  description = "Nombres de los rangos secundarios de pods y services en la subred GKE del host."
  type = object({
    pods     = string
    services = string
  })
}

variable "gke_master_ipv4_cidr_block" {
  description = "CIDR del control plane de GKE (null usa Private Service Connect sin requerir segmento /28 adicional)."
  type        = string
  default     = null
}

variable "gke_master_authorized_networks" {
  description = "Redes autorizadas a alcanzar el endpoint del control plane."
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = []
}

variable "gke_node_pools" {
  description = "Node pools del clúster. La clave es el nombre del pool."
  type = map(object({
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
  default = {}
}

# ─────────────────────────────────────────────
# CLOUD RUN SERVICES Y JOBS
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
    container_port  = optional(number, 8080)
    env_vars        = optional(map(string), {})
    invokers        = optional(list(string), [])
    labels          = optional(map(string), {})
    vpc_egress      = optional(string, "PRIVATE_RANGES_ONLY")
  }))
  default = {}
}

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
    invokers        = optional(list(string), [])
    labels          = optional(map(string), {})
    vpc_egress      = optional(string, "PRIVATE_RANGES_ONLY")
  }))
  default = {}
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

# ─────────────────────────────────────────────
# APIGEE (OPCIONAL)
# ─────────────────────────────────────────────

variable "enable_apigee" {
  description = "Despliega Apigee X."
  type        = bool
  default     = false
}

variable "enable_apigee_host_iam" {
  description = "Concede compute.networkUser a la SA de Apigee en el proyecto host."
  type        = bool
  default     = false
}

variable "apigee_name" {
  description = "Nombre base de la organización/instancia de Apigee."
  type        = string
  default     = "sso-apigee-des"
}

variable "apigee_billing_type" {
  description = "Modelo de facturación de Apigee."
  type        = string
  default     = "EVALUATION"
}

variable "apigee_ip_range" {
  description = "CIDR /22 del peering de Apigee."
  type        = string
  default     = null
}

variable "apigee_environment_name" {
  description = "Nombre del ambiente de Apigee."
  type        = string
  default     = "des"
}

variable "apigee_hostnames" {
  description = "Hostnames (FQDN) del environment group de Apigee."
  type        = list(string)
  default     = []
}
