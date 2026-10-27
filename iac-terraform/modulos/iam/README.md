# Módulo: iam

Otorga uno o más roles IAM de GCP a una cuenta (usuario, service account, grupo o dominio) sobre un **proyecto**, **carpeta** u **organización**.

Internamente crea un `google_project_iam_member`, `google_folder_iam_member` o `google_organization_iam_member` por cada rol, según el `tipo_recurso` indicado.

---

## Variables de entorno requeridas en el Workspace de Terraform Cloud

| Variable | Tipo | Descripción |
|---|---|---|
| `TFC_GCP_PROVIDER_AUTH` | env | Debe tener el valor `true` |
| `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | env | Email de la service account de GCP |
| `TFC_GCP_WORKLOAD_PROVIDER_NAME` | env | Nombre completo del Workload Identity Provider |

---

## Variables de Terraform en el Workspace

### Obligatorias

| Variable | Tipo | Descripción |
|---|---|---|
| `tipo_recurso` | `string` | Recurso sobre el que se otorga el IAM: `proyecto`, `carpeta` u `organizacion` |
| `recurso_id` | `string` | ID del recurso (ver tabla de formatos abajo) |
| `email` | `string` | Correo de la cuenta a la que se otorgan los roles |
| `roles` | `list(string)` | Lista de roles IAM. Usar formato completo: `roles/viewer`, `roles/storage.admin`, etc. |

### Opcionales

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `tipo_cuenta` | `string` | `"serviceAccount"` | Tipo de cuenta: `user`, `serviceAccount`, `group` o `domain` |

---

## Formato del `recurso_id` por tipo

| `tipo_recurso` | Formato esperado | Ejemplo |
|---|---|---|
| `proyecto` | Project ID (string) | `"mi-proyecto-001"` |
| `carpeta` | ID numérico (sin prefijo) | `"123456789"` |
| `organizacion` | ID numérico | `"123456789012"` |

> Para carpetas, el módulo agrega automáticamente el prefijo `folders/` que requiere el provider de GCP.

---

## Formato del `member` IAM

El módulo construye el identificador IAM completo concatenando `tipo_cuenta:email`:

| `tipo_cuenta` | Ejemplo de `member` resultante |
|---|---|
| `serviceAccount` | `serviceAccount:sa@mi-proyecto.iam.gserviceaccount.com` |
| `user` | `user:juan@empresa.com` |
| `group` | `group:equipo-devops@empresa.com` |
| `domain` | `domain:empresa.com` |

---

## Roles IAM comunes en GCP

| Rol | Descripción |
|---|---|
| `roles/viewer` | Lectura en todos los recursos |
| `roles/editor` | Lectura y escritura (no IAM) |
| `roles/owner` | Control total incluyendo IAM |
| `roles/iam.serviceAccountUser` | Usar service accounts |
| `roles/iam.serviceAccountTokenCreator` | Crear tokens para impersonación |
| `roles/compute.networkAdmin` | Administrar redes VPC |
| `roles/compute.networkViewer` | Ver recursos de red |
| `roles/container.admin` | Administrar GKE |
| `roles/storage.admin` | Administrar Cloud Storage |
| `roles/storage.objectViewer` | Leer objetos de Storage |
| `roles/cloudsql.client` | Conectarse a Cloud SQL |
| `roles/secretmanager.secretAccessor` | Leer secretos |
| `roles/logging.logWriter` | Escribir logs |
| `roles/monitoring.metricWriter` | Escribir métricas |
| `roles/resourcemanager.projectCreator` | Crear proyectos |
| `roles/resourcemanager.folderAdmin` | Administrar carpetas |
| `roles/billing.user` | Asociar proyectos a billing |

---

## Ejemplos de uso

```hcl
# Service account con acceso a un proyecto
module "iam_sa_proyecto" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/iam/v1.0"

  tipo_recurso = "proyecto"
  recurso_id   = "mi-proyecto-backend-a1b2"
  email        = "deployer@mi-proyecto-host.iam.gserviceaccount.com"
  tipo_cuenta  = "serviceAccount"

  roles = [
    "roles/container.developer",
    "roles/storage.objectViewer",
  ]
}

# Grupo de usuarios con acceso de lectura a una carpeta
module "iam_grupo_carpeta" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/iam/v1.0"

  tipo_recurso = "carpeta"
  recurso_id   = "123456789"
  email        = "equipo-dev@empresa.com"
  tipo_cuenta  = "group"

  roles = [
    "roles/viewer",
    "roles/logging.viewer",
  ]
}

# Service account con permisos de creación de proyectos en la organización
module "iam_sa_org" {
  source = "git::https://github.com/<org>/<repo>.git//Modulos-base/iam/v1.0"

  tipo_recurso = "organizacion"
  recurso_id   = "123456789012"
  email        = "tfc-sa@mi-proyecto-seed.iam.gserviceaccount.com"
  tipo_cuenta  = "serviceAccount"

  roles = [
    "roles/resourcemanager.projectCreator",
    "roles/resourcemanager.folderViewer",
    "roles/billing.user",
  ]
}
```
