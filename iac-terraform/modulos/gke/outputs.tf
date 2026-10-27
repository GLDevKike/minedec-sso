output "cluster_id" {
  value       = google_container_cluster.this.id
  description = "ID del clúster GKE"
}
output "cluster_name" {
  value       = google_container_cluster.this.name
  description = "Nombre del clúster"
}
output "endpoint" {
  value       = google_container_cluster.this.endpoint
  description = "Endpoint del control plane"
}
output "workload_pool" {
  value       = "${var.project_id}.svc.id.goog"
  description = "Workload Identity Pool del clúster"
}
output "node_pool_ids" {
  value       = { for k, v in google_container_node_pool.pools : k => v.id }
  description = "IDs de los node pools"
}
