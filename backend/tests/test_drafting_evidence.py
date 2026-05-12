from datetime import datetime, UTC, timedelta

import pytest
from sqlalchemy import select
from unittest.mock import AsyncMock, patch

from app.models import Brand, WebsiteAudit, WebsiteAuditPage, User, BrandSource, EvidenceCache
from app.services.drafting.evidence import (
    EvidenceSource,
    EvidencePack,
    select_brand_pages,
)


@pytest.mark.asyncio
async def test_evidence_source_dataclass_fields():
    src = EvidenceSource(
        ref="S1",
        kind="brand_page",
        url="https://example.com",
        title="Example",
        snippet="Body",
        published_date=None,
    )
    assert src.ref == "S1"
    assert src.kind == "brand_page"


@pytest.mark.asyncio
async def test_select_brand_pages_returns_top_n_by_relevance(db_session):
    user = User(email="ev1@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Acme", slug="acme-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    pages = [
        WebsiteAuditPage(
            audit_id=audit.id,
            url="https://a.com/breath-test",
            title="Breath test for cancer",
            h1_text="Breath test methodology",
            content_excerpt="Our breath test detects volatile compounds.",
            fact_density=0.7,
        ),
        WebsiteAuditPage(
            audit_id=audit.id,
            url="https://a.com/team",
            title="Our team",
            h1_text="Leadership",
            content_excerpt="Meet the team.",
            fact_density=0.1,
        ),
        WebsiteAuditPage(
            audit_id=audit.id,
            url="https://a.com/results",
            title="Cancer detection results",
            h1_text="Validation results",
            content_excerpt="In a 1400-patient study breath analysis achieved 94% sensitivity.",
            fact_density=0.9,
        ),
    ]
    db_session.add_all(pages)
    await db_session.commit()

    selected = await select_brand_pages(
        brand_id=brand.id,
        prompt_text="how does breath analysis detect cancer",
        db=db_session,
        limit=2,
    )
    assert len(selected) == 2
    titles = [s.title for s in selected]
    assert "Cancer detection results" in titles
    assert "Breath test for cancer" in titles
    assert "Our team" not in titles


@pytest.mark.asyncio
async def test_select_brand_pages_returns_empty_when_no_audit(db_session):
    user = User(email="ev2@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="NoAudit", slug="noaudit-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    selected = await select_brand_pages(
        brand_id=brand.id, prompt_text="anything", db=db_session, limit=3,
    )
    assert selected == []


@pytest.mark.asyncio
async def test_select_web_sources_returns_top_n_filtered():
    from app.services.drafting.evidence import select_web_sources

    fake_results = [
        {"title": "PubMed: breath analysis", "link": "https://pubmed.ncbi.nlm.nih.gov/123", "snippet": "Study A"},
        {"title": "Random forum thread", "link": "https://forum-spam.example/thread", "snippet": "Forum chat"},
        {"title": "Nature study", "link": "https://nature.com/articles/x", "snippet": "Study B"},
        {"title": "Reddit", "link": "https://reddit.com/r/medicine/x", "snippet": "Reddit post"},
        {"title": "MIT news", "link": "https://news.mit.edu/x", "snippet": "MIT writeup"},
        {"title": "Junk", "link": "https://content-aggregator.example/x", "snippet": "junk"},
    ]
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=fake_results)):
        sources = await select_web_sources(query="breath analysis cancer detection", limit=3)
    assert len(sources) == 3
    domains = [s.url for s in sources]
    assert any("pubmed" in u for u in domains)
    assert any("nature.com" in u for u in domains)
    assert any("mit.edu" in u for u in domains)
    assert not any("forum-spam" in u for u in domains)


@pytest.mark.asyncio
async def test_select_web_sources_empty_on_no_results():
    from app.services.drafting.evidence import select_web_sources
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=[])):
        sources = await select_web_sources(query="anything", limit=5)
    assert sources == []


@pytest.mark.asyncio
async def test_select_library_sources_returns_brand_sources(db_session):
    from app.services.drafting.evidence import select_library_sources

    user = User(email="ev3@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Lib", slug="lib-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add_all([
        BrandSource(brand_id=brand.id, title="Study A", url="https://a.com/a",
                    snippet="A", source_type="paper"),
        BrandSource(brand_id=brand.id, title="Study B", url="https://a.com/b",
                    snippet="B", source_type="paper"),
    ])
    await db_session.commit()

    sources = await select_library_sources(brand_id=brand.id, db=db_session)
    assert len(sources) == 2
    assert {s.title for s in sources} == {"Study A", "Study B"}
    assert all(s.kind == "library" for s in sources)


