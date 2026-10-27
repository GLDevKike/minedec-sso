# ─────────────────────────────────────────────
# APIs
# ─────────────────────────────────────────────

locals {
  apis_to_enable = distinct(concat(
    var.apis_to_enable,
    var.enable_kms ? ["cloudkms.googleapis.com"] : [],
    var.enable_alloydb ? ["alloydb.googleapis.com", "servicenetworking.googleapis.com"] : [],
    var.enable_cloudsql ? ["sqladmin.googleapis.com", "servicenetworking.googleapis.com"] : [],
    var.enable_cloudsql && try(var.cloudsql.enable_schedule, false) ? ["cloudscheduler.googleapis.com"] : [],
    var.enable_redis ? ["redis.googleapis.com", "servicenetworking.googleapis.com"] : [],
  ))
}

module "apis" {
  source = "../../modulos/apis"

  project_id = var.project_id
  apis       = local.apis_to_enable
}

data "google_project" "data" {
  project_id = var.project_id
  depends_on = [module.apis]
}

locals {
  gcs_sa      = "serviceAccount:service-${data.google_project.data.number}@gs-project-accounts.iam.gserviceaccount.com"
  bq_sa       = "serviceAccount:bq-${data.google_project.data.number}@bigquery-encryption.iam.gserviceaccount.com"
  pubsub_sa   = "serviceAccount:service-${data.google_project.data.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  dataflow_sa = "serviceAccount:service-${data.google_project.data.number}@dataflow-service-producer-prod.iam.gserviceaccount.com"

  cmek_key_id = var.enable_kms ? google_kms_crypto_key.data[0].id : null

  pubsub_subscriptions = merge([
    for topic_name, topic in var.pubsub_topics : {
      for sub_name, sub in topic.subscriptions : sub_name => merge(sub, {
        topic = topic_name
      })
    }
  ]...)
}

# ─────────────────────────────────────────────
# CLOUD KMS (OPCIONAL)
# ─────────────────────────────────────────────

resource "google_kms_key_ring" "data" {
  count = var.enable_kms ? 1 : 0

  name     = var.kms.key_ring_name
  project  = var.project_id
  location = var.region

  depends_on = [module.apis]
}

resource "google_kms_crypto_key" "data" {
  count = var.enable_kms ? 1 : 0

  name            = var.kms.crypto_key_name
  key_ring        = google_kms_key_ring.data[0].id
  rotation_period = var.kms.rotation_period
  labels          = var.labels
}

