# ─────────────────────────────────────────────
# CLOUD VPN CLÁSICA (route-based)
#
# Topología de recursos exigida por GCP para una VPN clásica:
#
#   google_compute_address (ya existente, se referencia)
#        │
#   google_compute_vpn_gateway (target VPN gateway)
#        │
#   3 × google_compute_forwarding_rule  → ESP, UDP 500 (IKE), UDP 4500 (NAT-T)
#        │
#   google_compute_vpn_tunnel  (peer_ip del extremo remoto, PSK, IKEv2)
#        │
#   google_compute_route × N   → un route estático por CIDR remoto
#
# Las tres forwarding rules deben existir ANTES del túnel; si no, GCP rechaza
# la creación del túnel. Por eso el túnel las declara en depends_on.
# ─────────────────────────────────────────────

locals {
  # Rangos remotos normalizados — se usan tanto en los routes estáticos
  # como en las reglas de firewall.
  remote_cidrs = var.remote_cidrs

  # Selectores de tráfico. En una VPN route-based se dejan en 0.0.0.0/0 y el
  # enrutamiento real lo determinan los google_compute_route.
  local_traffic_selector  = var.local_traffic_selector
  remote_traffic_selector = var.remote_traffic_selector
}

# ─────────────────────────────────────────────
# DIRECCIÓN IP EXTERNA (preexistente)
# No se crea: se reserva fuera de este código y aquí solo se consulta, para que
# el peer remoto no tenga que reconfigurar su extremo si se recrea la VPN.
# ─────────────────────────────────────────────

data "google_compute_address" "gateway" {
  name    = var.external_address_name
  project = var.project_id
  region  = var.region
}

# ─────────────────────────────────────────────
# TARGET VPN GATEWAY
# ─────────────────────────────────────────────

resource "google_compute_vpn_gateway" "this" {
  name        = var.name
  project     = var.project_id
  region      = var.region
  network     = var.network
  description = var.description
}

# ─────────────────────────────────────────────
# FORWARDING RULES — ESP + IKE (UDP 500) + NAT-T (UDP 4500)
# ─────────────────────────────────────────────

resource "google_compute_forwarding_rule" "esp" {
  name        = "${var.name}-fr-esp"
  project     = var.project_id
  region      = var.region
  ip_protocol = "ESP"
  ip_address  = data.google_compute_address.gateway.address
  target      = google_compute_vpn_gateway.this.self_link
}

resource "google_compute_forwarding_rule" "udp500" {
  name        = "${var.name}-fr-udp500"
  project     = var.project_id
  region      = var.region
  ip_protocol = "UDP"
  port_range  = "500"
  ip_address  = data.google_compute_address.gateway.address
  target      = google_compute_vpn_gateway.this.self_link
}

resource "google_compute_forwarding_rule" "udp4500" {
  name        = "${var.name}-fr-udp4500"
  project     = var.project_id
  region      = var.region
  ip_protocol = "UDP"
  port_range  = "4500"
  ip_address  = data.google_compute_address.gateway.address
  target      = google_compute_vpn_gateway.this.self_link
}

# ─────────────────────────────────────────────
# TÚNEL VPN
#
# Se crea con el provider google-beta porque el bloque cipher_suite (control
# explícito de los algoritmos de fase 1 y fase 2) solo está disponible en
# google-beta dentro de la serie 6.x; en el provider GA llegó en 7.x.
# Si enable_cipher_suite = false, GCP negocia los algoritmos por defecto.
# ─────────────────────────────────────────────

resource "google_compute_vpn_tunnel" "this" {
  provider = google-beta

  name        = "${var.name}-tunnel"
  project     = var.project_id
  region      = var.region
  description = var.description

  target_vpn_gateway = google_compute_vpn_gateway.this.self_link
  peer_ip            = var.peer_ip
  shared_secret      = var.shared_secret
  ike_version        = var.ike_version

  local_traffic_selector  = local.local_traffic_selector
  remote_traffic_selector = local.remote_traffic_selector

  dynamic "cipher_suite" {
    for_each = var.enable_cipher_suite ? [var.cipher_suite] : []
    content {
      phase1 {
        encryption = cipher_suite.value.phase1.encryption
        integrity  = cipher_suite.value.phase1.integrity
        prf        = cipher_suite.value.phase1.prf
        dh         = cipher_suite.value.phase1.dh
      }
      phase2 {
        encryption = cipher_suite.value.phase2.encryption
        integrity  = cipher_suite.value.phase2.integrity
        pfs        = cipher_suite.value.phase2.pfs
      }
    }
  }

  depends_on = [
    google_compute_forwarding_rule.esp,
    google_compute_forwarding_rule.udp500,
    google_compute_forwarding_rule.udp4500,
  ]
}

# ─────────────────────────────────────────────
# RUTAS ESTÁTICAS HACIA LOS CIDR REMOTOS
# Sin BGP, cada prefijo del extremo remoto necesita su propia ruta apuntando
# al túnel. Añadir un CIDR a var.remote_cidrs crea su ruta automáticamente.
# ─────────────────────────────────────────────

resource "google_compute_route" "remote" {
  for_each = toset(local.remote_cidrs)

  name        = "${var.name}-route-${replace(replace(each.value, ".", "-"), "/", "-")}"
  project     = var.project_id
  network     = var.network
  description = "Ruta hacia ${each.value} a través del túnel ${var.name}"

  dest_range          = each.value
  priority            = var.route_priority
  next_hop_vpn_tunnel = google_compute_vpn_tunnel.this.self_link
}

# ─────────────────────────────────────────────
# FIREWALL
# Ingreso: desde los CIDR remotos hacia las subredes locales.
# Egreso:  desde las subredes locales hacia los CIDR remotos.
# Los protocolos/puertos se controlan por variable; el default es deliberadamente
# restrictivo (vacío = no se crea la regla).
# ─────────────────────────────────────────────

resource "google_compute_firewall" "ingress_remote" {
  count = var.enable_firewall_rules && length(var.ingress_allow) > 0 ? 1 : 0

  name        = "${var.name}-allow-ingress"
  project     = var.project_id
  network     = var.network
  description = "Permite el tráfico entrante desde los rangos remotos alcanzados por la VPN ${var.name}."
  direction   = "INGRESS"
  priority    = var.firewall_priority

  source_ranges = local.remote_cidrs
  target_tags   = length(var.target_tags) > 0 ? var.target_tags : null

  dynamic "allow" {
    for_each = var.ingress_allow
    content {
      protocol = allow.value.protocol
      ports    = length(allow.value.ports) > 0 ? allow.value.ports : null
    }
  }
}

resource "google_compute_firewall" "egress_remote" {
  count = var.enable_firewall_rules && length(var.egress_allow) > 0 ? 1 : 0

  name        = "${var.name}-allow-egress"
  project     = var.project_id
  network     = var.network
  description = "Permite el tráfico saliente hacia los rangos remotos alcanzados por la VPN ${var.name}."
  direction   = "EGRESS"
  priority    = var.firewall_priority

  destination_ranges = local.remote_cidrs
  target_tags        = length(var.target_tags) > 0 ? var.target_tags : null

  dynamic "allow" {
    for_each = var.egress_allow
    content {
      protocol = allow.value.protocol
      ports    = length(allow.value.ports) > 0 ? allow.value.ports : null
    }
  }
}
