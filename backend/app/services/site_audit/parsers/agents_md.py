"""Parser for /agents.md — an emerging companion to /llms.txt aimed at agent crawlers.

Like llms.txt: cheap to add, signals intent, increasingly checked by agents.
"""
from __future__ import annotations

from app.services.site_audit.parsers import Finding


def parse_agents_md(content: str | None) -> list[Finding]:
    """Returns a single 'missing' finding when content is None.

    Doesn't validate structure deeply — agents.md is conventional, not specced.
    """
    if not content:
        return [Finding(
            "agents_md_missing",
            "info",
            "bot_access",
            "No /agents.md found. Companion to /llms.txt aimed at AI agent crawlers.",
            {},
        )]
    return []
