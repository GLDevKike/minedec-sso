resource "google_cloud_tasks_queue" "this" {
  for_each = var.queues

  project  = var.project_id
  location = var.region
  name     = each.key

  rate_limits {
    max_dispatches_per_second = each.value.max_dispatches_per_second
    max_concurrent_dispatches = each.value.max_concurrent_dispatches
  }

  retry_config {
    max_attempts  = each.value.max_attempts
    min_backoff   = each.value.min_backoff
    max_backoff   = each.value.max_backoff
    max_doublings = each.value.max_doublings
  }
}
