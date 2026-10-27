output "cluster_name" {
  description = "Nombre completo del recurso del clúster AlloyDB."
  value       = google_alloydb_cluster.this.name
}

output "primary_instance_ip" {
  description = "IP privada de la instancia primaria de AlloyDB."
  value       = google_alloydb_instance.primary.ip_address
}

output "read_pool_instance_ip" {
  description = "IP privada de la instancia Read Pool de AlloyDB (null si está deshabilitada)."
  value       = var.enable_read_pool ? google_alloydb_instance.read_pool[0].ip_address : null
}
