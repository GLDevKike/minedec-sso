locals {
  # Pares instancia-ambiente para los attachments de instancia
  instance_env_attachments = flatten([
    for inst_key, inst_val in var.instances : [
      for env in inst_val.environments : {
        instance_key = inst_key
        env          = env
      }
    ]
  ])

  # Pares envgroup-ambiente para los attachments de environment group
  envgroup_env_attachments = flatten([
    for group_key, group_val in var.envgroups : [
      for env in group_val.environments : {
        group_key = group_key
        env       = env
      }
    ]
  ])
}

# ─── Service Networking (VPC Peering para Apigee) ────────────────────────────
# Apigee requiere un rango IP reservado en la VPC para el peering interno.

resource "google_compute_global_address" "apigee_range" {
  count = var.create_service_networking ? 1 : 0

  name          = "${var.nombre}-apigee-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = var.peering_prefix_length
  network       = var.network
}

resource "google_service_networking_connection" "apigee_vpc_connection" {
  count = var.create_service_networking ? 1 : 0

  network                 = var.network
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.apigee_range[0].name]
}

# Habilita la exportación de rutas del peering (necesario para que Apigee
# pueda alcanzar recursos en la VPC y viceversa)
resource "google_compute_network_peering_routes_config" "apigee_peering_routes" {
  count = var.create_service_networking ? 1 : 0

  project = var.project_id
  peering = google_service_networking_connection.apigee_vpc_connection[0].peering
  network = split("/", var.network)[length(split("/", var.network)) - 1]

  import_custom_routes = true
  export_custom_routes = true
}

# ─── Organización Apigee ──────────────────────────────────────────────────────
# Una organización por proyecto GCP. La creación tarda ~20-30 minutos.

resource "google_apigee_organization" "this" {
  project_id                           = var.project_id
  analytics_region                     = var.analytics_region
  authorized_network                   = var.network
  runtime_type                         = var.runtime_type
  billing_type                         = var.billing_type
  runtime_database_encryption_key_name = var.cmek_key_name
  description                          = var.description

  depends_on = [
    google_service_networking_connection.apigee_vpc_connection,
  ]
}

# ─── Instancias de runtime ────────────────────────────────────────────────────
# Una instancia por región. Cada instancia tarda ~20-30 minutos en aprovisionarse.

resource "google_apigee_instance" "instances" {
  for_each = var.instances

  name        = each.key
  location    = each.value.location
  org_id      = google_apigee_organization.this.id
  description = each.value.description

  ip_range                 = each.value.ip_range
  peering_cidr_range       = each.value.peering_cidr_range
  disk_encryption_key_name = each.value.disk_encryption_key_name
}

# ─── Ambientes (Environments) ─────────────────────────────────────────────────

resource "google_apigee_environment" "environments" {
  for_each = var.environments

  name        = each.key
  org_id      = google_apigee_organization.this.id
  description = each.value.description
  type        = each.value.type

  dynamic "node_config" {
    for_each = each.value.min_node_count != null ? [1] : []
    content {
      min_node_count = each.value.min_node_count
      max_node_count = each.value.max_node_count
    }
  }
}

# ─── Attachments: ambiente ↔ instancia ───────────────────────────────────────

resource "google_apigee_instance_attachment" "attachments" {
  for_each = {
    for a in local.instance_env_attachments :
    "${a.instance_key}--${a.env}" => a
  }

  instance_id = google_apigee_instance.instances[each.value.instance_key].id
  environment = each.value.env

  depends_on = [google_apigee_environment.environments]
}

# ─── Environment Groups ───────────────────────────────────────────────────────
# Los Environment Groups definen los hostnames externos (FQDNs) desde los que
# los clientes consumen las APIs. El tráfico entrante se enruta al grupo y desde
# allí a los ambientes adjuntos.

resource "google_apigee_envgroup" "envgroups" {
  for_each = var.envgroups

  name      = each.key
  org_id    = google_apigee_organization.this.id
  hostnames = each.value.hostnames
}

# ─── Attachments: ambiente ↔ environment group ────────────────────────────────

resource "google_apigee_envgroup_attachment" "envgroup_attachments" {
  for_each = {
    for a in local.envgroup_env_attachments :
    "${a.group_key}--${a.env}" => a
  }

  envgroup_id = google_apigee_envgroup.envgroups[each.value.group_key].id
  environment = each.value.env

  depends_on = [google_apigee_environment.environments]
}

# ─── Endpoint Attachments (PSC) ───────────────────────────────────────────────
# Conecta Apigee a servicios backend en otras VPCs mediante Private Service Connect.
# Cada endpoint attachment genera una IP interna que puede usarse como target en proxies.

resource "google_apigee_endpoint_attachment" "endpoint_attachments" {
  for_each = var.endpoint_attachments

  org_id                 = google_apigee_organization.this.id
  endpoint_attachment_id = each.key
  location               = each.value.location
  service_attachment     = each.value.service_attachment
}

# ─── NAT Addresses ────────────────────────────────────────────────────────────
# IPs estáticas para el tráfico de salida de las instancias Apigee.
# Útil cuando los servicios backend requieren IPs fijas en sus listas de permitidos.
# Flujo: crear NAT address → activar en la instancia (activate = true).

resource "google_apigee_nat_address" "nat_addresses" {
  for_each = var.nat_addresses

  name        = each.key
  instance_id = google_apigee_instance.instances[each.value.instance_name].id
  activate    = true
}
