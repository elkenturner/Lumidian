from unittest.mock import patch

import pytest

from app.services.cluster_evidence import expand_queries, fetch_and_dedupe


def test_expand_queries_uses_prompt_and_claims():
    queries = expand_queries(
        prompt_text="best CRM for solo founders",
        key_claims=["Notion bundles tasks and docs", "HubSpot has a free tier"],
    )
    assert "best CRM for solo founders" in queries
    # Each claim becomes its own search query
    assert any("Notion bundles" in q for q in queries)
    assert any("HubSpot" in q for q in queries)
    # Capped at 5
    assert 1 <= len(queries) <= 5


def test_expand_queries_dedupes():
    queries = expand_queries(
        prompt_text="best CRM",
        key_claims=["best CRM", "best CRM"],
    )
    assert len(queries) == 1


@pytest.mark.asyncio
async def test_fetch_and_dedupe_drops_dupes_across_queries():
    fake_results = {
        "q1": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        ],
        "q2": [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},  # dup
            {"url": "https://oecd.org/c", "title": "C", "snippet": "..."},
        ],
    }

    async def fake_serper(query: str, num: int = 10):
        return fake_results[query]

    with patch("app.services.cluster_evidence._serper_search", side_effect=fake_serper):
        merged = await fetch_and_dedupe(["q1", "q2"])

    urls = [m["url"] for m in merged]
    assert urls.count("https://reuters.com/a") == 1
    assert "https://nytimes.com/b" in urls
    assert "https://oecd.org/c" in urls


# ---------------------------------------------------------------------------
# Task 6: authority tiering + pack-gate
# ---------------------------------------------------------------------------

import pytest  # noqa: E402 (already imported above but repeated for clarity)

from app.services.cluster_evidence import (
    PackGateError, rank_and_tier, gate_pack,
)


def _src(url: str, title: str = "t", snippet: str = "s") -> dict:
    return {"url": url, "title": title, "snippet": snippet}


def test_rank_prefers_t1_then_t2_then_t3():
    raw = [
        _src("https://randomblog.example.com/a"),  # T3
        _src("https://reuters.com/x"),              # T1
        _src("https://techcrunch.com/y"),           # T2
    ]
    ranked = rank_and_tier(raw)
    assert ranked[0]["tier"] == "T1"
    assert ranked[1]["tier"] == "T2"
    assert ranked[2]["tier"] == "T3"


def test_rank_attaches_tier_and_domain():
    raw = [_src("https://www.nytimes.com/path")]
    ranked = rank_and_tier(raw)
    assert ranked[0]["domain"] == "nytimes.com"
    assert ranked[0]["tier"] == "T1"


def test_gate_passes_with_two_t1():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://nytimes.com/b") | {"tier": "T1", "domain": "nytimes.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
    ]
    gate_pack(pack)  # should not raise


def test_gate_fails_with_one_t1():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
        _src("https://axios.com/e") | {"tier": "T2", "domain": "axios.com"},
    ]
    with pytest.raises(PackGateError) as exc:
        gate_pack(pack)
    assert "T1" in str(exc.value)


def test_gate_fails_when_t1_plus_t2_under_4():
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://nytimes.com/b") | {"tier": "T1", "domain": "nytimes.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
    ]
    with pytest.raises(PackGateError):
        gate_pack(pack)
