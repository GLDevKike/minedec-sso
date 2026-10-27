variable "project_id" {
  description = "ID del proyecto donde se crean las colas de Cloud Tasks."
  type        = string
}

variable "region" {
  description = "Región de las colas de Cloud Tasks."
  type        = string
}

variable "queues" {
  description = "Mapa de colas de Cloud Tasks a aprovisionar (clave = nombre de la cola)."
  type = map(object({
    max_dispatches_per_second = optional(number, 25)
    max_concurrent_dispatches = optional(number, 10)
    max_attempts              = optional(number, 5)
    min_backoff               = optional(string, "2s")
    max_backoff               = optional(string, "300s")
    max_doublings             = optional(number, 4)
  }))
  default = {}
}
