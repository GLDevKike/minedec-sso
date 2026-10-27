output "queue_ids" {
  description = "Mapa nombre de cola -> ID completo del recurso en Cloud Tasks."
  value       = { for k, q in google_cloud_tasks_queue.this : k => q.id }
}
