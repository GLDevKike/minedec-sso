resource "google_artifact_registry_repository" "this" {
  for_each = var.repositories

  project       = var.project_id
  location      = var.region
  repository_id = each.key
  description   = each.value.description
  format        = each.value.format
  labels        = each.value.labels

  dynamic "cleanup_policies" {
    for_each = each.value.cleanup_policies
    content {
      id     = cleanup_policies.key
      action = cleanup_policies.value.action

      dynamic "condition" {
        for_each = cleanup_policies.value.condition != null ? [cleanup_policies.value.condition] : []
        content {
          tag_state             = condition.value.tag_state
          older_than            = condition.value.older_than
          newer_than            = condition.value.newer_than
          tag_prefixes          = condition.value.tag_prefixes
          package_name_prefixes = condition.value.package_name_prefixes
        }
      }
    }
  }
}

resource "google_artifact_registry_repository_iam_member" "readers" {
  for_each = {
    for binding in flatten([
      for repo_key, repo_val in var.repositories : [
        for member in repo_val.readers : {
          key      = "${repo_key}--reader--${member}"
          repo_key = repo_key
          member   = member
        }
      ]
    ]) : binding.key => binding
  }

  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.this[each.value.repo_key].name
  role       = "roles/artifactregistry.reader"
  member     = each.value.member
}

resource "google_artifact_registry_repository_iam_member" "writers" {
  for_each = {
    for binding in flatten([
      for repo_key, repo_val in var.repositories : [
        for member in repo_val.writers : {
          key      = "${repo_key}--writer--${member}"
          repo_key = repo_key
          member   = member
        }
      ]
    ]) : binding.key => binding
  }

  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.this[each.value.repo_key].name
  role       = "roles/artifactregistry.writer"
  member     = each.value.member
}
