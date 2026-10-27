output "instance_id" {
  value       = google_sql_database_instance.this.id
  description = "ID de la instancia Cloud SQL"
}
output "instance_name" {
  value       = google_sql_database_instance.this.name
  description = "Nombre de la instancia"
}
output "connection_name" {
  value       = google_sql_database_instance.this.connection_name
  description = "Nombre de conexión para Cloud SQL Proxy (project:region:instance)"
}
output "private_ip" {
  value       = google_sql_database_instance.this.private_ip_address
  description = "IP privada de la instancia"
}
output "public_ip" {
  value       = google_sql_database_instance.this.public_ip_address
  description = "IP pública (null si ipv4_enabled = false)"
}
output "database_names" {
  value       = [for k, v in google_sql_database.databases : v.name]
  description = "Nombres de las bases de datos creadas"
}
output "server_ca_cert" {
  value       = google_sql_database_instance.this.server_ca_cert
  description = "Certificado CA del servidor"
  sensitive   = true
}
