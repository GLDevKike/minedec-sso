resource "google_redis_instance" "this" {
  name           = var.name
  project        = var.project_id
  region         = var.region
  display_name   = var.display_name
  tier           = var.tier
  memory_size_gb = var.memory_size_gb
  redis_version  = var.redis_version

  authorized_network = var.network
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  reserved_ip_range  = var.reserved_ip_range

  transit_encryption_mode = var.transit_encryption_mode
  auth_enabled            = var.auth_enabled

  redis_configs = var.redis_configs

  dynamic "maintenance_policy" {
    for_each = var.maintenance_day != null ? [1] : []
    content {
      weekly_maintenance_window {
        day = var.maintenance_day
        start_time {
          hours   = var.maintenance_hour
          minutes = 0
          seconds = 0
          nanos   = 0
        }
      }
    }
  }

  labels = var.labels
}
