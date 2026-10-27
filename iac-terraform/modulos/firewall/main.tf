resource "google_compute_firewall" "this" {
  for_each = var.rules

  name        = each.key
  project     = var.project_id
  network     = var.network
  description = each.value.description
  direction   = each.value.direction
  priority    = each.value.priority

  source_ranges      = each.value.direction == "INGRESS" && length(each.value.source_ranges) > 0 ? each.value.source_ranges : null
  destination_ranges = each.value.direction == "EGRESS" && length(each.value.destination_ranges) > 0 ? each.value.destination_ranges : null
  target_tags        = length(each.value.target_tags) > 0 ? each.value.target_tags : null
  source_tags        = each.value.direction == "INGRESS" && length(each.value.source_tags) > 0 ? each.value.source_tags : null

  dynamic "allow" {
    for_each = each.value.allow
    content {
      protocol = allow.value.protocol
      ports    = allow.value.ports
    }
  }

  dynamic "deny" {
    for_each = each.value.deny
    content {
      protocol = deny.value.protocol
      ports    = deny.value.ports
    }
  }
}