resource "google_kms_crypto_key_iam_member" "encrypters" {
  for_each = var.enable_kms ? {
    gcs    = local.gcs_sa
    bq     = local.bq_sa
    pubsub = local.pubsub_sa
  } : {}

  crypto_key_id = google_kms_crypto_key.data[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = each.value
}

# ─────────────────────────────────────────────
# BUCKETS (GCS)
# ─────────────────────────────────────────────

module "lake_buckets" {
  source   = "../../modulos/cloud-storage"
  for_each = var.lake_buckets

  project_id         = var.project_id
  name               = each.value.name
  location           = coalesce(each.value.location, var.region)
  storage_class      = each.value.storage_class
  versioning_enabled = each.value.versioning_enabled
  force_destroy      = each.value.force_destroy
  retention_policy   = each.value.retention_policy
  kms_key_name       = local.cmek_key_id
  lifecycle_rules    = each.value.lifecycle_rules
  labels             = merge(var.labels, { zona = each.key })

  depends_on = [module.apis, google_kms_crypto_key_iam_member.encrypters]
}

# ─────────────────────────────────────────────
# BIGQUERY
# ─────────────────────────────────────────────

resource "google_bigquery_dataset" "datasets" {
  for_each = var.bigquery_datasets

  dataset_id                  = each.key
  project                     = var.project_id
  location                    = coalesce(each.value.location, var.region)
  friendly_name               = coalesce(each.value.friendly_name, each.key)
  description                 = each.value.description
  default_table_expiration_ms = each.value.default_table_expiration_ms
  delete_contents_on_destroy  = each.value.delete_contents_on_destroy
  labels                      = merge(var.labels, each.value.labels)

  dynamic "default_encryption_configuration" {
    for_each = local.cmek_key_id != null ? [1] : []
    content {
      kms_key_name = local.cmek_key_id
    }
  }

  depends_on = [module.apis, google_kms_crypto_key_iam_member.encrypters]
}

# ─────────────────────────────────────────────
# PUB/SUB
# ─────────────────────────────────────────────

resource "google_pubsub_topic" "topics" {
  for_each = var.pubsub_topics

  name                       = each.key
  project                    = var.project_id
  message_retention_duration = each.value.message_retention_duration
  kms_key_name               = local.cmek_key_id
  labels                     = merge(var.labels, each.value.labels)

  depends_on = [module.apis, google_kms_crypto_key_iam_member.encrypters]
}

resource "google_pubsub_subscription" "subscriptions" {
  for_each = local.pubsub_subscriptions

  name                       = each.key
  project                    = var.project_id
  topic                      = google_pubsub_topic.topics[each.value.topic].id
  ack_deadline_seconds       = each.value.ack_deadline_seconds
  message_retention_duration = each.value.message_retention_duration
  retain_acked_messages      = each.value.retain_acked_messages
  enable_message_ordering    = each.value.enable_message_ordering
  labels                     = merge(var.labels, each.value.labels)

  dynamic "push_config" {
    for_each = each.value.push_endpoint != null ? [1] : []
    content {
      push_endpoint = each.value.push_endpoint
    }
  }

  dynamic "expiration_policy" {
    for_each = each.value.expiration_ttl != null ? [1] : []
    content {
      ttl = each.value.expiration_ttl
    }
  }
}

# ─────────────────────────────────────────────
# CLOUD TASKS
# ─────────────────────────────────────────────

module "cloud_tasks" {
  source = "../../modulos/cloud-tasks"

  project_id = var.project_id
  region     = var.region
  queues     = var.cloud_tasks_queues

  depends_on = [module.apis]
}

# ─────────────────────────────────────────────
# DATAFLOW (OPCIONAL)
# ─────────────────────────────────────────────

locals {
  dataflow_sa_email = var.enable_dataflow_sa ? google_service_account.dataflow[0].email : null
}

resource "google_service_account" "dataflow" {
  count = var.enable_dataflow_sa ? 1 : 0

  project      = var.project_id
  account_id   = var.dataflow_sa.account_id
  display_name = var.dataflow_sa.display_name

  depends_on = [module.apis]
}

module "dataflow_sa_iam" {
  source = "../../modulos/iam"
  count  = var.enable_dataflow_sa ? 1 : 0

  recurso_id   = var.project_id
  tipo_recurso = "proyecto"
  tipo_cuenta  = "serviceAccount"
  email        = local.dataflow_sa_email
  roles        = var.dataflow_sa.roles
}

resource "google_compute_subnetwork_iam_member" "dataflow_host_subnet" {
  for_each = var.enable_dataflow_sa && var.data_subnet_self_link != null ? {
    worker_sa     = "serviceAccount:${local.dataflow_sa_email}"
    service_agent = local.dataflow_sa
  } : {}

  project    = var.host_project_id
  region     = var.region
  subnetwork = var.data_subnet_self_link
  role       = "roles/compute.networkUser"
  member     = each.value
}

# ─────────────────────────────────────────────
# ALLOYDB FOR POSTGRESQL 16
# ─────────────────────────────────────────────

module "alloydb" {
  source = "../../modulos/alloydb"
  count  = var.enable_alloydb ? 1 : 0

  project_id           = var.project_id
  region               = var.region
  cluster_id           = var.alloydb.cluster_id
  network_self_link    = var.host_vpc_self_link
  allocated_ip_range   = var.alloydb.allocated_ip_range
  availability_type    = var.alloydb.availability_type
  primary_cpu_count    = var.alloydb.primary_cpu_count
  enable_read_pool     = var.alloydb.enable_read_pool
  read_pool_node_count = var.alloydb.read_pool_node_count
  deletion_protection  = var.alloydb.deletion_protection
  labels               = var.labels

  depends_on = [module.apis]
}

# ─────────────────────────────────────────────
# CLOUD SQL (OPCIONAL — PRUEBAS FINOPS CON HORARIO)
# ─────────────────────────────────────────────

module "cloud_sql" {
  source = "../../modulos/cloud-sql"
  count  = var.enable_cloudsql ? 1 : 0

  project_id                     = var.project_id
  region                         = var.region
  name                           = var.cloudsql.name
  database_version               = var.cloudsql.database_version
  tier                           = var.cloudsql.tier
  availability_type              = var.cloudsql.availability_type
  disk_size_gb                   = var.cloudsql.disk_size_gb
  disk_type                      = var.cloudsql.disk_type
  ipv4_enabled                   = var.cloudsql.ipv4_enabled
  private_network                = var.cloudsql.use_private_network ? var.host_vpc_self_link : null
  allocated_ip_range             = var.cloudsql.allocated_ip_range
  deletion_protection            = var.cloudsql.deletion_protection
  backup_enabled                 = var.cloudsql.backup_enabled
  pit_recovery_enabled           = var.cloudsql.pit_recovery_enabled
  transaction_log_retention_days = var.cloudsql.transaction_log_retention_days
  retained_backups               = var.cloudsql.retained_backups
  query_insights_enabled         = var.cloudsql.query_insights_enabled
  databases                      = var.cloudsql.databases
  database_flags                 = var.cloudsql.database_flags
  labels                         = var.labels

  depends_on = [module.apis]
}

resource "google_service_account" "cloudsql_scheduler" {
  count = var.enable_cloudsql && try(var.cloudsql.enable_schedule, false) ? 1 : 0

  project      = var.project_id
  account_id   = "sa-sso-sql-sched"
  display_name = "SA Cloud Scheduler Encendido/Apagado Cloud SQL SSO C2.2"
  description  = "Cuenta de servicio dedicada para encender y apagar Cloud SQL mediante Cloud Scheduler"

  depends_on = [module.apis]
}

resource "google_project_iam_member" "cloudsql_scheduler" {
  count = var.enable_cloudsql && try(var.cloudsql.enable_schedule, false) ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.editor"
  member  = "serviceAccount:${google_service_account.cloudsql_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "cloudsql_start" {
  count = var.enable_cloudsql && try(var.cloudsql.enable_schedule, false) ? 1 : 0

  name             = "${var.cloudsql.name}-start"
  description      = "Enciende la instancia Cloud SQL ${var.cloudsql.name} en horario laboral (L-V 08:00 y 14:00)"
  project          = var.project_id
  region           = var.region
  schedule         = var.cloudsql.start_cron
  time_zone        = var.cloudsql.schedule_time_zone
  attempt_deadline = "180s"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "PATCH"
    uri         = "https://sqladmin.googleapis.com/v1/projects/${var.project_id}/instances/${module.cloud_sql[0].instance_name}"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      settings = {
        activationPolicy = "ALWAYS"
      }
    }))
    oauth_token {
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
      service_account_email = google_service_account.cloudsql_scheduler[0].email
    }
  }

  depends_on = [
    module.apis,
    module.cloud_sql,
    google_project_iam_member.cloudsql_scheduler,
  ]
}

