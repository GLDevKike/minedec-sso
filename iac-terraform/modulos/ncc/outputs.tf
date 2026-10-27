output "hub_id" {
  description = "ID del hub NCC"
  value       = google_network_connectivity_hub.this.id
}

output "hub_name" {
  description = "Nombre del hub NCC"
  value       = google_network_connectivity_hub.this.name
}

output "state" {
  description = "Estado actual del hub"
  value       = google_network_connectivity_hub.this.state
}
