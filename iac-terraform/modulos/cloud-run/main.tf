resource "google_cloud_run_v2_service" "this" {
  name     = var.name
  project  = var.project_id
  location = var.region
  ingress  = var.ingress

  template {
    service_account = var.service_account

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

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
        cpu_idle = var.cpu_idle
      }

      dynamic "ports" {
        for_each = var.container_port != null ? [1] : []
        content {
          container_port = var.container_port
        }
      }
    }

    # Acceso a la VPC. Dos modos excluyentes:
    #   - direct VPC egress  → se indica vpc_subnetwork (la instancia recibe una IP de
    #     la subred, sin conector intermedio; es el modo recomendado y el único que
    #     funciona con Shared VPC sin crear conectores en el proyecto de servicio).
    #   - VPC Access Connector → se indica vpc_connector (modo legado).
    dynamic "vpc_access" {
      for_each = var.vpc_subnetwork != null || var.vpc_connector != null ? [1] : []
      content {
        connector = var.vpc_subnetwork == null ? var.vpc_connector : null
        egress    = var.vpc_egress

        dynamic "network_interfaces" {
          for_each = var.vpc_subnetwork != null ? [1] : []
          content {
            network    = var.vpc_network
            subnetwork = var.vpc_subnetwork
            tags       = var.vpc_network_tags
          }
        }
      }
    }

    timeout = "${var.timeout_seconds}s"
  }

  labels              = var.labels
  deletion_protection = var.deletion_protection
}

resource "google_cloud_run_v2_service_iam_member" "invokers" {
  for_each = toset(var.invokers)

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = each.value
}
