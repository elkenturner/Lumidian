from app.services.site_audit.parsers import Finding
from app.services.site_audit.recommendations import (
    build_rule_based_recs, RecInput,
)


def test_blocked_oai_searchbot_produces_high_priority_rec():
    findings = [Finding("blocked_oai_searchbot", "critical", "bot_access",
                        "OAI-SearchBot blocked", {})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert len(recs) == 1
    assert recs[0].priority == "high"
    assert recs[0].effort == "low"
    assert "OAI-SearchBot" in recs[0].body


def test_low_severity_findings_dont_produce_critical_recs():
    findings = [Finding("title_too_long", "low", "content",
                        "Title is long", {"length": 80})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert len(recs) == 1
    assert recs[0].priority == "low"


def test_page_link_map_propagates_prompt_ids():
    findings = [Finding("answer_first_failed", "medium", "content", "...", {})]
    recs = build_rule_based_recs(findings, page_link_map={5: [101, 102]}, page_id=5)
    assert recs[0].linked_prompt_ids == [101, 102]


def test_unknown_check_id_produces_no_rec():
    findings = [Finding("not_in_catalog", "high", "content", "...", {})]
    recs = build_rule_based_recs(findings, page_link_map={}, page_id=None)
    assert recs == []
