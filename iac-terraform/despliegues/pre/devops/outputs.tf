output "service_account_emails" {
  description = "Mapa account_id â†’ email de las cuentas de servicio de SSO creadas."
  value       = module.devops.service_account_emails
}

output "secret_resource_ids" {
  description = "Mapa secret_id â†’ ID completo del recurso en Secret Manager."
  value       = module.devops.secret_resource_ids
}

output "bucket_names" {
  description = "Mapa identificador lÃ³gico â†’ nombre del bucket creado."
  value       = module.devops.bucket_names
}

output "bucket_urls" {
  description = "Mapa identificador lÃ³gico â†’ URL gs:// del bucket."
  value       = module.devops.bucket_urls
}

output "artifact_registry_urls" {
  description = "Mapa repository_id â†’ URL del repositorio."
  value       = module.devops.artifact_registry_urls
}
