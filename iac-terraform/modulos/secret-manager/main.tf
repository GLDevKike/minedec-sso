locals {
  secret_accessor_pairs = {
    for pair in setproduct(toset(var.secret_ids), toset(var.accessor_members)) :
    "${pair[0]}--${pair[1]}" => {
      secret_id = pair[0]
      member    = pair[1]
    }
  }
}

resource "google_secret_manager_secret" "this" {
  for_each = toset(var.secret_ids)

  project   = var.project_id
  secret_id = each.value

  labels = merge(var.labels, {
    rotacion_max_dias = "90"
    cifrado           = "aes-256-gcm"
  })

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = local.secret_accessor_pairs

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.value.secret_id].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}
