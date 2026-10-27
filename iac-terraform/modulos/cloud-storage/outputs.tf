output "bucket_name" {
  value       = google_storage_bucket.this.name
  description = "Nombre del bucket"
}

output "bucket_id" {
  value       = google_storage_bucket.this.id
  description = "ID del bucket"
}

output "bucket_url" {
  value       = google_storage_bucket.this.url
  description = "URL gs:// del bucket"
}

output "self_link" {
  value       = google_storage_bucket.this.self_link
  description = "Self-link del bucket"
}
