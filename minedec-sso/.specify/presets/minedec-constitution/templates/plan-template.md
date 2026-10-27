# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

[Extraer de la spec: requisito principal + enfoque técnico. Texto en español.]

## Technical Context

<!--
  Spec Kit: aquí va el stack (no en la spec).
  Copiar de `.specify/memory/constitution.md` (sección Stack de este proyecto)
  o de los argumentos de /speckit.plan. Conservar las claves en inglés.
  Si un valor sigue en [PLACEHOLDER], marcar NEEDS CLARIFICATION.
-->

**Language/Version**: [LANGUAGE_AND_VERSION]

**Primary Dependencies**: [PRIMARY_DEPENDENCIES]

**Storage**: [STORAGE]

**Testing**: [TEST_HARNESS]

**Target Platform**: [TARGET_PLATFORM]

**Project Type**: [PROJECT_TYPE]

**SSO Repo**: [SSO_REPO]

**Performance Goals**: [específicos de esta feature]

**Constraints**: [p. ej. OIDC consume-only; SA dedicada; Secret Manager; CI/CD sin deploy local a GCP]

**Scale/Scope**: [específico de esta feature]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [ ] Language/Version coincide con el stack ratificado en `.specify/memory/constitution.md` (no improvisar otro lenguaje)
- [ ] Stack ratificado resuelto: sin `[PLACEHOLDER]` pendiente en Language/Version, Primary Dependencies, Storage, Testing, Target Platform, Project Type, OIDC Issuer, SSO Repo
- [ ] Microservicios o jobs desacoplados; sin acceder a la BD de otro servicio
- [ ] Pruebas unitarias/integración mapeadas; cobertura prevista ≥ 70%
- [ ] Flujos E2E de usuario crítico identificados **si hay UI** (N/A si no hay SPA)
- [ ] OpenAPI o contrato de datos actualizable en `contracts/`
- [ ] Spec y este plan: cuerpo en español; IDs FR-/SC- y User Story sin traducir
- [ ] SSO: consumo OIDC+PKCE (o IdP solo si este repo es la plataforma SSO)
- [ ] OKF/knowledge citado o marcado N/A; nada de LOEI inventada
- [ ] Si hay reglas LOEI / pedagógicas / de movimiento: Drools (u motor aprobado); si no aplican, N/A
- [ ] Si hay mapa interactivo: MapLibre; si no hay mapa, MapLibre N/A
- [ ] Identidad de servicio: cuenta dedicada (no la SA por defecto de Compute); secretos en Secret Manager
- [ ] Observabilidad de aplicación: logs (Cloud Logging), métricas (Cloud Monitoring), trazas si hay servicio HTTP
- [ ] No implementar Security Command Center ni landing zone org-level
- [ ] Autorización en servidor por operación (JWT ≠ permiso sobre el recurso); sin concatenar input en SQL, comandos ni HTML

[Añadir gates extra extraídos de `.specify/memory/constitution.md` si aplican]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

<!--
  Elegir UN árbol alineado con el stack ratificado. Borrar los demás.
  El plan entregado no debe incluir etiquetas "Option".
-->

```text
# [REMOVE IF UNUSED] Option 1: Java / Spring (típico SIEE/SGD)
backend/<servicio>/
└── src/
    ├── main/java/ec/gob/educacion/<dominio>/<contexto>/
    │   ├── domain/
    │   ├── application/
    │   └── infrastructure/
    └── test/java/ec/gob/educacion/<dominio>/
frontend/
└── src/app/
    └── features/<funcionalidad>/

# [REMOVE IF UNUSED] Option 2: Next.js o Cloud Run (típico geoportal / sso2)
src/
├── app/
├── modules/<feature>/
├── components/ui/
└── lib/

# variante Cloud Run hexagonal:
# backend/<servicio>/{domain,application,infrastructure,index.ts}
# frontend/{public,server.js,DESIGN.md,dev.yaml,qa.yaml,prod.yaml}

# [REMOVE IF UNUSED] Option 3: pipeline de datos (típico analítica)
src/
├── ingest/
├── transform/
├── quality/
└── publish/
tests/
```

**Structure Decision**: [Documentar el árbol elegido y las rutas reales que se usarán]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [p. ej. segundo lenguaje en el mismo repo] | [necesidad actual] | [por qué el stack ratificado no alcanza] |
| [p. ej. acceso directo a BD de otro servicio] | [problema concreto] | [por qué el contrato publicado no basta] |
