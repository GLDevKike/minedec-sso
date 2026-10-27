output "subnetwork_id" {
  description = "ID de la subred"
  value       = google_compute_subnetwork.this.id
}

output "subnetwork_name" {
  description = "Nombre de la subred"
  value       = google_compute_subnetwork.this.name
}

output "self_link" {
  description = "Self-link de la subred"
  value       = google_compute_subnetwork.this.self_link
}

output "ip_cidr_range" {
  description = "Rango CIDR principal de la subred"
  value       = google_compute_subnetwork.this.ip_cidr_range
}
