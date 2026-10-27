# Plantilla: data

Plataforma de datos del segmento. Los componentes con costo por hora están apagados por defecto.

## Componentes

| Componente | Flag | Default | Módulo |
|---|---|---|---|
| APIs del proyecto | — | siempre | `apis` |
| Data lake en GCS (un bucket por zona) | — | según mapa | `cloud-storage` |
| Datasets de BigQuery | — | según mapa | recursos nativos |
| Topics y subscriptions de Pub/Sub | — | según mapa | recursos nativos |
| Service account de Dataflow + roles | `enable_dataflow_sa` | `true` | `iam` + recursos nativos |
| Cloud SQL con IP privada (PSA) | `enable_cloudsql` | `false` | `cloud-sql` |
| Memorystore Redis (PSA) | `enable_redis` | `false` | `memorystore-redis` |
| Clave CMEK en Cloud KMS | `enable_kms` | `false` | recursos nativos |

No hay módulos base para BigQuery, Pub/Sub, service accounts ni KMS: se usan recursos nativos, igual que en las plantillas de referencia.

## Requisitos del host

Cloud SQL y Redis se conectan **solo por IP privada**, lo que exige que el stack host tenga `enable_psa = true` y la conexión de Service Networking establecida. Si no, la creación de la instancia falla.

Redis no fija `reserved_ip_range`: GCP toma un `/29` automáticamente del rango PSA reservado por el host.

Los workers de Dataflow corren en la subred de datos del host. La plantilla no crea jobs, pero sí la identidad y sus permisos: concede `compute.networkUser` a la SA de Dataflow sobre esa subred y la expone en el output `dataflow_service_account`, que es el valor del parámetro `--service_account_email` al lanzar un job.

## CMEK

Con `enable_kms = true` se crea un key ring regional y una clave que se aplica a los buckets del lake, los datasets de BigQuery y los topics de Pub/Sub. Los tres service agents correspondientes reciben `roles/cloudkms.cryptoKeyEncrypterDecrypter` **antes** de crear los recursos (`depends_on`).

Una clave KMS no se puede eliminar, solo deshabilitar: un `destroy` del stack deja la clave y el key ring en el proyecto.

## Notas de diseño

**No se crean usuarios de Cloud SQL.** Sus contraseñas quedarían en el state. Crearlos aparte y guardar las credenciales en Secret Manager.

**Defaults de sandbox**: Cloud SQL `ZONAL` con `db-g1-small`, sin PITR y sin protección de borrado; Redis `BASIC` de 1 GB. Para producción hay que revisar `availability_type`, `tier`, `pit_recovery_enabled` y `deletion_protection`.
