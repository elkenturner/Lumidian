"""Backfill expected_lift_pp / artifact_type / priority_score on existing recs.

Existing WebsiteAuditRecommendation rows (from audits run before the fix-factory
landed) lack the new fields. This script walks them, looks up the matching
_RECS_META entry by title (the only stable identifier without check_id stored
on the row), and writes the missing fields.

Idempotent — only writes when fields are NULL.

Usage:
    python -m scripts.backfill_rec_metadata
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import WebsiteAuditRecommendation
from app.services.site_audit.recommendations import (
    EFFORT_MINUTES,
    _RECS,
    _RECS_META,
    _RENDER_REC,
    compute_priority_score,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _title_to_check_id() -> dict[str, str]:
    """Build reverse map from rec title → check_id.

    Includes _RECS entries plus the standalone _RENDER_REC (check_id="js_rendered_page").
    """
    out: dict[str, str] = {meta["title"]: cid for cid, meta in _RECS.items()}
    out[_RENDER_REC["title"]] = "js_rendered_page"
    # LLM rewrites use a fixed title — map to section_rewrite metadata
    out["Rewrite this page's first section"] = "answer_first_failed"
    return out


async def main() -> None:
    title_map = _title_to_check_id()
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(select(WebsiteAuditRecommendation))
        ).scalars().all()
    log.info("Loaded %d recommendations to inspect", len(rows))

    n_updated = 0
    n_skipped_no_match = 0
    n_skipped_already_filled = 0

    for r in rows:
        if (
            r.expected_lift_pp is not None
            and r.priority_score is not None
            and (r.artifact_type is not None or r.title in _NO_ARTIFACT_TITLES)
        ):
            n_skipped_already_filled += 1
            continue

        cid = title_map.get(r.title)
        if not cid:
            n_skipped_no_match += 1
            continue

        meta = _RECS_META.get(cid, {})
        if not meta:
            n_skipped_no_match += 1
            continue

        lift = meta.get("expected_lift_pp")
        artifact_type = meta.get("artifact_type")
        async with AsyncSessionLocal() as db:
            fresh = await db.get(WebsiteAuditRecommendation, r.id)
            if fresh is None:
                continue
            if fresh.expected_lift_pp is None and lift is not None:
                fresh.expected_lift_pp = float(lift)
            if fresh.artifact_type is None and artifact_type is not None:
                fresh.artifact_type = artifact_type
            if fresh.priority_score is None and lift is not None:
                fresh.priority_score = compute_priority_score(
                    expected_lift_pp=lift,
                    pages_affected=1,
                    effort_minutes=EFFORT_MINUTES.get(fresh.effort or "medium", 20),
                )
            await db.commit()
            n_updated += 1

    log.info(
        "Backfill done: %d updated, %d already filled, %d no match",
        n_updated, n_skipped_already_filled, n_skipped_no_match,
    )


# Titles whose recs intentionally have no draftable artifact (no_outbound_citations,
# fake_lists, etc.). We skip these from "needs artifact_type" check.
_NO_ARTIFACT_TITLES: set[str] = set()
for _cid, _meta in _RECS_META.items():
    if _meta.get("artifact_type") is None and _cid in _RECS:
        _NO_ARTIFACT_TITLES.add(_RECS[_cid]["title"])
if _RENDER_REC["title"] not in _NO_ARTIFACT_TITLES:
    _NO_ARTIFACT_TITLES.add(_RENDER_REC["title"])


if __name__ == "__main__":
    asyncio.run(main())
