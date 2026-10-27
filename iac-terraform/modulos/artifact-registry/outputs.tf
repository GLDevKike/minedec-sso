output "repository_ids" {
  value       = { for k, v in google_artifact_registry_repository.this : k => v.id }
  description = "Mapa de repository_id a ID completo del recurso"
}
output "repository_urls" {
  value       = { for k, v in google_artifact_registry_repository.this : k => "${var.region}-docker.pkg.dev/${var.project_id}/${k}" }
  description = "URLs de los repositorios"
}
output "repository_names" {
  value       = { for k, v in google_artifact_registry_repository.this : k => v.name }
  description = "Nombres completos de los repositorios"
}
