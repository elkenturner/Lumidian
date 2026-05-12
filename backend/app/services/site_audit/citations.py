"""URL extraction from QueryResult response text + classification."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import tldextract

from app.services.site_audit.constants import THIRD_PARTY_AUTHORITY_DOMAINS, normalise_url

logger = logging.getLogger(__name__)

_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_BARE_URL_RE = re.compile(r"(?<![\[\(])(https?://[^\s\]\)\}\"']+)")
_TRAILING_PUNCT = ".,;:!?"


@dataclass
class ClassifyResult:
    kind: str
    domain: str
    competitor_id: int | None = None


def extract_urls(text: str | None) -> list[str]:
    if not text:
        return []
    raw: list[str] = []
    for m in _MD_LINK_RE.finditer(text):
        raw.append(m.group(2))
    for m in _BARE_URL_RE.finditer(text):
        raw.append(m.group(1))
    out: list[str] = []
    seen: set[str] = set()
    for u in raw:
        u = u.rstrip(_TRAILING_PUNCT)
        if "#" in u:
            u = u.split("#", 1)[0]
        if not u or u in seen:
            continue
        try:
            normalised = normalise_url(u)
        except ValueError:
            continue
        if normalised in seen:
            continue
        seen.add(normalised)
        out.append(normalised)
    return out


def registered_domain(url: str) -> str | None:
    try:
        ext = tldextract.extract(url)
    except Exception:
        return None
    if not ext.domain or not ext.suffix:
        return None
    return f"{ext.domain}.{ext.suffix}".lower()


def classify_url(url: str, own_domain: str | None, competitors_by_domain: dict[str, int]) -> ClassifyResult:
    domain = registered_domain(url) or ""
    if own_domain and domain == own_domain.lower():
        return ClassifyResult("own", domain)
    if domain in competitors_by_domain:
        return ClassifyResult("competitor", domain, competitor_id=competitors_by_domain[domain])
    if domain in THIRD_PARTY_AUTHORITY_DOMAINS:
        return ClassifyResult("third_party", domain)
    return ClassifyResult("unknown", domain)
