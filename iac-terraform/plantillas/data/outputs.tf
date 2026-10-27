# ─────────────────────────────────────────────
# BUCKETS
# ─────────────────────────────────────────────

output "lake_bucket_names" {
  description = "Mapa zona → nombre del bucket."
  value       = { for k, v in module.lake_buckets : k => v.bucket_name }
}

output "lake_bucket_urls" {
  description = "Mapa zona → URL gs:// del bucket."
  value       = { for k, v in module.lake_buckets : k => v.bucket_url }
}

# ─────────────────────────────────────────────
# BIGQUERY
# ─────────────────────────────────────────────

output "bigquery_dataset_ids" {
  description = "Mapa dataset_id → ID completo del recurso de BigQuery."
  value       = { for k, v in google_bigquery_dataset.datasets : k => v.id }
}

# ─────────────────────────────────────────────
# PUB/SUB
# ─────────────────────────────────────────────

output "pubsub_topic_ids" {
  description = "Mapa nombre de topic → ID completo del recurso."
  value       = { for k, v in google_pubsub_topic.topics : k => v.id }
}

output "pubsub_subscription_ids" {
  description = "Mapa nombre de subscription → ID completo del recurso."
  value       = { for k, v in google_pubsub_subscription.subscriptions : k => v.id }
}

# ─────────────────────────────────────────────
# CLOUD TASKS
# ─────────────────────────────────────────────

output "cloud_tasks_queue_ids" {
  description = "Mapa nombre de cola → ID completo en Cloud Tasks."
  value       = module.cloud_tasks.queue_ids
}

# ─────────────────────────────────────────────
# DATAFLOW
# ─────────────────────────────────────────────

output "dataflow_service_account" {
  description = "Email de la service account de Dataflow. Null si enable_dataflow_sa = false."
  value       = local.dataflow_sa_email
}

output "dataflow_subnetwork" {
  description = "Self-link de la subred para workers de Dataflow."
  value       = var.data_subnet_self_link
}

# ─────────────────────────────────────────────
# CLOUD KMS
# ─────────────────────────────────────────────

output "kms_crypto_key_id" {
  description = "ID de la clave CMEK creada. Null si enable_kms = false."
  value       = var.enable_kms ? google_kms_crypto_key.data[0].id : null
}

# ─────────────────────────────────────────────
# ALLOYDB FOR POSTGRESQL 16
# ─────────────────────────────────────────────

output "alloydb_cluster_name" {
  description = "Nombre completo del clúster AlloyDB. Null si enable_alloydb = false."
  value       = var.enable_alloydb ? module.alloydb[0].cluster_name : null
}

output "alloydb_primary_ip" {
  description = "IP privada de la instancia primaria de AlloyDB. Null si enable_alloydb = false."
  value       = var.enable_alloydb ? module.alloydb[0].primary_instance_ip : null
}

output "alloydb_read_pool_ip" {
  description = "IP privada de la instancia Read Pool de AlloyDB. Null si enable_alloydb = false."
  value       = var.enable_alloydb ? module.alloydb[0].read_pool_instance_ip : null
}

# ─────────────────────────────────────────────
# CLOUD SQL
# ─────────────────────────────────────────────

output "cloudsql_connection_name" {
  description = "Nombre de conexión de Cloud SQL. Null si enable_cloudsql = false."
  value       = var.enable_cloudsql ? module.cloud_sql[0].connection_name : null
}

output "cloudsql_private_ip" {
  description = "IP privada de la instancia Cloud SQL. Null si enable_cloudsql = false."
  value       = var.enable_cloudsql ? module.cloud_sql[0].private_ip : null
}

# ─────────────────────────────────────────────
# REDIS
# ─────────────────────────────────────────────

output "redis_host" {
  description = "IP privada de la instancia Redis. Null si enable_redis = false."
  value       = var.enable_redis ? module.redis[0].host : null
}

output "redis_port" {
  description = "Puerto de la instancia Redis. Null si enable_redis = false."
  value       = var.enable_redis ? module.redis[0].port : null
}
