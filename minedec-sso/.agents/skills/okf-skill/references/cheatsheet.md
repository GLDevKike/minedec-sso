# OKF cheat sheet (v0.1)

## File roles
| File | Frontmatter allowed? | Role |
|---|---|---|
| `index.md` (bundle root) | ONLY here: `okf_version: "0.1"` | directory listing |
| `index.md` (any other dir) | none | directory listing |
| `log.md` | none | dated change history |
| anything else `.md` | required (`type`) | a concept |

## Concept frontmatter
```yaml
---
type: <string>                 # REQUIRED. Free text, e.g. "BigQuery Table", "Playbook", "Metric"
title: <string>                # recommended
description: <one sentence>    # recommended
resource: <URI>                # recommended if bound to a real asset; omit for abstract concepts
tags: [a, b]                   # optional
timestamp: 2026-05-28T14:30:00Z  # optional, ISO 8601
# any other keys — allowed, must be preserved by consumers
---
```

## Conventional body headings
`# Schema` (fields/columns) · `# Examples` · `# Citations` (numbered, at the
bottom: `[1] [label](url)`)

## Links
- `/tables/customers.md` → bundle-root-relative. **Preferred.**
- `./sibling.md` → relative.
- Broken links are fine — never an error.

## `index.md` body shape (no frontmatter except root's `okf_version`)
```markdown
# Section Heading

* [Title](relative-url) - description copied from that concept's frontmatter

# Another Section

* [Subdir](subdir/) - description
```

## `log.md` body shape
```markdown
# Directory Update Log

## 2026-05-22
* **Update**: Added ... [orders](/tables/orders.md).
* **Creation**: Established ... .

## 2026-05-15
* **Initialization**: ...
```
Date headings: `## YYYY-MM-DD`, newest first. Bold lead word is convention
only (`Update`/`Creation`/`Deprecation`/etc.), not required.

## Conformance = only 3 hard rules (§9)
1. Every non-reserved `.md` has parseable frontmatter.
2. That frontmatter has non-empty `type`.
3. `index.md`/`log.md` follow §6/§7 shape when present.

Everything else (missing optional fields, unknown `type`, unknown extra keys,
broken links, missing `index.md`) is **soft guidance** — never fail a bundle
over these.
