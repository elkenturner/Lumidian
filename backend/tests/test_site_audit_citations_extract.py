import pytest

from app.services.site_audit.citations import (
    extract_urls, classify_url, ClassifyResult, registered_domain,
)


def test_markdown_link_extraction():
    text = "See [the docs](https://acme.com/docs) and [other](https://x.com/y)."
    urls = extract_urls(text)
    assert "https://acme.com/docs" in urls
    assert "https://x.com/y" in urls


def test_bare_url_extraction():
    text = "Cited at https://example.com/article and also at https://other.com/page!"
    urls = extract_urls(text)
    assert "https://example.com/article" in urls
    assert "https://other.com/page" in urls


def test_dedup_within_one_response():
    text = "[a](https://x.com/a) https://x.com/a [b](https://x.com/a)"
    urls = extract_urls(text)
    assert urls.count("https://x.com/a") == 1


def test_classify_own_competitor_third_party_unknown():
    own = "acme.com"
    competitors = {"rival.com": 7}
    assert classify_url("https://acme.com/x", own, competitors).kind == "own"
    res = classify_url("https://rival.com/y", own, competitors)
    assert res.kind == "competitor" and res.competitor_id == 7
    assert classify_url("https://wikipedia.org/x", own, competitors).kind == "third_party"
    assert classify_url("https://random.com/x", own, competitors).kind == "unknown"


def test_registered_domain():
    assert registered_domain("https://docs.acme.co.uk/foo") == "acme.co.uk"
    assert registered_domain("https://acme.com/") == "acme.com"
    assert registered_domain("not a url") is None


@pytest.mark.asyncio
async def test_extract_for_run_uses_structured_citations_field():
    """Perp/Gemini don't embed URLs in response_text — they return citations
    as a structured array. extract_for_run must pull URLs from the new
    QueryResult.citations column, not only from response_text.
    """
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, QueryResult, TrackingRun, User, CitationSource
    from sqlalchemy import select
    from app.services.site_audit.citations import extract_for_run

    async with AsyncSessionLocal() as db:
        user = User(email="cit-struct@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="cit-struct-brand", user_id=user.id,
                      website_url="https://acme.com")
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        run = TrackingRun(
            brand_id=brand.id, status="completed", run_type="manual",
            total_queries=1, total_mentions=0, overall_score=0.0,
        )
        db.add(run); await db.flush()
        # The Perplexity/Gemini regression: text has no URLs, but the
        # structured citations field does.
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity",
            run_number=1,
            response_text="Cancer screening is improving via novel methods.",
            mentioned=False,
            citations=[
                {"url": "https://www.nih.gov/news/breath-cancer-2025", "title": "NIH"},
                {"url": "https://nature.com/articles/voc-cancer-2024", "title": "Nature"},
            ],
        )
        db.add(qr); await db.commit()
        run_id = run.id
        brand_id = brand.id

    inserted = await extract_for_run(run_id)
    assert inserted == 2, f"expected 2 rows from structured citations, got {inserted}"

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(CitationSource).where(CitationSource.brand_id == brand_id)
        )).scalars().all()
        domains = {r.domain for r in rows}
        assert "nih.gov" in domains
        assert "nature.com" in domains


@pytest.mark.asyncio
async def test_extract_for_run_combines_text_and_structured_dedup():
    """When both response_text and citations contain the same URL, dedup."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, QueryResult, TrackingRun, User, CitationSource
    from sqlalchemy import select
    from app.services.site_audit.citations import extract_for_run

    async with AsyncSessionLocal() as db:
        user = User(email="cit-dedup@x.com", password_hash="x", name="t")
        db.add(user); await db.flush()
        brand = Brand(name="A", slug="cit-dedup-brand", user_id=user.id,
                      website_url="https://acme.com")
        db.add(brand); await db.flush()
        prompt = Prompt(brand_id=brand.id, text="q", prompt_type="standard")
        db.add(prompt); await db.flush()
        run = TrackingRun(
            brand_id=brand.id, status="completed", run_type="manual",
            total_queries=1, total_mentions=0, overall_score=0.0,
        )
        db.add(run); await db.flush()
        qr = QueryResult(
            tracking_run_id=run.id, prompt_id=prompt.id, model="chatgpt",
            run_number=1,
            response_text="Read [more](https://nih.gov/x).",
            mentioned=False,
            citations=[{"url": "https://nih.gov/x", "title": None}],
        )
        db.add(qr); await db.commit()
        run_id = run.id
        brand_id = brand.id

    inserted = await extract_for_run(run_id)
    assert inserted == 1  # same URL from both sources counted once

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(CitationSource).where(CitationSource.brand_id == brand_id)
        )).scalars().all()
        assert len(rows) == 1
