# ─────────────────────────────────────────────
# APIs
# ─────────────────────────────────────────────

locals {
  apis_to_enable = distinct(concat(
    var.apis_to_enable,
    var.enable_local_vpc ? ["servicenetworking.googleapis.com"] : [],
  ))
}

module "apis" {
  source = "../../modulos/apis"

  project_id = var.project_id
  apis       = local.apis_to_enable
}

# ─────────────────────────────────────────────
# VPC LOCAL Y SEGMENTACIÓN OFICIAL (/20, /23, /24)
# ─────────────────────────────────────────────

module "local_vpc" {
  source = "../../modulos/vpc"
  count  = var.enable_local_vpc ? 1 : 0

  project_id   = var.project_id
  name         = var.local_vpc.network_name
  routing_mode = var.local_vpc.routing_mode
  description  = "VPC local para SSO C2.2 con los 3 segmentos oficiales (/24 subred primaria + /23 PSA en 2x/24 + /20 GKE en 2x/21)"

  depends_on = [module.apis]
}

module "local_subnet" {
  source = "../../modulos/subred"
  count  = var.enable_local_vpc ? 1 : 0

  project_id               = var.project_id
  region                   = var.region
  name                     = var.local_vpc.subnet_name
  network                  = module.local_vpc[0].network_id
  ip_cidr_range            = var.local_vpc.subnet_cidr
  private_ip_google_access = true
  description              = "Segmento /24 (${var.local_vpc.subnet_cidr}): Nodos GKE, ILBs y Cloud Run Direct VPC Egress"

  secondary_ip_ranges = [
    {
      range_name    = var.local_vpc.pods_range_name
      ip_cidr_range = var.local_vpc.pods_cidr
    },
    {
      range_name    = var.local_vpc.services_range_name
      ip_cidr_range = var.local_vpc.services_cidr
    },
  ]
}

resource "google_compute_global_address" "local_psa" {
  count = var.enable_local_vpc ? 1 : 0

  project       = var.project_id
  name          = var.local_vpc.psa_range_name
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.local_vpc.psa_address
  prefix_length = var.local_vpc.psa_prefix_length
  network       = module.local_vpc[0].network_id
  description   = "2da mitad del segmento /23 (${var.local_vpc.psa_address}/${var.local_vpc.psa_prefix_length}): Private Services Access (Memorystore Redis)"
}

resource "google_compute_global_address" "local_psa_sql" {
  count = var.enable_local_vpc ? 1 : 0

  project       = var.project_id
  name          = var.local_vpc.psa_sql_range_name
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.local_vpc.psa_sql_address
  prefix_length = var.local_vpc.psa_sql_prefix_length
  network       = module.local_vpc[0].network_id
  description   = "1ra mitad del segmento /23 (${var.local_vpc.psa_sql_address}/${var.local_vpc.psa_sql_prefix_length}): Private Services Access (Cloud SQL / AlloyDB for PostgreSQL 16)"

  depends_on = [module.local_subnet]
}

resource "google_service_networking_connection" "local_psa" {
  count = var.enable_local_vpc ? 1 : 0

  network = module.local_vpc[0].network_id
  service = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [
    google_compute_global_address.local_psa[0].name,
    google_compute_global_address.local_psa_sql[0].name,
  ]
  deletion_policy         = "ABANDON"
  update_on_creation_fail = true
}

module "local_router" {
  source = "../../modulos/router"
  count  = var.enable_local_vpc ? 1 : 0

  project_id  = var.project_id
  region      = var.region
  name        = var.local_vpc.router_name
  network     = module.local_vpc[0].network_id
  description = "Cloud Router para salida NAT de nodos privados GKE y Cloud Run"
}

module "local_nat" {
  source = "../../modulos/cloud-nat"
  count  = var.enable_local_vpc ? 1 : 0

  project_id                         = var.project_id
  region                             = var.region
  name                               = var.local_vpc.nat_name
  router                             = module.local_router[0].router_name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

data "google_project" "devops" {
  project_id = var.project_id
  depends_on = [module.apis]
}

locals {
  google_apis_sa = "serviceAccount:${data.google_project.devops.number}@cloudservices.gserviceaccount.com"

  gitlab_sa_email = var.enable_gitlab_vm ? google_service_account.gitlab[0].email : null

  sso_sa_emails = {
    for k, sa in google_service_account.sso : k => sa.email
  }

  sso_sa_members = [
    for k, sa in google_service_account.sso : "serviceAccount:${sa.email}"
  ]

  # Bindings de Workload Identity: par (account_id, namespace/ksa_name)
  workload_identity_bindings = merge([
    for sa_key, sa_cfg in var.service_accounts : {
      for ksa in sa_cfg.workload_identity_ksas :
      "${sa_key}--${replace(ksa, "/", "-")}" => {
        sa_key = sa_key
        ksa    = ksa
      }
    }
  ]...)

  ar_repositories = {
    for k, v in var.artifact_registry_repositories : k => merge(v, {
      labels  = merge(var.labels, v.labels)
      readers = distinct(concat(v.readers, local.sso_sa_members))
      writers = distinct(concat(
        v.writers,
        local.gitlab_sa_email != null ? ["serviceAccount:${local.gitlab_sa_email}"] : [],
      ))
    })
  }
}

# ─────────────────────────────────────────────
# SERVICE ACCOUNTS DE MÍNIMO PRIVILEGIO (SSO C2.2)
# ─────────────────────────────────────────────

resource "google_service_account" "sso" {
  for_each = var.service_accounts

  project      = var.project_id
  account_id   = each.key
  display_name = each.value.display_name
  description  = each.value.description

  depends_on = [module.apis]
}

module "sso_sa_iam" {
  source   = "../../modulos/iam"
  for_each = var.service_accounts

