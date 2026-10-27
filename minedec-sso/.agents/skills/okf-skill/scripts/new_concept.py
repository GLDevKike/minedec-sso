#!/usr/bin/env python3
"""Create a new OKF concept document with correct frontmatter (SPEC.md §4).

Usage:
    python3 new_concept.py <bundle_root> <concept/path/without-md> \
        --type "BigQuery Table" \
        [--title "Customer Orders"] \
        [--description "One row per completed customer order."] \
        [--resource https://...] \
        [--tags sales,orders,revenue] \
        [--timestamp 2026-05-28T14:30:00Z] [--no-timestamp] \
        [--no-sections] [--force]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _okf_common import dump_frontmatter, is_reserved, now_iso8601, eprint  # noqa: E402


TEMPLATE_SECTIONS = """
# Schema

<!-- Table of fields/columns, if this concept describes a structured asset.
Delete this section if not applicable. -->

| Field | Type | Description |
|---|---|---|
|  |  |  |

# Examples

<!-- Concrete usage examples. Delete this section if not applicable. -->

# Citations

<!-- Numbered external sources backing claims made above.
Delete this section if not applicable.
[1] [Source label](https://example.com) -->
"""


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("bundle_root")
    p.add_argument("concept_path",
                    help="Path of the concept relative to the bundle root, "
                         "WITHOUT the .md suffix, e.g. tables/orders")
    p.add_argument("--type", required=True, dest="type_")
    p.add_argument("--title")
    p.add_argument("--description")
    p.add_argument("--resource")
    p.add_argument("--tags", help="comma-separated, e.g. sales,orders")
    p.add_argument("--timestamp", help="ISO 8601 datetime; default: now (UTC)")
    p.add_argument("--no-timestamp", action="store_true")
    p.add_argument("--no-sections", action="store_true",
                    help="skip the Schema/Examples/Citations placeholder body")
    p.add_argument("--force", action="store_true")
    args = p.parse_args()

    concept_path = args.concept_path
    if concept_path.endswith(".md"):
        concept_path = concept_path[:-3]
    basename = os.path.basename(concept_path) + ".md"
    if is_reserved(basename):
        eprint(f"'{basename}' is a reserved OKF filename (index.md/log.md) and "
               "cannot be used for a concept. Choose a different name.")
        sys.exit(1)

    target = os.path.join(args.bundle_root, concept_path + ".md")
    if os.path.exists(target) and not args.force:
        eprint(f"refusing to overwrite existing {target} (pass --force)")
        sys.exit(1)

    os.makedirs(os.path.dirname(target), exist_ok=True)

    if args.no_timestamp:
        timestamp = None
    else:
        timestamp = args.timestamp or now_iso8601()

    tags = [t.strip() for t in args.tags.split(",")] if args.tags else None

    fm_fields = [
        ("type", args.type_),
        ("title", args.title),
        ("description", args.description),
        ("resource", args.resource),
        ("tags", tags),
        ("timestamp", timestamp),
    ]
    frontmatter = dump_frontmatter(fm_fields)

    body = TEMPLATE_SECTIONS if not args.no_sections else "\n"

    with open(target, "w", encoding="utf-8") as f:
        f.write(frontmatter + "\n" + body)

    print(f"Created concept: {target}")
    print(f"  concept ID: {concept_path}")
    if not args.title:
        print("  note: no --title given; consumers may derive one from the filename.")
    if not args.description:
        print("  note: no --description given; add one before running gen_index.py "
              "for a useful index entry.")


if __name__ == "__main__":
    main()
