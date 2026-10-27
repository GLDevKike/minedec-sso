terraform {
  required_version = ">= 1.5.0, < 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.41.0, < 7.0.0"
    }
  }
}
