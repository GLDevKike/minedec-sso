resource "google_network_connectivity_hub" "this" {
  name            = var.name
  project         = var.project_id
  description     = var.description
  preset_topology = var.preset_topology

  labels = var.labels
}
