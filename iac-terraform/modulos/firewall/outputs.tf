output "firewall_rule_ids" {
  description = "Mapa nombre de regla → ID del recurso de firewall creado"
  value       = { for k, v in google_compute_firewall.this : k => v.id }
}

output "firewall_rule_self_links" {
  description = "Mapa nombre de regla → self-link del recurso de firewall creado"
  value       = { for k, v in google_compute_firewall.this : k => v.self_link }
}
