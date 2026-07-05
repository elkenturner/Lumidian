"""Content angle (persona) control — Insider vs Neutral expert.

Research note (July 2026): FTC disclosure attaches to ENDORSEMENT, not brand
mention. Insider = openly affiliated voice with casual disclosure when
endorsing. Neutral = genuinely non-endorsing informational text — which is
what makes 'no disclosure' legally safe. A neutral piece must NEVER claim
independence (affiliated poster claiming independence = astroturfing).
"""
from __future__ import annotations

VALID_ANGLES = ("auto", "insider", "neutral")

_INSIDER_DEFAULT = {"linkedin_article", "linkedin_post", "linkedin_reply",
                    "medium", "x_thread", "x_post", "x_reply"}
_NO_ANGLE = {"owned_site", "wikipedia"}


def effective_angle(platform: str, angle: str, subreddit_classification: str | None = None) -> str | None:
    """Resolve the cluster-level angle setting for one platform."""
    if platform in _NO_ANGLE:
        return None  # a page on the brand's own domain is inherently first-party
    if angle in ("insider", "neutral"):
        return angle
    # auto
    if platform in _INSIDER_DEFAULT:
        return "insider"
    if platform.startswith("reddit"):
        return "insider" if subreddit_classification == "allowed" else "neutral"
    if platform == "quora":
        return "neutral"  # the credential line carries affiliation
    return "insider"


def angle_directive(angle: str | None, brand_name: str) -> str | None:
    """Prompt section expressing the persona. None → no section."""
    if angle == "insider":
        return (
            f"ANGLE — INSIDER: you are writing as someone who works at {brand_name}. "
            f"First-person experience is welcome ('we kept hitting this', 'what worked for us'), "
            f"grounded in the Brand Profile's real specifics. If (and only if) the piece "
            f"recommends or praises {brand_name}, include one casual inline disclosure at the "
            f"first brand mention — e.g. 'full disclosure — I work at {brand_name}, so grain of "
            f"salt'. Never a formal disclosure block. NEVER pose as a customer or user of "
            f"{brand_name} — an insider writing as a satisfied customer is an FTC violation."
        )
    if angle == "neutral":
        return (
            f"ANGLE — NEUTRAL EXPERT: you are writing as an experienced practitioner surveying "
            f"the space. {brand_name} appears as one concrete option among alternatives — "
            f"factual claims only, no superlatives about it, no recommendation of it over the "
            f"others. No first-person claims about using or working at {brand_name}. Make NO "
            f"claim of independence or non-affiliation either — the text must simply be neutral "
            f"enough that knowing the author's employer would not change its weight. Because the "
            f"piece endorses nothing, no disclosure line is needed."
        )
    return None
