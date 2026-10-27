# ─────────────────────────────────────────────
# RAÍZ DE DESPLIEGUE — des / data (SSO C2.2)
#
# Aprovisiona la capa de datos y mensajería del Subcomponente C2.2 SSO:
# - AlloyDB for PostgreSQL 16 (PIP primario, clientes OIDC y auditoria_evento)
# - Memorystore for Redis (caché L2 con TTL <= 300s y sesiones de sso-oidc)
# - BigQuery (dataset de auditoría analítica append-only)
# - Cloud Storage (archivo forense de auditoría)
# - Cloud Pub/Sub (invalidación inmediata de caché y eventos Workspace)
# - Cloud Tasks (cola de sincronización con rate limit <= 28 req/s)
# ─────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  host_vpc_self_link    = "projects/${var.host_project_id}/global/networks/${var.host_network_name}"
  data_subnet_self_link = var.host_data_subnet_name != null ? "projects/${var.host_project_id}/regions/${var.region}/subnetworks/${var.host_data_subnet_name}" : null
}

module "data" {
  source = "./plantillas/data"

  project_id = var.project_id
  region     = var.region
  labels     = var.labels

  host_project_id       = var.host_project_id
  host_vpc_self_link    = local.host_vpc_self_link
  data_subnet_self_link = local.data_subnet_self_link

  lake_buckets       = var.lake_buckets
  bigquery_datasets  = var.bigquery_datasets
  pubsub_topics      = var.pubsub_topics
  cloud_tasks_queues = var.cloud_tasks_queues

  enable_dataflow_sa = false

  enable_cloudsql = var.enable_cloudsql
  cloudsql = {
    name                   = var.cloudsql_name
    database_version       = var.cloudsql_database_version
    tier                   = var.cloudsql_tier
    availability_type      = var.cloudsql_availability_type
    disk_size_gb           = var.cloudsql_disk_size_gb
    disk_type              = var.cloudsql_disk_type
    allocated_ip_range     = var.cloudsql_allocated_ip_range
    ipv4_enabled           = var.cloudsql_ipv4_enabled
    use_private_network    = var.cloudsql_use_private_network
    deletion_protection    = var.cloudsql_deletion_protection
    backup_enabled         = var.cloudsql_backup_enabled
    pit_recovery_enabled   = var.cloudsql_pit_recovery_enabled
    query_insights_enabled = var.cloudsql_query_insights_enabled
    databases              = var.cloudsql_databases
    enable_schedule        = var.cloudsql_enable_schedule
    schedule_time_zone     = var.cloudsql_schedule_time_zone
    start_cron             = var.cloudsql_start_cron
    stop_cron              = var.cloudsql_stop_cron
  }

  enable_alloydb = var.enable_alloydb
  alloydb = {
    cluster_id          = var.alloydb_cluster_id
    allocated_ip_range  = var.alloydb_allocated_ip_range
    availability_type   = var.alloydb_availability_type
    primary_cpu_count   = var.alloydb_primary_cpu_count
    enable_read_pool    = var.alloydb_enable_read_pool
    deletion_protection = var.alloydb_deletion_protection
  }

  enable_redis = var.enable_redis
  redis = {
    name           = var.redis_name
    display_name   = "Memorystore Redis SSO C2.2 (${var.project_id})"
    tier           = var.redis_tier
    memory_size_gb = var.redis_memory_size_gb
  }

  enable_kms = var.enable_kms
  kms = {
    key_ring_name   = "kr-sso-data-des"
    crypto_key_name = "key-sso-data-des"
  }
}
