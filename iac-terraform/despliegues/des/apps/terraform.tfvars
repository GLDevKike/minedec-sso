# ─────────────────────────────────────────────
# Valores del stack apps — des SSO C2.2 (us-east1)
# ─────────────────────────────────────────────

project_id = "mec-003-sso-des"
region     = "us-east1"

labels = {
  proyecto       = "minedec-sso"
  subcomponente  = "c2-2"
  ambiente       = "des"
  gestionado_por = "terraform"
}

# ─── Red (VPC local en mec-003-sso-des / Shared VPC comentada temporalmente) ─
# host_project_id = "mec-003-sha-net-des"
host_project_id   = "mec-003-sso-des"
host_network_name = "vpc-mec-sha-des"
enable_host_iam   = false

# Subred primaria única snet-sso-ue1 (10.10.0.0/24, 1ra mitad del segmento /23)
# compartida por los nodos GKE y Cloud Run Direct VPC Egress.
host_subnet_names = {
  gke  = "snet-sso-ue1"
  apps = "snet-sso-ue1"
}

# ─── GKE (sso-oidc, motor-pdp, pip-identity-service, api-pap, frontend) ──────
enable_gke   = true
cluster_name = "sso-gke-des-ue1"

gke_secondary_range_names = {
  pods     = "pods"
  services = "services"
}

# GKE 1.29+ usa Private Service Connect (PSC) para el control plane cuando es null,
# evitando consumir un segmento /28 adicional fuera de las 3 máscaras oficiales (/20, /23, /24).
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
    tags               = ["sso-gke-des"]
  }
}

# ─── Cloud Run Services (sso-sincronizador) ──────────────────────────────────
# Se poblará cuando la imagen de sso-sincronizador esté publicada en
# us-east1-docker.pkg.dev/mec-003-sso-des/sso-containers/sso-sincronizador
cloud_run_services = {}

# ─── Cloud Run Jobs (sso-conciliacion-job, sso-publicador-job) ───────────────
cloud_run_jobs = {}

# ─── Cloud Armor WAF (sso-oidc-waf-policy) ───────────────────────────────────
enable_cloud_armor_waf = true
waf_policy_name        = "sso-oidc-waf-policy"

# ─── Apigee ──────────────────────────────────────────────────────────────────
enable_apigee = false
