"""Audit orchestrator: crawl → parse → score → link → recommend → persist."""
from __future__ import annotations

import asyncio
import json
import logging
from urllib.parse import urljoin

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Brand, CitationSource, Prompt, WebsiteAudit, WebsiteAuditFinding,
    WebsiteAuditPage, WebsiteAuditRecommendation, utcnow,
)
from app.services.site_audit.constants import (
    PER_AUDIT_BUDGET_S, RENDER_SAMPLE_SIZE, RENDERED_CRAWL_MAX_PAGES, normalise_url,
)
from app.services.site_audit.crawler import crawl_site, discover_sitemap_urls
from app.services.site_audit.fetcher import (
    classify_render_mode, fetch_raw, fetch_rendered, rendered_fetch_session,
)
from app.services.site_audit.page_classifier import classify_page
from app.services.site_audit.page_prompt_link import (
    PageLinkInput, PromptLinkInput, link_pages_to_prompts,
)
from app.services.site_audit.parsers import Finding
from app.services.site_audit.parsers.llms_txt import parse_llms_txt
from app.services.site_audit.parsers.meta import parse_meta
from app.services.site_audit.parsers.robots import parse_robots
from app.services.site_audit.parsers.schema import parse_schema
from app.services.site_audit.parsers.semantic import parse_semantic
from app.services.site_audit.recommendations import (
    build_rule_based_recs, render_rec_for_csr_page,
)
from app.services.site_audit.scoring import (
    PageScoreInputs, score_audit, score_bot_access, score_page,
)

logger = logging.getLogger(__name__)


async def run_audit(*, brand_id: int, triggered_by: str, max_pages: int) -> int:
    """Top-level entry. Creates a WebsiteAudit row and runs to completion.

    Returns the audit_id. Never raises; on failure, audit.status='failed'
    and error_message is set.
    """
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if brand is None or not brand.website_url:
            raise ValueError("brand not found or has no website_url")

        audit = WebsiteAudit(
            brand_id=brand_id, status="pending", triggered_by=triggered_by,
            started_at=utcnow(),
        )
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        audit_id = audit.id

    try:
        await asyncio.wait_for(_run_audit_inner(audit_id, brand_id, max_pages),
                                timeout=PER_AUDIT_BUDGET_S + 30)
    except asyncio.TimeoutError:
        await _mark_failed(audit_id, "audit budget exceeded")
    except Exception as exc:  # noqa: BLE001
        logger.exception("audit %d failed", audit_id)
        await _mark_failed(audit_id, f"unexpected error: {exc}")
    return audit_id


async def _mark_failed(audit_id: int, msg: str) -> None:
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit:
            audit.status = "failed"
            audit.error_message = msg
            audit.completed_at = utcnow()
            await db.commit()


# Markers that identify an anti-bot challenge interstitial rather than real
# site content (Cloudflare managed challenge / Turnstile page).
_CF_CHALLENGE_MARKERS = (
    "just a moment",
    "challenges.cloudflare.com",
    "cf-chl",
    "checking your browser",
)


def _assess_crawl_block(pages) -> str | None:
    """Return an actionable failure message when the crawl produced zero usable
    pages because the site's bot protection rejected every request.

    A usable page is HTTP 200 with a body. Without this check a fully-blocked
    crawl scores the challenge/error page as if it were the site (MSC prod
    audits 8 + 12: "completed", total_pages=1, the one page a Cloudflare 403).
    """
    if not pages:
        return None  # unreachable-host path; handled elsewhere
    if any(p.status == 200 and p.html for p in pages):
        return None
    blocked = [p for p in pages if p.status in (401, 403, 429, 503)]
    if not blocked:
        return None
    remedy = (
        "Ask the site administrator to allowlist the user agent "
        "'LumidianAuditBot' (https://lumidian.ai/bot) in their firewall or bot "
        "protection settings, then re-run the audit."
    )
    if any(
        marker in (p.html or "").lower()
        for p in blocked
        for marker in _CF_CHALLENGE_MARKERS
    ):
        return (
            "The site's bot protection (Cloudflare) blocked our crawler — every "
            f"page request ({len(pages)} attempted) returned an anti-bot challenge "
            f"instead of content. {remedy}"
        )
    return (
        "The site blocked our crawler — every page request "
        f"({len(pages)} attempted) was rejected "
        f"(HTTP {blocked[0].status}). {remedy}"
    )


