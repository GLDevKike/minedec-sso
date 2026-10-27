locals {
  member    = "${var.tipo_cuenta}:${var.email}"
  folder_id = "folders/${var.recurso_id}"
}

resource "google_project_iam_member" "this" {
  for_each = var.tipo_recurso == "proyecto" ? toset(var.roles) : toset([])

  project = var.recurso_id
  role    = each.value
  member  = local.member
}

resource "google_folder_iam_member" "this" {
  for_each = var.tipo_recurso == "carpeta" ? toset(var.roles) : toset([])

  folder = local.folder_id
  role   = each.value
  member = local.member
}

resource "google_organization_iam_member" "this" {
  for_each = var.tipo_recurso == "organizacion" ? toset(var.roles) : toset([])

  org_id = var.recurso_id
  role   = each.value
  member = local.member
}
