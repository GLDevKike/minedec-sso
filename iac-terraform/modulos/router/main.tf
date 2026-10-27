resource "google_compute_router" "this" {
  name        = var.name
  project     = var.project_id
  region      = var.region
  network     = var.network
  description = var.description

  dynamic "bgp" {
    for_each = var.bgp != null ? [var.bgp] : []
    content {
      asn               = bgp.value.asn
      advertise_mode    = lookup(bgp.value, "advertise_mode", "DEFAULT")
      advertised_groups = lookup(bgp.value, "advertised_groups", null)

      dynamic "advertised_ip_ranges" {
        for_each = lookup(bgp.value, "advertised_ip_ranges", [])
        content {
          range       = advertised_ip_ranges.value.range
          description = lookup(advertised_ip_ranges.value, "description", null)
        }
      }
    }
  }
}
