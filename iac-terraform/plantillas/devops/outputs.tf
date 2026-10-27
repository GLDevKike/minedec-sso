# ─────────────────────────────────────────────
# VPC LOCAL (OPCIONAL)
# ─────────────────────────────────────────────

output "local_vpc_self_link" {
  description = "Self-link de la VPC local creada. Null si enable_local_vpc = false."
  value       = var.enable_local_vpc ? module.local_vpc[0].self_link : null
}

output "local_subnet_self_link" {
  description = "Self-link de la subred primaria creada. Null si enable_local_vpc = false."
  value       = var.enable_local_vpc ? module.local_subnet[0].self_link : null
}

output "local_psa_range_name" {
  description = "Nombre del rango reservado de Private Services Access (PSA). Null si enable_local_vpc = false."
  value       = var.enable_local_vpc ? google_compute_global_address.local_psa[0].name : null
}

# ─────────────────────────────────────────────
# SERVICE ACCOUNTS (SSO C2.2)
# ─────────────────────────────────────────────

output "service_account_emails" {
  description = "Mapa account_id -> email de las cuentas de servicio de SSO creadas."
  value       = local.sso_sa_emails
}

# ─────────────────────────────────────────────
# SECRET MANAGER
# ─────────────────────────────────────────────

output "secret_resource_ids" {
  description = "Mapa secret_id -> ID completo del recurso en Secret Manager."
  value       = module.secret_manager.secret_resource_ids
}

# ─────────────────────────────────────────────
# BUCKETS
# ─────────────────────────────────────────────

output "bucket_names" {
  description = "Mapa identificador lógico → nombre del bucket creado."
  value       = { for k, v in module.buckets : k => v.bucket_name }
}

output "bucket_urls" {
  description = "Mapa identificador lógico → URL gs:// del bucket."
  value       = { for k, v in module.buckets : k => v.bucket_url }
}

# ─────────────────────────────────────────────
# ARTIFACT REGISTRY
# ─────────────────────────────────────────────

output "artifact_registry_urls" {
  description = "Mapa repository_id → URL del repositorio."
  value       = module.artifact_registry.repository_urls
}

# ─────────────────────────────────────────────
# GITLAB
# ─────────────────────────────────────────────

output "gitlab_instance_name" {
  description = "Nombre de la instancia de GitLab. Null si enable_gitlab_vm = false."
  value       = var.enable_gitlab_vm ? google_compute_instance.gitlab[0].name : null
}

output "gitlab_internal_ip" {
  description = "IP interna de la VM de GitLab. Null si enable_gitlab_vm = false."
  value       = var.enable_gitlab_vm ? google_compute_instance.gitlab[0].network_interface[0].network_ip : null
}

output "gitlab_service_account" {
  description = "Email de la service account de la VM de GitLab. Null si enable_gitlab_vm = false."
  value       = local.gitlab_sa_email
}
