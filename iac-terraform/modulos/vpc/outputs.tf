output "network_id" {
  description = "ID de la VPC"
  value       = google_compute_network.this.id
}

output "network_name" {
  description = "Nombre de la VPC"
  value       = google_compute_network.this.name
}

output "self_link" {
  description = "Self-link de la VPC"
  value       = google_compute_network.this.self_link
}
