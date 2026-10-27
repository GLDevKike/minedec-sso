---
type: Cloud Infrastructure
title: Infraestructura GCP, Topología de Red Híbrida y Matriz de Cuentas de Servicio IAM (C2.2)
description: Especifica el diseño del proyecto GCP minedec-sso-pdp-core según C2-50 v0.1, direccionamiento VPC, conectividad híbrida redundante 99,99% (RNF-DIS-05), cierre de red perimetral (RNF-SEG-09) y las 10 cuentas de servicio con privilegio mínimo.
tags:
  - gcp
  - c2-50
  - infraestructura
  - vpc
  - iam
  - cuentas-de-servicio
  - workload-identity
  - terraform
timestamp: 2026-10-21T14:52:00Z
---

# Infraestructura GCP, Topología de Red Híbrida y Matriz de Cuentas de Servicio IAM (`C2-50` §7 y §9)

## 1. Estructura de Proyectos y Red en Google Cloud Platform (`C2-50` §7)

El Subcomponente C2.2 se despliega sobre el proyecto dedicado **`minedec-sso-pdp-core`** en la región **`us-central1`** (o región primaria acordada con CNT/MINEDEC), conectado mediante **Shared VPC / VPC Peering** y conectividad privada (**Private Service Connect / Private Services Access**):

### 1.1 Subredes, Segmentación Oficial de Red (`/20`, `/23`, `/24`), Conectividad Híbrida y Cierre de Red Perimetral

El direccionamiento de red del Subcomponente C2.2 utiliza **exclusivamente los 3 segmentos oficiales de máscara de red definidos (`/20`, `/23` y `/24`)**, sin requerir rangos adicionales (el plano de control de GKE Autopilot 1.29+ opera sobre Private Service Connect sin consumir un bloque `/28` adicional):

| Segmento / Máscara Oficial | Subred / Rango en VPC (`snet-sso-ue1` / `psa-sso-<ambiente>`) | Propósito en C2.2 | Controles de Red y Seguridad (`C2-49` v0.4 y `C2-50` v0.1) |
| :--- | :--- | :--- | :--- |
| **Segmento `/23` (512 IPs)** — 1.ª mitad **`/24` (256 IPs)** | **Subred primaria `snet-sso-ue1` (`/24`, ej. `10.10.0.0/24`)** | Subred primaria unificada para los nodos del clúster privado **GKE Autopilot** (**5 servicios**: `sso-oidc`, `motor-pdp`, `api-pap`, `frontend` y `pip-identity-service`), el Internal Load Balancer L4 de `motor-pdp` y el **Direct VPC Egress** de Cloud Run (`sso-sincronizador`, `sso-conciliacion-job` y `sso-publicador-job`). | Nodos 100% privados (sin IP pública). Salida controlada por Cloud NAT (`nat-sso-<ambiente>-ue1`); acceso a APIs de Google por **Private Google Access** (`private_ip_google_access = true`). |
| **Segmento `/23` (512 IPs)** — 2.ª mitad **`/24` (256 IPs)** | **Rango Private Services Access `psa-sso-<ambiente>` (`/24`, ej. `10.10.1.0/24`)** | Peering privado administrado (`servicenetworking.googleapis.com`) dedicado a **AlloyDB for PostgreSQL 16** (o **Cloud SQL for PostgreSQL 16** en pruebas de desarrollo) y **Memorystore for Redis**. | Tráfico 100% interno en la VPC; ni la base de datos PostgreSQL ni Redis poseen dirección IP pública. |
| **Segmento `/24` (256 IPs)** | **Rango secundario GKE `services` (`/24`, ej. `10.10.2.0/24`)** | Direccionamiento `ClusterIP` de los servicios internos de Kubernetes en GKE Autopilot (`sso-oidc`, `motor-pdp`, `api-pap`, `frontend`, `pip-identity-service`). | Aislado dentro del plano de red del clúster GKE Autopilot. |
| **Segmento `/20` (4.096 IPs)** | **Rango secundario GKE `pods` (`/20`, ej. `10.10.16.0/20`)** | Direccionamiento VPC-native de los Pods de GKE Autopilot con margen de autoescalado horizontal sin agotamiento de IPs. | Enrutamiento nativo en la VPC sin superposición con los segmentos `/23` y `/24`. |
| **Conectividad Híbrida Redundante (`RNF-DIS-05`, `D-17`, `BR-19`)** | **Cloud Interconnect** o **HA VPN** + cierre perimetral PEP (`RNF-SEG-09`, `R-03`) | Enlace redundante hacia aplicaciones on-premise y bloqueo de tráfico directo a backends perimetrales del Patrón 2. | Configurada en topología de **alta disponibilidad (`99,99%`)** con enlaces independientes entre producción (`pro`) y preproducción (`pre`), aceptando tráfico únicamente desde el PEP. |

