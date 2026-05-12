"""Per-page + audit-level scoring."""
from __future__ import annotations

from dataclasses import dataclass

from app.services.site_audit.constants import (
    BOT_ACCESS_BLOCK_PENALTY, PAGE_SCORE_WEIGHTS,
)


@dataclass
class PageScoreInputs:
    word_count: int
    h2_count: int
    table_count: int
    list_count: int
    fact_density: float
    outbound_links: int
    internal_links: int
    image_alt_pct: float
    has_jsonld: bool
    schema_types_count: int
    is_js_rendered: bool
    http_status: int | None
    fetch_ms: int | None
    findings_by_severity: dict[str, int]


def _structure_score(p: PageScoreInputs) -> float:
    s = 50.0
    s += 15 if p.h2_count >= 2 else (5 if p.h2_count == 1 else -15)
    s += 10 if p.list_count >= 1 else 0
    s += 10 if p.table_count >= 1 else 0
    s += min(15.0, p.internal_links * 1.5)
    return max(0.0, min(100.0, s))


def _content_score(p: PageScoreInputs) -> float:
    s = 40.0
    if p.word_count >= 600:
        s += 25
    elif p.word_count >= 300:
        s += 15
    elif p.word_count >= 100:
        s += 5
    s += min(20.0, p.fact_density * 1.5)
    s += min(10.0, p.outbound_links * 2.0)
    crit = p.findings_by_severity.get("critical", 0)
    high = p.findings_by_severity.get("high", 0)
    medium = p.findings_by_severity.get("medium", 0)
    s -= crit * 25 + high * 10 + medium * 3
    return max(0.0, min(100.0, s))


def _schema_score(p: PageScoreInputs) -> float:
    if not p.has_jsonld:
        return 20.0
    return min(100.0, 50.0 + p.schema_types_count * 10)


def _technical_score(p: PageScoreInputs) -> float:
    s = 50.0
    if p.http_status == 200:
        s += 25
    elif p.http_status is None or p.http_status >= 400:
        s -= 20
    if p.fetch_ms is not None and p.fetch_ms < 1500:
        s += 10
    elif p.fetch_ms is not None and p.fetch_ms > 5000:
        s -= 10
    s += 15 if not p.is_js_rendered else -25
    s += 10 if p.image_alt_pct >= 70 else 0
    return max(0.0, min(100.0, s))


def score_page(inputs: PageScoreInputs) -> dict:
    structure = _structure_score(inputs)
    content = _content_score(inputs)
    schema = _schema_score(inputs)
    technical = _technical_score(inputs)
    page = (
        structure * PAGE_SCORE_WEIGHTS["structure"]
        + content * PAGE_SCORE_WEIGHTS["content"]
        + schema * PAGE_SCORE_WEIGHTS["schema"]
        + technical * PAGE_SCORE_WEIGHTS["technical"]
    )
    return {
        "page_score": round(page, 2),
        "structure_score": round(structure, 2),
        "content_score": round(content, 2),
        "schema_score": round(schema, 2),
        "technical_score": round(technical, 2),
    }


def score_bot_access(bot_status: dict[str, str]) -> float:
    score = 100.0
    for bot, status in bot_status.items():
        if status == "disallowed_all":
            score -= BOT_ACCESS_BLOCK_PENALTY.get(bot, 5)
    return max(0.0, min(100.0, score))


def score_audit(*, bot_access: float, content: float, schema: float, technical: float) -> dict:
    overall = (bot_access + content + schema + technical) / 4.0
    return {
        "overall_score": round(overall, 2),
        "bot_access_score": round(bot_access, 2),
        "content_score": round(content, 2),
        "schema_score": round(schema, 2),
        "technical_score": round(technical, 2),
    }
