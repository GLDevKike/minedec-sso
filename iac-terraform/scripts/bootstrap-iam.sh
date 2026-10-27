#!/usr/bin/env bash
# Bootstrap IAM para Google Cloud Infrastructure Manager — MINEDEC SSO (Subcomponente C2.2).
# Ejecutar una sola vez por ambiente (mec-003-sso-des, mec-003-sso-pre, mec-003-sso-pro)
# con un usuario que posea projectIamAdmin y storage.admin en el proyecto SSO.
#
#Uso:
#  bash scripts/bootstrap-iam.sh [PROJECT_ID] [REGION]
set -euo pipefail

PROJECT_ID="${1:-mec-003-sso-des}"
REGION="${2:-us-east1}"
BUCKET_NAME="${PROJECT_ID}-im-artifacts"
SA_NAME="sa-infra-manager"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SA="serviceAccount:${SA_EMAIL}"
RUNNER="serviceAccount:gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com"

bind() {
  gcloud projects add-iam-policy-binding "$1" --member="$2" --role="$3" --condition=None --format=none
  echo "OK  $1  $3  ${2#serviceAccount:}"
}

# 1. Habilitar APIs base de Infrastructure Manager
gcloud services enable \
  config.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="${PROJECT_ID}"

# 2. Crear bucket de artefactos de Infrastructure Manager (si no existe)
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${BUCKET_NAME}" --versioning
fi

# 3. Crear cuenta de servicio de Infrastructure Manager (si no existe)
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="SA Google Cloud Infrastructure Manager (${PROJECT_ID})"
fi

# 4. Roles de mínimo privilegio para sa-infra-manager sobre el proyecto SSO
SSO_ROLES=(
  roles/config.agent
  roles/serviceusage.serviceUsageAdmin
  roles/resourcemanager.projectIamAdmin
  roles/iam.serviceAccountAdmin
  roles/iam.serviceAccountUser
  roles/storage.admin
  roles/artifactregistry.admin
  roles/secretmanager.admin
  roles/bigquery.admin
  roles/pubsub.admin
  roles/cloudtasks.admin
  roles/alloydb.admin
  roles/cloudsql.admin
  roles/redis.admin
  roles/cloudkms.admin
  roles/container.admin
  roles/run.admin
  roles/cloudscheduler.admin
  roles/compute.networkViewer
  roles/compute.securityAdmin
)

for r in "${SSO_ROLES[@]}"; do
  bind "${PROJECT_ID}" "${SA}" "$r"
done

# 5. Inicializar identidad del servicio config.googleapis.com
gcloud beta services identity create --service=config.googleapis.com --project="${PROJECT_ID}" || true

# 6. Permisos para el Runner de GitLab sobre Infrastructure Manager y el bucket de fuentes
bind "${PROJECT_ID}" "${RUNNER}" roles/config.admin
bind "${PROJECT_ID}" "${RUNNER}" roles/serviceusage.serviceUsageConsumer
bind "${PROJECT_ID}" "${RUNNER}" roles/logging.viewer
bind "${PROJECT_ID}" "${RUNNER}" roles/storage.objectAdmin

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" --project="${PROJECT_ID}" \
  --member="${RUNNER}" --role=roles/iam.serviceAccountUser --format=none
echo "OK  ${SA_EMAIL}  roles/iam.serviceAccountUser  (runner actAs)"
