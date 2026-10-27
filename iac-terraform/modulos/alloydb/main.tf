resource "google_alloydb_cluster" "this" {
  project          = var.project_id
  location         = var.region
  cluster_id       = var.cluster_id
  database_version = "POSTGRES_16"
  deletion_policy  = var.deletion_protection ? "DEFAULT" : "FORCE"
  labels           = var.labels

  network_config {
    network            = var.network_self_link
    allocated_ip_range = var.allocated_ip_range
  }

  continuous_backup_config {
    enabled              = true
    recovery_window_days = 14
  }

  automated_backup_policy {
    location      = var.region
    backup_window = "21600s"
    enabled       = true

    weekly_schedule {
      days_of_week = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]

      start_times {
        hours   = 3
        minutes = 0
        seconds = 0
        nanos   = 0
      }
    }

    quantity_based_retention {
      count = 14
    }
  }
}

resource "google_alloydb_instance" "primary" {
  cluster           = google_alloydb_cluster.this.name
  instance_id       = "${var.cluster_id}-primary"
  instance_type     = "PRIMARY"
  availability_type = var.availability_type
  labels            = var.labels

  machine_config {
    cpu_count = var.primary_cpu_count
  }

  database_flags = {
    "alloydb.iam_authentication" = "on"
    "alloydb.enable_pgaudit"     = "on"
  }

  client_connection_config {
    require_connectors = false

    ssl_config {
      ssl_mode = "ENCRYPTED_ONLY"
    }
  }
}

resource "google_alloydb_instance" "read_pool" {
  count = var.enable_read_pool ? 1 : 0

  cluster       = google_alloydb_cluster.this.name
  instance_id   = "${var.cluster_id}-read-pool"
  instance_type = "READ_POOL"
  labels        = var.labels

  machine_config {
    cpu_count = var.primary_cpu_count
  }

  read_pool_config {
    node_count = var.read_pool_node_count
  }

  database_flags = {
    "alloydb.iam_authentication" = "on"
  }

  client_connection_config {
    require_connectors = false

    ssl_config {
      ssl_mode = "ENCRYPTED_ONLY"
    }
  }

  depends_on = [google_alloydb_instance.primary]
}
