# Módulo: apigee v2.0

Despliega **Apigee X** en GCP. Extiende v1.0 añadiendo soporte para **Environment Groups** (routing de tráfico externo vía hostnames), **Endpoint Attachments PSC** (conectividad hacia backends en otras VPCs) y **NAT Addresses** (IPs de egreso estáticas).

> **Tiempo de aprovisionamiento:** La organización Apigee y cada instancia tardan entre 20 y 40 minutos. Es normal que el `apply` quede esperando en estos recursos — no es un error.

---

## v1.0 vs v2.0 — cuándo usar cada uno

| Necesidad | Usar |
|---|---|
| Apigee básico: org + instancia + ambiente + LB via PSC NEG | `v1.0` |
| Múltiples hostnames externos gestionados desde Terraform | `v2.0` |
| Apigee debe conectarse a backends en otras VPCs sin tráfico público | `v2.0` |
| IPs de egreso fijas para allowlists en servicios externos | `v2.0` |

La **plantilla `digital-apigee/v1.0`** usa este módulo para agregar el stack completo de exposición a internet (LB global, PSC NEG, SSL policy, DNS). Ver [`Plantillas/digital/digital-apigee/README.md`](../../../Plantillas/digital/digital-apigee/README.md).

---

## Recursos creados

| Recurso | Condición |
|---|---|
| `google_compute_global_address` (rango IP peering) | `create_service_networking = true` |
| `google_service_networking_connection` | `create_service_networking = true` |
| `google_compute_network_peering_routes_config` | `create_service_networking = true` |
| `google_apigee_organization` | Siempre |
| `google_apigee_instance` | Una por entrada en `var.instances` |
| `google_apigee_environment` | Una por entrada en `var.environments` |
| `google_apigee_instance_attachment` | Una por cada par instancia-ambiente |
| `google_apigee_envgroup` | Una por entrada en `var.envgroups` |
| `google_apigee_envgroup_attachment` | Una por cada par envgroup-ambiente |
| `google_apigee_endpoint_attachment` | Una por entrada en `var.endpoint_attachments` |
| `google_apigee_nat_address` | Una por entrada en `var.nat_addresses` |

---

## Variables de entorno requeridas en Terraform Cloud

| Variable | Descripción |
|---|---|
| `TFC_GCP_PROVIDER_AUTH` | `true` |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | SA con `roles/apigee.admin` en el proyecto |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | Nombre completo del Workload Identity Provider |

### APIs requeridas

```
apigee.googleapis.com
servicenetworking.googleapis.com
compute.googleapis.com
cloudkms.googleapis.com    (solo si se usa CMEK)
```

---

## Variables de Terraform

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `project_id` | `string` | ID del proyecto GCP |
| `nombre` | `string` | Nombre base para el rango IP del peering |
| `network` | `string` | Self-link de la VPC autorizada |
| `analytics_region` | `string` | Región para datos de analítica (ej: `us-central1`) |
| `instances` | `map(object)` | Instancias de runtime por región |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `billing_type` | `string` | `"PAYG"` | `PAYG`, `SUBSCRIPTION` o `EVALUATION`. Ver guía abajo. |
| `runtime_type` | `string` | `"CLOUD"` | `CLOUD` (Apigee X) o `HYBRID` |
| `description` | `string` | `""` | Descripción de la organización |
| `cmek_key_name` | `string` | `null` | Clave Cloud KMS para CMEK |
| `create_service_networking` | `bool` | `true` | `false` si PSA ya existe en la VPC |
| `peering_prefix_length` | `number` | `22` | Prefijo del rango PSA (/22 = 1024 IPs) |
| `environments` | `map(object)` | `{}` | Ambientes a crear |
| `envgroups` | `map(object)` | `{}` | Environment Groups con hostnames |
| `endpoint_attachments` | `map(object)` | `{}` | Endpoint Attachments PSC hacia backends |
| `nat_addresses` | `map(object)` | `{}` | NAT Addresses para IPs de egreso estáticas |

### Campos de `instances`

