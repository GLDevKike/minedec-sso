output "local_vpc_self_link" {
  description = "Self-link de la VPC local creada. Null si enable_local_vpc = false."
  value       = module.devops.local_vpc_self_link
}

output "local_subnet_self_link" {
  description = "Self-link de la subred primaria creada. Null si enable_local_vpc = false."
  value       = module.devops.local_subnet_self_link
}

output "local_psa_range_name" {
  description = "Nombre del rango reservado de Private Services Access (PSA). Null si enable_local_vpc = false."
  value       = module.devops.local_psa_range_name
}

output "service_account_emails" {
  description = "Mapa account_id → email de las cuentas de servicio de SSO creadas."
  value       = module.devops.service_account_emails
}

output "secret_resource_ids" {
  description = "Mapa secret_id → ID completo del recurso en Secret Manager."
  value       = module.devops.secret_resource_ids
}

output "bucket_names" {
  description = "Mapa identificador lógico → nombre del bucket creado."
  value       = module.devops.bucket_names
}

output "bucket_urls" {
  description = "Mapa identificador lógico → URL gs:// del bucket."
  value       = module.devops.bucket_urls
}

output "artifact_registry_urls" {
  description = "Mapa repository_id → URL del repositorio."
  value       = module.devops.artifact_registry_urls
}
