# Infrastructure Manager ejecuta Terraform 1.5.7: la restricción fija la serie 1.5
# para que un plan local use exactamente la misma versión.
#
# No se declara backend: Infra Manager guarda el state en su bucket de artefactos.
terraform {
  required_version = ">= 1.5.0, < 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.41.0, < 7.0.0"
    }
  }
}
