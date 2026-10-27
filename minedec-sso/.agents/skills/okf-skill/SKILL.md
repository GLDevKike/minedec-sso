---
name: okf-skill
description: 'Author, read, validate, and maintain Open Knowledge Format (OKF) bundles — agent-readable knowledge bases of markdown concept docs with typed YAML frontmatter plus index.md and log.md. Use for any mention of OKF, knowledge bundles/bases/catalogs, agent-readable or agent-friendly docs, adding concept docs, generating index.md, checking conformance, or converting existing docs, wikis, or data catalogs into structured markdown. Also use proactively during normal coding tasks: before starting non-trivial work in a repo, check whether it has an OKF bundle (index.md/log.md, or .md files with a `type` frontmatter key) and read the relevant concept docs for context instead of re-deriving it from source; after finishing work that changes documented behavior (features, schemas, APIs, configs), update the affected concept docs and log the change. Bundled dependency-free Python scripts handle scaffolding, concept creation, index generation, logging, and validation.'
license: Apache-2.0
compatibility: Any Agent-Skills-compatible agent; scripts need Python 3 (stdlib only)
metadata:
  spec: "OKF v0.1 (Google, GoogleCloudPlatform/knowledge-catalog)"
  spec-source: "https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md"
  category: documentation, knowledge-management
---

# OKF — Open Knowledge Format authoring & validation

Open Knowledge Format (OKF) is Google's spec for storing knowledge — metadata,
context, curated insight — as a **bundle**: a directory tree of plain markdown
files with YAML frontmatter. No schema registry, no bespoke tooling: `cat` to
read it, `git clone` to ship it.

Path conventions used below:

- `scripts/…` and `references/…` live in **this skill's directory** — when
  running a script, prefix it with the skill's base path (shown when the skill
  loads), e.g. `python3 <skill-dir>/scripts/validate.py docs/knowledge`.
- `<bundle_root>` is the bundle inside the **user's project** (e.g.
  `docs/knowledge`).

The scripts are dependency-free (Python 3 stdlib; no pip, no network). Always
use them instead of hand-writing frontmatter, `index.md`, or `log.md` — they
encode the spec's fiddly rules (root-only `okf_version`, newest-first logs,
index shape), so their output can be trusted without re-checking. They refuse
to overwrite existing files unless passed `--force`.

## Task router

| Task | Workflow |
|---|---|
| Get context from a repo that already has a bundle | 1 |
| Create a new bundle / knowledge base | 2 |
| Document something as a concept | 3 |
| Refresh `index.md` after adding/removing concepts | 4 |
| Record a change in `log.md` | 5 |
| Check conformance ("is this valid OKF?") | 6 |
| A coding task changed something a bundle documents | 7 |
| Convert an existing wiki/docs/catalog to OKF | 8 |
| Exact spec rule or edge case | `references/cheatsheet.md` first; `references/SPEC.md` for the letter of the law |

## Core rules

- One non-reserved `.md` file = one **concept**; its ID is its bundle-relative
  path minus `.md` (`tables/users.md` → `tables/users`).
- **Reserved filenames** at every directory level: `index.md` (directory
  listing, §6) and `log.md` (dated change history, §7).
- Concept frontmatter has exactly one **required** key: `type` — free text
  (`BigQuery Table`, `API Endpoint`, `Playbook`, `Metric`…), no central
  registry. Recommended, in priority order: `title`, `description`, `resource`
  (canonical URI of the real asset; omit for abstract concepts), `tags` (list),
  `timestamp` (ISO 8601). Unknown extra keys are allowed and must be preserved.
- Body is free-form markdown; conventional section headings: `# Schema`,
  `# Examples`, `# Citations` (numbered external sources, §8).
- Link to other concepts with bundle-root-relative paths
  (`/tables/customers.md`) — they survive file moves. Use relative
  `./sibling.md` only for permanent siblings. Broken links are legal by design
  (they can mark not-yet-written knowledge) — never an error. But never invent
  a link target to "complete" a thought: write plain text, or create the
  missing concept.
- `index.md` never has frontmatter — except the bundle **root's**, which may
  carry exactly one key: `okf_version: "0.1"`.
- `log.md`: `## YYYY-MM-DD` headings (ISO 8601 mandatory), newest first,
  entries like `* **Update**: prose…`. No frontmatter. The bold lead word
  (`Update`/`Creation`/`Deprecation`) is convention, not required.
- **Conformance (§9) is only three hard rules**: every non-reserved `.md`
  (1) has parseable YAML frontmatter, (2) with a non-empty `type`, and
  (3) `index.md`/`log.md` follow §6/§7 where present. Everything else —
  missing recommended fields, unknown `type` values, extra keys, broken links,
  missing `index.md` — is soft guidance. Never report it as an error.

## Workflows

### 1. Read a bundle for context (before coding)

When starting non-trivial work in a repo, a bundle is usually a faster, more
accurate source of system context than re-deriving it from source code.

1. Detect: look for `index.md` + `log.md` together, or `.md` files whose
   frontmatter carries `type`. Common locations: `docs/knowledge/`,
   `knowledge/`, `docs/`, repo root.
