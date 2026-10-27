output "org_id" {
  description = "ID de la organización Apigee (igual al project_id)"
  value       = google_apigee_organization.this.id
}

output "org_name" {
  description = "Nombre completo del recurso de la organización Apigee"
  value       = google_apigee_organization.this.name
}

output "apigee_endpoint" {
  description = "Endpoint de la organización Apigee para llamadas a la API de gestión"
  value       = "https://apigee.googleapis.com/v1/organizations/${var.project_id}"
}

# ─── Instancias ───────────────────────────────────────────────────────────────

output "instance_ids" {
  description = "Mapa de nombre de instancia a ID completo del recurso"
  value       = { for k, v in google_apigee_instance.instances : k => v.id }
}

output "instance_hosts" {
  description = "Mapa de nombre de instancia a IP del host (endpoint interno de la instancia)"
  value       = { for k, v in google_apigee_instance.instances : k => v.host }
}

output "instance_ports" {
  description = "Mapa de nombre de instancia a puerto de escucha"
  value       = { for k, v in google_apigee_instance.instances : k => v.port }
}

output "psc_service_attachments" {
  description = "Mapa de nombre de instancia → URI del PSC service attachment. Requerido por el PSC NEG para conectar el Load Balancer a Apigee."
  value       = { for k, v in google_apigee_instance.instances : k => v.service_attachment }
}

# ─── Ambientes ────────────────────────────────────────────────────────────────

output "environment_ids" {
  description = "Mapa de nombre de ambiente a ID del recurso"
  value       = { for k, v in google_apigee_environment.environments : k => v.id }
}

# ─── Service Networking ───────────────────────────────────────────────────────

output "service_networking_peering" {
  description = "Nombre del peering de Service Networking creado para Apigee (null si create_service_networking = false)"
  value       = var.create_service_networking ? google_service_networking_connection.apigee_vpc_connection[0].peering : null
}

# ─── Environment Groups ───────────────────────────────────────────────────────

output "envgroup_ids" {
  description = "Mapa de nombre de Environment Group a ID completo del recurso"
  value       = { for k, v in google_apigee_envgroup.envgroups : k => v.id }
}

output "envgroup_hostnames" {
  description = "Mapa de nombre de Environment Group a sus hostnames (google_apigee_envgroup no expone un atributo de estado)"
  value       = { for k, v in google_apigee_envgroup.envgroups : k => v.hostnames }
}

# ─── Endpoint Attachments (PSC) ───────────────────────────────────────────────

output "endpoint_attachment_hosts" {
  description = "Mapa de nombre de Endpoint Attachment a IP del host asignada por PSC. Usar como target en proxies de API."
  value       = { for k, v in google_apigee_endpoint_attachment.endpoint_attachments : k => v.host }
}

output "endpoint_attachment_connection_state" {
  description = "Mapa de nombre de Endpoint Attachment a estado de la conexión PSC"
  value       = { for k, v in google_apigee_endpoint_attachment.endpoint_attachments : k => v.connection_state }
}

# ─── NAT Addresses ────────────────────────────────────────────────────────────

output "nat_ips" {
  description = "Mapa de nombre de NAT Address a IP pública asignada. Usar para listas de permitidos en servicios backend."
  value       = { for k, v in google_apigee_nat_address.nat_addresses : k => v.ip_address }
}
