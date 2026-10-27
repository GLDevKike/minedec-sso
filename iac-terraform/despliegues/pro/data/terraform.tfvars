# ─────────────────────────────────────────────
# Valores del stack data — pro SSO C2.2 (us-east1)
# ─────────────────────────────────────────────

project_id = "mec-003-sso-pro"
region     = "us-east1"

labels = {
  proyecto       = "minedec-sso"
  subcomponente  = "c2-2"
  ambiente       = "pro"
  gestionado_por = "terraform"
}

# ─── Red compartida (proyecto host) ──────────────────────────────────────────
host_project_id       = "mec-003-sha-net-pro-511014"
host_network_name     = "vpc-mec-sha-pro"
host_data_subnet_name = "snet-sso-ue1"

# ─── Buckets de Auditoría Forense WORM (GCS) ─────────────────────────────────
lake_buckets = {
  audit_worm = {
    name               = "mec-003-sso-pro-audit-worm"
    storage_class      = "STANDARD"
    versioning_enabled = true
    force_destroy      = false
    retention_policy = {
      retention_period = 31536000
      is_locked        = true
    }
    lifecycle_rules = [
      { action_type = "SetStorageClass", storage_class = "NEARLINE", age_days = 90 },
      { action_type = "SetStorageClass", storage_class = "COLDLINE", age_days = 365 },
    ]
  }
}

# ─── BigQuery (Auditoría Analítica Append-Only) ──────────────────────────────
bigquery_datasets = {
  auditoria_sso = {
    friendly_name              = "Auditoría Analítica SSO C2.2"
    description                = "Dataset append-only de eventos de autenticación, autorización y administración del SSO C2.2"
    delete_contents_on_destroy = false
    deletion_protection        = true
  }
}

# ─── Cloud Pub/Sub (Invalidación <= 300s y Eventos Workspace) ────────────────
pubsub_topics = {
  "sso-revocaciones" = {
    message_retention_duration = "86400s"
    subscriptions = {
      "sub-sso-oidc-revocaciones" = {
        ack_deadline_seconds = 10
      }
      "sub-motor-pdp-revocaciones" = {
        ack_deadline_seconds = 10
      }
      "sub-pip-identity-revocaciones" = {
        ack_deadline_seconds = 10
      }
    }
  }
  "sso-pip-cache-invalidation" = {
    message_retention_duration = "86400s"
    subscriptions = {
      "sub-motor-pdp-pip-cache-invalidation" = {
        ack_deadline_seconds = 10
      }
      "sub-pip-identity-cache-invalidation" = {
        ack_deadline_seconds = 10
      }
    }
  }
  "sso-cache-invalidation" = {
    message_retention_duration = "86400s"
    subscriptions = {
      "sub-sso-oidc-invalidation" = {
        ack_deadline_seconds = 10
      }
      "sub-motor-pdp-invalidation" = {
        ack_deadline_seconds = 10
      }
    }
  }
  "sso-workspace-identity-events" = {
    message_retention_duration = "604800s"
    subscriptions = {
      "sub-sso-sincronizador-events" = {
        ack_deadline_seconds = 60
      }
    }
  }
}

# ─── Cloud Tasks (Control de Tasa <= 28 req/s hacia Google Workspace) ────────
cloud_tasks_queues = {
  "sso-workspace-sync-queue" = {
    max_dispatches_per_second = 25
    max_concurrent_dispatches = 10
    max_attempts              = 5
    min_backoff               = "2s"
    max_backoff               = "300s"
    max_doublings             = 4
  }
}

# ─── AlloyDB for PostgreSQL 16 y Memorystore Redis (requieren PSA en Host) ───
# Se activan en true una vez la VPC compartida (mec-003-sha-net-pro-511014) tenga
# adjuntado el proyecto mec-003-sso-pro y el peering PSA habilitado.
enable_alloydb              = false
alloydb_cluster_id          = "sso-alloydb-pro"
alloydb_availability_type   = "REGIONAL"
alloydb_primary_cpu_count   = 2
alloydb_enable_read_pool    = false
alloydb_deletion_protection = true

enable_redis         = false
redis_name           = "sso-redis-pro"
redis_tier           = "STANDARD_HA"
redis_memory_size_gb = 1

enable_kms = false
