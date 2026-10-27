variable "name" {
  type        = string
  description = "Nombre del servicio Cloud Run"
}
variable "project_id" {
  type        = string
  description = "ID del proyecto GCP"
}
variable "region" {
  type        = string
  description = "Región del servicio"
}
variable "image" {
  type        = string
  description = "Imagen de contenedor (ej: us-central1-docker.pkg.dev/proj/repo/imagen:tag)"
}

variable "ingress" {
  type    = string
  default = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  validation {
    condition     = contains(["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"], var.ingress)
    error_message = "Valor inválido para ingress."
  }
}

variable "service_account" {
  type        = string
  default     = null
  description = "Email de la service account del servicio"
}
variable "min_instances" {
  type        = number
  default     = 0
  description = "Número mínimo de instancias (0 = scale to zero)"
}
variable "max_instances" {
  type        = number
  default     = 10
  description = "Número máximo de instancias"
}
variable "cpu" {
  type        = string
  default     = "1"
  description = "CPUs asignadas (ej: '1', '2', '4')"
}
variable "memory" {
  type        = string
  default     = "512Mi"
  description = "Memoria asignada (ej: '512Mi', '1Gi')"
}
variable "cpu_idle" {
  type        = bool
  default     = true
  description = "Throttle CPU cuando no hay requests (reduce costo)"
}
variable "container_port" {
  type        = number
  default     = 8080
  description = "Puerto que expone el contenedor"
}
variable "timeout_seconds" {
  type        = number
  default     = 300
  description = "Tiempo máximo de respuesta en segundos"
}

variable "env_vars" {
  type        = map(string)
  default     = {}
  description = "Variables de entorno en texto plano"
}

variable "env_secrets" {
  description = "Variables de entorno desde Secret Manager"
  type = map(object({
    secret  = string
    version = optional(string, "latest")
  }))
  default = {}
}

variable "vpc_connector" {
  type        = string
  default     = null
  description = "Self-link del VPC Access Connector (modo legado). Dejar en null si se usa direct VPC egress."
}

variable "vpc_network" {
  type        = string
  default     = null
  description = "Direct VPC egress: self-link o nombre de la VPC a la que se conecta el servicio. En Shared VPC, la VPC del proyecto host."
}

variable "vpc_subnetwork" {
  type        = string
  default     = null
  description = "Direct VPC egress: self-link o nombre de la subred desde la que el servicio toma IPs. Si se define, se ignora vpc_connector."
}

variable "vpc_network_tags" {
  type        = list(string)
  default     = []
  description = "Network tags aplicados a las interfaces de direct VPC egress. Permiten seleccionar el servicio en reglas de firewall."
}
variable "vpc_egress" {
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
  description = "ALL_TRAFFIC o PRIVATE_RANGES_ONLY"
}

variable "invokers" {
  type        = list(string)
  default     = []
  description = "Lista de members con roles/run.invoker (ej: 'allUsers', 'serviceAccount:sa@proj.iam.gserviceaccount.com')"
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Etiquetas del servicio"
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Protege el servicio contra borrado accidental. Si el servicio necesita reemplazarse (ej: cambiar region, que es inmutable), primero hay que poner esto en false y aplicar, y solo en un segundo apply Terraform podrá destruirlo/recrearlo."
}
