# ─────────────────────────────────────────────
# RAÍZ DE DESPLIEGUE — des / devops (SSO C2.2)
#
# Aprovisiona las cuentas de servicio de mínimo privilegio (sa-sso-core,
# sa-sso-sync, sa-sso-sync-job, sa-sso-publicador), contenedores de secretos
# en Secret Manager, buckets operativos y el repositorio Artifact Registry
# (sso-containers).
# ─────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

module "devops" {
  source = "./plantillas/devops"

  project_id = var.project_id
  region     = var.region
  labels     = var.labels

  host_project_id  = var.host_project_id
  enable_host_iam  = var.enable_host_iam
  enable_local_vpc = var.enable_local_vpc
  local_vpc        = var.local_vpc

  service_accounts               = var.service_accounts
  secret_ids                     = var.secret_ids
  buckets                        = var.buckets
  artifact_registry_repositories = var.artifact_registry_repositories

  enable_gitlab_vm = false
}
