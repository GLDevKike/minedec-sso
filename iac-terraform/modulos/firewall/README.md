# Módulo: Firewall

Crea reglas de firewall (`google_compute_firewall`) sobre una VPC a partir de un mapa genérico de reglas. Pensado para VPCs "standalone" (creadas por la misma plantilla) donde no hay reglas predefinidas — el caller declara exactamente las reglas que necesita.

---

## Variables de Terraform

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `project_id` | `string` | ID del proyecto GCP donde se crean las reglas |
| `network` | `string` | Self-link o nombre de la VPC a la que se aplican las reglas |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `rules` | `map(object)` | `{}` | Mapa de reglas de firewall. La clave es el nombre de la regla. Ver campos abajo. |

### Campos de cada entrada de `rules`

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `direction` | `string` | `"INGRESS"` | `INGRESS` o `EGRESS` |
| `priority` | `number` | `1000` | Prioridad — menor número = mayor prioridad |
| `description` | `string` | `""` | Descripción de la regla |
| `source_ranges` | `list(string)` | `[]` | Rangos CIDR de origen. Solo aplica si `direction = INGRESS` |
| `destination_ranges` | `list(string)` | `[]` | Rangos CIDR de destino. Solo aplica si `direction = EGRESS` |
| `target_tags` | `list(string)` | `[]` | Network tags de las instancias destino |
| `source_tags` | `list(string)` | `[]` | Network tags de las instancias origen. Solo aplica si `direction = INGRESS` |
| `allow` | `list(object({ protocol, ports }))` | `[]` | Protocolos/puertos a permitir. `ports` opcional (vacío = todos los puertos del protocolo) |
| `deny` | `list(object({ protocol, ports }))` | `[]` | Protocolos/puertos a denegar |

---

## Outputs

| Output | Descripción |
|---|---|
| `firewall_rule_ids` | Mapa `nombre de regla → ID` de cada regla creada |
| `firewall_rule_self_links` | Mapa `nombre de regla → self-link` de cada regla creada |

---

## Ejemplo de uso como módulo

```hcl
module "firewall" {
  source = "../../../../Modulos-base/firewall/v1.0"

  project_id = var.project_id
  network    = module.vpc.self_link

  rules = {
    "allow-internal" = {
      description   = "Tráfico interno entre subredes"
      source_ranges = ["10.10.0.0/16"]
      allow         = [{ protocol = "all" }]
    }
    "allow-health-checks" = {
      description   = "Health checks de Google Cloud (requerido por Load Balancers)"
      source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
      allow         = [{ protocol = "tcp" }]
    }
    "allow-iap-ssh" = {
      description   = "SSH vía Identity-Aware Proxy"
      source_ranges = ["35.235.240.0/20"]
      allow         = [{ protocol = "tcp", ports = ["22"] }]
    }
  }
}
```
