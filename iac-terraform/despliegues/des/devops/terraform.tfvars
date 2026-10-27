# ─────────────────────────────────────────────
# Valores del stack devops — des SSO C2.2 (us-east1)
# ─────────────────────────────────────────────

project_id = "mec-003-sso-des"
region     = "us-east1"

labels = {
  proyecto       = "minedec-sso"
  subcomponente  = "c2-2"
  ambiente       = "des"
  gestionado_por = "terraform"
}

# ─── Red compartida (Comentada temporalmente mientras se usa VPC local en mec-003-sso-des) ───
# host_project_id = "mec-003-sha-net-des"
host_project_id = "mec-003-sso-des"
enable_host_iam = false

# ─── VPC Local con los 3 Segmentos Oficiales (/20, /23, /24) ─────────────────
# Distribución exacta de los 3 segmentos oficiales:
#   1. Segmento /23 (10.10.0.0/23 = 512 IPs) dedicado a Private Services Access (servicenetworking.googleapis.com) en sus dos mitades /24:
#      - 1ra mitad /24 (10.10.0.0/24, psa-sso-sql-des): Cloud SQL / AlloyDB for PostgreSQL 16 (requiere un bloque /24 exclusivo en GCP)
#      - 2da mitad /24 (10.10.1.0/24, psa-sso-des): Memorystore for Redis (PRIVATE_SERVICE_ACCESS compatible con Shared VPC)
#   2. Segmento /24 (10.10.2.0/24 = 256 IPs): Rango primario de subred snet-sso-ue1 (GKE Nodos + ILBs + Cloud Run Direct VPC Egress)
#   3. Segmento /20 (10.10.16.0/20 = 4,096 IPs) dedicado a rangos secundarios GKE en sus dos mitades /21:
#      - 1ra mitad /21 (10.10.16.0/21 = 2,048 IPs): GKE Pods (pods)
#      - 2da mitad /21 (10.10.24.0/21 = 2,048 IPs): GKE Services (services)
enable_local_vpc = true
local_vpc = {
  network_name          = "vpc-mec-sha-des"
  routing_mode          = "REGIONAL"
  subnet_name           = "snet-sso-ue1"
  subnet_cidr           = "10.10.2.0/24"
  pods_range_name       = "pods"
  pods_cidr             = "10.10.16.0/21"
  services_range_name   = "services"
  services_cidr         = "10.10.24.0/21"
  psa_range_name        = "psa-sso-des"
  psa_address           = "10.10.1.0"
  psa_prefix_length     = 24
  psa_sql_range_name    = "psa-sso-sql-des"
  psa_sql_address       = "10.10.0.0"
  psa_sql_prefix_length = 24
  router_name           = "rtr-sso-des-ue1"
  nat_name              = "nat-sso-des-ue1"
}

# ─── Cuentas de Servicio de Mínimo Privilegio (SSO C2.2) ─────────────────────
# Nota: workload_identity_ksas se habilita una vez creado el clúster GKE en el
# stack apps (cuando se inicializa el pool mec-003-sso-des.svc.id.goog).
service_accounts = {
  "sa-sso-core" = {
    display_name = "SA Cargas Core GKE SSO C2.2"
    description  = "Cuenta de servicio para sso-oidc, motor-pdp, pip-identity-service y api-pap en GKE"
    roles = [
      "roles/alloydb.client",
      "roles/cloudsql.client",
      "roles/redis.editor",
      "roles/pubsub.publisher",
      "roles/pubsub.subscriber",
      "roles/secretmanager.secretAccessor",
      "roles/logging.logWriter",
      "roles/cloudtrace.agent",
    ]
    workload_identity_ksas = []
  }
  "sa-sso-sync" = {
    display_name = "SA Sincronizador SSO C2.2"
    description  = "Cuenta de servicio para Cloud Run Service sso-sincronizador (solo lectura Workspace)"
    roles = [
      "roles/alloydb.client",
      "roles/cloudsql.client",
      "roles/redis.editor",
      "roles/pubsub.publisher",
      "roles/pubsub.subscriber",
      "roles/cloudtasks.enqueuer",
      "roles/secretmanager.secretAccessor",
      "roles/iam.serviceAccountTokenCreator",
      "roles/logging.logWriter",
    ]
  }
  "sa-sso-sync-job" = {
    display_name = "SA Conciliacion Job SSO C2.2"
    description  = "Cuenta de servicio para Cloud Run Job sso-conciliacion-job"
    roles = [
      "roles/alloydb.client",
      "roles/cloudsql.client",
      "roles/redis.editor",
      "roles/pubsub.publisher",
      "roles/secretmanager.secretAccessor",
      "roles/iam.serviceAccountTokenCreator",
      "roles/logging.logWriter",
    ]
  }
  "sa-sso-publicador" = {
    display_name = "SA Publicador Job SSO C2.2"
    description  = "Cuenta de servicio aislada para Cloud Run Job sso-publicador-job"
    roles = [
      "roles/alloydb.client",
      "roles/cloudsql.client",
      "roles/storage.objectAdmin",
      "roles/config.agent",
      "roles/secretmanager.secretAccessor",
      "roles/logging.logWriter",
    ]
  }
  "sa-workspace-reader" = {
    display_name = "SA Lectura Google Workspace DWD SSO C2.2"
    description  = "Cuenta de servicio dedicada a Domain-Wide Delegation (solo lectura Directory/Reports API via signJwt)"
    roles = [
      "roles/iam.serviceAccountTokenCreator",
    ]
  }
}

# ─── Secret Manager (contenedores sin valores en texto plano) ────────────────
secret_ids = [
  "sso-alloydb-app-password",
  "sso-google-oauth-client-secret",
  "sso-oidc-cookie-keys",
  "sso-oidc-jwks-private-key-active",
  "sso-pdp-jwks-private-key-active",
]

# ─── Buckets Operativos ──────────────────────────────────────────────────────
# El bucket de Infra Manager (gs://mec-003-sso-des-im-artifacts) se crea en el
# bootstrap y NO se gestiona aquí para proteger el state de los deployments.
buckets = {
  blueprints = {
    name               = "mec-003-sso-des-blueprints"
    versioning_enabled = true
  }
}

# ─── Artifact Registry ───────────────────────────────────────────────────────
artifact_registry_repositories = {
  "sso-containers" = {
    format      = "DOCKER"
    description = "Imágenes Docker de microservicios, SPA y jobs del Subcomponente C2.2 SSO"
  }
}
