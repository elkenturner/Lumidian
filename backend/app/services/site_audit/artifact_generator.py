"""Artifact generator: dispatch by artifact_type to per-type generators.

This module is the entry point for the "Draft this" button on Fix Cards
in the redesigned Site Audit UI. Each artifact_type maps to a function
that produces a paste-ready string (JSON-LD, HTML, plain text, etc.)
from the recommendation + brand profile + target page context.

Generators register themselves via @register_rule or @register_llm
decorators. The dispatcher loads context (rec/audit/brand/profile/page),
calls the matching generator, and persists the result.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Awaitable, Callable

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand,
    BrandProfile,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
    utcnow,
)

logger = logging.getLogger(__name__)

# All known artifact types.
ARTIFACT_TYPES: set[str] = {
    "jsonld_org",
    "jsonld_faq",
    "jsonld_article",
    "jsonld_breadcrumb",
    "jsonld_product",
    "jsonld_howto",
    "meta_title",
    "meta_description",
    "h1_text",
    "og_tags",
    "faq_section",
    "section_rewrite",
    "new_page_draft",
    "alt_text_batch",
    "llms_txt",
    "robots_snippet",
    "agents_md",
    "internal_link_suggestions",
}

# Subset that requires an LLM call. The remainder are rule-based template fills.
LLM_ARTIFACT_TYPES: set[str] = {
    "jsonld_faq",
    "jsonld_article",
    "jsonld_product",
    "jsonld_howto",
    "meta_title",
    "meta_description",
    "h1_text",
    "og_tags",
    "faq_section",
    "section_rewrite",
    "new_page_draft",
    "alt_text_batch",
    "internal_link_suggestions",
}


@dataclass
class ArtifactResult:
    """Return type from any per-type generator function."""
    artifact: str
    artifact_type: str


@dataclass
class GeneratorContext:
    """Inputs every generator receives. Generators choose which to use."""
    rec: WebsiteAuditRecommendation
    audit: WebsiteAudit
    brand: Brand
    profile: BrandProfile | None
    page: WebsiteAuditPage | None
    regenerate_notes: str | None


# Registries populated by decorators below. One function per artifact_type.
_RULE_GENERATORS: dict[str, Callable[[GeneratorContext], Awaitable[ArtifactResult]]] = {}
_LLM_GENERATORS: dict[str, Callable[[GeneratorContext], Awaitable[ArtifactResult]]] = {}


def register_rule(artifact_type: str):
    """Decorator: register a rule-based (no LLM) generator."""
    def deco(fn):
        _RULE_GENERATORS[artifact_type] = fn
        return fn
    return deco


def register_llm(artifact_type: str):
    """Decorator: register an LLM-backed generator."""
    def deco(fn):
        _LLM_GENERATORS[artifact_type] = fn
        return fn
    return deco


def _ensure_generators_loaded() -> None:
    """Force-import generator modules so their decorators fire."""
    # Imported for side effects: each module's @register_rule / @register_llm
    # calls populate the registries.
    from app.services.site_audit import generators_artifact_rule  # noqa: F401


async def generate_artifact(
    rec_id: int,
    *,
    regenerate_notes: str | None = None,
) -> ArtifactResult:
    _ensure_generators_loaded()
    """Dispatch by `rec.artifact_type`. Persist result on the row.

    Raises ValueError if rec doesn't exist, lacks artifact_type, or that
    type has no registered generator.
    """
    async with AsyncSessionLocal() as db:
        rec = await db.get(WebsiteAuditRecommendation, rec_id)
        if not rec:
            raise ValueError(f"recommendation {rec_id} not found")
        if not rec.artifact_type:
            raise ValueError(f"recommendation {rec_id} has no artifact_type")
        audit = await db.get(WebsiteAudit, rec.audit_id)
        if not audit:
            raise ValueError(f"audit {rec.audit_id} not found")
        brand = await db.get(Brand, audit.brand_id)
        profile = (
            await db.execute(
                select(BrandProfile).where(BrandProfile.brand_id == brand.id)
            )
        ).scalar_one_or_none()
        page = await db.get(WebsiteAuditPage, rec.page_id) if rec.page_id else None

    ctx = GeneratorContext(
        rec=rec,
        audit=audit,
        brand=brand,
        profile=profile,
        page=page,
        regenerate_notes=regenerate_notes,
    )

    gen = _RULE_GENERATORS.get(rec.artifact_type) or _LLM_GENERATORS.get(rec.artifact_type)
    if not gen:
        raise ValueError(f"no generator registered for artifact_type={rec.artifact_type!r}")

    result = await gen(ctx)

    async with AsyncSessionLocal() as db:
        fresh = await db.get(WebsiteAuditRecommendation, rec_id)
        fresh.artifact = result.artifact
        fresh.artifact_type = result.artifact_type
        fresh.artifact_generated_at = utcnow()
        if regenerate_notes is not None:
            fresh.artifact_regen_count = (fresh.artifact_regen_count or 0) + 1
        await db.commit()

    return result
