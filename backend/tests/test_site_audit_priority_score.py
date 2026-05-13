"""Tests for compute_priority_score + recs registry metadata coverage."""
from app.services.site_audit.recommendations import (
    EFFORT_MINUTES,
    _RECS,
    _RECS_META,
    build_rule_based_recs,
    compute_priority_score,
)
from app.services.site_audit.parsers import Finding


def test_priority_score_higher_lift_lower_effort_wins():
    a = compute_priority_score(
        expected_lift_pp=20.0, pages_affected=10, effort_minutes=5
    )
    b = compute_priority_score(
        expected_lift_pp=2.0, pages_affected=1, effort_minutes=60
    )
    assert a > b * 10


def test_priority_score_handles_zero_effort():
    # Should not divide by zero.
    s = compute_priority_score(expected_lift_pp=5.0, pages_affected=1, effort_minutes=0)
    assert s > 0


def test_priority_score_pages_affected_clamps_to_1():
    s_zero = compute_priority_score(
        expected_lift_pp=10.0, pages_affected=0, effort_minutes=5
    )
    s_one = compute_priority_score(
        expected_lift_pp=10.0, pages_affected=1, effort_minutes=5
    )
    assert s_zero == s_one


def test_recs_meta_covers_critical_check_ids():
    """High-priority recs must have an artifact_type entry (even if None)."""
    high_priority_check_ids = {
        cid for cid, rec in _RECS.items() if rec.get("priority") == "high"
    }
    missing = high_priority_check_ids - set(_RECS_META.keys())
    assert not missing, f"high-priority check_ids without metadata: {missing}"


def test_build_rule_based_recs_attaches_lift_and_artifact_type():
    findings = [
        Finding(
            check_id="missing_organization_schema",
            severity="high",
            category="schema",
            message="…",
            evidence={},
        )
    ]
    recs = build_rule_based_recs(
        findings, page_link_map={1: []}, page_id=1
    )
    assert len(recs) == 1
    r = recs[0]
    assert r.artifact_type == "jsonld_org"
    assert r.expected_lift_pp is not None
    assert r.expected_lift_pp > 0
    assert r.priority_score is not None
    assert r.priority_score > 0
    assert isinstance(r.impl_steps, list)
    assert len(r.impl_steps) >= 1


def test_effort_minutes_table_present():
    assert EFFORT_MINUTES["low"] < EFFORT_MINUTES["medium"] < EFFORT_MINUTES["high"]
