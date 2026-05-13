"""Rule-based artifact generators (no LLM call).

Each generator builds a paste-ready artifact from template + BrandProfile +
crawl data. Registered with the artifact_generator dispatcher via
@register_rule.
"""
from __future__ import annotations

import json
from urllib.parse import urlparse

from app.services.site_audit.artifact_generator import (
    ArtifactResult,
    GeneratorContext,
    register_rule,
)
from app.services.site_audit.generators import (
    BrandSummary,
    KeyPage,
    build_llms_txt,
    build_robots_snippet,
)


def _socials_from_profile(profile) -> list[str]:
    """BrandProfile.publications is a free-form text field; pull URL lines out."""
    if not profile or not profile.publications:
        return []
    out: list[str] = []
    for line in profile.publications.splitlines():
        line = line.strip()
        if line.startswith("http://") or line.startswith("https://"):
            out.append(line)
    return out


@register_rule("jsonld_org")
async def gen_jsonld_org(ctx: GeneratorContext) -> ArtifactResult:
    brand = ctx.brand
    base = (brand.website_url or "").rstrip("/")
    block: dict = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": brand.name,
        "url": brand.website_url or "",
    }
    if base:
        block["logo"] = f"{base}/logo.png"
    if ctx.profile and ctx.profile.company_description:
        block["description"] = ctx.profile.company_description
    same_as = _socials_from_profile(ctx.profile)
    if same_as:
        block["sameAs"] = same_as
    body = (
        '<script type="application/ld+json">\n'
        + json.dumps(block, indent=2)
        + "\n</script>"
    )
    return ArtifactResult(artifact=body, artifact_type="jsonld_org")


@register_rule("jsonld_breadcrumb")
async def gen_jsonld_breadcrumb(ctx: GeneratorContext) -> ArtifactResult:
    if not ctx.page or not ctx.page.url:
        raise ValueError("jsonld_breadcrumb requires a target page")
    parsed = urlparse(ctx.page.url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    segments = [s for s in parsed.path.split("/") if s]
    items = [{
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": base + "/",
    }]
    cumulative = ""
    for i, seg in enumerate(segments, start=2):
        cumulative += "/" + seg
        items.append({
            "@type": "ListItem",
            "position": i,
            "name": seg.replace("-", " ").replace("_", " ").title(),
            "item": base + cumulative,
        })
    block = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items,
    }
    body = (
        '<script type="application/ld+json">\n'
        + json.dumps(block, indent=2)
        + "\n</script>"
    )
    return ArtifactResult(artifact=body, artifact_type="jsonld_breadcrumb")


def _top_pages(audit_id: int, limit: int = 10) -> list[KeyPage]:
    """Synchronous helper — not used; LLMs txt builder takes the list directly."""
    return []


@register_rule("llms_txt")
async def gen_llms_txt(ctx: GeneratorContext) -> ArtifactResult:
    from sqlalchemy import desc, select
    from app.database import AsyncSessionLocal
    from app.models import WebsiteAuditPage

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(WebsiteAuditPage)
                .where(
                    WebsiteAuditPage.audit_id == ctx.audit.id,
                    WebsiteAuditPage.http_status == 200,
                )
                .order_by(desc(WebsiteAuditPage.page_score))
                .limit(10)
            )
        ).scalars().all()
    pages = [
        KeyPage(
            url=p.url,
            title=p.title or p.url,
            page_type=p.page_type,
            score=p.page_score or 0.0,
        )
        for p in rows
    ]
    summary = BrandSummary(
        name=ctx.brand.name,
        website_url=ctx.brand.website_url or "https://example.com",
        description=(ctx.profile.company_description if ctx.profile else None),
    )
    txt = build_llms_txt(summary, pages)
    return ArtifactResult(artifact=txt, artifact_type="llms_txt")


@register_rule("robots_snippet")
async def gen_robots_snippet(ctx: GeneratorContext) -> ArtifactResult:
    return ArtifactResult(
        artifact=build_robots_snippet("allow_all"),
        artifact_type="robots_snippet",
    )


@register_rule("agents_md")
async def gen_agents_md(ctx: GeneratorContext) -> ArtifactResult:
    """Minimal agents.md — companion to llms.txt, geared at agent crawlers."""
    brand = ctx.brand
    base = (brand.website_url or "").rstrip("/")
    desc = ctx.profile.company_description if ctx.profile else None
    lines = [
        f"# {brand.name}",
        "",
        desc or f"{brand.name} — see {base or 'website'} for details.",
        "",
        "## Agent policy",
        "",
        "- Read-only access is welcome.",
        "- Cite the source URL when reproducing material.",
        "- Checkouts, account creation, and payments require human review.",
        "",
        "## Contact",
        "",
        f"- Site: {base or '—'}",
        "",
    ]
    return ArtifactResult(artifact="\n".join(lines), artifact_type="agents_md")
