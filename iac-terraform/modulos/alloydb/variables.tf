variable "project_id" {
  description = "ID del proyecto GCP donde se despliega el clúster AlloyDB for PostgreSQL 16."
  type        = string
}

variable "region" {
  description = "Región de GCP para el clúster AlloyDB."
  type        = string
}

variable "cluster_id" {
  description = "Identificador del clúster AlloyDB (ej: sso-alloydb)."
  type        = string
}

variable "network_self_link" {
  description = "Ruta canónica de la VPC con Private Services Access (projects/<host_project>/global/networks/<network>)."
  type        = string
}

variable "allocated_ip_range" {
  description = "Nombre del rango IP reservado para PSA en el proyecto host (opcional)."
  type        = string
  default     = null
}

variable "availability_type" {
  description = "Tipo de disponibilidad de la instancia primaria (REGIONAL o ZONAL)."
  type        = string
  default     = "REGIONAL"
}

variable "primary_cpu_count" {
  description = "Número de vCPUs para la instancia primaria de AlloyDB."
  type        = number
  default     = 2
}

variable "enable_read_pool" {
  description = "Habilita una instancia Read Pool de AlloyDB para lecturas de alta concurrencia."
  type        = bool
  default     = false
}

variable "read_pool_node_count" {
  description = "Número de nodos en el Read Pool de AlloyDB."
  type        = number
  default     = 1
}

variable "deletion_protection" {
  description = "Protección contra borrado accidental del clúster AlloyDB."
  type        = bool
  default     = true
}

variable "labels" {
  description = "Etiquetas clave/valor aplicadas al clúster e instancias de AlloyDB."
  type        = map(string)
  default     = {}
}