| Campo | Requerido | Default | Descripción |
|---|---|---|---|
| `location` | ✅ | — | Región (ej: `us-central1`) |
| `description` | — | `""` | Descripción |
| `ip_range` | — | `null` | CIDR /22. Null = asignación automática |
| `peering_cidr_range` | — | `"SLASH_22"` | `SLASH_16`, `SLASH_20` o `SLASH_22` |
| `disk_encryption_key_name` | — | `null` | Clave KMS para cifrado de disco |
| `environments` | — | `[]` | Ambientes a adjuntar a esta instancia |

### Campos de `environments`

| Campo | Requerido | Default | Descripción |
|---|---|---|---|
| `type` | — | `"BASE"` | `BASE`, `INTERMEDIATE` o `COMPREHENSIVE`. Ver guía abajo. |
| `description` | — | `""` | Descripción |
| `min_node_count` | — | `null` | MPs mínimos |
| `max_node_count` | — | `null` | MPs máximos |

### Campos de `envgroups`

| Campo | Requerido | Descripción |
|---|---|---|
| `hostnames` | ✅ | FQDNs del grupo (ej: `["api.empresa.com"]`) |
| `environments` | — | Ambientes adjuntos al grupo |

### Campos de `endpoint_attachments`

| Campo | Requerido | Descripción |
|---|---|---|
| `service_attachment` | ✅ | URI del Service Attachment del productor PSC |
| `location` | ✅ | Región del endpoint |

### Campos de `nat_addresses`

| Campo | Requerido | Descripción |
|---|---|---|
| `instance_name` | ✅ | Clave de la instancia en `var.instances` |

---

## Outputs

| Output | Descripción |
|---|---|
| `org_id` | ID de la organización Apigee |
| `org_name` | Nombre completo del recurso |
| `apigee_endpoint` | URL base de la API de gestión |
| `instance_ids` | Mapa `nombre → ID` de cada instancia |
| `instance_hosts` | Mapa `nombre → IP host` de cada instancia |
| `instance_ports` | Mapa `nombre → puerto` de cada instancia |
| `psc_service_attachments` | Mapa `nombre → URI del PSC service attachment`. Usado por `psc-neg/v1.0` para conectar el Load Balancer a Apigee. |
| `environment_ids` | Mapa `nombre → ID` de cada ambiente |
| `service_networking_peering` | Nombre del peering PSA creado |
| `envgroup_ids` | Mapa `nombre → ID` de cada Environment Group |
| `envgroup_hostnames` | Mapa `nombre → hostnames` de cada Environment Group |
| `endpoint_attachment_hosts` | Mapa `nombre → IP PSC` de cada Endpoint Attachment. Usar como TargetServer en proxies. |
| `endpoint_attachment_connection_state` | Mapa `nombre → estado PSC` |
| `nat_ips` | Mapa `nombre → IP pública` de cada NAT Address. Registrar en allowlists de backends externos. |

---

## Ejemplo de uso

```hcl
module "apigee" {
  source = "git::https://git.sitimapa.co/grupo-mariposa/mar-iac-interna/modulos-y-plantillas.git//Modulos-base/apigee/v2.0?ref=develop"

  project_id       = "mar-digital-apigee-prod-a1b2"
  nombre           = "apigee-prod"
  network          = "projects/mar-digital-host-prod-c3d4/global/networks/vpc-digital-prod"
  analytics_region = "us-central1"
  billing_type     = "PAYG"

  instances = {
    "instance-uc1" = {
      location     = "us-central1"
      ip_range     = "10.5.0.0/22"
      environments = ["prod"]
    }
  }

  environments = {
    "prod" = {
      type           = "COMPREHENSIVE"
      min_node_count = 2
      max_node_count = 10
    }
  }

  envgroups = {
    "eg-prod" = {
      hostnames    = ["api.empresa.com", "api-v2.empresa.com"]
      environments = ["prod"]
    }
  }

  endpoint_attachments = {
    "ea-backend-pagos" = {
      location           = "us-central1"
      service_attachment = "projects/mar-shared/regions/us-central1/serviceAttachments/sa-pagos"
    }
  }

  nat_addresses = {
    "nat-uc1" = { instance_name = "instance-uc1" }
  }
}
```