  recurso_id   = var.project_id
  tipo_recurso = "proyecto"
  tipo_cuenta  = "serviceAccount"
  email        = google_service_account.sso[each.key].email
  roles        = each.value.roles
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each = local.workload_identity_bindings

  service_account_id = google_service_account.sso[each.value.sa_key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${each.value.ksa}]"
}

# ─────────────────────────────────────────────
# SECRET MANAGER (ROTACIÓN <= 90 DÍAS)
# ─────────────────────────────────────────────

module "secret_manager" {
  source = "../../modulos/secret-manager"

  project_id       = var.project_id
  secret_ids       = var.secret_ids
  accessor_members = local.sso_sa_members
  labels           = var.labels

  depends_on = [module.apis]
}

# ─────────────────────────────────────────────
# BUCKETS (ARTEFACTOS DE INFRA MANAGER, BLUEPRINTS, ETC.)
# ─────────────────────────────────────────────

module "buckets" {
  source   = "../../modulos/cloud-storage"
  for_each = var.buckets

  project_id         = var.project_id
  name               = each.value.name
  location           = coalesce(each.value.location, var.region)
  storage_class      = each.value.storage_class
  versioning_enabled = each.value.versioning_enabled
  force_destroy      = each.value.force_destroy
  lifecycle_rules    = each.value.lifecycle_rules
  labels             = merge(var.labels, each.value.labels)

  depends_on = [module.apis]
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
# SERVICE ACCOUNT DE LA VM DE GITLAB (OPCIONAL)
# ─────────────────────────────────────────────

resource "google_service_account" "gitlab" {
  count = var.enable_gitlab_vm ? 1 : 0

  project      = var.project_id
  account_id   = var.gitlab_vm.service_account_id
  display_name = "Service Account GitLab (${var.gitlab_vm.name})"

  depends_on = [module.apis]
}

module "gitlab_sa_iam" {
  source = "../../modulos/iam"
  count  = var.enable_gitlab_vm ? 1 : 0

  recurso_id   = var.project_id
  tipo_recurso = "proyecto"
  tipo_cuenta  = "serviceAccount"
  email        = local.gitlab_sa_email
  roles        = var.gitlab_vm.service_account_roles
}

resource "google_compute_subnetwork_iam_member" "gitlab_host_subnet" {
  count = var.enable_gitlab_vm && var.enable_host_iam ? 1 : 0

  project    = var.host_project_id
  region     = var.region
  subnetwork = var.gitlab_vm.subnet_self_link
  role       = "roles/compute.networkUser"
  member     = local.google_apis_sa
}

resource "google_compute_disk" "gitlab_data" {
  count = var.enable_gitlab_vm && try(var.gitlab_vm.data_disk_size_gb, 0) > 0 ? 1 : 0

  name    = "${var.gitlab_vm.name}-data"
  project = var.project_id
  zone    = var.gitlab_vm.zone
  type    = var.gitlab_vm.data_disk_type
  size    = var.gitlab_vm.data_disk_size_gb
  labels  = merge(var.labels, var.gitlab_vm.labels)

  depends_on = [module.apis]
}

resource "google_compute_instance" "gitlab" {
  count = var.enable_gitlab_vm ? 1 : 0

  name                = var.gitlab_vm.name
  project             = var.project_id
  zone                = var.gitlab_vm.zone
  machine_type        = var.gitlab_vm.machine_type
  tags                = var.gitlab_vm.network_tags
  metadata            = var.gitlab_vm.metadata
  labels              = merge(var.labels, var.gitlab_vm.labels)
  deletion_protection = var.gitlab_vm.deletion_protection

  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = var.gitlab_vm.boot_image
      size  = var.gitlab_vm.boot_disk_size_gb
      type  = var.gitlab_vm.boot_disk_type
    }
  }

  dynamic "attached_disk" {
    for_each = var.gitlab_vm.data_disk_size_gb > 0 ? [1] : []
    content {
      source      = google_compute_disk.gitlab_data[0].id
      device_name = "gitlab-data"
    }
  }

  network_interface {
    subnetwork = var.gitlab_vm.subnet_self_link
  }

  service_account {
    email  = local.gitlab_sa_email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  depends_on = [google_compute_subnetwork_iam_member.gitlab_host_subnet]
}
