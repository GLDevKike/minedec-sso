# spec-kit-preset-glocation (`minedec`)

Preset de [Spec Kit](https://github.com/github/spec-kit) para las iniciativas MINEDEC. Vive en la rama **`minedec`**.

El preset **no fija un lenguaje**. TypeScript, Java o Python los declara cada repositorio al ratificar `/speckit.constitution` y los aplica `/speckit.plan` (`Language/Version`). La spec no habla de stack (guía oficial de Spec Kit).

Este preset **no** se instala solo en los repos; hay que añadirlo con `specify preset add`.

## Qué incluye

| Recurso | Descripción |
|---------|-------------|
| `constitution-template` | Constitución MINEDEC 2.3.0: principios compartidos; stack por repo; SA/Secret Manager; seguridad de aplicación XIV. |
| `spec-template` | Spec con cuerpo en español; IDs Spec Kit (`FR-`/`SC-`/`User Story`); OKF y SSO. Sin stack. |
| `plan-template` | Plan con Technical Context al estilo Spec Kit (un bloque `Language/Version`). |
| `speckit.specify` (wrap) | Preámbulo MINEDEC alrededor del comando core de Spec Kit. |
| `templates/agents-template.md` | Manual MINEDEC para copiar a la raíz como `AGENTS.md`. La extensión `agent-context` de Spec Kit inyecta su sección gestionada (`<!-- SPECKIT START/END -->`) dentro de ese archivo. |

La plantilla `tasks` de Spec Kit se deja sin modificar.

## Instalación

Requiere el CLI `specify` (ver la [Quickstart de Spec Kit](https://github.github.com/spec-kit/quickstart.html)).

### Desde este directorio local (desarrollo)

Windows:

Con esta rama (`minedec`) checkout:

```bash
specify preset add --dev "C:\ruta\a\spec-kit-preset-glocation"
```

> **Nota sobre `--dev`**: el comando **copia** el preset a `.specify/presets/minedec-constitution/` (no es un symlink). La resolución de templates ocurre en runtime sobre esa copia, por lo que **los cambios que hagas después en tu carpeta de desarrollo no se reflejan** en el proyecto hasta que vuelvas a ejecutar `specify preset add --dev ...`.

macOS / Linux (ajusta la ruta):

```bash
specify preset add --dev /ruta/a/spec-kit-preset-glocation
```

### Verificar

```bash
specify preset list
specify preset resolve constitution-template
specify preset resolve spec-template
```

Al correr `/speckit.constitution` se usará esta constitución. Pasa el stack de **ese** repo en el argumento (p. ej. Java 21 y Drools, o TypeScript/Next.js, o Python/BigQuery), incluyendo `[SSO_REPO]` (el repo de la plataforma SSO). Después copia `templates/agents-template.md` a `AGENTS.md` y transcribe el stack ya ratificado. La extensión `agent-context` mantendrá la sección gestionada del AGENTS.md actualizada tras `/speckit.plan`.

### Remover

```bash
specify preset remove minedec-constitution
```

Si el proyecto ya tenía el preset GLocation (`glocation-constitution`), quítalo antes de instalar este: las constituciones no deben convivir.

```bash
specify preset remove glocation-constitution
```

## Cómo declarar el stack (por iniciativa)

1. Instala este preset en el repo.
2. Ratifica `/speckit.constitution` con el lenguaje y la plataforma **de ese** repositorio. Eso rellena `[LANGUAGE_AND_VERSION]` y el resto.
3. Copia `templates/agents-template.md` → `AGENTS.md` y pega esos valores. La extensión `agent-context` inyectará su sección gestionada dentro del AGENTS.md tras `/speckit.plan`.
4. En cada feature, `/speckit.plan` copia el stack a Technical Context (o lo recibes en los argumentos del comando).
5. Si existe `.okf/` o `knowledge/`, esa base es la fuente de verdad de negocio; no inventar normas LOEI.

Más adelante se pueden apilar presets por familia (Java, TypeScript, Python) con `specify preset add --priority`. Este preset es solo la capa común.

## Actualizar el estándar

1. Editar `templates/constitution-template.md` (y spec/plan/agent-file si el impacto lo exige).
2. Actualizar el bloque `SYNC IMPACT REPORT` y la versión al pie de la constitución.
3. Subir de versión `preset.yml` (`preset.version`) siguiendo semver.
4. Registrar el cambio en `CHANGELOG.md`.

## Licencia

Uso interno de Glocation / MINEDEC.