Ver `terraform.tfvars.example` para referencia completa por ambiente (dev / staging / prod).

---

## Notas importantes

- **Una organización por proyecto:** Apigee permite solo una organización por proyecto GCP.
- **PSA:** Si la VPC ya tiene PSA configurado, usar `create_service_networking = false`.
- **Environment Groups y DNS:** Los hostnames del envgroup necesitan registros DNS apuntando al Load Balancer. Este módulo no gestiona el LB ni el DNS — usar `psc-neg/v1.0`, `ssl-policy/v1.0` y `cloud-dns/v1.0`, o la plantilla `digital-apigee/v1.0` que los incluye.
- **Endpoint Attachments:** El productor PSC debe tener el proyecto Apigee en su lista de proyectos permitidos antes del apply.
- **NAT Addresses:** La IP se activa automáticamente tras el apply. Puede tardar algunos minutos adicionales.
- **`EVALUATION`:** 60 días, sin SLA, máximo 1 instancia, sin envgroups personalizados.
- **Migración desde v1.0:** Org, instancias, ambientes y attachments se importan automáticamente. Los nuevos recursos (envgroups, endpoint_attachments, nat_addresses) se crean en el mismo apply.

---

## Guía de decisión: `billing_type`

El `billing_type` **no se puede cambiar sin destruir y recrear la organización**. Elegirlo correctamente desde el inicio evita downtime.

| Característica | `EVALUATION` | `PAYG` | `SUBSCRIPTION` |
|---|---|---|---|
| **Duración** | 60 días | Indefinido | Según contrato |
| **Costo** | Gratuito | Por nodo-hora + llamadas API | Fijo mensual |
| **Ambientes** | 1 | Ilimitados | Según contrato |
| **Instancias** | 1 | Ilimitadas (pagadas) | Según contrato |
| **SLA** | Sin SLA | 99.99% | 99.99% |
| **Multi-región** | No | Sí | Sí |
| **CMEK** | No | Sí | Sí |
| **Caso de uso** | PoC / demos | Dev, staging, prod | Prod con volumen alto predecible |

### ⚠️ Proceso para cambiar `billing_type`

1. Exportar proxies y configuraciones (backup vía API de Apigee).
2. `terraform destroy` — elimina la organización y todos sus recursos.
3. Actualizar `billing_type` en el tfvars.
4. `terraform apply` — recrea desde cero.
5. Reimportar proxies.

---

## Guía de decisión: `environments.type` y `max_node_count`

Los **Message Processors (MPs)** son los nodos que ejecutan los proxies en tiempo real. El tipo de ambiente controla su autoscaling.

| Tipo | Autoscaling | MPs | Uso |
|---|---|---|---|
| `BASE` | No | 1 fijo | Desarrollo, demos |
| `INTERMEDIATE` | Sí (1–3) | 1 a 3 | Staging, pre-producción |
| `COMPREHENSIVE` | Sí (configurable) | `min` a `max` | Producción |

### Referencia orientativa de `max_node_count`

| TPS sostenido | `min_node_count` | `max_node_count` |
|---|---|---|
| < 100 | 1 | 2 |
| 100 – 500 | 2 | 4 |
| 500 – 2000 | 2 | 8 |
| > 2000 | 4 | 15+ |

> El TPS real por nodo depende de la complejidad de las políticas del proxy. Una validación JWT consume significativamente más que un pass-through.

### ⚠️ Cambiar `type` después del primer apply

- **`BASE` → `INTERMEDIATE`/`COMPREHENSIVE`:** Apigee provisiona nodos adicionales. Hay un período sin nueva capacidad. En producción puede causar degradación si coincide con un pico.
- **`COMPREHENSIVE` → `BASE`:** Termina nodos. Las peticiones en vuelo pueden fallar. **Nunca en producción sin ventana de mantenimiento.**
- **Cambiar solo `min_node_count`/`max_node_count`:** Seguro, se aplica gradualmente.
