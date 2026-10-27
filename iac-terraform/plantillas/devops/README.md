# Plantilla: devops

Tooling de CI/CD: almacenamiento de Infrastructure Manager, repositorios de imágenes y la VM de GitLab self-managed.

## Componentes

| Componente | Flag | Default | Módulo |
|---|---|---|---|
| APIs del proyecto | — | siempre | `apis` |
| Buckets de GCS | — | según mapa | `cloud-storage` |
| Artifact Registry | — | según mapa | `artifact-registry` |
| Service account de la VM + roles | `enable_gitlab_vm` | `false` | `iam` + recursos nativos |
| VM de GitLab (sin IP pública) + disco de datos | `enable_gitlab_vm` | `false` | recursos nativos |

## VM de GitLab

La instancia se crea en la subred devops de la Shared VPC **sin IP pública** (no hay bloque `access_config`):

- La salida a internet va por el **Cloud NAT del host**.
- El acceso administrativo es por **IAP** — la regla de firewall que permite SSH desde `35.235.240.0/20` la crea la plantilla host.
- Las claves SSH de proyecto quedan bloqueadas: la metadata fija `enable-oslogin = TRUE`.
- Shielded VM con secure boot, vTPM e integrity monitoring.

El `subnetwork` se pasa como self-link completo, que ya identifica el proyecto host; no se usa `subnetwork_project` porque combinarlos produce diffs permanentes.

`data_disk_size_gb = 0` desactiva el disco de datos adicional. El tipo de máquina por defecto es `e2-standard-4`: GitLab Omnibus necesita al menos 4 vCPU y 8 GB para uso real.

Está apagada por defecto porque es el recurso de mayor costo fijo del stack y en muchos casos la instancia ya existe fuera de este código.

## Buckets

Aquí se declara, entre otros, el bucket de artefactos y state de Infrastructure Manager. **Ese bucket ya existe como prerrequisito**, así que el primer apply necesita importarlo (`gcloud infra-manager deployments apply --import-existing-resources`) o quitarlo del `terraform.tfvars`.
