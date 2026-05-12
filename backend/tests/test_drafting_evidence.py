import pytest

from app.models import Brand, WebsiteAudit, WebsiteAuditPage, User
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
