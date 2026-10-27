output "secret_resource_ids" {
  description = "Mapa de secret_id -> ID completo del recurso en Secret Manager."
  value       = { for k, s in google_secret_manager_secret.this : k => s.id }
}
