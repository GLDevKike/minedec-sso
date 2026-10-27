output "lake_bucket_names" {
  description = "Mapa identificador â†’ nombre del bucket creado."
  value       = module.data.lake_bucket_names
}

output "bigquery_dataset_ids" {
  description = "Mapa dataset_id â†’ ID completo del recurso en BigQuery."
  value       = module.data.bigquery_dataset_ids
}

output "pubsub_topic_ids" {
  description = "Mapa nombre de topic â†’ ID completo del recurso en Pub/Sub."
  value       = module.data.pubsub_topic_ids
}

output "pubsub_subscription_ids" {
  description = "Mapa nombre de subscription â†’ ID completo del recurso en Pub/Sub."
  value       = module.data.pubsub_subscription_ids
}

output "cloud_tasks_queue_ids" {
  description = "Mapa nombre de cola â†’ ID completo en Cloud Tasks."
  value       = module.data.cloud_tasks_queue_ids
}

output "alloydb_cluster_name" {
  description = "Nombre completo del clÃºster AlloyDB. Null si enable_alloydb = false."
  value       = module.data.alloydb_cluster_name
}

output "alloydb_primary_ip" {
  description = "IP privada de AlloyDB primario. Null si enable_alloydb = false."
  value       = module.data.alloydb_primary_ip
}

output "redis_host" {
  description = "IP privada de Memorystore Redis. Null si enable_redis = false."
  value       = module.data.redis_host
}

output "redis_port" {
  description = "Puerto de Memorystore Redis. Null si enable_redis = false."
  value       = module.data.redis_port
}