2. Read the root `index.md`, then follow links only into directories relevant
   to the task — don't bulk-read the bundle.
3. Skim the top entries of the nearest `log.md` for recent changes in your
   area.
4. To find every concept of one kind: `grep -rl '^type: Playbook' <bundle_root>`.

### 2. Start a new bundle

```bash
python3 scripts/init_bundle.py <bundle_root> [--okf-version 0.1]
```

Creates the root `index.md` (the only place `okf_version` frontmatter is
allowed) and an empty `log.md`. Before creating subdirectories for an existing
system, ask the user what top-level groupings fit (`tables/`, `apis/`,
`playbooks/`…) — the spec deliberately leaves taxonomy domain-defined, and a
wrong guess means a rename pass later.

### 3. Add a concept

```bash
python3 scripts/new_concept.py <bundle_root> <concept/path/without-md> \
  --type "BigQuery Table" --title "Customer Orders" \
  --description "One row per completed customer order." \
  [--resource <uri>] [--tags sales,orders] [--no-timestamp] [--no-sections]
```

Writes a correctly-frontmattered concept file with placeholder `# Schema` /
`# Examples` / `# Citations` sections — fill them in, or delete the ones that
don't apply (none are required; `--no-sections` skips them). Timestamp
defaults to now (UTC, ISO 8601). Then:

- Describing a real asset (table, API, dashboard)? Use its real column
  names/types and real `resource` URI. Never invent details you weren't
  given — ask. If you can't ask, omit the unknown frontmatter key entirely
  (never write a junk value) and note in the body what's missing.
- Abstract concept (playbook, metric, process)? Just omit `--resource`.
- Cross-link related concepts in the body as you write (linking rules above).

### 4. Regenerate index.md

```bash
python3 scripts/gen_index.py <bundle_root> [--dir <subdir>] [--dry-run] [--describe "…"]
```

Rebuilds `index.md` per directory (every directory if `--dir` omitted) from
concept frontmatter, preserving the root's `okf_version`. Run after any
add/remove/rename. It fully regenerates rather than merging — if a human may
have hand-edited an `index.md`, run `--dry-run` first (prints a unified diff)
and warn before overwriting. `--describe` (used with `--dir <subdir>`) sets
the one-line description a parent index shows for that subdirectory; it is
stored as a `<!-- description: … -->` marker in the subdirectory's own
`index.md` and survives future regenerations.

### 5. Log a change

```bash
python3 scripts/add_log_entry.py <bundle_root> [--dir <subdir>] \
  --kind Update --text "Added freshness SLA to [orders](/tables/orders.md)."
```

Appends under today's `## YYYY-MM-DD` heading, newest first (creates `log.md`
if missing; `--date YYYY-MM-DD` backfills). Log every meaningful
add/edit/deprecation — but never fabricate history for changes that didn't
happen.

### 6. Validate

```bash
python3 scripts/validate.py <bundle_root> [--strict] [--check-links]
```

Checks the three §9 hard rules as PASS/FAIL (exit 0 = conformant, 1 = not) and
prints soft-guidance warnings that are informational only. Run it after any
batch of changes and always before telling the user a bundle is done — quote
the actual PASS/FAIL/warning lines, don't just say "looks good".

- `--strict` additionally fails on missing `title`/`description`. Off by
  default; use only if the user wants a stricter house style than the spec.
- `--check-links` reports unresolved internal links — informational only,
  never a conformance failure (§5.3).

### 7. After a coding task that touched documented territory

If a completed task changed behavior a bundle documents (feature, bug fix,
schema/API/config change): update the affected concept docs (or add new ones —
Workflow 3), log it (5), regenerate indexes if concepts were added or removed
(4), validate (6). Skip only for trivial changes or if the user declines — a
stale bundle quietly misleads every future agent session that trusts it.

### 8. Migrate existing docs/catalogs into OKF

Map each existing entity to one concept file; carry its real metadata into
frontmatter (never invent `resource` URIs); ask the user for the target
directory taxonomy up front if the source material doesn't make it obvious.
Finish with `gen_index.py`, one `add_log_entry.py` entry describing the
migration, and `validate.py` — never hand-write `index.md`/`log.md`.

## References

- `references/cheatsheet.md` (~60 lines) — every shape at a glance
  (frontmatter, index, log, conformance). Open for any quick "what goes
  where" question.
- `references/SPEC.md` (~450 lines) — the full vendored OKF v0.1 spec. Open
  only for exact conformance rules, § citations, or edge cases the cheatsheet
  doesn't settle.
- `templates/` — canonical example shapes for hand-authoring; the scripts
  already produce these shapes, so you rarely need these files.

## Guardrails

- Unknown `type` values, missing optional fields, broken links: soft guidance,
  never errors — the spec forbids failing a bundle over them (§9).
- No frontmatter in any non-root `index.md`; nothing in `log.md` except
  entries.
- Never fabricate `resource` URIs, schema columns, citations, or history. Ask
  for the real facts, or write an explicit placeholder and say so.
- Trust `validate.py` over eyeballing — it implements §9 exactly, including
  the root-`index.md` `okf_version` exception that is easy to get wrong by
  hand.
