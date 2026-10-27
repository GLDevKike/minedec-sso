terraform {
  required_version = ">= 1.5.0, < 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.41.0, < 7.0.0"
    }
    # El túnel se crea con google-beta: el bloque cipher_suite solo existe en la
    # serie 6.x del provider beta (desde 6.41.0). En el provider GA llegó en 7.x.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.41.0, < 7.0.0"
    }
  }
}
