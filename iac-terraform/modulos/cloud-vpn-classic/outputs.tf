output "gateway_id" {
  description = "ID del target VPN gateway."
  value       = google_compute_vpn_gateway.this.id
}

output "gateway_self_link" {
  description = "Self-link del target VPN gateway."
  value       = google_compute_vpn_gateway.this.self_link
}

output "gateway_ip_address" {
  description = "Dirección IP pública del gateway. Es el valor que debe configurar el extremo remoto como peer."
  value       = data.google_compute_address.gateway.address
}

output "tunnel_id" {
  description = "ID del túnel VPN."
  value       = google_compute_vpn_tunnel.this.id
}

output "tunnel_self_link" {
  description = "Self-link del túnel VPN."
  value       = google_compute_vpn_tunnel.this.self_link
}

output "tunnel_detailed_status" {
  description = "Estado detallado del túnel reportado por GCP (útil para diagnosticar fallos de fase 1 / fase 2)."
  value       = google_compute_vpn_tunnel.this.detailed_status
}

output "forwarding_rule_names" {
  description = "Nombres de las tres forwarding rules creadas (ESP, UDP 500, UDP 4500)."
  value = [
    google_compute_forwarding_rule.esp.name,
    google_compute_forwarding_rule.udp500.name,
    google_compute_forwarding_rule.udp4500.name,
  ]
}

output "route_names" {
  description = "Mapa CIDR remoto → nombre de la ruta estática creada hacia el túnel."
  value       = { for k, v in google_compute_route.remote : k => v.name }
}

output "remote_cidrs" {
  description = "CIDR remotos configurados en el túnel."
  value       = var.remote_cidrs
}