---

## 2. Blindaje Perimetral, WAF Cloud Armor y Criptografía (`RNF-SEG-01` a `RNF-SEG-10`)

1. **Ingress Cerrado y Balanceo con Cloud Armor**:
   - La Consola Web y la API PAP se publican exclusivamente detrás de un **External Application Load Balancer** protegido por **Cloud Identity-Aware Proxy (IAP)** y una política **Google Cloud Armor** con reglas preconfiguradas **OWASP ModSecurity Core Rule Set (CRS)** contra SQLi, XSS, LFI, RCE y reglas de Rate Limiting anti-DDoS (`RNF-SEG-04`).
   - Los servicios en Cloud Run (`sa-sync`, `sa-catalogo`) y el Servicio de Identidades (PIP) operan con **Ingress = Internal only**; ninguna URL `*.run.app` queda expuesta abiertamente a Internet.
2. **Política SSL/TLS Moderna (`RNF-SEG-01`)**:
   - Todos los balanceadores exigen una **SSL Policy `RESTRICTED` o `MODERN` con versión mínima `TLS 1.2` y `TLS 1.3`**, deshabilitando explícitamente TLS 1.0, TLS 1.1 y suites débiles (3DES/SWEET32).
   - Comunicación interna servicio a servicio cifrada extremo a extremo.
3. **Cero Secretos en Código y Google Secret Manager Obligatorio (`RNF-SEG-03`)**:
   - El 100% de los secretos (claves RSA de firma de `X-Minedec-Assertion` y tokens M2M, credenciales de base de datos, semillas de cifrado) se almacenan en **Google Secret Manager** con cifrado AES-256 (`RNF-SEG-02`) y rotación cada `<= 90 días` con ventana de gracia dual.
   - Ninguna cuenta de servicio utiliza llaves estáticas `.json` descargadas; todo acceso usa **Workload Identity Federation** en GKE e identidad nativa en Cloud Run.

---

## 3. Matriz Oficial de las 10 Cuentas de Servicio de C2.2 (`C2-50` Tabla 16)

El diseño de seguridad del **Sistema de Autenticación Centralizado SSO / Conecta MINEDEC (C2.2)** segrega los permisos en **10 cuentas de servicio dedicadas** bajo el principio de privilegio mínimo (`RNF-SEG-07`):

