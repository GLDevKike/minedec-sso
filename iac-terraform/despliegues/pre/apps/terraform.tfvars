# ─────────────────────────────────────────────
# Valores del stack apps — pre SSO C2.2 (us-east1)
# ─────────────────────────────────────────────

project_id = "mec-003-sso-pre"
region     = "us-east1"

labels = {
  proyecto       = "minedec-sso"
  subcomponente  = "c2-2"
  ambiente       = "pre"
  gestionado_por = "terraform"
}

# ─── Red compartida (proyecto host) ──────────────────────────────────────────
host_project_id   = "mec-003-sha-net-pre"
host_network_name = "vpc-mec-sha-pre"
enable_host_iam   = false

host_subnet_names = {
  gke  = "snet-sso-ue1"
  apps = "snet-sso-ue1"
}

# ─── GKE (sso-oidc, motor-pdp, pip-identity-service, api-pap, frontend) ──────
# Se activa en true una vez la subred snet-sso-ue1 de mec-003-sha-net-pre
# esté compartida con los service agents del proyecto mec-003-sso-pre.
enable_gke   = false
cluster_name = "sso-gke-pre-ue1"

gke_secondary_range_names = {
  pods     = "pods"
  services = "services"
}

# gke_master_ipv4_cidr_block = "10.1.12.0/28"
gke_master_ipv4_cidr_block = null

gke_master_authorized_networks = [
  { cidr_block = "10.0.0.0/8", display_name = "Red interna MINEDEC" },
]

gke_node_pools = {
  "pool-sso-core" = {
    machine_type       = "e2-standard-2"
    disk_size_gb       = 50
    disk_type          = "pd-balanced"
    initial_node_count = 1
    min_node_count     = 1
    max_node_count     = 3
    spot               = false
    tags               = ["sso-gke-pre"]
  }
}

# ─── Cloud Run Services (sso-sincronizador) ──────────────────────────────────
# Se poblará cuando la imagen de sso-sincronizador esté publicada en
# us-east1-docker.pkg.dev/mec-003-sso-pre/sso-containers/sso-sincronizador
cloud_run_services = {}

# ─── Cloud Run Jobs (sso-conciliacion-job, sso-publicador-job) ───────────────
cloud_run_jobs = {}

# ─── Cloud Armor WAF (sso-oidc-waf-policy) ───────────────────────────────────
enable_cloud_armor_waf = true
waf_policy_name        = "sso-oidc-waf-policy"

# ─── Apigee ──────────────────────────────────────────────────────────────────
enable_apigee = false
