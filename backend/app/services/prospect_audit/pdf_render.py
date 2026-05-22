"""Render the prospect audit Jinja2 template to PDF bytes via Playwright Chromium.

Reuses the same `async_playwright` pattern as `services/site_audit/pdf_renderer.py`.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.models import ProspectAudit
from app.services.prospect_audit.competitor_detect import DetectedCompetitor
from app.services.prospect_audit.recommendations import AuditSummaryForRecs
from app.services.prospect_audit.scoring import PromptScore

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=select_autoescape(["html", "j2"]))


def _kind_for(p: PromptScore) -> str:
    """Classify a prompt by what action it suggests.

    - 'loss' — competitors lead (own < peer_avg)
    - 'untapped' — both own and peers at 0% (greenfield)
    - 'uncontested' — own > 0, peers at 0%
    - 'tied' — own == peer_avg, both > 0
    - 'lead' — own > peer_avg, both > 0
    """
    own = p.own_visibility_pct
    peer = p.peer_avg_visibility_pct
    if own == 0 and peer == 0:
        return "untapped"
    if peer == 0 and own > 0:
        return "uncontested"
    if own < peer:
        return "loss"
    if own == peer:
        return "tied"
    return "lead"


_KIND_DISPLAY_ORDER = {"loss": 0, "untapped": 1, "tied": 2, "lead": 3, "uncontested": 4}


def _scorecard_sort_key(p: PromptScore) -> tuple[int, float, int]:
    """Sort the per-prompt scorecard: losses first, untapped next, then wins."""
    kind = _kind_for(p)
    own = p.own_visibility_pct
    peer = p.peer_avg_visibility_pct
    if kind == "loss":
        # Widest absolute gap (peer - own) first
        return (0, -(peer - own), p.prompt_index)
    if kind == "untapped":
        return (1, 0.0, p.prompt_index)
    if kind == "tied":
        return (2, 0.0, p.prompt_index)
    if kind == "lead":
        # Smallest lead first (fragile wins on top)
        return (3, own - peer, p.prompt_index)
    # uncontested: biggest absolute own_pct first
    return (4, -own, p.prompt_index)


def _smart_title_case(name: str) -> str:
    """Title-case a business name only if it looks like a slug/URL (all-lower/upper, no spaces).

    Leaves CamelCase, "iPad", and properly-cased names untouched.
    """
    stripped = name.strip()
    if not stripped:
        return name
    if stripped == stripped.lower() or stripped == stripped.upper():
        return stripped.title()
    return stripped


def _join_peer_names(competitors: list[DetectedCompetitor]) -> str:
    names = [c.name for c in competitors if not c.is_subject][:3]
    if not names:
        return "your peer group"
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def _build_action_blocks(
    prompts: list[str],
    prompt_scores: list[PromptScore],
    per_prompt_top_competitor: dict[int, tuple[str | None, float | None]],
) -> list[dict]:
    """Pick 3 prompts that tell a story: where you're losing, where it's open,
    where you're already winning. Variety > repetition.

    Strategy:
        slot 1: biggest loss (widest peer_avg - own gap)  ← if any losses exist
        slot 2: most actionable untapped (lowest prompt_index among untapped)
        slot 3: best lead/uncontested win (biggest own - peer_avg gap)

    Falls through gracefully if a category is empty (e.g., no losses → fill
    that slot with the next best untapped).

    Each block also gets a `variant_index` so the template can rotate copy
    when two consecutive blocks share the same kind.
    """
    by_kind: dict[str, list[PromptScore]] = {}
    for ps in prompt_scores:
        by_kind.setdefault(_kind_for(ps), []).append(ps)

    # Sort each kind list by what's most interesting first
    if "loss" in by_kind:
        by_kind["loss"].sort(key=lambda p: p.own_visibility_pct - p.peer_avg_visibility_pct)
    if "untapped" in by_kind:
        by_kind["untapped"].sort(key=lambda p: p.prompt_index)
    if "uncontested" in by_kind:
        by_kind["uncontested"].sort(key=lambda p: -p.own_visibility_pct)
    if "lead" in by_kind:
        by_kind["lead"].sort(key=lambda p: -(p.own_visibility_pct - p.peer_avg_visibility_pct))
    if "tied" in by_kind:
        by_kind["tied"].sort(key=lambda p: p.prompt_index)

    chosen: list[PromptScore] = []
    used_indexes: set[int] = set()

    def _take(kind: str) -> PromptScore | None:
        for p in by_kind.get(kind, []):
            if p.prompt_index not in used_indexes:
                used_indexes.add(p.prompt_index)
                return p
        return None

    # Slot 1: biggest loss
    p = _take("loss")
    if p:
        chosen.append(p)
    # Slot 2: most actionable untapped (or 2nd loss if no untapped)
    p = _take("untapped") or _take("loss")
    if p:
        chosen.append(p)
    # Slot 3: best win to defend (uncontested → lead) — or fall through
    p = _take("uncontested") or _take("lead") or _take("untapped") or _take("tied") or _take("loss")
    if p:
        chosen.append(p)

    # If still under 3, pad from any kind
    if len(chosen) < 3:
        for ps in prompt_scores:
            if ps.prompt_index in used_indexes:
                continue
            chosen.append(ps)
            used_indexes.add(ps.prompt_index)
            if len(chosen) >= 3:
                break

    # Annotate with variant_index for copy rotation when same kind appears twice
    blocks = []
    kind_seen: dict[str, int] = {}
    for ps in chosen[:3]:
        kind = _kind_for(ps)
        variant = kind_seen.get(kind, 0)
        kind_seen[kind] = variant + 1
        top_name, top_pct = per_prompt_top_competitor.get(ps.prompt_index, (None, None))
        blocks.append({
            "prompt_text": prompts[ps.prompt_index],
            "kind": kind,
            "variant_index": variant,
            "own_visibility_pct": ps.own_visibility_pct,
            "peer_avg_visibility_pct": ps.peer_avg_visibility_pct,
            "top_competitor_name": top_name,
            "top_competitor_visibility_pct": top_pct,
        })
    return blocks


def _headline_framing(overall_pct: float, peer_avg_pct: float, location: str | None) -> dict:
    """Return the headline copy bundle that drives the cover + executive summary.

    Strategy: lead with the absolute number, framed as a gap. This is the
    cold-email hook. The relative position (RVI band) is supporting detail,
    NOT the lead — a 17%-visibility prospect is not "dominant" in any way
    that matters to the business owner, even if peers are at 3%.
    """
    missing_pct = max(0, round(100 - overall_pct))
    own_int = round(overall_pct)
    peer_int = round(peer_avg_pct)

    # Cover hook — what gets the prospect to open page 2
    if overall_pct < 25:
        cover_hook = f"AI models mention you in only {own_int}% of relevant searches."
        cover_sub = f"{missing_pct}% of potential customers asking these questions never hear your name."
    elif overall_pct < 50:
        cover_hook = f"You appear in {own_int}% of relevant AI searches."
        cover_sub = f"More than half of customers asking these questions never see your name."
    elif overall_pct < 80:
        cover_hook = f"You appear in {own_int}% of relevant AI searches."
        cover_sub = "There's still significant room to widen the lead."
    else:
        cover_hook = f"You appear in {own_int}% of relevant AI searches — strong position."
        cover_sub = "The audit below shows where to defend and where to widen the gap."

    # Executive summary lead sentence
    geo = f" in {location}" if location else ""
    if overall_pct < peer_avg_pct:
        # Real loss case
        summary_lead = (
            f"Customers searching for what you offer{geo} mention you in only {own_int}% of "
            f"AI responses. Competitors are mentioned {peer_int}% of the time. You're losing the conversation."
        )
    elif overall_pct == 0 and peer_avg_pct == 0:
        summary_lead = (
            f"AI models don't surface you OR your competitors{geo} for these questions. "
            f"Whoever publishes first owns this category in AI search."
        )
    else:
        summary_lead = (
            f"You appear in {own_int}% of AI responses about your category{geo}. "
            f"Competitors average {peer_int}%. You're ahead, but {missing_pct}% of relevant searches still don't mention you."
        )

    return {
        "cover_hook": cover_hook,
        "cover_sub": cover_sub,
        "summary_lead": summary_lead,
        "missing_pct": missing_pct,
    }


async def render_prospect_pdf(
    *,
    audit: ProspectAudit,
    prompts: list[str],
    prompt_scores: list[PromptScore],
    competitors: list[DetectedCompetitor],
    summary: AuditSummaryForRecs,
    recommendations_md: str | None,
    logo_data_uri: str | None,
    per_prompt_top_competitor: dict[int, tuple[str | None, float | None]],
) -> bytes:
    """Render the audit HTML template and return PDF bytes."""
    template = _env.get_template("prospect_audit.html.j2")

    display_name = _smart_title_case(audit.business_name)
    sorted_scores = sorted(prompt_scores, key=_scorecard_sort_key)
    # Annotate each prompt score with its kind for the template
    scorecard = []
    for ps in sorted_scores:
        scorecard.append({
            "prompt_text": prompts[ps.prompt_index],
            "kind": _kind_for(ps),
            "own_visibility_pct": ps.own_visibility_pct,
            "peer_avg_visibility_pct": ps.peer_avg_visibility_pct,
            "rvi": ps.rvi,
            "rvi_band": ps.rvi_band,
        })

    action_blocks = _build_action_blocks(prompts, prompt_scores, per_prompt_top_competitor)
    peer_names_joined = _join_peer_names(competitors)
    framing = _headline_framing(summary.overall_visibility_pct, summary.peer_avg_visibility_pct, summary.location)

    recommendations_html = _md.markdown(recommendations_md) if recommendations_md else None

    cta_url = os.getenv("PROSPECT_AUDIT_CTA_URL", "https://lumidian.io")
    cta_email = os.getenv("PROSPECT_AUDIT_CTA_EMAIL") or os.getenv("SUPPORT_EMAIL") or ""

    html = template.render(
        business_name=display_name,
        location=summary.location,
        logo_data_uri=logo_data_uri,
        audit_month=datetime.utcnow().strftime("%B %Y"),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
        # Headline + framing
        cover_hook=framing["cover_hook"],
        cover_sub=framing["cover_sub"],
        summary_lead=framing["summary_lead"],
        missing_pct=framing["missing_pct"],
        # Stats
        rvi_band=summary.rvi_band,
        aggregate_rvi=summary.aggregate_rvi,
        overall_visibility_pct=summary.overall_visibility_pct,
        peer_avg_overall=summary.peer_avg_visibility_pct,
        peer_names_joined=peer_names_joined,
        # Data tables
        scorecard=scorecard,
        action_blocks=action_blocks,
        # Recommendations
        recommendations_html=recommendations_html,
        # CTA
        cta_url=cta_url,
        cta_email=cta_email,
    )

    return await _playwright_pdf(html)


async def _playwright_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            await page.emulate_media(media="print")
            return await page.pdf(
                format="Letter",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
        finally:
            await browser.close()
