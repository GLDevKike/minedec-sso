# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# RAÃZ DE DESPLIEGUE â€” des / data (SSO C2.2)
#
# Aprovisiona la capa de datos y mensajerÃ­a del Subcomponente C2.2 SSO:
# - AlloyDB for PostgreSQL 16 (PIP primario, clientes OIDC y auditoria_evento)
# - Memorystore for Redis (cachÃ© L2 con TTL <= 300s y sesiones de sso-oidc)
# - BigQuery (dataset de auditorÃ­a analÃ­tica append-only)
# - Cloud Storage (archivo forense de auditorÃ­a)
# - Cloud Pub/Sub (invalidaciÃ³n inmediata de cachÃ© y eventos Workspace)
# - Cloud Tasks (cola de sincronizaciÃ³n con rate limit <= 28 req/s)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  enable_cloudsql    = false

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
    key_ring_name   = "kr-sso-data-pro"
    crypto_key_name = "key-sso-data-pro"
  }
}
