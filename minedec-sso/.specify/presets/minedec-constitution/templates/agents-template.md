# Contexto del proyecto (MINEDEC)

Manual de contexto MINEDEC para agentes de IA. Copia este archivo a la **raíz del repositorio** como `AGENTS.md` después de instalar el preset `minedec-constitution` y de ratificar `/speckit.constitution`.

> **Nota:** Spec Kit (extensión `agent-context`) gestiona el `AGENTS.md` e inyecta una **sección gestionada** (referencias al plan activo y tecnologías) delimitada por los marcadores `SPECKIT START` / `SPECKIT END`. Este manual es el **contenido estático MINEDEC** que convive con esa sección gestionada: no borres esa sección.

Personas y agentes de IA están sujetos a `.specify/memory/constitution.md` (Constitución MINEDEC 2.3.0). Este manual resume el stack **ya ratificado** y el flujo diario.

## Stack de este repositorio

Valores de `.specify/memory/constitution.md` (sección **Stack de este proyecto**). Si hay `[PLACEHOLDER]`, correr `/speckit.constitution` con el stack de **este** repo.

- **Lenguaje**: [LANGUAGE_AND_VERSION]
- **Dependencias**: [PRIMARY_DEPENDENCIES]
- **Datos**: [STORAGE]
- **Tests**: [TEST_HARNESS]
- **Plataforma**: [TARGET_PLATFORM]
- **Tipo**: [PROJECT_TYPE]
- **Issuer (`iss`)**: [OIDC_ISSUER]

## Identidad (consume-only)

Salvo el repo `[SSO_REPO]`:

- No implementar login con contraseña ni un servidor de autorización.
- Integrar OIDC Authorization Code + PKCE S256; `redirect_uri` exactos; validar JWT contra JWKS.
- Autorizar con claims `roles` / `permissions` (`recurso:accion`). Refresh con rotación.
- Jobs/ETL: cliente máquina registrado en SSO (`client_credentials`), no un IdP propio.
- Si falta un cliente OAuth, un scope o un claim, especificarlo en el repo SSO; no parchear un IdP local.

## GCP de aplicación

- Cuenta de servicio **dedicada**, privilegio mínimo. No la SA por defecto de Compute Engine.
- Secretos en **Secret Manager** (runtime). Nada de secretos ni JSON keys en git.
- En GKE: Workload Identity.

## Seguridad de aplicación (constitución XIV)

- Spec: quién puede / quién no (negocio). Plan e implementación: autorización **en servidor** y sin concatenar input en SQL, comandos o HTML.
- No pedir OWASP Top 10, WAF ni SCC como feature de este repo.

## Cómo generar especificaciones

Camino oficial: `specify` → `clarify` → `plan` → `checklist` → `tasks` → `analyze` → `implement` → `converge`.

Antes de `/speckit.specify` o `/speckit.plan`:

1. Leer **un** índice: `.okf/index.md` **o** `knowledge/index.md` (el que el repo declare).
2. Citar los conceptos OKF usados en Assumptions.
3. En la spec: conservar `User Story`, `FR-001`, `SC-001`. **No** declarar lenguaje, stack ni recetas OWASP.
4. En el plan: rellenar Technical Context con el stack de esta constitución. Cuerpo en **español**.
5. Si falta un hecho de negocio o de ley, `[NEEDS CLARIFICATION]`. **No inventar** artículos LOEI ni topología GCP.

Vocabulario: AMIE, cantón, zona, distrito, predio, establecimiento, docente, representante, planilla, `@educacion.gob.ec`.

## Observabilidad y qué no construir aquí

Logs estructurados (Cloud Logging), métricas (Cloud Monitoring) y trazas si hay HTTP (Cloud Trace / OpenTelemetry). Sin secretos ni PII en los logs.

**No** implementar en este repo: Security Command Center, SIEM central ni landing zone (Shared VPC, Organization Policy, Interconnect).

## Quality gates

- Cobertura ≥ 70% (harness de este proyecto).
- E2E de flujos críticos **si hay UI**.
- OpenAPI o contrato de datos actualizado en cada cambio publicado.
- Prohibido desplegar a GCP saltándose Cloud Build / GitOps.

## Archivos de verdad

| Archivo | Rol |
|---------|-----|
| `.specify/memory/constitution.md` | Gobernanza y stack de este repo |
| `.okf/` o `knowledge/` | Negocio, LOEI, arquitectura de referencia |
| `estructuradb.md` | Modelo de datos (si existe) |
| `frontend/DESIGN.md` o tokens del kit | Fidelidad de UI (si hay frontend) |
| Este `AGENTS.md` | Resumen operativo; no sustituye la constitución |