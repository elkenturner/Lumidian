from app.services.site_audit.scoring import (
    score_page, score_bot_access, score_audit, PageScoreInputs,
)


def test_score_page_high_quality():
    inputs = PageScoreInputs(
        word_count=800, h2_count=4, table_count=1, list_count=2,
        fact_density=12.0, outbound_links=3, internal_links=8,
        image_alt_pct=85.0, has_jsonld=True, schema_types_count=3,
        is_js_rendered=False, http_status=200, fetch_ms=400,
        findings_by_severity={"critical": 0, "high": 0, "medium": 1, "low": 1},
    )
    s = score_page(inputs)
    assert s["page_score"] >= 75
    assert 0 <= s["content_score"] <= 100
    assert 0 <= s["structure_score"] <= 100


def test_score_page_low_quality_js_rendered():
    inputs = PageScoreInputs(
        word_count=20, h2_count=0, table_count=0, list_count=0,
        fact_density=0.0, outbound_links=0, internal_links=0,
        image_alt_pct=0.0, has_jsonld=False, schema_types_count=0,
        is_js_rendered=True, http_status=200, fetch_ms=400,
        findings_by_severity={"critical": 1, "high": 2, "medium": 0, "low": 0},
    )
    s = score_page(inputs)
    assert s["page_score"] < 30


def test_bot_access_score_penalises_oai_block_hardest():
    s_oai = score_bot_access({"OAI-SearchBot": "disallowed_all"})
    s_gpt = score_bot_access({"GPTBot": "disallowed_all"})
    assert s_oai < s_gpt


def test_score_audit_aggregates_sub_scores():
    out = score_audit(
        bot_access=80.0, content=70.0, schema=60.0, technical=90.0,
    )
    assert out["overall_score"] == 75.0
    assert out["bot_access_score"] == 80.0
