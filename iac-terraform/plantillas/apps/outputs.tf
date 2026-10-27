# ─────────────────────────────────────────────
# PROYECTO
# ─────────────────────────────────────────────

output "project_number" {
  description = "Número del proyecto de servicio."
  value       = data.google_project.service.number
}

output "service_agents" {
  description = "Emails de los service agents gestionados por Google que requieren IAM en el proyecto host."
  value = {
    gke_robot       = local.gke_robot_sa
    google_apis     = local.google_apis_sa
    compute_default = local.compute_default_sa
    cloud_run_agent = local.cloud_run_agent_sa
    apigee          = local.apigee_sa
  }
}

output "shared_subnet_iam_members" {
  description = "Bindings de compute.networkUser creados sobre las subredes del host."
  value       = keys(google_compute_subnetwork_iam_member.network_user)
}

# ─────────────────────────────────────────────
# GKE
# ─────────────────────────────────────────────

output "cluster_id" {
  description = "ID del clúster GKE. Null si enable_gke = false."
  value       = var.enable_gke ? module.gke[0].cluster_id : null
}

output "cluster_name" {
  description = "Nombre del clúster GKE. Null si enable_gke = false."
  value       = var.enable_gke ? module.gke[0].cluster_name : null
}

output "cluster_endpoint" {
  description = "Endpoint del control plane. Null si enable_gke = false."
  value       = var.enable_gke ? module.gke[0].endpoint : null
  sensitive   = true
}

output "workload_identity_pool" {
  description = "Workload Identity Pool del clúster (<project_id>.svc.id.goog). Null si enable_gke = false."
  value       = var.enable_gke ? module.gke[0].workload_pool : null
}

output "node_pool_ids" {
  description = "Mapa nombre de node pool → ID. Vacío si enable_gke = false."
  value       = var.enable_gke ? module.gke[0].node_pool_ids : {}
}

# ─────────────────────────────────────────────
# ARTIFACT REGISTRY
# ─────────────────────────────────────────────

output "artifact_registry_urls" {
  description = "Mapa repository_id → URL del repositorio."
  value       = module.artifact_registry.repository_urls
}

# ─────────────────────────────────────────────
# CLOUD RUN SERVICES & JOBS
# ─────────────────────────────────────────────

output "cloud_run_uris" {
  description = "Mapa nombre de servicio → URL (*.run.app) de cada Cloud Run Service."
  value       = { for k, v in module.cloud_run : k => v.uri }
}

output "cloud_run_job_names" {
  description = "Mapa identificador → nombre de cada Cloud Run Job."
  value       = { for k, v in module.cloud_run_jobs : k => v.job_name }
}

# ─────────────────────────────────────────────
# APIGEE
# ─────────────────────────────────────────────

output "apigee_org_id" {
  description = "ID de la organización Apigee. Null si enable_apigee = false."
  value       = var.enable_apigee ? module.apigee[0].org_id : null
}

output "apigee_instance_hosts" {
  description = "Mapa nombre de instancia Apigee → IP interna del endpoint."
  value       = var.enable_apigee ? module.apigee[0].instance_hosts : {}
}

output "apigee_psc_service_attachments" {
  description = "Mapa nombre de instancia → URI del PSC service attachment."
  value       = var.enable_apigee ? module.apigee[0].psc_service_attachments : {}
}
