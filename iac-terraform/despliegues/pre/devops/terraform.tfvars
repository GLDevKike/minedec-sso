# ─────────────────────────────────────────────
# Valores del stack devops — pre SSO C2.2 (us-east1)
# ─────────────────────────────────────────────

project_id = "mec-003-sso-pre"
region     = "us-east1"

labels = {
  proyecto       = "minedec-sso"
  subcomponente  = "c2-2"
  ambiente       = "pre"
  gestionado_por = "terraform"
}

# ─── Red compartida (gestionada en el proyecto host) ─────────────────────────
host_project_id = "mec-003-sha-net-pre"
enable_host_iam = false

# ─── Cuentas de Servicio de Mínimo Privilegio (SSO C2.2) ─────────────────────
# Nota: workload_identity_ksas se habilita una vez creado el clúster GKE en el
# stack apps (cuando se inicializa el pool mec-003-sso-pre.svc.id.goog).
service_accounts = {
  "sa-sso-core" = {
    display_name = "SA Cargas Core GKE SSO C2.2"
    description  = "Cuenta de servicio para sso-oidc, motor-pdp, pip-identity-service y api-pap en GKE"
    roles = [
      "roles/alloydb.client",
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
# El bucket de Infra Manager (gs://mec-003-sso-pre-im-artifacts) se crea en el
# bootstrap y NO se gestiona aquí para proteger el state de los deployments.
buckets = {
  blueprints = {
    name               = "mec-003-sso-pre-blueprints"
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
