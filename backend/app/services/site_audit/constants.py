"""Constants for the Website AIO audit module."""
from __future__ import annotations

from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

# AI crawler user-agents we check for in robots.txt and report on.
AI_BOT_USER_AGENTS: list[str] = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "Meta-ExternalAgent",
    "Applebot-Extended",
    "Amazonbot",
]

# Registered domains we classify as 'third_party authority' citations
THIRD_PARTY_AUTHORITY_DOMAINS: set[str] = {
    "wikipedia.org", "g2.com", "capterra.com", "trustradius.com",
    "reddit.com", "linkedin.com", "youtube.com", "github.com",
    "medium.com", "stackoverflow.com", "quora.com",
    "producthunt.com", "crunchbase.com",
}

# Per-tier audit gating (internal tier keys: basic/starter/pro; Free=None excluded).
TIER_AUDIT_LIMITS: dict[str, dict] = {
    "basic":   {"max_pages": 50,  "monthly_audits": 4,   "llm_rewrites": 0},
    "starter": {"max_pages": 100, "monthly_audits": 8,   "llm_rewrites": 5},
    "pro":     {"max_pages": 250, "monthly_audits": 999, "llm_rewrites": 15},
}

# Crawler config
AUDIT_USER_AGENT = "LumidianAuditBot/1.0 (+https://lumidian.ai/bot)"
PER_PAGE_TIMEOUT_S = 10
PER_AUDIT_BUDGET_S = 300
PER_AUDIT_CONCURRENCY = 4
MAX_CONCURRENT_AUDITS = 3
HOST_REQUESTS_PER_SECOND = 1.0
RENDER_SAMPLE_SIZE = 5  # pages sent through Playwright per audit

# Scoring weights (used in scoring.py; defined here for centralisation)
PAGE_SCORE_WEIGHTS = {
    "structure": 0.30,
    "content":   0.35,
    "schema":    0.15,
    "technical": 0.20,
}

# Penalties used in bot_access_score (out of 100)
BOT_ACCESS_BLOCK_PENALTY = {
    "OAI-SearchBot":      40,
    "GPTBot":             15,
    "ClaudeBot":          15,
    "Google-Extended":    15,
    "PerplexityBot":       5,
    "ChatGPT-User":        5,
    "anthropic-ai":        5,
    "Meta-ExternalAgent":  5,
    "Applebot-Extended":   5,
    "Amazonbot":           5,
}


def _strip_default_port(netloc: str, scheme: str) -> str:
    if scheme == "http" and netloc.endswith(":80"):
        return netloc[:-3]
    if scheme == "https" and netloc.endswith(":443"):
        return netloc[:-4]
    return netloc


import re as _re

# Matches repeated slashes inside a path (not the //  in scheme).
_REPEATED_SLASHES = _re.compile(r"/+")


def _clean_path(path: str, host: str) -> str:
    """Collapse repeated slashes; strip embedded host duplications.

    Wix and a few other CMSes generate canonical URLs that accidentally embed
    the host as a path segment (e.g. ``/post/www.example.com/cookie-policy``).
    Normalise these to ``/post/cookie-policy``.

    Also unescapes JSON-style ``\\/`` sequences that leak through from
    sitemaps or inline JSON-LD before applying the slash-collapse rule.
    """
    if not path:
        return "/"
    # Unescape JSON-style backslash-slash sequences first (\/ → /)
    pre = path.replace("\\/", "/").replace("\\\\", "")
    # Collapse runs of slashes to a single /
    cleaned = _REPEATED_SLASHES.sub("/", pre)
    # Strip embedded host segments that match the page's own host.
    # We try both bare host and www-stripped variants.
    host_variants = {host.lower()}
    if host.lower().startswith("www."):
        host_variants.add(host[4:].lower())
    else:
        host_variants.add(f"www.{host.lower()}")

    segments = [s for s in cleaned.split("/") if s]
    out: list[str] = []
    for seg in segments:
        if seg.lower() in host_variants:
            # Skip — host shouldn't appear as a path segment.
            continue
        out.append(seg)
    return "/" + "/".join(out) if out else "/"


def normalise_url(url: str) -> str:
    """Canonical URL form for crawler-dedup, citation-matching, and storage.

    Rules:
      - Lowercase scheme + host
      - Default 'https://' if scheme missing
      - Strip fragment
      - Strip default port
      - Sort query params alphabetically
      - Trim trailing slash on non-root paths
      - Collapse repeated slashes in the path
      - Strip embedded host segments (Wix-style canonical artifacts)
      - Never decode percent-encoding
    """
    if not url or not isinstance(url, str):
        raise ValueError("url must be a non-empty string")

    raw = url.strip()
    if not raw:
        raise ValueError("url is empty")

    if "://" not in raw:
        raw = "https://" + raw

    p = urlparse(raw)
    if not p.netloc:
        raise ValueError(f"url has no host: {url!r}")
    if any(ch.isspace() for ch in p.netloc):
        raise ValueError(f"url host contains whitespace: {url!r}")
    if p.scheme not in ("http", "https"):
        raise ValueError(f"unsupported scheme: {p.scheme!r}")

    scheme = p.scheme.lower()
    netloc = _strip_default_port(p.netloc.lower(), scheme)

    path = _clean_path(p.path or "/", netloc)
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    qs = urlencode(sorted(parse_qsl(p.query, keep_blank_values=True))) if p.query else ""

    return urlunparse((scheme, netloc, path, "", qs, ""))
