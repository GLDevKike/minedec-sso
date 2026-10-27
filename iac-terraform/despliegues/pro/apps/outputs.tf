output "project_number" {
  description = "NÃºmero del proyecto de servicio SSO."
  value       = module.apps.project_number
}

output "service_agents" {
  description = "Service agents del proyecto que requieren IAM en el proyecto host de Shared VPC."
  value       = module.apps.service_agents
}

output "cluster_name" {
  description = "Nombre del clÃºster GKE. Null si enable_gke = false."
  value       = module.apps.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint del control plane del clÃºster. Null si enable_gke = false."
  value       = module.apps.cluster_endpoint
  sensitive   = true
}

output "workload_identity_pool" {
  description = "Workload Identity Pool del clÃºster (<project_id>.svc.id.goog)."
  value       = module.apps.workload_identity_pool
}

output "cloud_run_uris" {
  description = "Mapa nombre de servicio â†’ URL de cada Cloud Run Service."
  value       = module.apps.cloud_run_uris
}

output "cloud_run_job_names" {
  description = "Mapa identificador â†’ nombre de cada Cloud Run Job."
  value       = module.apps.cloud_run_job_names
}
