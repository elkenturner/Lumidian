"""Citation-integrity stage for the drafting pipeline.

Runs BEFORE ``render_citations`` (while ``[SN]`` markers are still present) so
that fabricated or unsupported citations are caught instead of silently
vanishing during render. Two layers:

  1. Deterministic bounds-drop — strip ``[SN]`` whose N has no matching source
     (the writer hallucinated it). No LLM, always on when a pack exists.
  2. Support critic — the Haiku pass in ``citation_critic.critique_citations``
     that drops markers whose source snippet doesn't actually support the
     surrounding claim. Previously Pro-only and (worse) wired AFTER render in
     the cluster path, where it was a guaranteed no-op because no markers
     survived. Now reached on every tier that has an evidence pack.

The stage also reports a ``low_evidence`` signal the caller can use to decide
whether to regenerate the piece once and/or flag it in the UI.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from app.services.drafting.citations import drop_out_of_range_markers, extract_used_refs
from app.services.drafting.evidence import EvidencePack
from app.services.source_authority import classify_domain

logger = logging.getLogger(__name__)

# (text, pack_sources) -> cleaned text. Injectable for testing.
SupportCritic = Callable[..., Awaitable[str]]


@dataclass
class IntegrityResult:
    text: str
    low_evidence: bool
    out_of_range_dropped: int
    emitted_refs: list[str]
    retained_refs: list[str]


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return url


def pack_to_source_dicts(pack: EvidencePack) -> list[dict]:
    """Adapt EvidenceSource dataclasses to the dict shape the critic/verifier expect.

    The cluster path used to pass the WRONG pack here (the ORM ContentEvidencePack,
    not the per-piece pack the markers actually map to). Deriving the dicts from
    the same pack that produced the prompt guarantees S1..SN line up.
    """
    return [
        {
            "tier": classify_domain(_domain(s.url)),
            "url": s.url,
            "domain": _domain(s.url),
            "title": s.title,
            "snippet": s.snippet,
        }
        for s in pack.sources
    ]


async def enforce_citation_integrity(
    *,
    text: str,
    pack: EvidencePack,
    run_support_critic: bool,
    support_critic: Optional[SupportCritic] = None,
) -> IntegrityResult:
    """Validate citation markers against the pack. Returns cleaned text + signals.

    Must be called with the SAME pack that was injected into the writer prompt.
    """
    emitted = extract_used_refs(text)
    source_count = len(pack.sources)

    # 1. Deterministic bounds-drop.
    cleaned, out_of_range = drop_out_of_range_markers(text, source_count)
    if out_of_range:
        logger.info("Citation integrity: dropped %d out-of-range marker(s)", out_of_range)

    # 2. Support critic (only worth a call if markers remain).
    if run_support_critic and extract_used_refs(cleaned):
        critic = support_critic
        if critic is None:
            from app.services.citation_critic import critique_citations
            critic = critique_citations
        try:
            cleaned = await critic(text=cleaned, pack_sources=pack_to_source_dicts(pack))
        except Exception as exc:
            logger.warning("Citation support critic failed — keeping bounds-checked text: %s", exc)

    retained = extract_used_refs(cleaned)
    # Thin sourcing: no real sources at all, OR the writer tried to cite but
    # every marker was invalid/unsupported.
    low_evidence = source_count == 0 or (len(emitted) > 0 and len(retained) == 0)

    return IntegrityResult(
        text=cleaned,
        low_evidence=low_evidence,
        out_of_range_dropped=out_of_range,
        emitted_refs=emitted,
        retained_refs=retained,
    )
