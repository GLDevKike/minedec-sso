# ─────────────────────────────────────────────
# GENERALES
# ─────────────────────────────────────────────

variable "name" {
  description = "Nombre base de la VPN. Se usa como prefijo del gateway, las forwarding rules, el túnel y las rutas."
  type        = string
}

variable "project_id" {
  description = "ID del proyecto GCP donde vive la VPC y se crea la VPN (proyecto host en una Shared VPC)."
  type        = string
}

variable "region" {
  description = "Región del gateway y del túnel. Debe coincidir con la región de la dirección IP externa reservada."
  type        = string
}

variable "network" {
  description = "Self-link o nombre de la VPC donde se crean el gateway, las rutas y las reglas de firewall."
  type        = string
}

variable "description" {
  description = "Descripción aplicada al gateway y al túnel."
  type        = string
  default     = ""
}

# ─────────────────────────────────────────────
# DIRECCIÓN IP EXTERNA
# ─────────────────────────────────────────────

variable "external_address_name" {
  description = <<-EOT
    Nombre de la dirección IP externa regional YA RESERVADA que usará el gateway.
    El módulo la consulta con un data source: no la crea ni la destruye.

    Se usa una IP preexistente para que el extremo remoto no tenga que
    reconfigurar su peer si la VPN se recrea desde Terraform.
  EOT
  type        = string
}

# ─────────────────────────────────────────────
# TÚNEL
# ─────────────────────────────────────────────

variable "peer_ip" {
  description = "Dirección IP pública del gateway VPN del extremo remoto."
  type        = string
}

variable "shared_secret" {
  description = <<-EOT
    Pre-shared key (PSK) de IKE.

    NUNCA debe escribirse en el repositorio ni en archivos .tfvars. Debe leerse en
    tiempo de ejecución desde Secret Manager con
    data "google_secret_manager_secret_version". Aun así el valor queda
    almacenado en el state de Terraform, por lo que el bucket del state debe ser
    privado y de acceso restringido.
  EOT
  type        = string
  sensitive   = true
}

variable "ike_version" {
  description = "Versión del protocolo IKE: 1 o 2. Usar 2 salvo que el extremo remoto solo soporte IKEv1."
  type        = number
  default     = 2

  validation {
    condition     = contains([1, 2], var.ike_version)
    error_message = "El valor debe ser 1 o 2."
  }
}

variable "local_traffic_selector" {
  description = "Selectores de tráfico local (lado GCP). En VPN route-based se deja en 0.0.0.0/0 y el enrutamiento lo definen las rutas estáticas."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "remote_traffic_selector" {
  description = "Selectores de tráfico remoto (lado peer). En VPN route-based se deja en 0.0.0.0/0."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ─────────────────────────────────────────────
# CIFRADO (cipher_suite)
# ─────────────────────────────────────────────

variable "enable_cipher_suite" {
  description = <<-EOT
    Si es true, fija explícitamente los algoritmos de fase 1 y fase 2 del túnel
    mediante el bloque cipher_suite. Requiere el provider google-beta >= 6.41.0
    (en el provider GA el bloque solo existe desde la serie 7.x).

    Si es false, GCP negocia con el peer usando su lista de algoritmos por defecto.
  EOT
  type        = bool
  default     = true
}

variable "cipher_suite" {
  description = <<-EOT
    Algoritmos IKE negociados por el túnel. Deben coincidir exactamente con los
    configurados en el extremo remoto, o la fase 1 / fase 2 no levanta.

    Los valores admitidos por la API son listas de strings y el orden es
    significativo (el provider rastrea el orden declarado).
  EOT
  type = object({
    phase1 = object({
      encryption = list(string)
      integrity  = list(string)
      prf        = list(string)
      dh         = list(string)
    })
    phase2 = object({
      encryption = list(string)
      integrity  = list(string)
      pfs        = list(string)
    })
  })
  default = {
    phase1 = {
      encryption = ["AES-CBC-256"]
      integrity  = ["HMAC-SHA2-256-128"]
      prf        = ["PRF-HMAC-SHA2-256"]
      dh         = ["Group-20"]
    }
    phase2 = {
      encryption = ["AES-CBC-256"]
      integrity  = ["HMAC-SHA2-256-128"]
      pfs        = ["Group-20"]
    }
  }
}

# ─────────────────────────────────────────────
# RUTAS
# ─────────────────────────────────────────────

variable "remote_cidrs" {
  description = "Lista de CIDR del extremo remoto alcanzables por el túnel. Se crea una ruta estática por cada uno y se usan como origen/destino en las reglas de firewall."
  type        = list(string)
  default     = []
}

variable "route_priority" {
  description = "Prioridad de las rutas estáticas creadas hacia los CIDR remotos (menor número = mayor preferencia)."
  type        = number
  default     = 1000
}

# ─────────────────────────────────────────────
# FIREWALL
# ─────────────────────────────────────────────

variable "enable_firewall_rules" {
  description = "Habilita la creación de las reglas de firewall de ingreso/egreso asociadas a los rangos remotos."
  type        = bool
  default     = true
}

variable "ingress_allow" {
  description = <<-EOT
    Protocolos y puertos permitidos en el tráfico entrante desde los CIDR remotos.
    Lista vacía = no se crea la regla de ingreso.

    Ejemplo:
      ingress_allow = [
        { protocol = "tcp", ports = ["443", "8443"] },
        { protocol = "icmp" },
      ]
  EOT
  type = list(object({
    protocol = string
    ports    = optional(list(string), [])
  }))
  default = []
}

variable "egress_allow" {
  description = "Protocolos y puertos permitidos en el tráfico saliente hacia los CIDR remotos. Mismo formato que ingress_allow. Lista vacía = no se crea la regla de egreso."
  type = list(object({
    protocol = string
    ports    = optional(list(string), [])
  }))
  default = []
}

variable "firewall_priority" {
  description = "Prioridad de las reglas de firewall creadas por el módulo (1000 = default de GCP)."
  type        = number
  default     = 1000
}

variable "target_tags" {
  description = "Network tags a los que se restringen las reglas de firewall. Lista vacía = las reglas aplican a todas las instancias de la VPC."
  type        = list(string)
  default     = []
}
