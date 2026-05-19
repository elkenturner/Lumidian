"""Wikipedia drafter — produces a locked-article suggested edit for a candidate."""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    BrandProfile,
    Prompt,
    WikipediaCandidate,
)
from app.services.drafting.client import call_claude
from app.services.drafting.evidence import build_evidence_pack
from app.services.drafting.models import writer_model_for_tier
from app.services.drafting.pipeline import parse_wikipedia_draft
from app.services.drafting.prompts import build_wikipedia_prompt
from app.services.drafting_service import (
    _analyze_responses_for_prompt,
    _extract_publications,
    _load_profile_context,
)
from app.services.wikipedia.api_client import fetch_wikitext_and_sections

logger = logging.getLogger(__name__)


class ArticleNotFoundError(Exception):
    """Article has been deleted or renamed since the scan."""


class TitleMismatchError(Exception):
    """LLM returned wikitext for a different article than the locked title."""


_TITLE_NORMALIZE_RE = re.compile(r"[\s_]+")


def _normalize_title(t: str) -> str:
    return _TITLE_NORMALIZE_RE.sub(" ", (t or "").strip().lower())


def _extract_citation_needed(wikitext: str) -> list[str]:
    """Return a short list of context strings around each {{citation needed}} template."""
    hints: list[str] = []
    for match in re.finditer(r"\{\{citation needed[^}]*\}\}", wikitext, flags=re.IGNORECASE):
        start = max(match.start() - 80, 0)
        end = min(match.end() + 20, len(wikitext))
        snippet = wikitext[start:end].strip().replace("\n", " ")
        hints.append(snippet)
        if len(hints) >= 5:
            break
    return hints


async def _call_writer(prompt: str, *, tier: str | None) -> str:
    return (await call_claude(prompt=prompt, max_tokens=1500, model=writer_model_for_tier(tier))).strip()


async def draft_candidate(
    db: AsyncSession,
    *,
    candidate_id: int,
    tier: str | None,
) -> WikipediaCandidate:
    """Produce a suggested wikitext edit for the candidate. Persists in place."""
    candidate = (
        await db.execute(select(WikipediaCandidate).where(WikipediaCandidate.id == candidate_id))
    ).scalar_one()
    brand = (
        await db.execute(select(Brand).where(Brand.id == candidate.brand_id))
    ).scalar_one()
    profile = (
        await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
    ).scalar_one_or_none()
    prompt_row: Prompt | None = None
    if candidate.prompt_id:
        prompt_row = (
            await db.execute(select(Prompt).where(Prompt.id == candidate.prompt_id))
        ).scalar_one_or_none()

    # Fetch current article state
    wikitext, sections = await fetch_wikitext_and_sections(candidate.pageid)
    if not wikitext:
        candidate.status = "dismissed"
        candidate.last_status_change_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
        raise ArticleNotFoundError(
            f"Article '{candidate.article_title}' (pageid {candidate.pageid}) is no longer available"
        )

    cn_hints = _extract_citation_needed(wikitext)

    # Build inputs — reuse existing helpers from drafting_service
    try:
        profile_context = await _load_profile_context(db, brand.id)
    except Exception:
        profile_context = f"Name: {brand.name}"

    prompt_text = prompt_row.text if prompt_row else candidate.article_title

    response_analysis = ""
    if prompt_row:
        try:
            response_analysis = await _analyze_responses_for_prompt(db, brand.id, prompt_row.id)
        except Exception:
            logger.exception("_analyze_responses_for_prompt failed (non-fatal)")

    publications = _extract_publications(profile) if profile else []

    evidence_pack = None
    if prompt_row is not None:
        try:
            evidence_pack = await build_evidence_pack(
                brand_id=brand.id,
                brand_name=brand.name,
                prompt_id=prompt_row.id,
                prompt_text=prompt_text,
                db=db,
            )
        except Exception:
            logger.exception("build_evidence_pack failed (non-fatal)")

    locked_title = candidate.article_title

    async def _generate_once(extra_lock_hint: bool = False) -> tuple:
        title_for_lock = locked_title + (" — DO NOT SUBSTITUTE" if extra_lock_hint else "")
        prompt_for_llm = build_wikipedia_prompt(
            brand_name=brand.name,
            prompt_text=prompt_text,
            profile_context=profile_context,
            response_analysis=response_analysis,
            publications=publications,
            website_url=brand.website_url,
            evidence_pack=evidence_pack,
            locked_article_title=title_for_lock,
            article_section_list=sections,
            citation_needed_hints=cn_hints,
        )
        raw = await _call_writer(prompt_for_llm, tier=tier)
        return parse_wikipedia_draft(raw)

    article_title, article_url, section, insert_location, wiki_text = await _generate_once()

    if _normalize_title(article_title) != _normalize_title(locked_title):
        # One auto-retry with stronger instruction
        article_title, article_url, section, insert_location, wiki_text = await _generate_once(
            extra_lock_hint=True
        )
        if _normalize_title(article_title) != _normalize_title(locked_title):
            raise TitleMismatchError(
                f"LLM produced wikitext for '{article_title}' but candidate locked to '{locked_title}'"
            )

    # Persist
    candidate.suggested_wikitext = wiki_text
    candidate.suggested_section = section
    candidate.suggested_insert_location = insert_location
    candidate.last_drafted_at = datetime.now(UTC).replace(tzinfo=None)
    if evidence_pack and evidence_pack.sources:
        candidate.evidence_pack_used = {"source_refs": [s.ref for s in evidence_pack.sources]}
    # Only advance status if it is still "new" — preserve "drafted", "submitted", etc.
    if candidate.status == "new":
        candidate.status = "drafted"
        candidate.last_status_change_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()
    await db.refresh(candidate)
    return candidate