async def _run_audit_inner(audit_id: int, brand_id: int, max_pages: int) -> None:
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        root = (brand.website_url or "").rstrip("/") + "/"

    # ── crawling phase ────────────────────────────────────────────────────
    await _set_status(audit_id, "crawling")

    sitemap_urls, sitemap_src = await discover_sitemap_urls(root)
    seed_urls = sitemap_urls[:max_pages] if sitemap_urls else None
    pages_crawled = await crawl_site(root, max_pages=max_pages, max_depth=3, seed_urls=seed_urls)

    # Blocked-crawl escalation: bot UA → browser headers → rendered browser.
    # Only kicks in when the standard crawl produced zero usable pages, so an
    # unprotected site never pays for it.
    crawl_mode = "bot"
    block_msg = _assess_crawl_block(pages_crawled)
    if block_msg is not None:
        logger.info("site_audit %d: bot crawl blocked, retrying with browser headers", audit_id)
        from functools import partial

        browser_fetch = partial(fetch_raw, browser_profile=True)
        sm_urls, sm_src = await discover_sitemap_urls(root, fetcher=browser_fetch)
        retry_seeds = sm_urls[:max_pages] if sm_urls else None
        retry = await crawl_site(
            root, max_pages=max_pages, max_depth=3, seed_urls=retry_seeds, fetcher=browser_fetch
        )
        if _assess_crawl_block(retry) is None:
            pages_crawled, crawl_mode, block_msg = retry, "browser_headers", None
            if sm_src:
                sitemap_src = sm_src
    if block_msg is not None:
        logger.info("site_audit %d: browser-header crawl blocked, retrying rendered", audit_id)
        async with rendered_fetch_session() as rendered_fetch:
            rendered = await crawl_site(
                root,
                max_pages=min(max_pages, RENDERED_CRAWL_MAX_PAGES),
                max_depth=3,
                seed_urls=None,
                fetcher=rendered_fetch,
            )
        if _assess_crawl_block(rendered) is None:
            pages_crawled, crawl_mode, block_msg = rendered, "rendered", None
    if block_msg is not None:
        logger.warning("site_audit %d: crawl blocked — %s", audit_id, block_msg)
        await _mark_failed(audit_id, block_msg)
        return

    # robots.txt + llms.txt + agents.md
    robots_res = await fetch_raw(urljoin(root, "robots.txt"))
    robots_content = robots_res.html if robots_res.status == 200 else None
    llms_res = await fetch_raw(urljoin(root, "llms.txt"))
    llms_content = llms_res.html if llms_res.status == 200 else None
    agents_res = await fetch_raw(urljoin(root, "agents.md"))
    agents_content = agents_res.html if agents_res.status == 200 else None

    # Render-mode detection on a sample. Skipped when the crawl itself was
    # rendered (raw fetches are blocked, so there is no raw/rendered pair to
    # compare) — site_render_mode stays "unknown".
    sample_indexes = (
        [] if crawl_mode == "rendered" else _sample_indexes(len(pages_crawled), RENDER_SAMPLE_SIZE)
    )
    rendered_modes: list[str] = []
    is_js_rendered_by_url: dict[str, bool] = {}
    for i in sample_indexes:
        if i >= len(pages_crawled):
            continue
        page = pages_crawled[i]
        if not page.html:
            continue
        rendered = await fetch_rendered(page.url)
        if rendered.error:
            logger.info("fetch_rendered failed for %s: %s", page.url, rendered.error)
        mode = classify_render_mode(page.html, rendered.html or "")
        rendered_modes.append(mode)
        is_js_rendered_by_url[page.url] = (mode == "csr")

    site_render_mode = _majority(rendered_modes) if rendered_modes else "unknown"

    # Platform detection — sniff homepage HTML for Wix/Shopify/Webflow/etc.
    from app.services.site_audit.platform_detector import detect_platform
    homepage_html = pages_crawled[0].html if pages_crawled else None
    cms_platform = detect_platform(homepage_html)

    # ── analyzing phase ──────────────────────────────────────────────────
    await _set_status(audit_id, "analyzing")

    site_findings: list[Finding] = []
    if crawl_mode != "bot":
        fallback_label = (
            "realistic browser headers" if crawl_mode == "browser_headers" else "a full rendered browser"
        )
        site_findings.append(Finding(
            "bot_protection_challenge", "medium", "bot_access",
            f"The site's bot protection blocked our standard crawler; this audit used {fallback_label} "
            "as a fallback. Unverified bots are being challenged — verify that AI crawlers "
            "(GPTBot, ClaudeBot, PerplexityBot, Google-Extended) are permitted in your bot protection "
            "settings, or they may not be able to read your content.",
            evidence={"crawl_mode": crawl_mode},
        ))
    robots_out = parse_robots(robots_content, root)
    site_findings.extend(robots_out.findings)
    bot_status = robots_out.measurements.get("bot_status", {})

    llms_out = parse_llms_txt(llms_content)
    site_findings.extend(llms_out.findings)

    from app.services.site_audit.parsers.agents_md import parse_agents_md
    site_findings.extend(parse_agents_md(agents_content))

    # Per-page parsing
    page_records: list[dict] = []

    from app.services.site_audit.parsers.eeat import parse_eeat
    from app.services.site_audit.parsers.qa import parse_qa
    from bs4 import BeautifulSoup as _BS

    for crawl_page in pages_crawled:
        page_type = classify_page(crawl_page.url, crawl_page.html)
        sem = parse_semantic(crawl_page.html or "", crawl_page.url)
        sch = parse_schema(crawl_page.html or "", crawl_page.url, page_type)
        mta = parse_meta(crawl_page.html or "", crawl_page.url, page_type)

        # New: E-E-A-T + Q&A. Both share a BS4 parse — do it once.
        soup_cached = _BS(crawl_page.html or "", "lxml")
        eeat_findings = parse_eeat(soup_cached, crawl_page.url, page_type)
        qa_findings = parse_qa(soup_cached, crawl_page.url, page_type)

        per_page_findings = sem.findings + sch.findings + mta.findings + eeat_findings + qa_findings
        is_js = is_js_rendered_by_url.get(crawl_page.url, False)

        # Severity counts for scoring
        sev_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for f in per_page_findings:
            sev_counts[f.severity] = sev_counts.get(f.severity, 0) + 1

        inputs = PageScoreInputs(
            word_count=sem.measurements["word_count"],
            h2_count=sem.measurements["h2_count"],
            table_count=sem.measurements["table_count"],
            list_count=sem.measurements["list_count"],
            fact_density=sem.measurements["fact_density"],
            outbound_links=sem.measurements["outbound_links"],
            internal_links=sem.measurements["internal_links"],
            image_alt_pct=mta.measurements["image_alt_pct"],
            has_jsonld=sch.measurements["has_jsonld"],
            schema_types_count=len(sch.measurements["schema_types"]),
            is_js_rendered=is_js,
            http_status=crawl_page.status,
            fetch_ms=crawl_page.fetch_ms,
            findings_by_severity=sev_counts,
        )
        scores = score_page(inputs)
        page_records.append({
            "url": crawl_page.url,
            "depth": crawl_page.depth,
            "http_status": crawl_page.status,
            "fetch_ms": crawl_page.fetch_ms,
            "fetch_error": crawl_page.error,
            "page_type": page_type,
            "measurements": {**sem.measurements, **sch.measurements, **mta.measurements,
                             "is_js_rendered": is_js,
                             "raw_html_size": len(crawl_page.html or ""),
                             "rendered_html_size": None},
            "findings": per_page_findings,
            "scores": scores,
            "content_excerpt": crawl_page.content_excerpt,
        })

    # ── site-level: internal linking analysis ─────────────────────────────
    from app.services.site_audit.parsers.linking import parse_linking

    pages_by_url = {
        normalise_url(rec["url"]): {
            "links": rec["measurements"].get("links", []),
            "http_status": rec["http_status"],
            "page_type": rec["page_type"],
        }
        for rec in page_records
    }
    linking_findings = parse_linking(pages_by_url, root)
    # Merge into per-page findings by URL match
    for rec in page_records:
        url = normalise_url(rec["url"])
        extra = linking_findings.get(url, [])
        if extra:
            rec["findings"].extend(extra)

    # ── persist ───────────────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        for rec in page_records:
            m = rec["measurements"]
            page_row = WebsiteAuditPage(
                audit_id=audit_id,
                url=normalise_url(rec["url"]),
                depth=rec["depth"],
                http_status=rec["http_status"],
                fetch_ms=rec["fetch_ms"],
                page_type=rec["page_type"],
                word_count=m.get("word_count", 0),
                title=m.get("title"),
                meta_description=m.get("meta_description"),
                h1_text=m.get("h1_text"),
                h2_count=m.get("h2_count", 0),
                h3_count=m.get("h3_count", 0),
                table_count=m.get("table_count", 0),
                list_count=m.get("list_count", 0),
                fact_density=m.get("fact_density", 0.0),
                outbound_links=m.get("outbound_links", 0),
                internal_links=m.get("internal_links", 0),
                image_count=m.get("image_count", 0),
                image_alt_pct=m.get("image_alt_pct", 0.0),
                has_jsonld=m.get("has_jsonld", False),
                schema_types=json.dumps(m.get("schema_types") or []),
                is_js_rendered=m.get("is_js_rendered", False),
                page_score=rec["scores"]["page_score"],
                content_score=rec["scores"]["content_score"],
                structure_score=rec["scores"]["structure_score"],
                schema_score=rec["scores"]["schema_score"],
                raw_html_size=m.get("raw_html_size"),
                fetch_error=rec.get("fetch_error"),
                content_excerpt=rec.get("content_excerpt"),
            )
            db.add(page_row)
            await db.flush()
            rec["page_id"] = page_row.id
            for f in rec["findings"]:
                db.add(WebsiteAuditFinding(
                    audit_id=audit_id, page_id=page_row.id,
                    check_id=f.check_id, severity=f.severity, category=f.category,
                    message=f.message, evidence=json.dumps(f.evidence),
                ))

        # Site-level findings
        for f in site_findings:
            db.add(WebsiteAuditFinding(
                audit_id=audit_id, page_id=None,
                check_id=f.check_id, severity=f.severity, category=f.category,
                message=f.message, evidence=json.dumps(f.evidence),
            ))

        await db.commit()

    # ── page↔prompt linking ──────────────────────────────────────────────
    page_link_inputs = [
        PageLinkInput(id=rec["page_id"], url=rec["url"],
                       title=rec["measurements"].get("title"),
                       page_type=rec["page_type"])
        for rec in page_records
    ]
    prompt_link_inputs = await _build_prompt_link_inputs(brand_id)
    page_link_map = link_pages_to_prompts(page_link_inputs, prompt_link_inputs)

    # check_ids that represent SITE-WIDE fixes — should fire once per audit even
    # if the underlying finding triggered on multiple pages (e.g. Organization
    # schema can be added once to the global layout, not per page).
    _SITE_WIDE_CHECK_IDS = {
        "missing_organization_schema",
        "incomplete_organization_schema",
        "no_jsonld",  # generic — handle once per site
    }

    # ── recommendations ───────────────────────────────────────────────────
    seen_site_wide: set[str] = set()
    async with AsyncSessionLocal() as db:
        # Per-page recs from per-page findings
        for rec in page_records:
            recs = build_rule_based_recs(
                findings=rec["findings"],
                page_link_map=page_link_map,
                page_id=rec["page_id"],
            )
            if rec["measurements"].get("is_js_rendered"):
                recs.append(render_rec_for_csr_page(
                    rec["page_id"], page_link_map.get(rec["page_id"], [])
                ))
            page_url = rec.get("url")
            for r in recs:
                # Site-wide dedup: skip if we've already emitted this check_id.
                if r.check_id in _SITE_WIDE_CHECK_IDS:
                    if r.check_id in seen_site_wide:
                        continue
                    seen_site_wide.add(r.check_id)
                    # Site-wide recs: detach from page_id so they read as global.
                    db.add(WebsiteAuditRecommendation(
                        audit_id=audit_id, page_id=None,
                        priority=r.priority, effort=r.effort, category=r.category,
                        title=r.title, body=r.body,
                        linked_prompt_ids=None,
                        expected_impact=r.expected_impact,
                        llm_generated=r.llm_generated,
                        artifact_type=r.artifact_type,
                        expected_lift_pp=r.expected_lift_pp,
                        priority_score=r.priority_score,
                        target_url=None,
                    ))
                    continue
                db.add(WebsiteAuditRecommendation(
                    audit_id=audit_id, page_id=rec["page_id"],
                    priority=r.priority, effort=r.effort, category=r.category,
                    title=r.title, body=r.body,
                    linked_prompt_ids=json.dumps(r.linked_prompt_ids) if r.linked_prompt_ids else None,
                    expected_impact=r.expected_impact,
                    llm_generated=r.llm_generated,
                    artifact_type=r.artifact_type,
                    expected_lift_pp=r.expected_lift_pp,
                    priority_score=r.priority_score,
                    target_url=page_url,
                ))

        # Site-level recs from site-level findings (no page_id)
        site_recs = build_rule_based_recs(site_findings, page_link_map={}, page_id=None)
        for r in site_recs:
            db.add(WebsiteAuditRecommendation(
                audit_id=audit_id, page_id=None,
                priority=r.priority, effort=r.effort, category=r.category,
                title=r.title, body=r.body,
                linked_prompt_ids=None, expected_impact=r.expected_impact,
                llm_generated=False,
                artifact_type=r.artifact_type,
                expected_lift_pp=r.expected_lift_pp,
                priority_score=r.priority_score,
            ))

        await db.commit()

    # Carry over applied/dismissed status from the most recent prior audit so
    # users don't have to re-acknowledge fixes they already handled. Matching
    # by (title, target_url) — title is stable for a given check_id, target_url
    # disambiguates per-page recs.
    await _carry_over_rec_status(brand_id=brand_id, new_audit_id=audit_id)

    # ── LLM rewrites (Growth/Pro tiers only) ────────────────────────────
    try:
        await _maybe_generate_llm_rewrites(
            audit_id=audit_id,
            brand_id=brand_id,
            page_records=page_records,
            page_link_map=page_link_map,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM rewrite pass failed for audit %d: %s", audit_id, exc)

    async with AsyncSessionLocal() as db:
        # Scores
        bot_score = score_bot_access(bot_status)
        content_avg = sum(rec["scores"]["content_score"] for rec in page_records) / max(len(page_records), 1)
        schema_avg = sum(rec["scores"]["schema_score"] for rec in page_records) / max(len(page_records), 1)
        technical_avg = sum(rec["scores"]["page_score"] for rec in page_records) / max(len(page_records), 1)

        audit = await db.get(WebsiteAudit, audit_id)
        scores = score_audit(
            bot_access=bot_score, content=content_avg, schema=schema_avg, technical=technical_avg,
        )
        audit.overall_score = scores["overall_score"]
        audit.bot_access_score = scores["bot_access_score"]
        audit.content_score = scores["content_score"]
        audit.schema_score = scores["schema_score"]
        audit.technical_score = scores["technical_score"]
        audit.total_pages = len(page_records)
        audit.pages_failed = sum(1 for r in page_records if r.get("fetch_error"))
        audit.render_mode = site_render_mode
        audit.sitemap_url = sitemap_src
        audit.robots_txt_raw = (robots_content or "")[:8192] if robots_content else None
        audit.llms_txt_present = llms_out.measurements["present"]
        audit.llms_txt_valid = llms_out.measurements["valid"]
        audit.cms_platform = cms_platform
        audit.status = "completed"
        audit.completed_at = utcnow()
        await db.commit()


async def _set_status(audit_id: int, status: str) -> None:
    async with AsyncSessionLocal() as db:
        audit = await db.get(WebsiteAudit, audit_id)
        if audit:
            audit.status = status
            await db.commit()


async def _carry_over_rec_status(*, brand_id: int, new_audit_id: int) -> None:
    """Propagate applied/dismissed status from the prior audit's recs to the
    new audit. Match by (title, target_url) — title is stable per check_id,
    target_url disambiguates per-page recs (NULL == NULL for site-wide recs).
    """
    async with AsyncSessionLocal() as db:
        # Find the most recent COMPLETED audit for this brand that's older than the new one.
        prior_audit = (
            await db.execute(
                select(WebsiteAudit)
                .where(
                    WebsiteAudit.brand_id == brand_id,
                    WebsiteAudit.id != new_audit_id,
                    WebsiteAudit.status == "completed",
                )
                .order_by(WebsiteAudit.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not prior_audit:
            return

        prior_recs = (
            await db.execute(
                select(WebsiteAuditRecommendation).where(
                    WebsiteAuditRecommendation.audit_id == prior_audit.id,
                    WebsiteAuditRecommendation.status.in_(("applied", "dismissed")),
                )
            )
        ).scalars().all()
        if not prior_recs:
            return

        # Build a lookup from (title, target_url) → status, choosing 'applied'
        # over 'dismissed' if both exist for the same key.
        prior_status: dict[tuple[str, str | None], str] = {}
        for r in prior_recs:
            key = (r.title, r.target_url)
            existing = prior_status.get(key)
            if existing == "applied":
                continue
            prior_status[key] = r.status

        if not prior_status:
            return

        new_recs = (
            await db.execute(
                select(WebsiteAuditRecommendation).where(
                    WebsiteAuditRecommendation.audit_id == new_audit_id,
                )
            )
        ).scalars().all()

        carried = 0
        for r in new_recs:
            key = (r.title, r.target_url)
            inherited = prior_status.get(key)
            if inherited and r.status == "pending":
                r.status = inherited
                carried += 1
        if carried:
            await db.commit()
            logger.info(
                "Carried over %d rec status flags from audit %d → %d",
                carried, prior_audit.id, new_audit_id,
            )


async def _build_prompt_link_inputs(brand_id: int) -> list[PromptLinkInput]:
    async with AsyncSessionLocal() as db:
        prompts = (await db.execute(
            select(Prompt).where(Prompt.brand_id == brand_id)
        )).scalars().all()
        out: list[PromptLinkInput] = []
        for p in prompts:
            cites = (await db.execute(
                select(CitationSource.url).where(
                    CitationSource.brand_id == brand_id,
                    CitationSource.prompt_id == p.id,
                    CitationSource.kind.in_(["competitor", "third_party"]),
                )
            )).all()
            out.append(PromptLinkInput(id=p.id, text=p.text, cited_urls=[r[0] for r in cites]))
        return out


def _majority(values: list[str]) -> str:
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _sample_indexes(total: int, k: int) -> list[int]:
    if total <= k:
        return list(range(total))
    return [0, total // 4, total // 2, (3 * total) // 4, total - 1][:k]


async def _maybe_generate_llm_rewrites(
    *,
    audit_id: int,
    brand_id: int,
    page_records: list[dict],
    page_link_map: dict[int, list[int]],
) -> None:
    """For tiers that include LLM rewrites, generate one for the top-N pages."""
    from app.models import BrandProfile, Prompt, User
    from app.services.site_audit.constants import TIER_AUDIT_LIMITS
    from app.services.site_audit.recommendations import generate_llm_rewrite

    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if brand is None:
            return
        owner = await db.get(User, brand.user_id)
        tier = owner.subscription_tier if owner else None
        limits = TIER_AUDIT_LIMITS.get(tier or "")
        n_pages = (limits or {}).get("llm_rewrites", 0)
        if n_pages <= 0:
            return
        profile = (await db.execute(
            select(BrandProfile).where(BrandProfile.brand_id == brand_id)
        )).scalar_one_or_none()
        # Prompt text for linked prompts (limit to 5)
        prompt_text_by_id: dict[int, str] = {}
        all_prompt_ids = {pid for ids in page_link_map.values() for pid in ids}
        if all_prompt_ids:
            prompts = (await db.execute(
                select(Prompt).where(Prompt.id.in_(all_prompt_ids))
            )).scalars().all()
            prompt_text_by_id = {p.id: p.text for p in prompts}

        brand_name = brand.name
        tone = (profile.tone_of_voice if profile else None) or "professional, factual"
        what_not_to_say = (profile.what_not_to_say if profile else None) or ""

    brand_profile_dict = {
        "name": brand_name,
        "tone_of_voice": tone,
        "what_not_to_say": what_not_to_say,
    }

    # Rank pages by (linked_prompt_count DESC, page_score ASC)
    def _rank_key(rec: dict) -> tuple[int, float]:
        n = len(page_link_map.get(rec.get("page_id", -1), []))
        score = rec["scores"]["page_score"] or 100.0
        return (-n, score)

    ranked = sorted(page_records, key=_rank_key)
    selected = ranked[:n_pages]

    async with AsyncSessionLocal() as db:
        for rec in selected:
            # Build a short excerpt from the crawl_page's HTML (first ~4KB of body text)
            # The page record stored raw_html_size but not the html itself; we have to
            # reconstruct from measurements OR re-fetch. Simplest: re-fetch the URL.
            from app.services.site_audit.fetcher import fetch_raw
            r = await fetch_raw(rec["url"])
            html = r.html or ""
            excerpt = _extract_first_h2_section(html)

            findings = rec["findings"]
            linked_ids = page_link_map.get(rec["page_id"], [])
            linked_texts = [prompt_text_by_id[i] for i in linked_ids if i in prompt_text_by_id][:5]
            rewrite = await generate_llm_rewrite(
                page_excerpt=excerpt,
                findings=findings,
                brand_profile=brand_profile_dict,
                linked_prompts=linked_texts,
            )
            if not rewrite:
                continue
            from app.services.site_audit.recommendations import (
                EFFORT_MINUTES,
                compute_priority_score,
            )
            lift = 15.0
            ps = compute_priority_score(
                expected_lift_pp=lift,
                pages_affected=1,
                effort_minutes=EFFORT_MINUTES["medium"],
            )
            db.add(WebsiteAuditRecommendation(
                audit_id=audit_id,
                page_id=rec["page_id"],
                priority="high",
                effort="medium",
                category="content",
                title="Rewrite this page's first section",
                body=rewrite,
                linked_prompt_ids=json.dumps(linked_ids) if linked_ids else None,
                expected_impact="AI-generated rewrite for top-priority page",
                llm_generated=True,
                artifact_type="section_rewrite",
                artifact=rewrite,
                artifact_generated_at=utcnow(),
                expected_lift_pp=lift,
                priority_score=ps,
                target_url=rec.get("url"),
            ))
        await db.commit()


def _extract_first_h2_section(html: str) -> str:
    """Cheap extractor: grab the first ~4KB of body text after the first <h2>."""
    if not html:
        return ""
    import re
    # find first <h2 ... > and take everything until next <h2 or end-of-body
    m = re.search(r"<h2[^>]*>", html, re.IGNORECASE)
    if not m:
        return html[:4000]
    start = m.start()
    next_h2 = html.find("<h2", m.end())
    end = next_h2 if next_h2 > 0 else len(html)
    return html[start:end][:4000]
