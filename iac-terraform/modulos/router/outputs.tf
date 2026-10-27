output "router_id" {
  description = "ID del Cloud Router"
  value       = google_compute_router.this.id
}

output "router_name" {
  description = "Nombre del Cloud Router"
  value       = google_compute_router.this.name
}

output "self_link" {
  description = "Self-link del Cloud Router"
  value       = google_compute_router.this.self_link
}
