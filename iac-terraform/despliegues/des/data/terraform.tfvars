# ─────────────────────────────────────────────
# Valores del stack data — des SSO C2.2 (us-east1)
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
# host_project_id     = "mec-003-sha-net-des"
host_project_id       = "mec-003-sso-des"
host_network_name     = "vpc-mec-sha-des"
host_data_subnet_name = "snet-sso-ue1"

# ─── Buckets de Auditoría Forense WORM (GCS) ─────────────────────────────────
lake_buckets = {
  audit_worm = {
    name               = "mec-003-sso-des-audit-worm"
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

# ─── AlloyDB for PostgreSQL 16 (Comentado temporalmente en des para probar con Cloud SQL) ───
# Para volver a AlloyDB en el futuro: descomentar este bloque y cambiar enable_cloudsql = false.
enable_alloydb = false
# alloydb_cluster_id          = "sso-alloydb-des"
# alloydb_availability_type   = "ZONAL"
# alloydb_primary_cpu_count   = 2
# alloydb_enable_read_pool    = false
# alloydb_deletion_protection = true

# ─── Cloud SQL for PostgreSQL 16 (Sustituto económico temporal para pruebas en des) ───
# Configurado con el tier más económico (db-f1-micro, ZONAL, 10 GB) y programación
# automática en Cloud Scheduler (Lunes a Viernes, hora Colombia America/Bogota,
# apagado fines de semana):
#   - Encendido (ALWAYS): 08:00 AM y 02:00 PM (14:00) L-V -> "0 8,14 * * 1-5"
#   - Apagado   (NEVER) : 01:00 PM (13:00) y 05:00 PM (17:00) L-V -> "0 13,17 * * 1-5"
enable_cloudsql                 = true
cloudsql_name                   = "sso-postgres-des"
cloudsql_database_version       = "POSTGRES_16"
cloudsql_tier                   = "db-f1-micro"
cloudsql_availability_type      = "ZONAL"
cloudsql_disk_size_gb           = 10
cloudsql_disk_type              = "PD_SSD"
cloudsql_use_private_network    = true
cloudsql_ipv4_enabled           = false
cloudsql_deletion_protection    = false
cloudsql_backup_enabled         = false
cloudsql_pit_recovery_enabled   = false
cloudsql_query_insights_enabled = false
cloudsql_databases              = ["sso_db"]
cloudsql_enable_schedule        = true
cloudsql_schedule_time_zone     = "America/Bogota"
cloudsql_start_cron             = "0 8,14 * * 1-5"
cloudsql_stop_cron              = "0 13,17 * * 1-5"

# ─── Memorystore Redis (Conectado vía PSA psa-sso-des 10.10.1.0/24) ──────────
enable_redis         = true
redis_name           = "sso-redis-des"
redis_tier           = "BASIC"
redis_memory_size_gb = 1

enable_kms = false
