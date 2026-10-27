resource "google_cloud_run_v2_job" "this" {
  name                = var.name
  project             = var.project_id
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    parallelism = var.parallelism
    task_count  = var.task_count

    template {
      service_account = var.service_account
      max_retries     = var.max_retries
      timeout         = "${var.timeout_seconds}s"

      containers {
        image = var.image

        dynamic "env" {
          for_each = var.env_vars
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = var.env_secrets
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.secret
                version = env.value.version
              }
            }
          }
        }

        resources {
          limits = {
            cpu    = var.cpu
            memory = var.memory
          }
        }
      }

      dynamic "vpc_access" {
        for_each = var.vpc_subnetwork != null ? [1] : []
        content {
          egress = var.vpc_egress

          network_interfaces {
            network    = var.vpc_network
            subnetwork = var.vpc_subnetwork
            tags       = var.vpc_network_tags
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "invokers" {
  for_each = toset(var.invokers)

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.this.name
  role     = "roles/run.invoker"
  member   = each.value
}
