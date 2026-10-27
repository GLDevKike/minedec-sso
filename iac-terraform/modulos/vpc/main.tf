resource "google_compute_network" "this" {
  name                    = var.name
  project                 = var.project_id
  description             = var.description
  auto_create_subnetworks = false
  routing_mode            = var.routing_mode
  mtu                     = var.mtu
}