| # | Cuenta de Servicio | Componente que la Usa | Roles IAM / Permisos Exactos Otorgados | Restricción de Seguridad Clave |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **`sa-conecta`** | Pods en GKE Autopilot (Motor PDP + API PAP + PIP) vía **Workload Identity** | • `roles/alloydb.client` y usuario BD de aplicación<br>• `roles/redis.editor` (lectura/escritura de caché)<br>• `roles/pubsub.publisher` (solo al tópico de auditoría/purga)<br>• `roles/secretmanager.secretAccessor` (solo secretos del PDP)<br>• `roles/run.jobsExecutor` (solo sobre el job `sa-publicador`) | **No tiene** permisos sobre Infrastructure Manager, Admin SDK de Google ni recursos de red/balanceadores. |
| 2 | **`sa-gke-nodes`** | Nodos del clúster privado **GKE Autopilot** | • `roles/container.defaultNodeServiceAccount`<br>• `roles/artifactregistry.reader` (solo repositorio de imágenes de C2.2) | Solo extrae imágenes de contenedores firmadas y escaneadas del Artifact Registry interno. |
| 3 | **`sa-sync`** | **Cloud Run Service** del Sincronizador de Identidades en tiempo real | • `roles/alloydb.client`<br>• `roles/redis.editor` (para invalidar claves de caché)<br>• `roles/cloudtasks.enqueuer`<br>• `roles/iam.serviceAccountTokenCreator` (**solo `signJwt`** sobre `sa-workspace-reader`) | No posee llave JSON ni delegación directa de Workspace; pide firma efímera a `sa-workspace-reader`. |
| 4 | **`sa-sync-job`** | **Cloud Run Job** de carga masiva inicial y conciliación nocturna | • `roles/alloydb.client`<br>• `roles/redis.editor`<br>• `roles/iam.serviceAccountTokenCreator` (**solo `signJwt`** sobre `sa-workspace-reader`) | Ejecuta en lote fuera del camino crítico y guarda checkpoints en `sync_checkpoint`. |
| 5 | **`sa-workspace-reader`** | Identidad sin cargas de trabajo directas, usada para **Domain-Wide Delegation (DWD)** en Google Workspace | • Sin roles sobre recursos de GCP.<br>• En Google Workspace Admin Console: **Domain-Wide Delegation** exclusivamente con el scope de solo lectura `https://www.googleapis.com/auth/admin.directory.user.readonly`. | **Cero llaves `.json` creadas** (bloqueado por política de organización `iam.disableServiceAccountKeyCreation`). Solo `sa-sync` y `sa-sync-job` pueden invocar `signJwt` sobre ella. *(Si existen tenants separados según `BR-20`, se parametriza una cuenta lectora por tenant).* |
| 6 | **`sa-tasks-invoker`** | Cola de **Cloud Tasks** de sincronización | • `roles/run.invoker` exclusivamente sobre el servicio Cloud Run del Sincronizador (`sa-sync`). | Impide que cualquier otro actor invoque el endpoint interno del sincronizador. |
| 7 | **`sa-pubsub-push`** | Suscripción Push de **Cloud Pub/Sub** (eventos de Workspace Audit Logs) | • `roles/run.invoker` o `roles/cloudtasks.enqueuer` sobre el receptor de eventos. | Autentica los mensajes push provenientes del Sink de Cloud Logging. |
| 8 | **`sa-scheduler`** | **Cloud Scheduler** (disparador nocturno de conciliación) | • `roles/run.invoker` / `roles/run.jobsExecutor` exclusivamente sobre el Cloud Run Job de conciliación (`sa-sync-job`). | No puede ejecutar el job del publicador ni acceder a datos. |
| 9 | **`sa-publicador`** | **Cloud Run Job** orquestador de publicación de aplicaciones | • `roles/alloydb.client` (para leer catálogo y adquirir `pg_try_advisory_lock`)<br>• `roles/storage.objectAdmin` (solo en el bucket versionado de blueprints)<br>• Rol personalizado **`publicador_infra`** (`config.deployments.create`, `config.deployments.update`, `config.previews.create`, `config.previews.get`, `iam.serviceAccounts.actAs` sobre `sa-infra-manager`). | Solo aplica cambios a través de **Infrastructure Manager** tras verificar que el Preview no destruye recursos de otras aplicaciones (`DA-09`, `R-04`). |
| 10 | **`sa-catalogo`** (+ `sa-infra-manager`) | **Cloud Run Service** sondeador de estado perimetral (`sa-catalogo`) y ejecutor de Terraform (`sa-infra-manager`) | • `sa-catalogo` solo posee **3 roles personalizados de solo lectura**:<br>  1. `catalogo_lb` (`compute.forwardingRules.get/list`, `compute.backendServices.get/list`, `compute.healthChecks.get`)<br>  2. `catalogo_certificados` (`certificatemanager.certs.get/list`, `compute.sslCertificates.get/list`)<br>  3. `catalogo_apigee` (`apigee.proxies.get/list`, `apigee.deployments.list`)<br>• `sa-infra-manager` ejecuta los blueprints aprobados por `sa-publicador`. | `sa-catalogo` **jamás puede modificar** balanceadores, certificados ni proxies; solo diagnostica su estado para mostrarlo en la consola. |

---

## 4. Inmutabilidad de Datos y Protección contra Borrado Accidental (`RF-AUD-03`, `RF-AUD-04`)

En cumplimiento de `C2-50` y de la **Constitución del Proyecto (`v2.11.0`, Principio XVI)**:
- En los módulos de Terraform de C2.2 (`c2-sso/devops/iac-terraform`), el clúster de **AlloyDB (`google_alloydb_cluster`)**, el dataset analítico de **BigQuery** y los buckets de **Cloud Storage** (blueprints y archivo forense WORM con `retention_policy` bloqueada) tienen configurado obligatoriamente **`deletion_protection = true`**.
- El rol de base de datos utilizado por `sa-sso-core` tiene permisos `INSERT` y `SELECT` sobre `auditoria_evento`, pero **tiene revocados los permisos `UPDATE`, `DELETE` y `TRUNCATE`** sobre las tablas de auditoría.

---

## 5. Documentos Relacionados

- [Componentes del Núcleo Central del Sistema de Autenticación Centralizado SSO (C2.2)](componentes-pdp-core.md)
- [Gobierno y Ciclo de Vida de Aplicaciones desde la Consola](gobierno-ciclo-vida-aplicaciones.md)
- [Sincronización de Identidades y Protección de Cuotas](sincronizacion-identidades-cuotas.md)
- [Catálogo Oficial de Requerimientos No Funcionales (`C2-49` v0.4)](../requerimientos/requerimientos-no-funcionales-c22.md)