resource "google_cloud_scheduler_job" "cloudsql_stop" {
  count = var.enable_cloudsql && try(var.cloudsql.enable_schedule, false) ? 1 : 0

  name             = "${var.cloudsql.name}-stop"
  description      = "Apaga la instancia Cloud SQL ${var.cloudsql.name} fuera de horario laboral (L-V 13:00 y 17:00)"
  project          = var.project_id
  region           = var.region
  schedule         = var.cloudsql.stop_cron
  time_zone        = var.cloudsql.schedule_time_zone
  attempt_deadline = "180s"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "PATCH"
    uri         = "https://sqladmin.googleapis.com/v1/projects/${var.project_id}/instances/${module.cloud_sql[0].instance_name}"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      settings = {
        activationPolicy = "NEVER"
      }
    }))
    oauth_token {
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
      service_account_email = google_service_account.cloudsql_scheduler[0].email
    }
  }

  depends_on = [
    module.apis,
    module.cloud_sql,
    google_project_iam_member.cloudsql_scheduler,
  ]
}

# ─────────────────────────────────────────────
# MEMORYSTORE REDIS
# ─────────────────────────────────────────────

module "redis" {
  source = "../../modulos/memorystore-redis"
  count  = var.enable_redis ? 1 : 0

  project_id              = var.project_id
  region                  = var.region
  name                    = var.redis.name
  display_name            = var.redis.display_name
  tier                    = var.redis.tier
  memory_size_gb          = var.redis.memory_size_gb
  redis_version           = var.redis.redis_version
  network                 = var.host_vpc_self_link
  transit_encryption_mode = var.redis.transit_encryption_mode
  auth_enabled            = var.redis.auth_enabled
  redis_configs           = var.redis.redis_configs
  labels                  = var.labels

  depends_on = [module.apis]
}
