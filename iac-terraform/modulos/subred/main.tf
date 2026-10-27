resource "google_compute_subnetwork" "this" {
  name          = var.name
  project       = var.project_id
  region        = var.region
  network       = var.network
  ip_cidr_range = var.ip_cidr_range
  description   = var.description

  # Las subredes proxy-only (REGIONAL_MANAGED_PROXY) y las de Private Service Connect
  # no admiten acceso privado a Google ni rangos secundarios: solo alojan los proxies
  # gestionados de los balanceadores regionales.
  purpose = var.purpose
  role    = var.purpose == "REGIONAL_MANAGED_PROXY" ? var.role : null

  private_ip_google_access = var.purpose == null ? var.private_ip_google_access : null

  dynamic "secondary_ip_range" {
    for_each = var.purpose == null ? var.secondary_ip_ranges : []
    content {
      range_name    = secondary_ip_range.value.range_name
      ip_cidr_range = secondary_ip_range.value.ip_cidr_range
    }
  }

  dynamic "log_config" {
    for_each = var.enable_flow_logs ? [1] : []
    content {
      aggregation_interval = var.flow_logs_interval
      flow_sampling        = var.flow_logs_sampling
      metadata             = var.flow_logs_metadata
    }
  }
}
