"""End-to-end PDF render test using real Playwright Chromium."""
import pytest

from app.models import ProspectAudit
from app.services.prospect_audit.competitor_detect import DetectedCompetitor
from app.services.prospect_audit.pdf_render import render_prospect_pdf
from app.services.prospect_audit.recommendations import AuditSummaryForRecs, PromptInsight
from app.services.prospect_audit.scoring import PromptScore


@pytest.mark.asyncio
async def test_render_prospect_pdf_produces_pdf_bytes():
    audit = ProspectAudit(
        id=1,
        staff_user_id=1,
        business_name="Acme Dental",
        website_url="https://acme.com",
        is_local=True,
        location="Austin, TX",
        status="rendering_pdf",
    )
    prompts = [f"Q{i}?" for i in range(10)]
    prompt_scores = [
        PromptScore(prompt_index=i, own_visibility_pct=10.0 + i, peer_avg_visibility_pct=50.0, rvi=0.2 + 0.05 * i, rvi_band="losing")
        for i in range(10)
    ]
    competitors = [
        DetectedCompetitor(name="Brilliant Smile", website_url="https://b.com", is_subject=False),
        DetectedCompetitor(name="Austin Bright", website_url="https://ab.com", is_subject=False),
    ]
    summary = AuditSummaryForRecs(
        business_name="Acme Dental",
        location="Austin, TX",
        overall_visibility_pct=14.5,
        peer_avg_visibility_pct=50.0,
        aggregate_rvi=0.29,
        rvi_band="losing",
        worst_prompts=[
            PromptInsight(prompt_text="best dentist in Austin?", own_visibility_pct=11, peer_avg_visibility_pct=89, rvi=0.12,
                          top_competitor_name="Brilliant Smile", top_competitor_visibility_pct=92),
        ],
    )

    pdf_bytes = await render_prospect_pdf(
        audit=audit,
        prompts=prompts,
        prompt_scores=prompt_scores,
        competitors=competitors,
        summary=summary,
        recommendations_md="1. **Publish 12 articles** — short justification.",
        logo_data_uri=None,
        per_prompt_top_competitor={},
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 5000   # real PDF, not empty
