<!--
SYNC IMPACT REPORT:
- Version change: MINEDEC 2.2.0 -> 2.3.0
- List of modified principles: ninguno redefinido.
- Added sections:
  - XIV. Seguridad de aplicación (autorización en servidor + no inyección). Spec Kit: principios en constitution; HOW en /speckit.plan; spec solo quién/qué de negocio.
- Removed sections: none
- Templates requiring updates (✅ updated / ⚠ pending) with file paths:
  - .specify/templates/plan-template.md (✅ Constitution Check XIV)
  - .specify/templates/spec-template.md (✅ acceso en lenguaje de negocio; sin OWASP/SQL)
  - commands/speckit.specify.md (✅ spec no lista OWASP)
- Follow-up TODOs: ninguno.
-->

# Constitución MINEDEC (Spec Kit)

Estándar de arquitectura y gobernanza para las iniciativas MINEDEC. Deriva de la constitución GLocation 1.5.0 (GCP, hexagonal, 70% de cobertura, OpenAPI, Spec Kit en español) y añade identidad consume-only, secretos/SA de aplicación y base de conocimiento OKF. Cada iniciativa es un repositorio aparte: esta constitución rige **este** proyecto, no un mapa del resto.

Este preset **no fija un lenguaje**. Spec Kit reserva el stack para `/speckit.constitution` (este archivo, por proyecto) y para `/speckit.plan` (`Language/Version`). `/speckit.specify` describe qué y por qué, sin Java, TypeScript ni Python.

Al ratificar, reemplazar los placeholders `[ALL_CAPS]` con el stack **de este repositorio** (argumentos de `/speckit.constitution` o inferencia del repo). No dejar tokens sin justificar.

## Core Principles

### I. Estructura de Microservicios Desacoplados

Cada servicio de backend necesario para construir el proyecto debe organizarse como un microservicio independiente y autocontenido. No debe existir acoplamiento directo entre microservicios; la comunicación se realiza de forma exclusiva mediante APIs REST o gRPC bien documentadas, o eventos asíncronos (Pub/Sub u otro bus aprobado).

