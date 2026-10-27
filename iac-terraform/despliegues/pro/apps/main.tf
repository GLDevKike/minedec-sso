# ─────────────────────────────────────────────
# RAÍZ DE DESPLIEGUE — pro / apps (SSO C2.2)
#
# Aprovisiona la capa de cómputo del Subcomponente C2.2 SSO sobre la Shared VPC:
# - Clúster GKE privado para sso-oidc, motor-pdp, pip-identity-service, api-pap y frontend
# - Cloud Run Service (sso-sincronizador) con Direct VPC Egress
# - Cloud Run Jobs (sso-conciliacion-job, sso-publicador-job) con Direct VPC Egress
# - Política Cloud Armor WAF (sso-oidc-waf-policy)
# ─────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  host_vpc_self_link = "projects/${var.host_project_id}/global/networks/${var.host_network_name}"

  subnet_self_links = {
    for k, name in var.host_subnet_names :
    k => "projects/${var.host_project_id}/regions/${var.region}/subnetworks/${name}"
  }
}

module "apps" {
  source = "./plantillas/apps"

  project_id = var.project_id
  region     = var.region
  labels     = var.labels

  host_project_id            = var.host_project_id
  host_vpc_self_link         = local.host_vpc_self_link
  cloud_run_subnet_self_link = local.subnet_self_links.apps
  enable_host_iam            = var.enable_host_iam

  enable_gke = var.enable_gke
  cluster = {
    name                  = var.cluster_name
    node_subnet_self_link = local.subnet_self_links.gke
    pods_range_name       = var.gke_secondary_range_names.pods
    services_range_name   = var.gke_secondary_range_names.services

    master_ipv4_cidr_block     = var.gke_master_ipv4_cidr_block
    enable_private_nodes       = true
    enable_private_endpoint    = false
    master_authorized_networks = var.gke_master_authorized_networks

    release_channel     = "REGULAR"
    deletion_protection = false

    node_pools = var.gke_node_pools
  }

  cloud_run_services = var.cloud_run_services
  cloud_run_jobs     = var.cloud_run_jobs

  enable_cloud_armor_waf = var.enable_cloud_armor_waf
  waf_policy_name        = var.waf_policy_name

  enable_apigee          = var.enable_apigee
  enable_apigee_host_iam = var.enable_apigee_host_iam
  apigee = {
    name             = var.apigee_name
    analytics_region = var.region
    billing_type     = var.apigee_billing_type
    description      = "Apigee X del segmento ${var.project_id}"

    instances = {
      "${var.apigee_name}-instance" = {
        location     = var.region
        ip_range     = var.apigee_ip_range
        environments = [var.apigee_environment_name]
        description  = "Instancia de runtime de Apigee en ${var.region}"
      }
    }

    environments = {
      (var.apigee_environment_name) = {
        description = "Ambiente ${var.apigee_environment_name}"
        type        = var.apigee_billing_type == "EVALUATION" ? null : "BASE"
      }
    }

    envgroups = {
      "${var.apigee_name}-envgroup" = {
        hostnames    = var.apigee_hostnames
        environments = [var.apigee_environment_name]
      }
    }
  }
}
