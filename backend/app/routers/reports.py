"""
Reports router — exportable visibility reports.

Routes
------
GET /api/reports/{brand_id}/export   — download PDF visibility report
"""
from __future__ import annotations

import io
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_brand_for_user
from app.models import Prompt, QueryResult, RunModelScore, TrackingRun

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

from app.utils import MODEL_LABELS, MODEL_ORDER, normalise_model  # noqa: E402


@router.get("/{brand_id}/export")
async def export_report(
    brand_id: int,
    db: DbDep,
    user: CurrentUser,
    run_id: int | None = Query(None, description="Specific run ID to report on (defaults to latest)"),
):
    """Generate and return a PDF visibility report for the brand."""
    brand = await get_brand_for_user(brand_id, db, user)

    # ── Fetch data ────────────────────────────────────────────────────────────

    # All completed runs (for trend)
    runs_result = await db.execute(
        select(TrackingRun)
        .where(TrackingRun.brand_id == brand_id, TrackingRun.status == "completed")
        .order_by(TrackingRun.completed_at.asc())
    )
    completed_runs: list[TrackingRun] = list(runs_result.scalars().all())

    # Use specified run or fall back to latest
    target_run: TrackingRun | None = None
    if run_id is not None:
        target_run = next((r for r in completed_runs if r.id == run_id), None)
        if target_run is None:
            raise HTTPException(status_code=404, detail="Run not found or not completed")
    else:
        target_run = completed_runs[-1] if completed_runs else None

    overall_score: float | None = target_run.overall_score if target_run else None

    # Per-model scores for target run
    model_scores: dict[str, float] = {}
    if target_run:
        ms_result = await db.execute(
            select(RunModelScore).where(RunModelScore.tracking_run_id == target_run.id)
        )
        for ms in ms_result.scalars().all():
            model_scores[normalise_model(ms.model)] = round(ms.score, 1)

    # Query results for target run
    query_results: list[QueryResult] = []
    if target_run:
        qr_result = await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == target_run.id)
        )
        query_results = list(qr_result.scalars().all())

    # Prompts for this brand
    prompts_result = await db.execute(select(Prompt).where(Prompt.brand_id == brand_id))
    prompts: dict[int, str] = {p.id: p.text for p in prompts_result.scalars().all()}

    # ── Build prompt groups ───────────────────────────────────────────────────

    class PGroup:
        def __init__(self, pid: int, text: str):
            self.prompt_id = pid
            self.text = text
            self.total = 0
            self.mentioned = 0
            self.model_stats: dict[str, dict] = {}

    groups: dict[int, PGroup] = {}
    for qr in query_results:
        # Exclude responses with no text (API completely failed)
        if not qr.response_text:
            continue
        pid = qr.prompt_id
        if pid not in groups:
            groups[pid] = PGroup(pid, prompts.get(pid, f"Prompt #{pid}"))
        g = groups[pid]
        g.total += 1
        if qr.mentioned:
            g.mentioned += 1
        mk = normalise_model(qr.model)
        if mk not in g.model_stats:
            g.model_stats[mk] = {"total": 0, "mentioned": 0}
        g.model_stats[mk]["total"] += 1
        if qr.mentioned:
            g.model_stats[mk]["mentioned"] += 1

    sorted_groups = sorted(
        groups.values(),
        key=lambda g: (g.mentioned / g.total) if g.total else -1,
        reverse=True,
    )

    # ── Build PDF ─────────────────────────────────────────────────────────────

    try:
        pdf_bytes = _build_pdf(
            brand_name=brand.name,
            overall_score=overall_score,
            completed_runs=completed_runs,
            sorted_groups=sorted_groups,
            model_scores=model_scores,
            generated_at=datetime.now(UTC),
        )
    except Exception as exc:
        logger.exception("PDF generation failed for brand %d: %s", brand_id, exc)
        raise HTTPException(status_code=500, detail="PDF generation failed")

    import re
    safe_name = re.sub(r'[^\w\-]', '_', brand.name)
    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    filename = f"{safe_name}_visibility_{date_str}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── PDF builder ───────────────────────────────────────────────────────────────

