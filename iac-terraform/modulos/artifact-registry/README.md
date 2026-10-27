# Módulo: Artifact Registry

Crea repositorios de Artifact Registry en GCP (`google_artifact_registry_repository`) con soporte para Docker, Helm y otros formatos, permisos IAM y políticas de limpieza automática de imágenes antiguas.

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

Estas variables deben configurarse como **Terraform Variables** en el workspace de TFC.

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `project_id` | `string` | ID del proyecto GCP donde se crean los repositorios |
| `region` | `string` | Región donde se alojan los repositorios (ej: `us-central1`) |
| `repositories` | `map(object)` | Mapa de repositorios a crear. La clave es el `repository_id`. Cada objeto acepta: `format` (`DOCKER`, `HELM`, `MAVEN`, `NPM`, etc.), `description`, `labels`, `readers` (lista de miembros IAM con rol lector), `writers` (lista de miembros IAM con rol escritor), `cleanup_policies` |

### Opcionales

Este módulo no tiene variables opcionales de nivel raíz. Toda la configuración se define dentro de cada entrada del mapa `repositories`.

> **Nota sobre `cleanup_policies`:** Las políticas de limpieza permiten eliminar automáticamente imágenes o artefactos antiguos según criterios como edad o número máximo de versiones retenidas. Esto evita el crecimiento ilimitado del almacenamiento y reduce costos.

---

## Outputs

| Output | Descripción |
|---|---|
| `repository_ids` | Mapa de `repository_id` → ID completo del repositorio en GCP |
| `repository_urls` | Mapa de `repository_id` → URL del repositorio (usada para push/pull de imágenes) |
| `repository_names` | Mapa de `repository_id` → nombre del recurso del repositorio |

---

## Ejemplo de uso como módulo

```hcl
module "artifact_registry" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/artifact-registry/v1.0"

  project_id = "mi-proyecto-001"
  region     = "us-central1"

  repositories = {
    "contenedores-produccion" = {
      format      = "DOCKER"
      description = "Imágenes de contenedores para producción"
      labels      = { ambiente = "produccion" }

      readers = [
        "serviceAccount:sa-gke-nodes@mi-proyecto-001.iam.gserviceaccount.com",
      ]
      writers = [
        "serviceAccount:sa-cicd@mi-proyecto-001.iam.gserviceaccount.com",
      ]

      cleanup_policies = {
        "eliminar-no-etiquetadas" = {
          action = "DELETE"
          condition = {
            tag_state  = "UNTAGGED"
            older_than = "2592000s" # 30 días
          }
        }
        "retener-ultimas-10" = {
          action = "KEEP"
          most_recent_versions = {
            keep_count = 10
          }
        }
      }
    }

    "helm-charts" = {
      format      = "HELM"
      description = "Charts de Helm para despliegues en GKE"
      labels      = { tipo = "helm" }
      readers     = ["group:equipo-plataforma@empresa.com"]
      writers     = ["serviceAccount:sa-cicd@mi-proyecto-001.iam.gserviceaccount.com"]
      cleanup_policies = {}
    }
  }
}
```
