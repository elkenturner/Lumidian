"""Wikipedia scanner — discovers and ranks candidate articles for a brand."""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Competitor,
    Prompt,
    WikipediaCandidate,
    WikipediaScan,
)
from app.services.wikipedia.api_client import fetch_lead_extract, search_articles
from app.services.wikipedia.legitimacy_gate import LEGITIMACY_THRESHOLD, score_candidate

logger = logging.getLogger(__name__)

_PRESERVE_STATUSES = {"submitted", "accepted", "reverted"}


def is_obviously_illegitimate(*, title: str, summary: str, brand_name: str, competitor_names: list[str]) -> bool:
    """Free pre-filter — drops obvious non-starters before the LLM gate fires."""
    t = (title or "").lower()
    s = (summary or "").strip()
    if not t or not s:
        return True
    if len(s) < 100:
        return True
    if "(disambiguation)" in t:
        return True
    if t.startswith("list of "):
        return True
    if t.startswith("year ") or (len(t) == 4 and t.isdigit()):
        return True
    bn = (brand_name or "").lower().strip()
    if bn and (t == bn or t.startswith(bn + " (") or t.startswith(bn + ",")):
        return True
    for comp in competitor_names:
        c = (comp or "").lower().strip()
        if c and (t == c or t.startswith(c + " (")):
            return True
    return False


async def _build_profile_block(db: AsyncSession, brand_id: int) -> tuple[str, str]:
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id))).scalar_one()
    profile = (await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))).scalar_one_or_none()
    parts = [f"Name: {brand.name}"]
    if profile:
        if profile.company_description:
            parts.append(f"Description: {profile.company_description}")
        if profile.key_stats:
            parts.append(f"Key stats: {profile.key_stats}")
        if profile.target_audience:
            parts.append(f"Target audience: {profile.target_audience}")
    return brand.name, "\n".join(parts)


async def _competitor_names(db: AsyncSession, brand_id: int) -> list[str]:
    rows = (await db.execute(select(Competitor.name).where(Competitor.brand_id == brand_id))).scalars().all()
    return [r for r in rows if r]


async def run_scan(
    db: AsyncSession,
    *,
    brand_id: int,
    triggered_by: int | None,
) -> WikipediaScan:
    """Run a single scan: search per prompt -> pre-filter -> legitimacy gate -> upsert."""
    scan = WikipediaScan(
        brand_id=brand_id, status="running", triggered_by=triggered_by, started_at=datetime.now(UTC).replace(tzinfo=None)
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    try:
        brand_name, profile_block = await _build_profile_block(db, brand_id)
        competitor_names = await _competitor_names(db, brand_id)
        prompts = (
            await db.execute(
                select(Prompt).where(Prompt.brand_id == brand_id, Prompt.prompt_type == "standard")
            )
        ).scalars().all()

        # 1. Search per prompt, dedupe by pageid
        seen_pageids: dict[int, dict] = {}
        scan.prompts_searched = len(prompts)
        for prompt in prompts:
            try:
                results = await search_articles(prompt.text, limit=5)
            except Exception:
                logger.exception("search_articles failed for prompt %d", prompt.id)
                continue
            for r in results:
                pid = r.get("pageid")
                if not pid or pid in seen_pageids:
                    continue
                seen_pageids[pid] = {**r, "discovered_via_prompt_id": prompt.id}
        scan.total_candidates_found = len(seen_pageids)

        # 2. Fetch lead extracts + pre-filter
        survivors: list[dict] = []
        for pid, info in seen_pageids.items():
            try:
                extract_result = await fetch_lead_extract(pid)
            except Exception:
                logger.exception("fetch_lead_extract failed for pageid %d", pid)
                continue
            if extract_result is None:
                continue
            verified_title, summary = extract_result
            if is_obviously_illegitimate(
                title=verified_title, summary=summary, brand_name=brand_name, competitor_names=competitor_names
            ):
                continue
            info["verified_title"] = verified_title
            info["summary"] = summary
            survivors.append(info)

        # 3. Legitimacy gate per survivor
        persisted = 0
        for s in survivors:
            try:
                score, reasoning = await score_candidate(
                    brand_name=brand_name,
                    profile_block=profile_block,
                    article_title=s["verified_title"],
                    article_summary=s["summary"],
                )
            except Exception:
                logger.exception("score_candidate failed for pageid %d", s["pageid"])
                continue
            if score < LEGITIMACY_THRESHOLD:
                continue

            existing = (
                await db.execute(
                    select(WikipediaCandidate).where(
                        WikipediaCandidate.brand_id == brand_id,
                        WikipediaCandidate.article_title == s["verified_title"],
                    )
                )
            ).scalar_one_or_none()

            if existing:
                existing.legitimacy_score = score
                existing.legitimacy_reasoning = reasoning
                existing.article_summary = s["summary"]
                existing.scan_id = scan.id
                existing.pageid = s["pageid"]
                existing.article_url = f"https://en.wikipedia.org/wiki/{s['verified_title'].replace(' ', '_')}"
                # status preserved for user-acted candidates
                persisted += 1
            else:
                db.add(
                    WikipediaCandidate(
                        brand_id=brand_id,
                        prompt_id=s.get("discovered_via_prompt_id"),
                        scan_id=scan.id,
                        article_title=s["verified_title"],
                        article_url=f"https://en.wikipedia.org/wiki/{s['verified_title'].replace(' ', '_')}",
                        pageid=s["pageid"],
                        article_summary=s["summary"],
                        legitimacy_score=score,
                        legitimacy_reasoning=reasoning,
                        status="new",
                        created_at=datetime.now(UTC).replace(tzinfo=None),
                    )
                )
                persisted += 1

        scan.candidates_persisted = persisted
        scan.status = "completed"
        scan.completed_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
        await db.refresh(scan)
        return scan
    except Exception as e:
        logger.exception("Scan %d failed: %s", scan.id, e)
        scan.status = "failed"
        scan.error_message = str(e)[:1000]
        scan.completed_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
        await db.refresh(scan)
        return scan
