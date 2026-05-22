"""
Per-platform citation rendering for the drafting pipeline.

The writer LLM emits inline markers like [S1], [S2]. This module resolves them
back to URLs and renders them appropriately for each platform.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from app.services.drafting.evidence import EvidencePack, EvidenceSource

_MARKER_RE = re.compile(r"\[S(\d+)\]")

_PLATFORMS_WITH_FOOTER = {"medium", "linkedin_article", "quora"}
_LINKEDIN_POST_PLATFORMS = {"linkedin_post", "linkedin_reply"}
_REDDIT_PLATFORMS = {"reddit", "reddit_reply"}
_STRIP_PLATFORMS = {"x_post", "x_thread", "x_reply"}


@dataclass
class RenderedCitation:
    source_ref: str
    url: str
    title: str
    position_marker: int


def extract_used_refs(text: str) -> list[str]:
    """Return refs used in order of first appearance, deduped."""
    seen: list[str] = []
    for m in _MARKER_RE.finditer(text):
        ref = f"S{m.group(1)}"
        if ref not in seen:
            seen.append(ref)
    return seen


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return url


def render_citations(
    text: str,
    pack: EvidencePack,
    platform: str,
) -> tuple[str, list[RenderedCitation]]:
    """Render [SN] markers into platform-native citation forms.

    Per the 2026-05-20 cluster redesign:
      - Medium / linkedin_article / quora: numbered footer block
      - linkedin_post: end-of-post "Sources" numbered block (NOT inline)
      - reddit:        conversational "More on this:" trailing block
      - wikipedia:     <ref>{{cite web}}</ref> inline
      - x_*:           strip markers entirely

    Unmatched markers are stripped silently.
    """
    by_ref: dict[str, EvidenceSource] = {s.ref: s for s in pack.sources}
    used: list[RenderedCitation] = []
    ref_to_display: dict[str, int] = {}

    for m in _MARKER_RE.finditer(text):
        ref = f"S{m.group(1)}"
        if ref in by_ref and ref not in ref_to_display:
            ref_to_display[ref] = len(ref_to_display) + 1
            src = by_ref[ref]
            used.append(RenderedCitation(
                source_ref=ref, url=src.url, title=src.title, position_marker=m.start(),
            ))

    def _replace(match: re.Match) -> str:
        ref = f"S{match.group(1)}"
        if ref not in by_ref:
            return ""
        src = by_ref[ref]
        if platform in _STRIP_PLATFORMS:
            return ""
        if platform in _LINKEDIN_POST_PLATFORMS or platform in _REDDIT_PLATFORMS:
            # Marker removed inline; references aggregate into trailing block
            return ""
        if platform == "wikipedia":
            return f"<ref>{{{{cite web|url={src.url}|title={src.title}}}}}</ref>"
        display = ref_to_display[ref]
        return f"[{display}]({src.url})"

    rendered = _MARKER_RE.sub(_replace, text).strip()

    if not used:
        return rendered, used

    if platform in _PLATFORMS_WITH_FOOTER:
        footer = ["", "", "Sources"]
        for ref, n in ref_to_display.items():
            src = by_ref[ref]
            footer.append(f"{n}. [{src.title}]({src.url})")
        rendered = rendered + "\n".join(footer)
    elif platform in _LINKEDIN_POST_PLATFORMS:
        footer = ["", "", "Sources:"]
        for ref, n in ref_to_display.items():
            src = by_ref[ref]
            footer.append(f"{n}. {src.title} — {src.url}")
        rendered = rendered + "\n".join(footer)
    elif platform in _REDDIT_PLATFORMS:
        # Reddit native: conversational trailing line, plain markdown
        parts = ["", "", "More on this:"]
        for ref in ref_to_display:
            src = by_ref[ref]
            domain = _domain(src.url)
            parts.append(f"- {domain} — [{src.title}]({src.url})")
        rendered = rendered + "\n".join(parts)

    return rendered, used
