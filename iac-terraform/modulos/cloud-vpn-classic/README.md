# Módulo: cloud-vpn-classic

Crea una **Cloud VPN clásica route-based** (sin HA VPN y sin BGP) sobre una dirección IP externa regional ya reservada.

Se usa cuando el extremo remoto solo acepta un peer con una IP estática concreta y no soporta (o no se quiere operar) BGP. Si el escenario admite HA VPN con BGP, usar el módulo `cloud-vpn` en su lugar: la VPN clásica no tiene SLA de 99.99 % y Google la considera legado.

## Recursos que crea

| Recurso | Cantidad | Nota |
|---|---|---|
| `google_compute_vpn_gateway` | 1 | Target VPN gateway (clásico) |
| `google_compute_forwarding_rule` | 3 | ESP, UDP 500 (IKE), UDP 4500 (NAT-T) |
| `google_compute_vpn_tunnel` | 1 | Con `cipher_suite` opcional, creado con `google-beta` |
| `google_compute_route` | 1 por CIDR remoto | `next_hop_vpn_tunnel`, sin BGP |
| `google_compute_firewall` | 0–2 | Ingreso desde / egreso hacia los CIDR remotos |

La dirección IP externa **no se crea**: se consulta con `data "google_compute_address"` a partir de `external_address_name`. Así el peer remoto no necesita reconfigurar nada si la VPN se recrea.

Las tres forwarding rules deben existir antes que el túnel (requisito de la API de GCP); el módulo ya lo resuelve con `depends_on`.

## Variables obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `name` | `string` | Nombre base (prefijo de gateway, forwarding rules, túnel y rutas) |
| `project_id` | `string` | Proyecto donde vive la VPC (proyecto host si hay Shared VPC) |
| `region` | `string` | Región del gateway; debe coincidir con la de la IP reservada |
| `network` | `string` | Self-link o nombre de la VPC |
| `external_address_name` | `string` | Nombre de la IP externa regional ya reservada |
| `peer_ip` | `string` | IP pública del gateway remoto |
| `shared_secret` | `string` (sensible) | PSK de IKE — ver sección de seguridad |

## Variables opcionales relevantes

| Variable | Default | Descripción |
|---|---|---|
| `ike_version` | `2` | Versión de IKE (1 o 2) |
| `local_traffic_selector` | `["0.0.0.0/0"]` | Selector local; en route-based se deja abierto |
| `remote_traffic_selector` | `["0.0.0.0/0"]` | Selector remoto; en route-based se deja abierto |
| `enable_cipher_suite` | `true` | Fija los algoritmos de fase 1 / fase 2 |
| `cipher_suite` | AES-CBC-256 / SHA2-256 / Group-20 | Algoritmos negociados |
| `remote_cidrs` | `[]` | CIDR remotos → una ruta estática por cada uno |
| `route_priority` | `1000` | Prioridad de las rutas estáticas |
| `enable_firewall_rules` | `true` | Habilita las reglas de firewall del módulo |
| `ingress_allow` | `[]` | Protocolos/puertos de entrada (vacío = sin regla) |
| `egress_allow` | `[]` | Protocolos/puertos de salida (vacío = sin regla) |
| `target_tags` | `[]` | Restringe las reglas a instancias con esos tags |

## Cifrado: requisito de provider

El bloque `cipher_suite` de `google_compute_vpn_tunnel` **no existe en el provider `google` 6.x** (llegó al provider GA en la serie 7.x). Sí existe en **`google-beta` desde 6.41.0**, que es lo que usa este módulo para el recurso del túnel.

Por eso la raíz de despliegue debe declarar y configurar también el provider `google-beta`:

```hcl
provider "google-beta" {
  project = var.project_id
  region  = var.region
}
```

Si se fija el provider en una versión anterior a 6.41.0, hay que poner `enable_cipher_suite = false` y configurar los algoritmos manualmente en la consola o dejar que GCP los negocie por defecto.

Valores por defecto del módulo:

| Fase | Parámetro | Valor |
|---|---|---|
| Fase 1 | `encryption` | `AES-CBC-256` |
| Fase 1 | `integrity` | `HMAC-SHA2-256-128` |
| Fase 1 | `prf` | `PRF-HMAC-SHA2-256` |
| Fase 1 | `dh` | `Group-20` |
| Fase 2 | `encryption` | `AES-CBC-256` |
| Fase 2 | `integrity` | `HMAC-SHA2-256-128` |
| Fase 2 | `pfs` | `Group-20` |

> Los lifetimes de fase 1 y fase 2 **no son configurables** desde la API de GCP: Cloud VPN usa 36000 s (fase 1) y 10800 s (fase 2). El extremo remoto debe igualarlos.

## Seguridad: la PSK

La PSK nunca debe estar en el repositorio ni en un `.tfvars`. El patrón correcto es leerla en tiempo de ejecución desde Secret Manager:

```hcl
data "google_secret_manager_secret_version" "vpn_psk" {
  secret  = "vpn-dinardap-psk"
  project = var.project_id
}

module "vpn" {
  source        = "../../modulos/cloud-vpn-classic"
  shared_secret = data.google_secret_manager_secret_version.vpn_psk.secret_data
  # ...
}
```

Aun así, **el valor queda escrito en el state de Terraform**. El bucket que guarda el state debe ser privado y con acceso restringido al service account de despliegue.

## Ejemplo de uso

```hcl
module "vpn_dinardap" {
  source = "../../modulos/cloud-vpn-classic"

  name       = "vpn-dinardap"
  project_id = "dnr-001-sha-network"
  region     = "us-east1"
  network    = module.vpc.self_link

  external_address_name = "test-ip-sp"
  peer_ip               = "190.152.45.205"
  shared_secret         = data.google_secret_manager_secret_version.vpn_psk.secret_data

  remote_cidrs = ["192.168.148.96/32"]

  ingress_allow = [
    { protocol = "tcp", ports = ["443"] },
    { protocol = "icmp" },
  ]
  egress_allow = [
    { protocol = "tcp", ports = ["443"] },
    { protocol = "icmp" },
  ]
}
```
