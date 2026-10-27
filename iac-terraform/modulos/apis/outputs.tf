output "enabled_apis" {
  description = "Lista de APIs habilitadas en el proyecto."
  value       = [for svc in google_project_service.apis : svc.service]
}
