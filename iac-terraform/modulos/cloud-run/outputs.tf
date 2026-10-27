output "service_id" {
  value       = google_cloud_run_v2_service.this.id
  description = "ID del servicio Cloud Run"
}
output "service_name" {
  value       = google_cloud_run_v2_service.this.name
  description = "Nombre del servicio"
}
output "uri" {
  value       = google_cloud_run_v2_service.this.uri
  description = "URL del servicio (HTTPS)"
}
output "service_account" {
  value       = var.service_account
  description = "Service account del servicio"
}
