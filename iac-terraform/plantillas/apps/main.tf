# ─────────────────────────────────────────────
# APIs
# ─────────────────────────────────────────────

locals {
  apis_to_enable = distinct(concat(
    var.apis_to_enable,
    var.enable_apigee ? ["apigee.googleapis.com", "servicenetworking.googleapis.com"] : [],
  ))
}

module "apis" {
  source = "../../modulos/apis"

  project_id = var.project_id
  apis       = local.apis_to_enable
}

data "google_project" "service" {
  project_id = var.project_id
  depends_on = [module.apis]
}

# ─────────────────────────────────────────────
# IAM EN EL PROYECTO HOST (SHARED VPC)
# ─────────────────────────────────────────────

locals {
  project_number = data.google_project.service.number

  gke_robot_sa       = "serviceAccount:service-${local.project_number}@container-engine-robot.iam.gserviceaccount.com"
  google_apis_sa     = "serviceAccount:${local.project_number}@cloudservices.gserviceaccount.com"
  compute_default_sa = "serviceAccount:${local.project_number}-compute@developer.gserviceaccount.com"
  cloud_run_agent_sa = "serviceAccount:service-${local.project_number}@serverless-robot-prod.iam.gserviceaccount.com"
  apigee_sa          = "serviceAccount:service-${local.project_number}@gcp-sa-apigee.iam.gserviceaccount.com"

  node_pool_sa_members = var.enable_gke ? distinct([
    for _, np in var.cluster.node_pools :
    np.service_account != null ? "serviceAccount:${np.service_account}" : local.compute_default_sa
  ]) : []

  cloud_run_sa_members = distinct(compact([
    for _, svc in var.cloud_run_services :
    svc.service_account != null ? "serviceAccount:${svc.service_account}" : null
  ]))

  cloud_run_job_sa_members = distinct(compact([
    for _, job in var.cloud_run_jobs :
    job.service_account != null ? "serviceAccount:${job.service_account}" : null
  ]))

  gke_subnet_members = var.enable_host_iam && var.enable_gke ? {
    for m in distinct(concat([local.gke_robot_sa, local.google_apis_sa], local.node_pool_sa_members)) :
    "gke--${m}" => {
      subnetwork = var.cluster.node_subnet_self_link
      member     = m
    }
  } : {}

  cloud_run_subnet_members = var.enable_host_iam && var.cloud_run_subnet_self_link != null ? {
    for m in distinct(concat([local.cloud_run_agent_sa], local.cloud_run_sa_members, local.cloud_run_job_sa_members)) :
    "cloudrun--${m}" => {
      subnetwork = var.cloud_run_subnet_self_link
      member     = m
    }
  } : {}

  subnet_iam_bindings = merge(local.gke_subnet_members, local.cloud_run_subnet_members)

  ar_auto_readers = distinct(concat(local.node_pool_sa_members, local.cloud_run_sa_members, local.cloud_run_job_sa_members))

  ar_repositories = {
    for k, v in var.artifact_registry_repositories : k => merge(v, {
      labels  = merge(var.labels, v.labels)
      readers = distinct(concat(v.readers, local.ar_auto_readers))
    })
  }
}

resource "google_project_iam_member" "gke_host_service_agent" {
  count = var.enable_host_iam && var.enable_gke ? 1 : 0

  project = var.host_project_id
  role    = "roles/container.hostServiceAgentUser"
  member  = local.gke_robot_sa
}

resource "google_compute_subnetwork_iam_member" "network_user" {
  for_each = local.subnet_iam_bindings

  project    = var.host_project_id
  region     = var.region
  subnetwork = each.value.subnetwork
  role       = "roles/compute.networkUser"
  member     = each.value.member
}

resource "google_project_iam_member" "apigee_network_user" {
  count = var.enable_apigee && var.enable_apigee_host_iam ? 1 : 0

  project = var.host_project_id
  role    = "roles/compute.networkUser"
  member  = local.apigee_sa
}

# ─────────────────────────────────────────────
# GKE
# ─────────────────────────────────────────────

module "gke" {
  source = "../../modulos/gke"
  count  = var.enable_gke ? 1 : 0

  name                       = var.cluster.name
  project_id                 = var.project_id
  region                     = var.region
  network                    = var.host_vpc_self_link
  subnetwork                 = var.cluster.node_subnet_self_link
  pods_range_name            = var.cluster.pods_range_name
  services_range_name        = var.cluster.services_range_name
  master_ipv4_cidr_block     = var.cluster.master_ipv4_cidr_block
  enable_private_nodes       = var.cluster.enable_private_nodes
  enable_private_endpoint    = var.cluster.enable_private_endpoint
  master_authorized_networks = var.cluster.master_authorized_networks
  release_channel            = var.cluster.release_channel
  deletion_protection        = var.cluster.deletion_protection
  enable_managed_prometheus  = var.cluster.enable_managed_prometheus
  maintenance_start_time     = var.cluster.maintenance_start_time
  maintenance_end_time       = var.cluster.maintenance_end_time
  maintenance_recurrence     = var.cluster.maintenance_recurrence
  labels                     = merge(var.labels, var.cluster.labels)
  node_pools                 = var.cluster.node_pools

