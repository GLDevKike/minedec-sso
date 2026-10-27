output "nat_id" {
  description = "ID del Cloud NAT"
  value       = google_compute_router_nat.this.id
}

output "nat_name" {
  description = "Nombre del Cloud NAT"
  value       = google_compute_router_nat.this.name
}
