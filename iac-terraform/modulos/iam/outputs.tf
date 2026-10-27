output "member" {
  description = "Identificador IAM completo de la cuenta (formato: tipo_cuenta:email)"
  value       = local.member
}

output "roles_otorgados" {
  description = "Lista de roles otorgados"
  value       = var.roles
}

output "tipo_recurso" {
  description = "Tipo de recurso al que se otorgaron los roles"
  value       = var.tipo_recurso
}

output "recurso_id" {
  description = "ID del recurso al que se otorgaron los roles"
  value       = var.recurso_id
}