  depends_on = [
    module.apis,
    google_project_iam_member.gke_host_service_agent,
    google_compute_subnetwork_iam_member.network_user,
  ]
}

# ─────────────────────────────────────────────
# ARTIFACT REGISTRY
# ─────────────────────────────────────────────

module "artifact_registry" {
  source = "../../modulos/artifact-registry"

  project_id   = var.project_id
  region       = var.region
  repositories = local.ar_repositories

  depends_on = [module.apis]
}

# ─────────────────────────────────────────────
# CLOUD RUN SERVICES
# ─────────────────────────────────────────────

module "cloud_run" {
  source   = "../../modulos/cloud-run"
  for_each = var.cloud_run_services

  name                = each.key
  project_id          = var.project_id
  region              = var.region
  image               = each.value.image
  ingress             = each.value.ingress
  service_account     = each.value.service_account
  min_instances       = each.value.min_instances
  max_instances       = each.value.max_instances
  cpu                 = each.value.cpu
  memory              = each.value.memory
  cpu_idle            = each.value.cpu_idle
  container_port      = each.value.container_port
  timeout_seconds     = each.value.timeout_seconds
  env_vars            = each.value.env_vars
  env_secrets         = each.value.env_secrets
  invokers            = each.value.invokers
  vpc_network         = var.cloud_run_subnet_self_link != null ? var.host_vpc_self_link : null
  vpc_subnetwork      = var.cloud_run_subnet_self_link
  vpc_egress          = each.value.vpc_egress
  vpc_network_tags    = each.value.vpc_network_tags
  deletion_protection = each.value.deletion_protection
  labels              = merge(var.labels, each.value.labels)

  depends_on = [
    module.apis,
    google_compute_subnetwork_iam_member.network_user,
  ]
}

# ─────────────────────────────────────────────
# CLOUD RUN JOBS
# ─────────────────────────────────────────────

module "cloud_run_jobs" {
  source   = "../../modulos/cloud-run-job"
  for_each = var.cloud_run_jobs

  name                = each.key
  project_id          = var.project_id
  region              = var.region
  image               = each.value.image
  service_account     = each.value.service_account
  cpu                 = each.value.cpu
  memory              = each.value.memory
  max_retries         = each.value.max_retries
  timeout_seconds     = each.value.timeout_seconds
  parallelism         = each.value.parallelism
  task_count          = each.value.task_count
  env_vars            = each.value.env_vars
  env_secrets         = each.value.env_secrets
  invokers            = each.value.invokers
  vpc_network         = var.cloud_run_subnet_self_link != null ? var.host_vpc_self_link : null
  vpc_subnetwork      = var.cloud_run_subnet_self_link
  vpc_egress          = each.value.vpc_egress
  vpc_network_tags    = each.value.vpc_network_tags
  deletion_protection = each.value.deletion_protection
  labels              = merge(var.labels, each.value.labels)

  depends_on = [
    module.apis,
    google_compute_subnetwork_iam_member.network_user,
  ]
}

# ─────────────────────────────────────────────
# APIGEE
# ─────────────────────────────────────────────

module "apigee" {
  source = "../../modulos/apigee"
  count  = var.enable_apigee ? 1 : 0

  project_id       = var.project_id
  nombre           = var.apigee.name
  analytics_region = coalesce(var.apigee.analytics_region, var.region)
  runtime_type     = var.apigee.runtime_type
  billing_type     = var.apigee.billing_type
  description      = var.apigee.description
  network          = var.host_vpc_self_link
  cmek_key_name    = var.apigee.cmek_key_name
  instances        = var.apigee.instances
  environments     = var.apigee.environments
  envgroups        = var.apigee.envgroups

  depends_on = [
    module.apis,
    google_project_iam_member.apigee_network_user,
  ]
}

# ─────────────────────────────────────────────
# CLOUD ARMOR WAF (SSO OIDC)
# ─────────────────────────────────────────────

resource "google_compute_security_policy" "sso_oidc_waf" {
  count = var.enable_cloud_armor_waf ? 1 : 0

  name        = var.waf_policy_name
  project     = var.project_id
  description = "Política WAF Cloud Armor OWASP Top 10 y Rate Limiting para sso-oidc"

  rule {
    action   = "deny(403)"
    priority = 1000
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable')"
      }
    }
    description = "Bloqueo de inyección SQL (OWASP sqli-v33-stable)"
  }

  rule {
    action   = "deny(403)"
    priority = 1010
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable')"
      }
    }
    description = "Bloqueo de Cross-Site Scripting (OWASP xss-v33-stable)"
  }

  rule {
    action   = "deny(403)"
    priority = 1020
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('protocolattack-v33-stable')"
      }
    }
    description = "Bloqueo de ataques de protocolo HTTP (OWASP protocolattack-v33-stable)"
  }

  rule {
    action   = "deny(403)"
    priority = 1030
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sessionfixation-v33-stable')"
      }
    }
    description = "Bloqueo de fijación de sesión (OWASP sessionfixation-v33-stable)"
  }

  rule {
    action   = "rate_based_ban"
    priority = 2000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
    description = "Límite de tasa por IP para mitigar fuerza bruta sobre /authorize y /token"
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Regla por defecto (permitir tráfico legítimo)"
  }

  depends_on = [module.apis]
}
