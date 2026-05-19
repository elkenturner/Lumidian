"""Generalized markdown -> HTML section parser.

Each PDF template module declares a SECTION_MAP dict mapping lowercase H2
heading text -> Jinja2 block key. parse_sections() splits a markdown body
on `## ` headings and returns {block_key: rendered_html} for the
recognized ones (unrecognized headings are dropped silently).
"""
from __future__ import annotations

import re

import markdown as _md


def parse_sections(body: str | None, section_map: dict[str, str]) -> dict[str, str]:
    if not body:
        return {}
    parts = re.split(r"^##\s+", body, flags=re.MULTILINE)
    out: dict[str, str] = {}
    for part in parts[1:]:
        lines = part.splitlines()
        if not lines:
            continue
        heading = lines[0].strip().lower()
        body_md = "\n".join(lines[1:]).strip()
        key = section_map.get(heading)
        if key is None:
            continue
        out[key] = _md.markdown(body_md, extensions=["extra", "pymdownx.tasklist"])
    return out
