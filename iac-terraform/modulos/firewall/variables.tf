variable "project_id" {
  description = "ID del proyecto GCP donde se crean las reglas"
  type        = string
}

variable "network" {
  description = "Self-link o nombre de la VPC a la que se aplican las reglas"
  type        = string
}

variable "rules" {
  description = <<-EOT
    Mapa de reglas de firewall. La clave es el nombre de la regla (debe ser único en el proyecto).

    Campos:
      direction          → "INGRESS" (default) o "EGRESS"
      priority           → prioridad de la regla, menor número = mayor prioridad (default: 1000)
      description        → descripción (opcional)
      source_ranges      → rangos CIDR de origen — solo aplica si direction = INGRESS
      destination_ranges → rangos CIDR de destino — solo aplica si direction = EGRESS
      target_tags        → network tags de las instancias destino (opcional)
      source_tags        → network tags de las instancias origen — solo INGRESS (opcional)
      allow              → lista de protocolos/puertos a permitir
      deny               → lista de protocolos/puertos a denegar

    Ejemplo:
      rules = {
        "allow-internal" = {
          source_ranges = ["10.0.0.0/8"]
          allow         = [{ protocol = "all" }]
        }
        "allow-iap-ssh" = {
          source_ranges = ["35.235.240.0/20"]
          allow         = [{ protocol = "tcp", ports = ["22"] }]
        }
      }
  EOT

  type = map(object({
    direction          = optional(string, "INGRESS")
    priority           = optional(number, 1000)
    description        = optional(string, "")
    source_ranges      = optional(list(string), [])
    destination_ranges = optional(list(string), [])
    target_tags        = optional(list(string), [])
    source_tags        = optional(list(string), [])
    allow = optional(list(object({
      protocol = string
      ports    = optional(list(string), [])
    })), [])
    deny = optional(list(object({
      protocol = string
      ports    = optional(list(string), [])
    })), [])
  }))
  default = {}

  validation {
    condition     = alltrue([for k, v in var.rules : contains(["INGRESS", "EGRESS"], v.direction)])
    error_message = "direction debe ser INGRESS o EGRESS."
  }
}