El lenguaje, runtime y modelo de despliegue **no se improvisan**: los fija la sección [Stack de este proyecto](#stack-de-este-proyecto) de esta constitución.

**Regla de Oro**: Ningún cambio puede violar el aislamiento de los microservicios. Queda prohibido el acceso a la base de datos de otro servicio. Si hace falta un dato externo, se consume un contrato publicado (API, evento o extracto), no el modelo interno de otro sistema.

### II. Cobertura de Pruebas Unitarias e Integración Obligatoria (Mínimo 70%)

Todo desarrollo de backend o de pipeline de datos debe incluir pruebas unitarias e integración. Es un requisito no negociable (NON-NEGOTIABLE) mantener un **mínimo de 70% de cobertura de código** en cada servicio (o en las transformaciones, si el proyecto es de datos). Esta cobertura se valida de manera automatizada en el pipeline de CI/CD antes de cualquier fase de construcción o despliegue.

El harness es el declarado en el stack de este proyecto. Si hay UI, los flujos críticos se cubren con E2E. Si no hay SPA (p. ej. jobs de datos), E2E de navegador no aplica.

**Regla de Oro**: Ninguna funcionalidad será aprobada para su despliegue si los tests automatizados fallan o si la cobertura cae por debajo del 70%.

### III. Frontend Desacoplado y Pruebas End-to-End

**Si el proyecto no tiene interfaz web**, este principio es N/A salvo fidelidad si más adelante se añade UI.

Si hay frontend, es una aplicación desacoplada de los microservicios, desplegada sobre la infraestructura GCP del stack de este proyecto. Es obligatorio cubrir los flujos de usuario más críticos mediante pruebas E2E en el pipeline de CI/CD.

- **Fidelidad de diseño**: todo cambio de interfaz se alinea con el sistema de diseño del proyecto (`frontend/DESIGN.md`, tokens del kit MINEDEC, o guía institucional del Portal Educativo).
- **Componentes**: usar el kit ya existente en el repo (p. ej. shadcn/ui o componentes institucionales). Queda prohibido introducir otra librería de componentes genérica.
- **Mapas interactivos** (solo si el producto los tiene): GeoJSON y mapa con **`@vis.gl/react-maplibre`** e importando `maplibre-gl/dist/maplibre-gl.css`. Queda prohibido `react-map-gl`, Mapbox y Google Maps SDK. Dashboards BI y productos sin mapa no exigen MapLibre.

**Regla de Oro**: si hay UI, todo flujo principal debe tener E2E. Ningún desarrollo de interfaz será aprobado si desobedece el sistema de diseño o si un mapa interactivo usa una librería distinta a MapLibre.

### IV. Despliegue Continuo Declarativo y Automatizado

Tanto para backend como para frontend (y para jobs de datos), todo despliegue en GCP debe gestionarse exclusivamente a través de pipelines declarativos: `cloudbuild.yaml` por servicio y/o GitOps hacia GKE. Queda terminantemente prohibido realizar despliegues manuales desde entornos locales (`gcloud run deploy`, `gcloud app deploy`, `kubectl apply` improvisado) que salten el pipeline.

**Regla de Oro**: el pipeline de CI/CD es la única fuente de verdad para compilación, verificación de calidad (pruebas y cobertura) y publicación.

### V. Tipado Estricto y Calidad del Código

El código usa el lenguaje declarado en [Stack de este proyecto](#stack-de-este-proyecto), con tipado estricto o type hints según ese lenguaje. Se prohíben tipos inseguros (`any`, casteos forzados, `# type: ignore` indiscriminado, supresión del compilador).

Este preset **no** impone TypeScript a un repo de analítica ni Java a un geoportal. Tampoco impone Python a SIEE o SGD.

Todo código nuevo respeta las convenciones de estilo del proyecto. Linters y formateadores van en desarrollo local y en CI/CD.

**Regla de Oro**: el código generado por agentes o escrito por personas se adhiere a las convenciones de tipado e interfaces, sin trucos de evasión del compilador.

### VI. Arquitectura Hexagonal (Puertos y Adaptadores)

Los **servicios de aplicación** (APIs, backends transaccionales, BFF) siguen Arquitectura Hexagonal:

1. **Dominio**: núcleo puro sin dependencias de frameworks, HTTP ni base de datos. Entidades, value objects, puertos de repositorio y errores de dominio.
2. **Aplicación**: casos de uso y DTOs que orquestan el negocio sin conocer adaptadores concretos.
3. **Infraestructura**: adaptadores conducidos (SQL, BigQuery, in-memory) y conductores (REST/gRPC, colas, controladores).
4. **Composición**: el mecanismo de arranque es el del stack de este proyecto (p. ej. Spring `@Configuration`, `index.ts` con inyección manual, orquestación de un job).

Los **jobs de datos / ETL** usan capas de pipeline (ingesta → transformación → calidad → publicación) en lugar de forzar un `index.ts` o un controlador HTTP.

**Regla de Oro**: en servicios de aplicación, las dependencias van de afuera hacia adentro (Infraestructura → Aplicación → Dominio). El Dominio nunca importa capas externas.

### VII. Generación de Documentos Técnicos en Español (Mandato Spec Kit)

Todos los documentos `spec.md`, `plan.md` y `tasks.md` generados o modificados dentro de `specs/` deben redactarse **íntegramente en español**. Este preset reemplaza las plantillas de spec y plan por versiones en español; aun así, agentes y personas son responsables de no dejar secciones en inglés.

**Regla de Oro**: al usar comandos Spec Kit, la salida técnica final se redacta en español.

### VIII. Documentación de APIs con OpenAPI / Swagger

Cada microservicio nuevo o actualizado debe documentar su interfaz. El contrato OpenAPI vive junto al servicio (p. ej. `specs/<feature>/contracts/` y el artefacto de runtime del backend). No se exige un único `backend/swagger.json` para todo el ecosistema si hay varios servicios; sí se exige que **cada** cambio de API actualice su contrato antes del despliegue.

Los pipelines de datos documentan esquemas o contratos de extracto en `contracts/` cuando publican datos.

**Regla de Oro**: no se aprueba ni se despliega un cambio de API (o de contrato de datos publicado) sin haber sincronizado la especificación correspondiente.

### IX. Identidad de servicio y secretos (GCP)

Cada servicio o job que corre en GCP (Cloud Run, GKE u orquestación) usa una **cuenta de servicio dedicada** con el mínimo privilegio necesario. Queda prohibido usar la cuenta por defecto de Compute Engine como identidad del contenedor.

Los secretos (contraseñas, API keys, certificados) viven en **Secret Manager** y se inyectan en runtime. Nada de secretos en git, en la imagen ni en variables versionadas. En GKE se usa Workload Identity. No se crean claves JSON de service account de larga duración.

Esto es identidad de *carga de trabajo*. El login de usuarios es el principio X.

**Regla de Oro**: la app no lleva secretos ni una identidad de proyecto con privilegios de editor.

### X. Identidad Consume-Only (OIDC + PKCE)

Las aplicaciones consumidoras **no implementan** login con usuario/contraseña ni un IdP propio. El IdP institucional es **Google Cloud Identity**. `[SSO_REPO]` es la plataforma SSO de producto (puede federar hacia Cloud Identity). Cada repo declara **un** `iss` en el stack de este proyecto; no se mezclan Entra, Cloud Identity y sso2 en la misma app.

Contrato consume-only (salvo si este repo **es** la plataforma SSO):

- OIDC Authorization Code + PKCE **S256** (no `plain`)
- `redirect_uri` exactos HTTPS; sin comodines en prod; clientes `PUBLIC` sin `client_secret`
- Validación local de JWT contra JWKS (`iss`, `aud`, `exp`, `nbf`, firma); 401 si falla
- Autorización con claims `roles` / `permissions` en formato `recurso:accion`
- Refresh con rotación: reutilizar un refresh implica re-login completo
- HTTPS / TLS 1.3; scopes mínimos `openid profile email`
- Integración máquina a máquina (ETL/analítica): cliente `client_credentials` **registrado en SSO**, no un IdP paralelo
- SAML/CAS/LDAP son adaptadores **del dominio SSO** para legado; las apps nuevas no los reimplementan

Queda prohibido construir un servidor de autorización, MFA, registro de usuarios o federación AD/GCDS en un repo que no sea la plataforma SSO.

**Regla de Oro**: las apps MINEDEC consumen identidad; no la reinventan. Si falta un claim, scope o cliente OAuth, se especifica en el dominio SSO.

### XI. Fuente de Verdad de Negocio y Datos

Si el repositorio contiene `.okf/` o `knowledge/`, ese bundle es la **referencia primaria** de reglas normativas (LOEI), arquitectura GCP, actores y alcance. Cada repo declara **un** índice canónico (`knowledge/index.md` **o** `.okf/index.md`, no los dos como si fueran el mismo modelo). Agentes y personas leen ese índice y citan los conceptos en Assumptions. **No se inventan** hechos de negocio, artículos de ley ni topología GCP. Si falta información, se marca `[NEEDS CLARIFICATION]`.

Si existe `estructuradb.md` en la raíz, es la fuente de verdad del modelo de datos. Specs y planes deben mapear entidades contra ese archivo.

Vocabulario institucional (no sustituir por anglicismos de plantilla): AMIE, cantón, zona, distrito, predio, establecimiento, docente, representante, planilla, `@educacion.gob.ec`.

**Regla de Oro**: OKF/knowledge y `estructuradb.md` vencen a la memoria del modelo. Ante duda, aclarar; no asumir.

### XII. Reglas Normativas Fuera del Código de Aplicación

**Si este proyecto aplica normativa LOEI o reglas pedagógicas / de movimiento de personal** (escala 0.00–10.00, DAR/AAR/PAR/NAR, supletorio/remedial/gracia, concursos, ascensos, traslados, inmutabilidad de resoluciones firmadas), esas reglas viven en **Drools** (u otro motor de reglas aprobado), no en controladores ni en servicios de aplicación como `if` permanentes.

Si este proyecto **no** es transaccional de ese tipo (geoportal, SSO, analítica), este principio es N/A. No se introduce Java/Drools “por si acaso”.

**Regla de Oro**: un cambio de ley o de escala pedagógica no debe exigir reescribir el microservicio transaccional; debe exigir actualizar el paquete de reglas.

### XIII. Observabilidad de Aplicación (Logging, Monitoring, Trace)

Cada servicio que se despliegue en GCP **debe** emitir telemetría de aplicación. No es opcional ni se deja “para más adelante”.

- **Logs**: estructurados (JSON), sin secretos ni datos sensibles de estudiantes/docentes en claro. Destino: **Cloud Logging** (y Cloud Audit Logs para acciones administrativas).
- **Métricas y salud**: el servicio expone o exporta señales de salud y de error hacia **Cloud Monitoring** (latencia, disponibilidad, errores). El plan debe decir qué se alerta, no inventar un SIEM.
- **Trazas**: si hay servicio HTTP, backends instrumentan peticiones (OpenTelemetry o el SDK de **Cloud Trace**).

Esto es lo que cada iniciativa *hace en su código y su pipeline*. No sustituye la landing zone.

**Fuera de alcance de este repo** (plataforma / organización GCP, no un feature de la aplicación):

- Activar o administrar **Security Command Center** (Standard/Premium/Enterprise)
- Posture org-level, findings SCC, SIEM central, Organization Policy, Shared VPC, Interconnect
- Dashboards ministeriales globales que no pertenezcan al servicio

Si un spec pide “implementar SCC” o “montar el SOC”, marcar `[NEEDS CLARIFICATION]` y no generar Terraform/código de SCC en el repo de la iniciativa.

**Regla de Oro**: la app registra, mide y traza. La postura de seguridad de la organización (SCC y landing zone) no se reimplementa en cada iniciativa.

### XIV. Seguridad de aplicación (entrada y autorización)

Spec Kit coloca las reglas no negociables aquí, no en la spec. `/speckit.specify` describe **quién puede hacer qué** (negocio). `/speckit.plan` y el código aplican el cómo. No se copia el OWASP Top 10 ni se pide WAF, escáner WAS o SCC.

1. **Autorización en servidor**: cada operación comprueba permiso y alcance (p. ej. el recurso es de este docente/establecimiento). Un JWT válido no basta si el API no verifica el objeto. El frontend no es la frontera.
2. **La entrada no es un comando**: no concatenar input de usuario en SQL, comandos del sistema ni HTML. Usar APIs parametrizadas, ORM o el escape del contexto. Validar contra el contrato y rechazar lo demás.
3. **Datos de más**: no devolver ni registrar PII de estudiantes o docentes que la operación no necesite (alineado con el principio XIII).

**Regla de Oro**: autenticado no es autorizado. El dato del usuario no se pega a una consulta.

## Stack de este proyecto

<!--
  Spec Kit: /speckit.constitution rellena [PLACEHOLDERS].
  /speckit.plan copia Language/Version y el resto a Technical Context.
  Ejemplos (NO son mandato de este preset):
  - SIEE/SGD suelen ser Java 21, Spring, Angular, GKE, Drools.
  - Geoportal / sso2 suelen ser TypeScript, Next.js o Cloud Run.
  - Analítica suele ser Python, pipelines, BigQuery.
  Inferir del repo o de los argumentos de /speckit.constitution.
-->

| Eje | Valor de este repositorio |
|-----|---------------------------|
| Lenguaje y versión | [LANGUAGE_AND_VERSION] |
| Dependencias principales | [PRIMARY_DEPENDENCIES] |
| Almacenamiento | [STORAGE] |
| Pruebas | [TEST_HARNESS] |
| Plataforma / runtime | [TARGET_PLATFORM] |
| Tipo de proyecto | [PROJECT_TYPE] |
| Issuer OIDC (`iss`) | [OIDC_ISSUER] |
| Repo plataforma SSO | [SSO_REPO] |

## Restricciones tecnológicas y entornos

- **Configuración**: variables de entorno no secretas y Secret Manager por ambiente (Dev, QA, Prod). Nada de secretos en git.
- **Identidad de servicio**: principio IX. Cuenta de servicio dedicada; Workload Identity en GKE.
- **Puertos**: los que declare el stack de este proyecto (p. ej. `PORT` 3000 en frontend; 8080 en Cloud Run Docker).
- **Observabilidad**: principio XIII. No forzar Security Command Center.
- **Calidad estática**: linter y formateador del **lenguaje de este proyecto**.

## Flujo de trabajo y quality gates

Camino Spec Kit (oficial). Clarify, checklist y analyze son gates de calidad; no hace falta wrappearlos en este preset.

1. **Constitution**: principios de este repo (una vez; enmendar cuando cambien).
2. **Specify**: requerimientos en español; citas OKF. Conservar `FR-###`, `SC-###` y `User Story`. **No** declarar lenguaje ni stack.
3. **Clarify**: resolver ambigüedades de la spec antes de diseñar.
4. **Plan**: Technical Context con el stack de esta constitución (o argumentos de `/speckit.plan`). Un solo árbol de código.
5. **Checklist**: calidad de la spec (no es “código listo”). El `checklists/requirements.md` lo mantiene specify/clarify.
6. **Tasks**: desglose accionable.
7. **Analyze**: consistencia spec / plan / tasks (solo lectura). Corregir en el artefacto dueño y repetir.
8. **Implement**: ejecutar tasks. No auto-aprobar checklists de revisor.
9. **Converge**: huecos vs spec/plan/tasks; si añade tasks, volver a implement.
10. **CI/CD**: compilación limpia, cobertura ≥ 70%, E2E si hay UI, contratos actualizados. Sin esto no hay despliegue. Verificación local de la suite relevante antes de subir cambios.

## Governance

- **Cumplimiento obligatorio**: esta constitución tiene prioridad sobre preferencias individuales. Personas y agentes de IA están subordinados a ella.
- **Enmienda**: toda modificación detalla impacto, actualiza `.specify/memory/constitution.md` y sube la versión de gobernanza.
- **Manual de runtime**: `AGENTS.md` en la raíz (partir de `templates/agents-template.md` de este preset). Resume el stack ya ratificado; no elige un “perfil” del preset.
- **Conflicto de lenguaje**: el stack lo fija esta constitución (este repo) y se aplica en `/speckit.plan`. La spec no elige stack. Si una spec nombra un lenguaje distinto al ratificado, es `[NEEDS CLARIFICATION]`.

**Version**: 2.3.0 | **Ratified**: 2026-08-18 | **Last Amended**: 2026-08-18 | **Derived from**: GLocation Constitution 1.5.0
