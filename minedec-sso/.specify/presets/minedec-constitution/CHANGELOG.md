# Changelog

Todos los cambios relevantes de este preset se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado de `preset.yml` sigue [SemVer](https://semver.org/lang/es/).

## [1.3.1] — 2026-08-24

### Corregido

- Fix de numeración en `spec-template`: `SC-005` → `SC-004` (el patrón era SC-001..SC-003, SC-005; faltaba SC-004).

### Cambiado

- Placeholder `[SSO_REPO]` en lugar de `minedec-sso2` hardcodeado en `speckit.specify`, `constitution-template`, `spec-template` y `agents-template` — evita acoplar el preset a un nombre de repo concreto.
- Nueva fila "Repo plataforma SSO | [SSO_REPO]" en la tabla de stack de la constitución, y clave `**SSO Repo**` en el Technical Context del plan.
- Gate "Stack ratificado resuelto" en el Constitution Check del plan (detecta `[PLACEHOLDER]` pendientes antes de avanzar).
- `agents-template.md`: contenido estático + nota sobre la extensión `agent-context` de Spec Kit (que inyecta la sección gestionada `SPECKIT START/END` en el AGENTS.md). Se descartó el template `agent-file-template` con tokens `[PROJECT NAME]` (mecanismo legacy, no usado en Spec Kit v0.16).
- README: ruta de instalación genérica, nota sobre el comportamiento real de `--dev` (copia, no symlink) y documentación del flujo de AGENTS.md.

## [1.3.0] — 2026-08-18

### Añadido

- Principio XIV: seguridad de aplicación (autorización en servidor, no inyección). En el preset según Spec Kit: constitución + Constitution Check del plan; la spec solo dice quién puede hacer qué.

## [1.2.0] — 2026-08-18

### Cambiado

- Se elimina el principio de aislamiento de dominios (cada iniciativa es un repo aparte).
- Quality gates alineados al flujo oficial Spec Kit (`clarify`, `checklist`, `analyze`, `converge`).
- Identidad de servicio GCP: cuenta dedicada y Secret Manager (sin SA por defecto de Compute).

## [1.1.0] — 2026-08-18

### Cambiado

- El preset deja de mandatar perfiles A/B/C (Java / TypeScript / Python). El stack se ratifica por repo en `/speckit.constitution` (placeholders Spec Kit) y se aplica en `/speckit.plan`, como indica la guía oficial.

## [1.0.3] — 2026-08-18

### Ajustado (otras iniciativas)

- Contrato SSO consume-only más preciso (PKCE S256, JWKS, `redirect_uri`, rotación de refresh, un solo `iss`).
- OKF: un índice canónico (`knowledge/` **o** `.okf/`).
- Offline-first, Classroom y firma/PKI ya no se mandatan a todas las apps; MapLibre solo mapa interactivo; analítica sin JDBC a SIEE/SGD.

## [1.0.2] — 2026-08-18

### Añadido

- Principio XIII: observabilidad de aplicación (Cloud Logging, Cloud Monitoring, Cloud Trace). Security Command Center y la landing zone quedan explícitamente fuera del alcance de cada repo de iniciativa.

## [1.0.1] — 2026-08-18

### Corregido

- Spec alineada con Spec Kit: se conservan `User Story`, `FR-###`, `SC-###` y `Given`/`When`/`Then` (el texto sigue en español).
- El perfil A/B ya no se pide en la spec; vive en `AGENTS.md` y se aplica en `/speckit.plan`.

## [1.0.0] — 2026-08-18

### Añadido

- Constitución MINEDEC 2.0.0 derivada de GLocation 1.5.0: principios I–VIII ajustados a dos perfiles de stack, más IX–XII (aislamiento de dominios, identidad consume-only, fuente de verdad OKF, Drools/LOEI).
- Plantillas `spec-template` y `plan-template` en español, con dominio, perfil A/B y árboles de código concretos.
- `agents-template.md` para copiar a la raíz de cada iniciativa como `AGENTS.md`.
- Wrap de `/speckit.specify` con preámbulo OKF, español, aislamiento y SSO.
- README de instalación local en Windows (ruta de desarrollo MINEDEC).
