output "project_number" {
  description = "Número del proyecto de servicio SSO."
  value       = module.apps.project_number
}

output "service_agents" {
  description = "Service agents del proyecto que requieren IAM en el proyecto host de Shared VPC."
  value       = module.apps.service_agents
}

output "cluster_name" {
  description = "Nombre del clúster GKE. Null si enable_gke = false."
  value       = module.apps.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint del control plane del clúster. Null si enable_gke = false."
  value       = module.apps.cluster_endpoint
  sensitive   = true
}

output "workload_identity_pool" {
  description = "Workload Identity Pool del clúster (<project_id>.svc.id.goog)."
  value       = module.apps.workload_identity_pool
}

output "cloud_run_uris" {
  description = "Mapa nombre de servicio → URL de cada Cloud Run Service."
  value       = module.apps.cloud_run_uris
}

output "cloud_run_job_names" {
  description = "Mapa identificador → nombre de cada Cloud Run Job."
  value       = module.apps.cloud_run_job_names
}
