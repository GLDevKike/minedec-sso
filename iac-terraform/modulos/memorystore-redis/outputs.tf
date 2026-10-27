output "instance_id" {
  value       = google_redis_instance.this.id
  description = "ID de la instancia Redis"
}
output "host" {
  value       = google_redis_instance.this.host
  description = "IP de conexión a Redis"
}
output "port" {
  value       = google_redis_instance.this.port
  description = "Puerto de conexión (default: 6379)"
}
output "auth_string" {
  value       = google_redis_instance.this.auth_string
  description = "AUTH token (si auth_enabled = true)"
  sensitive   = true
}
output "redis_version" {
  value       = google_redis_instance.this.redis_version
  description = "Versión de Redis de la instancia"
}
