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

    async def fake_serper(query: str, num: int = 10, raise_on_rate_limit: bool = False):
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


def test_gate_passes_with_one_t1_and_two_t2():
    # Threshold is MIN_T1=1, MIN_T1_PLUS_T2=3 — a single authoritative source
    # plus solid trade press is enough to ground the brief.
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
        _src("https://randomblog.example.com/e") | {"tier": "T3", "domain": "randomblog.example.com"},
    ]
    gate_pack(pack)  # should not raise


def test_gate_fails_with_zero_t1():
    pack = [
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://forbes.com/d") | {"tier": "T2", "domain": "forbes.com"},
        _src("https://axios.com/e") | {"tier": "T2", "domain": "axios.com"},
    ]
    with pytest.raises(PackGateError) as exc:
        gate_pack(pack)
    assert "T1" in str(exc.value)


def test_gate_fails_when_t1_plus_t2_under_threshold():
    # 1 T1 + 1 T2 = 2 < MIN_T1_PLUS_T2 (3) — fails on authority floor.
    pack = [
        _src("https://reuters.com/a") | {"tier": "T1", "domain": "reuters.com"},
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
        _src("https://randomblog.example.com/d") | {"tier": "T3", "domain": "randomblog.example.com"},
    ]
    with pytest.raises(PackGateError):
        gate_pack(pack)


def test_gate_thresholds_env_overridable(monkeypatch):
    """gate_pack must consult _min_t1()/_min_t1_plus_t2() helpers that read env."""
    # A pack that fails the default gate (needs MIN_T1=1, MIN_T1_PLUS_T2=3)...
    pack = [
        _src("https://techcrunch.com/c") | {"tier": "T2", "domain": "techcrunch.com"},
    ]
    monkeypatch.setenv("CLUSTER_GATE_MIN_T1", "0")
    monkeypatch.setenv("CLUSTER_GATE_MIN_T1_PLUS_T2", "1")
    gate_pack(pack)  # ...passes once the env-configured thresholds are lowered

    # Raising the env-configured threshold above the pack's content re-fails it.
    monkeypatch.setenv("CLUSTER_GATE_MIN_T1", "1")
    with pytest.raises(PackGateError):
        gate_pack(pack)


# ---------------------------------------------------------------------------
# Task 7: build_cluster_pack — full builder + persistence
# ---------------------------------------------------------------------------

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Brand, BrandSource, ContentCluster, ContentClusterSource, ContentEvidencePack,
    Prompt, User,
)
from app.services.cluster_evidence import build_cluster_pack  # noqa: E402


@pytest.mark.asyncio
async def test_build_cluster_pack_persists_and_dedups(monkeypatch):
    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
            {"url": "https://randomblog.example.com/e", "title": "E", "snippet": "..."},
        ]
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="pack@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-pack-test", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="best CRM for solo founders")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        pack = await build_cluster_pack(
            db,
            cluster=cluster,
            prompt_text="best CRM for solo founders",
            key_claims=["Notion bundles tasks and docs"],
            version=1,
        )

        assert pack.total_t1 == 2
        assert pack.total_t2 == 2
        assert pack.total_t3 == 1
        assert len(pack.sources) == 5

        rows = (await db.execute(
            select(ContentClusterSource).where(ContentClusterSource.cluster_id == cluster.id)
        )).scalars().all()
        assert len(rows) == 5
        assert {r.tier for r in rows} == {"T1", "T2", "T3"}


@pytest.mark.asyncio
async def test_build_cluster_pack_raises_when_authority_too_low(monkeypatch):
    async def fake_fetch(queries):
        # Only one T1, rest T3
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://randomblog.example.com/b", "title": "B", "snippet": "..."},
            {"url": "https://otherblog.example.com/c", "title": "C", "snippet": "..."},
        ]
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="pack2@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-pack-test-2", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        from app.services.cluster_evidence import PackGateError
        with pytest.raises(PackGateError):
            await build_cluster_pack(
                db,
                cluster=cluster,
                prompt_text="q",
                key_claims=[],
                version=1,
            )

        # Nothing persisted on failure
        rows = (await db.execute(
            select(ContentEvidencePack).where(ContentEvidencePack.cluster_id == cluster.id)
        )).scalars().all()
        assert rows == []


# ---------------------------------------------------------------------------
# Task 7: user-attached BrandSource library counts toward the authority gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_sources_satisfy_gate(monkeypatch):
    """Brand has 3 BrandSource rows: one .gov domain (T1) + 2 arbitrary T3
    domains (floored to T2). Serper returns nothing and there are no tracking
    runs, so the citations path is empty too. build_cluster_pack must still
    PASS the gate purely off user sources (t1=1, t1+t2=3) and persist them.
    """
    async def fake_fetch(queries):
        return []
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="usersrc1@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-user-src-1", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        db.add_all([
            BrandSource(brand_id=brand.id, title="Gov data", url="https://data.gov/a", snippet="s"),
            BrandSource(brand_id=brand.id, title="My blog", url="https://myblog.example.com/b", snippet="s"),
            BrandSource(brand_id=brand.id, title="Sample", url="https://sample.example.com/c", snippet="s"),
        ])
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        pack = await build_cluster_pack(
            db,
            cluster=cluster,
            prompt_text="q",
            key_claims=[],
            version=1,
        )

        assert pack.total_t1 == 1
        assert pack.total_t2 == 2
        assert pack.total_t3 == 0
        urls = {s["url"] for s in pack.sources}
        assert urls == {
            "https://data.gov/a",
            "https://myblog.example.com/b",
            "https://sample.example.com/c",
        }
        assert all(s.get("user_supplied") for s in pack.sources)


@pytest.mark.asyncio
async def test_user_sources_merged_even_when_serper_alone_passes(monkeypatch):
    """Even when Serper results alone clear the gate, user sources must still
    be merged into the persisted pack (prepended, deduped by normalized URL).
    """
    async def fake_fetch(queries):
        return [
            {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
            {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
            {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
            {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
        ]
    monkeypatch.setattr("app.services.cluster_evidence.fetch_and_dedupe", fake_fetch)

    async with AsyncSessionLocal() as db:
        user = User(email="usersrc2@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="a-user-src-2", user_id=user.id)
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q")
        db.add(prompt); await db.flush()
        db.add(
            BrandSource(brand_id=brand.id, title="My site", url="https://mysite.example.com/x", snippet="s")
        )
        cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
        db.add(cluster); await db.commit(); await db.refresh(cluster)

        pack = await build_cluster_pack(
            db,
            cluster=cluster,
            prompt_text="q",
            key_claims=[],
            version=1,
        )

        urls = {s["url"] for s in pack.sources}
        assert "https://mysite.example.com/x" in urls
        user_entry = next(s for s in pack.sources if s["url"] == "https://mysite.example.com/x")
        assert user_entry["tier"] == "T2"  # T3 domain floored to T2
        assert user_entry.get("user_supplied") is True
