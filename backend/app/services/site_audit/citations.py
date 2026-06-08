"""URL extraction from QueryResult response text + classification."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import tldextract

from app.services.site_audit.constants import THIRD_PARTY_AUTHORITY_DOMAINS, normalise_url

logger = logging.getLogger(__name__)

_DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$", re.IGNORECASE)
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


def classify_structured_citation(
    item: dict,
    url: str,
    own_domain: str | None,
    competitors_by_domain: dict[str, int],
) -> ClassifyResult:
    """Classify a structured citation, honouring a `domain_hint`.

    Gemini stores citations as opaque grounding-redirect proxy URLs, which
    registered_domain() resolves to google.com. `_extract_gemini_citations`
    attaches a `domain_hint` (the real bare domain from web.title); when present
    we classify by that instead of the proxy URL. Non-hinted items (Perplexity,
    real URLs) are unaffected.
    """
    hint = item.get("domain_hint") if isinstance(item, dict) else None
    if hint:
        cleaned = hint.strip().lstrip("@").lower()
        # Only trust the hint when it actually looks like a bare domain. Gemini's
        # web.title is "usually" the domain but is sometimes a human page title
        # ("Best CRMs 2026 | TechRadar") — feeding that to classify_url would yield
        # a garbage/empty domain. When it doesn't look like a domain, fall back.
        if _DOMAIN_RE.match(cleaned):
            return classify_url(f"https://{cleaned}", own_domain, competitors_by_domain)
    return classify_url(url, own_domain, competitors_by_domain)


async def extract_for_run(tracking_run_id: int) -> int:
    """Extract+classify citations for one completed tracking run.

    Idempotent via UNIQUE(query_result_id, url) — re-runs insert 0 rows.
    Returns the number of NEW rows inserted.
    """
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from app.database import AsyncSessionLocal
    from app.models import (
        Brand, CitationSource, Competitor, QueryResult, TrackingRun,
    )

    inserted = 0
    async with AsyncSessionLocal() as db:
        run = await db.get(TrackingRun, tracking_run_id)
        if run is None:
            return 0
        brand = await db.get(Brand, run.brand_id)
        if brand is None:
            return 0
        own = registered_domain(brand.website_url or "") if brand.website_url else None

        comp_rows = (await db.execute(
            select(Competitor).where(Competitor.brand_id == brand.id)
        )).scalars().all()
        competitors_by_domain: dict[str, int] = {}
        for c in comp_rows:
            d = registered_domain(c.website_url or "") if c.website_url else None
            if d:
                competitors_by_domain[d] = c.id

        qrs = (await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == tracking_run_id)
        )).scalars().all()

        for qr in qrs:
            # Combine URLs from response_text (ChatGPT/Claude inline links)
            # AND from structured citations (Perplexity citations array,
            # Gemini grounding_metadata). The latter is the only source for
            # Perp/Gemini, which don't embed URLs in response_text.
            urls: list[str] = []
            seen: set[str] = set()
            # url -> structured citation item (carries domain_hint for Gemini)
            structured_by_url: dict[str, dict] = {}
            if qr.response_text:
                for u in extract_urls(qr.response_text):
                    if u not in seen:
                        seen.add(u)
                        urls.append(u)
            structured = qr.citations or []
            for item in structured:
                u = item.get("url") if isinstance(item, dict) else None
                if not u:
                    continue
                try:
                    u = normalise_url(u)
                except ValueError:
                    continue
                if u in seen:
                    continue
                seen.add(u)
                urls.append(u)
                if isinstance(item, dict):
                    structured_by_url[u] = item
            for url in urls:
                item = structured_by_url.get(url)
                if item is not None:
                    cls = classify_structured_citation(item, url, own, competitors_by_domain)
                else:
                    cls = classify_url(url, own, competitors_by_domain)
                row = CitationSource(
                    brand_id=brand.id,
                    tracking_run_id=run.id,
                    prompt_id=qr.prompt_id,
                    query_result_id=qr.id,
                    model=qr.model,
                    url=url,
                    domain=cls.domain,
                    kind=cls.kind,
                    competitor_id=cls.competitor_id,
                )
                db.add(row)
                try:
                    await db.flush()
                    inserted += 1
                except IntegrityError:
                    await db.rollback()
                    continue

        await db.commit()
    return inserted
