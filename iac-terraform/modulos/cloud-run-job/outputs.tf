output "job_id" {
  description = "ID completo del Cloud Run Job."
  value       = google_cloud_run_v2_job.this.id
}

output "job_name" {
  description = "Nombre del Cloud Run Job."
  value       = google_cloud_run_v2_job.this.name
}
