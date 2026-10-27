resource "google_storage_bucket" "this" {
  name          = var.name
  project       = var.project_id
  location      = var.location
  storage_class = var.storage_class

  uniform_bucket_level_access = true
  public_access_prevention    = var.public_read ? "inherited" : "enforced"

  dynamic "versioning" {
    for_each = var.versioning_enabled ? [1] : []
    content {
      enabled = true
    }
  }

  dynamic "website" {
    for_each = var.website_main_page != null ? [1] : []
    content {
      main_page_suffix = var.website_main_page
      not_found_page   = var.website_not_found_page
    }
  }

  dynamic "cors" {
    for_each = var.cors_origins != null ? [1] : []
    content {
      origin          = var.cors_origins
      method          = var.cors_methods
      response_header = var.cors_response_headers
      max_age_seconds = var.cors_max_age_seconds
    }
  }

  dynamic "encryption" {
    for_each = var.kms_key_name != null ? [1] : []
    content {
      default_kms_key_name = var.kms_key_name
    }
  }

  dynamic "retention_policy" {
    for_each = var.retention_policy != null ? [var.retention_policy] : []
    content {
      retention_period = retention_policy.value.retention_period
      is_locked        = retention_policy.value.is_locked
    }
  }

  dynamic "lifecycle_rule" {
    for_each = var.lifecycle_rules
    content {
      action {
        type          = lifecycle_rule.value.action_type
        storage_class = lifecycle_rule.value.storage_class
      }
      condition {
        age                   = lifecycle_rule.value.age_days
        with_state            = lifecycle_rule.value.with_state
        num_newer_versions    = lifecycle_rule.value.num_newer_versions
        matches_storage_class = lifecycle_rule.value.matches_storage_class
      }
    }
  }

  labels = var.labels

  force_destroy = var.force_destroy
}

resource "google_storage_bucket_iam_member" "public_read" {
  count  = var.public_read ? 1 : 0
  bucket = google_storage_bucket.this.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
