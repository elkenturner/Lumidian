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
            if not qr.response_text:
                continue
            urls = extract_urls(qr.response_text)
            for url in urls:
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
