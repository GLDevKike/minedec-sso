variable "project_id" {
  description = "ID del proyecto donde se despliega el Cloud Run Job."
  type        = string
}

variable "region" {
  description = "Región del Cloud Run Job."
  type        = string
}

variable "name" {
  description = "Nombre del Cloud Run Job."
  type        = string
}

variable "image" {
  description = "URI completa de la imagen de contenedor."
  type        = string
}

variable "service_account" {
  description = "Email de la Service Account con la que se ejecuta el Job."
  type        = string
  default     = null
}

variable "cpu" {
  description = "Límite de CPU por contenedor."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Límite de memoria por contenedor."
  type        = string
  default     = "1Gi"
}

variable "max_retries" {
  description = "Número máximo de reintentos por tarea."
  type        = number
  default     = 1
}

variable "timeout_seconds" {
  description = "Tiempo máximo de ejecución por tarea en segundos."
  type        = number
  default     = 3600
}

variable "parallelism" {
  description = "Número de tareas concurrentes."
  type        = number
  default     = 1
}

variable "task_count" {
  description = "Número total de tareas a ejecutar."
  type        = number
  default     = 1
}

variable "env_vars" {
  description = "Variables de entorno en texto plano."
  type        = map(string)
  default     = {}
}

variable "env_secrets" {
  description = "Variables de entorno inyectadas desde Secret Manager."
  type = map(object({
    secret  = string
    version = optional(string, "latest")
  }))
  default = {}
}

variable "vpc_network" {
  description = "Self-link de la VPC para Direct VPC Egress."
  type        = string
  default     = null
}

variable "vpc_subnetwork" {
  description = "Self-link de la subred para Direct VPC Egress."
  type        = string
  default     = null
}

variable "vpc_egress" {
  description = "Tráfico que sale por la VPC (PRIVATE_RANGES_ONLY o ALL_TRAFFIC)."
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
}

variable "vpc_network_tags" {
  description = "Network tags aplicados a la interfaz de Direct VPC Egress."
  type        = list(string)
  default     = []
}

variable "invokers" {
  description = "Lista de miembros IAM con rol roles/run.invoker sobre el Job."
  type        = list(string)
  default     = []
}

variable "deletion_protection" {
  description = "Protección contra eliminación del Job."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas al Job."
  type        = map(string)
  default     = {}
}
