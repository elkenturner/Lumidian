"""Render a sample prospect-audit PDF for design iteration.

Run with:
    cd backend && source venv/bin/activate
    python scripts/render_sample_audit_pdf.py

Writes the PDF to /tmp/sample_audit.pdf and opens it.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from app.models import ProspectAudit  # noqa: E402
from app.services.prospect_audit.competitor_detect import DetectedCompetitor  # noqa: E402
from app.services.prospect_audit.pdf_render import render_prospect_pdf  # noqa: E402
from app.services.prospect_audit.recommendations import AuditSummaryForRecs, PromptInsight  # noqa: E402
from app.services.prospect_audit.scoring import PromptScore  # noqa: E402


# Mirrors the real CleaeViewEyes audit (LASIK clinic, San Diego)
_PROMPTS = [
    "What's the best LASIK surgery clinic in San Diego, CA?",
    "How much does LASIK eye surgery cost in San Diego?",
    "Is LASIK worth it? Reviews from San Diego patients?",
    "Can I get LASIK if I have thin corneas in San Diego?",
    "How do I know if I'm a good candidate for LASIK in San Diego?",
    "SMILE LASIK vs traditional LASIK: which is better in San Diego, CA?",
    "What's the recovery time for LASIK surgery in San Diego, CA?",
    "Is PRK or LASIK better for active people in San Diego?",
    "Where can I find custom wavefront LASIK in San Diego, CA?",
    "What are the risks and side effects of LASIK surgery in San Diego, CA?",
]

_RECS_MD = """1. **Build an AI-cited LASIK cost content cluster across LinkedIn, Medium, Reddit, Quora, and X.** CleaeViewEyes registers 0% visibility on "How much does LASIK eye surgery cost in San Diego?" while LasikPlus dominates at 33% — meaning AI models are pulling pricing facts exclusively from competitors, not from CleaeViewEyes. Lumidian's **content clusters** would deploy 12+ AI-optimized articles per month coordinated across platforms, all anchored to the same cited pricing claims so models begin associating CleaeViewEyes with authoritative cost information in the San Diego market.

2. **Activate CleaeViewEyes's existing YouTube videos as AI-readable citation surfaces for LASIK outcome content.** The prompt "Is LASIK worth it? Reviews from San Diego patients?" returns 0% for CleaeViewEyes against a 7% peer average, suggesting that patient-outcome content from this practice is invisible to AI retrieval — even if video testimonials already exist. Lumidian's **YouTube video AI-readability optimization** would transcribe those existing videos, restructure descriptions, captions, and chapters around citable facts and named claims, and re-publish them so ChatGPT, Perplexity, and Gemini can pull from them directly.

3. **Deploy real-time competitor monitoring to neutralize first-mover advantages from NVISION and LasikPlus.** NVISION Centers hold 33% share on the highest-value LASIK clinic query while CleaeViewEyes holds none — and without visibility into when and how competitors publish new AI-citable content, that gap compounds silently over time. Lumidian's **competitor monitoring** flags within days when peers publish AI-citable content in CleaeViewEyes's category, surfacing alerts directly in the dashboard so the team can respond with targeted cluster content before a competitor's position hardens further.

4. **Track prompt-level visibility weekly to measure which content moves which queries.** CleaeViewEyes currently has no baseline signal to know whether any marketing activity is influencing AI model citations — making it impossible to prioritize spend or validate progress against the 3% peer average. The **Lumidian platform** provides live per-prompt visibility across ChatGPT, Claude, Perplexity, and Gemini with cluster-level attribution showing exactly which published articles drove movement on which queries, available either as a self-serve dashboard or fully managed by Lumidian's team.

5. **Commission a Lumidian website audit to identify the highest-impact technical citation opportunities on CleaeViewEyes's own domain.** The prompt-level data reveals clear content gaps — no LASIK cost content, no patient-review content, and no best-clinic content is being cited from CleaeViewEyes — but the root causes at the website level remain undiagnosed. A **Lumidian website AI-readability audit** would identify the highest-impact technical wins available on the site, including schema structure, FAQ surfaces, and citation architecture, translating those findings into a prioritized roadmap that compounds the impact of every content cluster published.
"""


async def main() -> None:
    audit = ProspectAudit(
        id=999,
        staff_user_id=1,
        business_name="CleaeViewEyes",
        website_url="https://cleaevieweyes.example.com",
        is_local=True,
        location="San Diego, CA",
        status="rendering_pdf",
    )

    prompt_scores = [
        PromptScore(prompt_index=0, own_visibility_pct=0.0, peer_avg_visibility_pct=7.0, rvi=0.0, rvi_band="invisible"),
        PromptScore(prompt_index=1, own_visibility_pct=0.0, peer_avg_visibility_pct=7.0, rvi=0.0, rvi_band="invisible"),
        PromptScore(prompt_index=2, own_visibility_pct=0.0, peer_avg_visibility_pct=7.0, rvi=0.0, rvi_band="invisible"),
        PromptScore(prompt_index=3, own_visibility_pct=0.0, peer_avg_visibility_pct=4.0, rvi=0.0, rvi_band="invisible"),
        PromptScore(prompt_index=4, own_visibility_pct=0.0, peer_avg_visibility_pct=4.0, rvi=0.0, rvi_band="invisible"),
        PromptScore(prompt_index=5, own_visibility_pct=0.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="invisible"),
        PromptScore(prompt_index=6, own_visibility_pct=0.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="invisible"),
        PromptScore(prompt_index=7, own_visibility_pct=0.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="invisible"),
        PromptScore(prompt_index=8, own_visibility_pct=0.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="invisible"),
        PromptScore(prompt_index=9, own_visibility_pct=0.0, peer_avg_visibility_pct=0.0, rvi=None, rvi_band="invisible"),
    ]

    competitors = [
        DetectedCompetitor(name="TLC Vision", website_url="https://tlcvision.com", is_subject=False),
        DetectedCompetitor(name="NVISION Centers", website_url="https://nvisioncenters.com", is_subject=False),
        DetectedCompetitor(name="LaserSight", website_url="https://lasersight.com", is_subject=False),
    ]

    summary = AuditSummaryForRecs(
        business_name="CleaeViewEyes",
        location="San Diego, CA",
        overall_visibility_pct=0.0,
        peer_avg_visibility_pct=3.0,
        aggregate_rvi=0.0,
        rvi_band="invisible",
        worst_prompts=[
            PromptInsight(
                prompt_text=_PROMPTS[0],
                own_visibility_pct=0.0,
                peer_avg_visibility_pct=7.0,
                rvi=0.0,
                top_competitor_name="NVISION Centers",
                top_competitor_visibility_pct=33.0,
            ),
        ],
    )

    per_prompt_top: dict[int, tuple[str | None, float | None]] = {
        0: ("NVISION Centers", 33.0),
        1: ("LasikPlus", 33.0),
        2: ("TLC Vision", 21.0),
    }

    os.environ.setdefault("PROSPECT_AUDIT_CTA_EMAIL", "elkenturner@gmail.com")

    pdf_bytes = await render_prospect_pdf(
        audit=audit,
        prompts=_PROMPTS,
        prompt_scores=prompt_scores,
        competitors=competitors,
        summary=summary,
        recommendations_md=_RECS_MD,
        logo_data_uri=None,
        per_prompt_top_competitor=per_prompt_top,
    )

    out = Path("/tmp/sample_audit.pdf")
    out.write_bytes(pdf_bytes)
    print(f"Wrote {out} ({len(pdf_bytes)} bytes)")
    subprocess.run(["open", str(out)], check=False)


if __name__ == "__main__":
    asyncio.run(main())
