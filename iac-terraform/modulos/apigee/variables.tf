variable "project_id" {
  type        = string
  description = "ID del proyecto GCP donde se despliega Apigee"
}

variable "nombre" {
  type        = string
  description = "Nombre base para el rango IP del peering (ej: apigee-prod)"
}

variable "network" {
  type        = string
  description = "Self-link de la VPC autorizada para Apigee (ej: projects/proj/global/networks/vpc-name)"
}

variable "analytics_region" {
  type        = string
  description = "Región para almacenar los datos de analítica de Apigee (ej: us-central1)"
}

variable "runtime_type" {
  type        = string
  default     = "CLOUD"
  description = "Tipo de runtime: CLOUD (Apigee X, fully managed) o HYBRID"
  validation {
    condition     = contains(["CLOUD", "HYBRID"], var.runtime_type)
    error_message = "Debe ser CLOUD o HYBRID."
  }
}

variable "billing_type" {
  type        = string
  default     = "PAYG"
  description = "Modelo de facturación: PAYG (pago por uso), SUBSCRIPTION o EVALUATION (30 días gratis, sin SLA)"
  validation {
    condition     = contains(["PAYG", "SUBSCRIPTION", "EVALUATION"], var.billing_type)
    error_message = "Debe ser PAYG, SUBSCRIPTION o EVALUATION."
  }
}

variable "description" {
  type        = string
  default     = ""
  description = "Descripción de la organización Apigee"
}

variable "cmek_key_name" {
  type        = string
  default     = null
  description = "Nombre completo de la clave Cloud KMS para cifrado de la base de datos de runtime (CMEK). Null = cifrado gestionado por Google."
}

# ─── Service Networking ───────────────────────────────────────────────────────

variable "create_service_networking" {
  type        = bool
  default     = true
  description = "Si true, crea el rango IP reservado y la conexión de Service Networking. Poner false si PSA ya está configurado en la VPC."
}

variable "peering_prefix_length" {
  type        = number
  default     = 22
  description = "Longitud del prefijo del rango IP para el peering de Apigee (/22 = 1024 IPs recomendado)"
}

# ─── Instancias de runtime ────────────────────────────────────────────────────

variable "instances" {
  description = <<-EOT
    Mapa de instancias de runtime de Apigee. La clave es el nombre de la instancia.
    Cada instancia corresponde a una región y puede estar adjunta a múltiples ambientes.
  EOT
  type = map(object({
    location    = string
    description = optional(string, "")

    # Rango CIDR /22 opcional para la instancia. Si null, Apigee asigna uno automáticamente.
    ip_range = optional(string, null)

    # Tamaño del rango de peering: SLASH_16, SLASH_20 o SLASH_22
    peering_cidr_range = optional(string, "SLASH_22")

    # Clave KMS para cifrado del disco de la instancia (CMEK). Null = cifrado de Google.
    disk_encryption_key_name = optional(string, null)

    # Lista de nombres de ambientes que se adjuntan a esta instancia
    environments = optional(list(string), [])
  }))
}

# ─── Ambientes ────────────────────────────────────────────────────────────────

variable "environments" {
  description = "Mapa de ambientes Apigee. La clave es el nombre del ambiente."
  type = map(object({
    description = optional(string, "")

    # Tipo de ambiente: BASE, INTERMEDIATE o COMPREHENSIVE. null para orgs EVALUATION
    # (solo PAYG con el nuevo plan o SUBSCRIPTION_2024 admiten especificarlo)
    type = optional(string, null)

    # Configuración de nodos (solo para ambientes con node_config habilitado)
    min_node_count = optional(number, null)
    max_node_count = optional(number, null)
  }))
  default = {}
}

# ─── Environment Groups ───────────────────────────────────────────────────────

variable "envgroups" {
  description = <<-EOT
    Mapa de Environment Groups de Apigee. La clave es el nombre del grupo.
    Los Environment Groups definen los hostnames externos a través de los cuales
    se enruta el tráfico hacia los proxies de API.
  EOT
  type = map(object({
    # Lista de hostnames (FQDN) asociados a este grupo (ej: ["api.ejemplo.com"])
    hostnames = list(string)

    # Lista de nombres de ambientes a adjuntar a este grupo
    environments = optional(list(string), [])
  }))
  default = {}
}

# ─── Endpoint Attachments (PSC) ───────────────────────────────────────────────

variable "endpoint_attachments" {
  description = <<-EOT
    Mapa de Endpoint Attachments para conectar Apigee a servicios backend
    en otras VPCs mediante Private Service Connect (PSC).
    La clave es el nombre del endpoint attachment.
  EOT
  type = map(object({
    # URI del Service Attachment en el lado del productor PSC
    # Formato: projects/{project}/regions/{region}/serviceAttachments/{name}
    service_attachment = string

    # Región donde se crea el endpoint
    location = string
  }))
  default = {}
}

# ─── NAT Addresses ────────────────────────────────────────────────────────────

variable "nat_addresses" {
  description = <<-EOT
    Mapa de NAT Addresses estáticas para el tráfico de salida de instancias Apigee.
    Permite usar IPs fijas en listas de permitidos de servicios backend.
    La clave es el nombre de la dirección NAT.
  EOT
  type = map(object({
    # Nombre de la instancia de runtime a la que se asocia esta NAT address
    instance_name = string
  }))
  default = {}
}
