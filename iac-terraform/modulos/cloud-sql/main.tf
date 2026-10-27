resource "google_sql_database_instance" "this" {
  name             = var.name
  project          = var.project_id
  region           = var.region
  database_version = var.database_version

  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_size         = var.disk_size_gb
    disk_type         = var.disk_type
    disk_autoresize   = true

    backup_configuration {
      enabled                        = var.backup_enabled
      point_in_time_recovery_enabled = var.pit_recovery_enabled
      start_time                     = var.backup_start_time
      transaction_log_retention_days = var.transaction_log_retention_days

      backup_retention_settings {
        retained_backups = var.retained_backups
      }
    }

    ip_configuration {
      ipv4_enabled       = var.ipv4_enabled
      private_network    = var.private_network
      allocated_ip_range = var.allocated_ip_range
      ssl_mode           = var.ssl_mode

      dynamic "authorized_networks" {
        for_each = var.authorized_networks
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.cidr
        }
      }
    }

    dynamic "database_flags" {
      for_each = var.database_flags
      content {
        name  = database_flags.key
        value = database_flags.value
      }
    }

    insights_config {
      query_insights_enabled  = var.query_insights_enabled
      query_string_length     = 1024
      record_application_tags = false
      record_client_address   = false
    }

    maintenance_window {
      day          = var.maintenance_day
      hour         = var.maintenance_hour
      update_track = "stable"
    }

    user_labels = var.labels
  }

  lifecycle {
    ignore_changes = [
      settings[0].activation_policy,
    ]
  }
}

resource "google_sql_database" "databases" {
  for_each = toset(var.databases)

  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = each.value
}

resource "google_sql_user" "users" {
  for_each = var.users

  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = each.key
  password = each.value.password
  type     = each.value.type
}
