# Plantilla: apps

Cargas de trabajo del proyecto de aplicaciones, sobre la Shared VPC del host. **No crea red**: recibe los self-links de la VPC y de las subredes como variables.

## Componentes

| Componente | Flag | Default | Módulo |
|---|---|---|---|
| APIs del proyecto | — | siempre | `apis` |
| IAM de Shared VPC para los service agents | `enable_host_iam` | `true` | `iam` + recursos nativos |
| GKE Standard privado + node pools | `enable_gke` | `true` | `gke` |
| Artifact Registry | — | según mapa | `artifact-registry` |
| Cloud Run (direct VPC egress) | — | según mapa | `cloud-run` |
| Apigee X | `enable_apigee` | `false` | `apigee` |
| IAM de Apigee en el host | `enable_apigee_host_iam` | `false` | `iam` |

## IAM de Shared VPC

GCP exige estos permisos **antes** de crear las cargas; los módulos los declaran en `depends_on`:

| Service agent | Rol | Alcance |
|---|---|---|
| `service-<n>@container-engine-robot...` | `roles/container.hostServiceAgentUser` | Proyecto host |
| `service-<n>@container-engine-robot...` | `roles/compute.networkUser` | Subred de nodos GKE |
| `<n>@cloudservices.gserviceaccount.com` | `roles/compute.networkUser` | Subred de nodos GKE |
| `service-<n>@serverless-robot-prod...` | `roles/compute.networkUser` | Subred de Cloud Run |
| `service-<n>@gcp-sa-apigee...` | `roles/compute.networkUser` | Proyecto host |
| SAs de los node pools | `roles/container.defaultNodeServiceAccount` | Proyecto de servicio |

`compute.networkUser` se concede **a nivel de subred**, y solo sobre la subred que cada agent realmente usa.

## Notas de diseño

**Cloud Run usa direct VPC egress**, no VPC Access Connector: es el único modo que funciona en Shared VPC sin crear conectores en el proyecto de servicio. La subred se indica en `cloud_run_subnet_self_link` y cada instancia toma una IP de ahí.

**Apigee requiere dos applies.** La SA de Apigee no existe hasta que la organización está aprovisionada (~30 min):

1. `enable_apigee = true`, `enable_apigee_host_iam = false`
2. `enable_apigee_host_iam = true`

El peering de Apigee lo crea la plantilla host, así que el módulo se invoca con `create_service_networking = false` y el `/22` reservado se pasa como `ip_range` de la instancia.

**GKE.** `master_ipv4_cidr_block` es el `/28` del control plane y no puede solaparse con ninguna subred. Los nombres de `pods_range_name` y `services_range_name` deben coincidir exactamente con los rangos secundarios creados por el host.
