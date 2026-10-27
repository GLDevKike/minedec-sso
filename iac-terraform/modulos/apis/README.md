# Módulo: apis

Habilita una o más APIs de GCP en un proyecto (`google_project_service`).

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

Estas variables deben configurarse como **variables de entorno** (Environment Variables) en el workspace de TFC. Son necesarias para la autenticación dinámica con GCP mediante Workload Identity Federation.

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` para habilitar la autenticación dinámica |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP que ejecutará el plan/apply |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider (formato: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`) |

---

## Variables de Terraform en el Workspace

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `project_id` | `string` | ID del proyecto GCP donde se habilitarán las APIs |
| `apis` | `list(string)` | Lista de APIs a habilitar. Ver referencia de nombres abajo. |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `disable_on_destroy` | `bool` | `false` | Si `true`, deshabilita las APIs al ejecutar `terraform destroy`. Se recomienda dejarlo en `false` para no afectar otros recursos que puedan depender de ellas. |
| `disable_dependent_services` | `bool` | `false` | Si `true`, deshabilita también los servicios dependientes al hacer destroy. |

---

## Nombres de APIs más comunes en GCP

| API | Nombre del servicio |
|---|---|
| Compute Engine | `compute.googleapis.com` |
| Cloud Storage | `storage.googleapis.com` |
| BigQuery | `bigquery.googleapis.com` |
| Cloud Run | `run.googleapis.com` |
| GKE / Kubernetes | `container.googleapis.com` |
| Cloud Build | `cloudbuild.googleapis.com` |
| Artifact Registry | `artifactregistry.googleapis.com` |
| Cloud SQL | `sqladmin.googleapis.com` |
| Secret Manager | `secretmanager.googleapis.com` |
| IAM | `iam.googleapis.com` |
| Cloud DNS | `dns.googleapis.com` |
| Cloud Logging | `logging.googleapis.com` |
| Cloud Monitoring | `monitoring.googleapis.com` |
| VPC Access Connector | `vpcaccess.googleapis.com` |
| Service Networking | `servicenetworking.googleapis.com` |
| Network Connectivity (NCC) | `networkconnectivity.googleapis.com` |
| Apigee | `apigee.googleapis.com` |
| Cloud KMS | `cloudkms.googleapis.com` |
| Resource Manager | `cloudresourcemanager.googleapis.com` |
| Billing | `cloudbilling.googleapis.com` |

> El nombre completo de cualquier API se puede consultar en [https://console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library) seleccionando el servicio y revisando el campo **Service name**.

---

## Ejemplo de uso como módulo

```hcl
module "apis" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos base/apis/v1.0"

  project_id = module.proyecto.project_id

  apis = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ]
}
```

---

## Notas importantes

- **`disable_on_destroy = false` (recomendado):** Deshabilitar una API puede interrumpir servicios en producción que dependen de ella. Solo usar `true` en entornos de desarrollo o cuando se esté eliminando el proyecto completo.
- **Orden de dependencia:** Si el proyecto se crea en el mismo workspace con el módulo `proyecto`, agregar `depends_on = [module.proyecto]` para asegurarse de que el proyecto exista antes de habilitar las APIs.
- **Tiempo de habilitación:** GCP puede tardar hasta 2 minutos en propagar la habilitación de una API. Si un recurso dependiente falla con `API not enabled`, volver a ejecutar `terraform apply`.
