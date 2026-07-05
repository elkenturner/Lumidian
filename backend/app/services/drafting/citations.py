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
from app.services.source_authority import classify_domain

_MARKER_RE = re.compile(r"\[S(\d+)\]")

_PLATFORMS_WITH_FOOTER = {"medium", "linkedin_article", "quora"}
_LINKEDIN_POST_PLATFORMS = {"linkedin_post", "linkedin_reply"}
_REDDIT_PLATFORMS: set[str] = set()  # retired: reddit renders linkless (July 2026 research)
_STRIP_PLATFORMS = {"x_post", "x_thread", "x_reply", "reddit", "reddit_reply", "reddit_comment"}


@dataclass
class RenderedCitation:
    source_ref: str
    url: str
    title: str
    position_marker: int
    tier: str = "T3"  # T1/T2/T3 authority of the cited domain


def extract_used_refs(text: str) -> list[str]:
    """Return refs used in order of first appearance, deduped."""
    seen: list[str] = []
    for m in _MARKER_RE.finditer(text):
        ref = f"S{m.group(1)}"
        if ref not in seen:
            seen.append(ref)
    return seen


def drop_out_of_range_markers(text: str, source_count: int) -> tuple[str, int]:
    """Deterministically strip [SN] markers whose N has no matching source.

    The writer can hallucinate a marker like [S7] when only 5 sources were
    provided. ``render_citations`` would silently drop these, hiding the
    problem. We strip them here BEFORE rendering and return a count so the
    caller can decide whether the draft is under-sourced.

    Returns ``(cleaned_text, dropped_count)``.
    """
    dropped = 0

    def _replace(m: re.Match) -> str:
        nonlocal dropped
        n = int(m.group(1))
        if n < 1 or n > source_count:
            dropped += 1
            return ""
        return m.group(0)

    cleaned = _MARKER_RE.sub(_replace, text)
    return cleaned, dropped


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

    Per the 2026-05-20 cluster redesign (reddit updated July 2026):
      - Medium / linkedin_article / quora: numbered footer block
      - linkedin_post: end-of-post "Sources" numbered block (NOT inline)
      - reddit / reddit_reply / reddit_comment: linkless — prose attribution
        only, markers stripped, no footer at all (outbound links to own
        content are the classic Reddit spam fingerprint)
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
                tier=classify_domain(_domain(src.url)),
            ))

    def _replace(match: re.Match) -> str:
        ref = f"S{match.group(1)}"
        if ref not in by_ref:
            return ""
        src = by_ref[ref]
        if platform in _STRIP_PLATFORMS:
            return ""
        if platform in _LINKEDIN_POST_PLATFORMS:
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

    return rendered, used