def _build_pdf(
    brand_name: str,
    overall_score: float | None,
    completed_runs: list,
    sorted_groups: list,
    model_scores: dict[str, float],
    generated_at: datetime,
) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        HRFlowable,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    # Colour palette
    COL_BG        = colors.HexColor("#0a0a0f")
    COL_CARD      = colors.HexColor("#12121a")
    COL_BORDER    = colors.HexColor("#2d2d3d")
    COL_INDIGO    = colors.HexColor("#6366f1")
    COL_INDIGO_LT = colors.HexColor("#818cf8")
    COL_TEXT      = colors.HexColor("#e2e8f0")
    COL_MUTED     = colors.HexColor("#64748b")
    COL_GREEN     = colors.HexColor("#10b981")
    COL_AMBER     = colors.HexColor("#f59e0b")
    COL_RED       = colors.HexColor("#ef4444")
    COL_WHITE     = colors.white

    W, H = A4
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )

    def _page_bg(canvas, doc):
        """Paint the full page background dark with accent stripe."""
        canvas.saveState()
        # Full page background
        canvas.setFillColor(COL_BG)
        canvas.rect(0, 0, W, H, stroke=0, fill=1)
        # Indigo accent stripe at very top
        canvas.setFillColor(COL_INDIGO)
        canvas.rect(0, H - 3 * mm, W, 3 * mm, stroke=0, fill=1)
        # Page number (bottom center, skip first page)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(COL_MUTED)
        canvas.drawCentredString(W / 2, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    styles = getSampleStyleSheet()
    body_w = W - 36 * mm

    def style(name, **kw):
        s = ParagraphStyle(name, **kw)
        return s

    S_TITLE   = style("Title",   fontSize=22, textColor=COL_TEXT,    fontName="Helvetica-Bold", leading=28, spaceAfter=2)
    S_SUB     = style("Sub",     fontSize=10, textColor=COL_MUTED,   fontName="Helvetica",      leading=14)
    S_H2      = style("H2",      fontSize=13, textColor=COL_TEXT,    fontName="Helvetica-Bold", leading=18, spaceBefore=10, spaceAfter=4)
    S_H3      = style("H3",      fontSize=10, textColor=COL_INDIGO_LT, fontName="Helvetica-Bold", leading=14, spaceBefore=6, spaceAfter=2)
    S_BODY    = style("Body",    fontSize=9,  textColor=COL_MUTED,   fontName="Helvetica",      leading=13)
    S_LABEL   = style("Label",   fontSize=8,  textColor=COL_MUTED,   fontName="Helvetica",      leading=11)
    S_SCORE   = style("Score",   fontSize=30, textColor=COL_INDIGO_LT, fontName="Helvetica-Bold", leading=36, alignment=TA_CENTER)
    S_SCLAB   = style("ScLab",   fontSize=9,  textColor=COL_MUTED,   fontName="Helvetica",      leading=12, alignment=TA_CENTER)

    def score_color(pct: float) -> colors.Color:
        if pct >= 60:
            return COL_GREEN
        if pct >= 30:
            return COL_AMBER
        return COL_RED

    story = []

    # ── Header ────────────────────────────────────────────────────────────────
    S_BRAND = style("Brand", fontSize=8, textColor=COL_INDIGO_LT, fontName="Helvetica-Bold",
                     leading=11, spaceAfter=2, letterSpacing=2)
    story.append(Paragraph("LUMIDIAN", S_BRAND))
    story.append(Paragraph("AI Visibility Report", S_TITLE))
    story.append(Paragraph(f"<b>{brand_name}</b>  ·  Generated {generated_at.strftime('%B %d, %Y')}", S_SUB))
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=COL_BORDER, spaceAfter=6 * mm))

    # ── Overall score card ────────────────────────────────────────────────────
    if overall_score is not None:
        sc = round(overall_score, 1)
        sc_col = score_color(sc)
        score_style = ParagraphStyle("ScBig", fontSize=34, textColor=sc_col,
                                     fontName="Helvetica-Bold", leading=40, alignment=TA_CENTER)
        score_data = [[
            Paragraph(f"{sc}%", score_style),
            Paragraph("Overall Visibility Score<br/><font size='8' color='#94a3b8'>Percentage of AI responses that mention your brand</font>",
                      ParagraphStyle("ScD", fontSize=12, textColor=COL_TEXT, fontName="Helvetica-Bold",
                                     leading=18, alignment=TA_LEFT)),
        ]]
        score_table = Table(score_data, colWidths=[50 * mm, body_w - 50 * mm])
        score_table.setStyle(TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING",   (0, 0), (-1, -1), 14),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 14),
            ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#161625")),
            ("ROUNDEDCORNERS", (0, 0), (-1, -1), [6, 6, 6, 6]),
            ("BOX",          (0, 0), (-1, -1), 0.5, colors.HexColor("#4f46e5")),
        ]))
        story.append(score_table)
        story.append(Spacer(1, 6 * mm))

    # ── Per-model breakdown ───────────────────────────────────────────────────
    if model_scores:
        story.append(Paragraph("Model Breakdown", S_H2))
        ms_headers = [Paragraph(MODEL_LABELS.get(m, m.title()), ParagraphStyle(
            "MH", fontSize=9, textColor=colors.HexColor("#94a3b8"), fontName="Helvetica-Bold",
            leading=12, alignment=TA_CENTER)) for m in MODEL_ORDER if m in model_scores]
        ms_values = [Paragraph(f"{model_scores[m]}%", ParagraphStyle(
            "MV", fontSize=18, fontName="Helvetica-Bold",
            textColor=score_color(model_scores[m]), leading=22, alignment=TA_CENTER))
            for m in MODEL_ORDER if m in model_scores]

        cols = len(ms_headers)
        if cols:
            col_w = body_w / cols
            ms_table = Table([ms_headers, ms_values], colWidths=[col_w] * cols)
            ms_table.setStyle(TableStyle([
                ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#161625")),
                ("BOX",          (0, 0), (-1, -1), 1, COL_BORDER),
                ("INNERGRID",    (0, 0), (-1, -1), 0.5, COL_BORDER),
                ("TOPPADDING",   (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
                ("LEFTPADDING",  (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(ms_table)
            story.append(Spacer(1, 6 * mm))

    # ── Trend table ───────────────────────────────────────────────────────────
    if completed_runs:
        story.append(Paragraph("Visibility Trend", S_H2))
        trend_headers = [
            Paragraph("Date", ParagraphStyle("TH", fontSize=8, textColor=COL_MUTED, fontName="Helvetica-Bold", leading=11)),
            Paragraph("Score", ParagraphStyle("TH", fontSize=8, textColor=COL_MUTED, fontName="Helvetica-Bold", leading=11, alignment=TA_RIGHT)),
            Paragraph("Queries", ParagraphStyle("TH", fontSize=8, textColor=COL_MUTED, fontName="Helvetica-Bold", leading=11, alignment=TA_RIGHT)),
            Paragraph("Mentions", ParagraphStyle("TH", fontSize=8, textColor=COL_MUTED, fontName="Helvetica-Bold", leading=11, alignment=TA_RIGHT)),
        ]
        trend_data = [trend_headers]
        for run in reversed(completed_runs[-10:]):  # most recent first, up to 10
            dt = run.completed_at.strftime("%b %d, %Y") if run.completed_at else "—"
            sc_str = f"{round(run.overall_score, 1)}%" if run.overall_score is not None else "—"
            sc_col = score_color(run.overall_score) if run.overall_score is not None else COL_MUTED
            trend_data.append([
                Paragraph(dt, ParagraphStyle("TC", fontSize=8, textColor=COL_TEXT, fontName="Helvetica", leading=11)),
                Paragraph(sc_str, ParagraphStyle("TC", fontSize=8, textColor=sc_col, fontName="Helvetica-Bold", leading=11, alignment=TA_RIGHT)),
                Paragraph(str(run.total_queries or "—"), ParagraphStyle("TC", fontSize=8, textColor=COL_MUTED, fontName="Helvetica", leading=11, alignment=TA_RIGHT)),
                Paragraph(str(run.total_mentions or "—"), ParagraphStyle("TC", fontSize=8, textColor=COL_MUTED, fontName="Helvetica", leading=11, alignment=TA_RIGHT)),
            ])

        cw = [body_w * 0.45, body_w * 0.20, body_w * 0.175, body_w * 0.175]
        trend_table = Table(trend_data, colWidths=cw)
        trend_style = [
            ("BACKGROUND",   (0, 0), (-1, 0), COL_BORDER),
            ("BACKGROUND",   (0, 1), (-1, -1), COL_CARD),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [COL_CARD, colors.HexColor("#0f0f1a")]),
            ("BOX",          (0, 0), (-1, -1), 1, COL_BORDER),
            ("LINEBELOW",    (0, 0), (-1, 0), 1, COL_BORDER),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
            ("LEFTPADDING",  (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ]
        trend_table.setStyle(TableStyle(trend_style))
        story.append(trend_table)
        story.append(Spacer(1, 5 * mm))

    # ── Per-prompt breakdown ──────────────────────────────────────────────────
    if sorted_groups:
        story.append(Paragraph("Per-Prompt Visibility Breakdown", S_H2))

        active_models = [m for m in MODEL_ORDER if any(m in g.model_stats for g in sorted_groups)]
        ph_style = ParagraphStyle("PH", fontSize=8, textColor=COL_MUTED, fontName="Helvetica-Bold",
                                  leading=11, alignment=TA_CENTER)
        prompt_headers = [Paragraph("Prompt", ParagraphStyle("PH2", fontSize=8, textColor=COL_MUTED,
                                    fontName="Helvetica-Bold", leading=11))]
        prompt_headers.append(Paragraph("Overall", ph_style))
        for m in active_models:
            prompt_headers.append(Paragraph(MODEL_LABELS.get(m, m.title()), ph_style))

        prompt_data = [prompt_headers]
        for g in sorted_groups:
            overall_pct = round((g.mentioned / g.total) * 100) if g.total else 0
            oc = score_color(overall_pct)
            row = [
                Paragraph(g.text[:90] + ("…" if len(g.text) > 90 else ""),
                          ParagraphStyle("PC", fontSize=8, textColor=COL_TEXT, fontName="Helvetica", leading=11)),
                Paragraph(f"{overall_pct}%",
                          ParagraphStyle("PC2", fontSize=8, textColor=oc, fontName="Helvetica-Bold",
                                         leading=11, alignment=TA_CENTER)),
            ]
            for m in active_models:
                ms = g.model_stats.get(m)
                if ms and ms["total"] > 0:
                    pct = round((ms["mentioned"] / ms["total"]) * 100)
                    mc = score_color(pct)
                    row.append(Paragraph(f"{pct}%", ParagraphStyle("MC", fontSize=8, textColor=mc,
                                                                    fontName="Helvetica-Bold", leading=11,
                                                                    alignment=TA_CENTER)))
                else:
                    row.append(Paragraph("—", ParagraphStyle("MC2", fontSize=8, textColor=COL_MUTED,
                                                              fontName="Helvetica", leading=11,
                                                              alignment=TA_CENTER)))
            prompt_data.append(row)

        extra_cols = len(active_models)
        prompt_col_w = body_w * 0.45
        stat_col_w = (body_w - prompt_col_w) / (extra_cols + 1) if extra_cols >= 0 else body_w * 0.15
        pt_cw = [prompt_col_w] + [stat_col_w] * (extra_cols + 1)
        prompt_table = Table(prompt_data, colWidths=pt_cw, repeatRows=1)
        prompt_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0), COL_BORDER),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [COL_CARD, colors.HexColor("#0f0f1a")]),
            ("BOX",            (0, 0), (-1, -1), 1, COL_BORDER),
            ("LINEBELOW",      (0, 0), (-1, 0), 1, COL_BORDER),
            ("TOPPADDING",     (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 5),
            ("LEFTPADDING",    (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",   (0, 0), (-1, -1), 6),
            ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(prompt_table)
        story.append(Spacer(1, 5 * mm))

    # ── Gap analysis ──────────────────────────────────────────────────────────
    gap_groups = [g for g in sorted_groups if g.total > 0 and (g.mentioned / g.total) < 0.5]
    if gap_groups:
        story.append(Paragraph("Gap Analysis", S_H2))
        story.append(Paragraph(
            f"The following {len(gap_groups)} prompt{'s' if len(gap_groups) != 1 else ''} "
            f"have visibility below 50% and represent opportunities to improve your brand's AI presence.",
            S_BODY,
        ))
        story.append(Spacer(1, 3 * mm))
        for g in gap_groups[:10]:  # cap at 10 to avoid very long PDFs
            overall_pct = round((g.mentioned / g.total) * 100) if g.total else 0
            gap_data = [[
                Paragraph(g.text[:100] + ("…" if len(g.text) > 100 else ""),
                          ParagraphStyle("GT", fontSize=9, textColor=COL_TEXT, fontName="Helvetica", leading=13)),
                Paragraph(f"{overall_pct}%",
                          ParagraphStyle("GS", fontSize=11, textColor=score_color(overall_pct),
                                         fontName="Helvetica-Bold", leading=14, alignment=TA_RIGHT)),
            ]]
            gap_table = Table(gap_data, colWidths=[body_w - 20 * mm, 20 * mm])
            gap_table.setStyle(TableStyle([
                ("BACKGROUND",   (0, 0), (-1, -1), COL_CARD),
                ("BOX",          (0, 0), (-1, -1), 1, COL_BORDER),
                ("TOPPADDING",   (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
                ("LEFTPADDING",  (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(gap_table)
            story.append(Spacer(1, 2 * mm))

    # ── Footer note ───────────────────────────────────────────────────────────
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=COL_BORDER, spaceAfter=4 * mm))
    story.append(Paragraph(
        f"<font color='#818cf8'>Lumidian</font>  ·  {generated_at.strftime('%Y-%m-%d %H:%M')} UTC  ·  lumidian.com",
        ParagraphStyle("Footer", fontSize=8, textColor=COL_MUTED, fontName="Helvetica",
                       leading=11, alignment=TA_CENTER),
    ))

    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()