@pytest.mark.asyncio
async def test_select_library_sources_caps_at_limit(db_session):
    from app.services.drafting.evidence import select_library_sources, BRAND_SOURCE_LIMIT

    user = User(email="ev4@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Many", slug="many-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add_all([
        BrandSource(brand_id=brand.id, title=f"S{i}", url=f"https://a.com/{i}",
                    snippet=f"snip {i}", source_type="article")
        for i in range(BRAND_SOURCE_LIMIT + 5)
    ])
    await db_session.commit()

    sources = await select_library_sources(brand_id=brand.id, db=db_session)
    assert len(sources) == BRAND_SOURCE_LIMIT


@pytest.mark.asyncio
async def test_cache_roundtrip(db_session):
    from app.services.drafting.evidence import (
        EvidencePack, EvidenceSource, write_cache, read_cache,
    )
    pack = EvidencePack(
        sources=[EvidenceSource(ref="S1", kind="web", url="https://x", title="t", snippet="s")],
        query="q", brand_name="b",
    )
    await write_cache(brand_id=1, prompt_id=2, pack=pack, db=db_session)
    fetched = await read_cache(brand_id=1, prompt_id=2, db=db_session)
    assert fetched is not None
    assert fetched.query == "q"
    assert len(fetched.sources) == 1
    assert fetched.sources[0].url == "https://x"


@pytest.mark.asyncio
async def test_cache_returns_none_when_expired(db_session):
    from app.services.drafting.evidence import (
        EvidencePack, write_cache, read_cache, CACHE_TTL_HOURS,
    )
    pack = EvidencePack(sources=[], query="q", brand_name="b")
    await write_cache(brand_id=3, prompt_id=4, pack=pack, db=db_session)
    row = (await db_session.execute(
        select(EvidenceCache).where(EvidenceCache.brand_id == 3, EvidenceCache.prompt_id == 4)
    )).scalar_one()
    row.fetched_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=CACHE_TTL_HOURS + 1)
    await db_session.commit()
    fetched = await read_cache(brand_id=3, prompt_id=4, db=db_session)
    assert fetched is None


@pytest.mark.asyncio
async def test_cache_miss_returns_none(db_session):
    from app.services.drafting.evidence import read_cache
    assert await read_cache(brand_id=999, prompt_id=999, db=db_session) is None


@pytest.mark.asyncio
async def test_build_evidence_pack_merges_three_sources(db_session):
    from app.services.drafting.evidence import build_evidence_pack

    user = User(email="ev5@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Pack", slug="pack-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    db_session.add(WebsiteAuditPage(
        audit_id=audit.id, url="https://b.com/x", title="breath cancer",
        h1_text="breath", content_excerpt="data", fact_density=0.8,
    ))
    db_session.add(BrandSource(
        brand_id=brand.id, title="Lib paper", url="https://a.com/p",
        snippet="paper", source_type="paper",
    ))
    await db_session.commit()

    fake_web = [
        {"title": "Nature x", "link": "https://nature.com/y", "snippet": "web snip"},
    ]
    with patch("app.services.drafting.evidence._serper_search", new=AsyncMock(return_value=fake_web)):
        pack = await build_evidence_pack(
            brand_id=brand.id,
            brand_name="Pack",
            prompt_id=1,
            prompt_text="breath cancer detection",
            db=db_session,
            use_cache=False,
        )
    refs = [s.ref for s in pack.sources]
    assert refs == [f"S{i+1}" for i in range(len(pack.sources))]
    kinds = {s.kind for s in pack.sources}
    assert kinds == {"library", "brand_page", "web"}
    assert len(pack.sources) <= 15


@pytest.mark.asyncio
async def test_build_evidence_pack_uses_cache_on_second_call(db_session):
    from app.services.drafting.evidence import build_evidence_pack

    user = User(email="ev6@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="Cached", slug="cached-evidence", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    with patch("app.services.drafting.evidence._serper_search",
               new=AsyncMock(return_value=[{"title": "T", "link": "https://nature.com/z", "snippet": "s"}])) as m:
        await build_evidence_pack(
            brand_id=brand.id, brand_name="Cached", prompt_id=42,
            prompt_text="test query", db=db_session, use_cache=True,
        )
        await build_evidence_pack(
            brand_id=brand.id, brand_name="Cached", prompt_id=42,
            prompt_text="test query", db=db_session, use_cache=True,
        )
    assert m.call_count == 1
