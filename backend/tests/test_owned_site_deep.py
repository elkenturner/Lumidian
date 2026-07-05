"""Tests for the owned-site "deep" variant (Task 3): 1800-3000 word FAQ-rich
pages with FAQPage JSON-LD.

Covers:
  - build_owned_site_prompt(depth="deep") encodes the length target, the FAQ
    mandate, and the H2-as-question rule; depth="standard" (default) does not.
  - _extract_faq parses a "## Frequently asked questions" section's "### Q"
    subsections into [{"question", "answer"}] pairs; [] when absent.
  - generate_owned_site_draft(depth="deep") threads the FAQ into build_jsonld
    so the result carries a FAQPage node.
  - The cluster regenerate-piece route accepts an optional depth field and
    forwards it into regenerate_piece for owned_site only.
"""
from unittest.mock import AsyncMock

import pytest

from app.services.drafting import owned_site
from tests.conftest import create_brand, register_and_login

_BRAND = {
    "name": "Acme Widgets",
    "description": "makes industrial widgets",
    "url": "https://acme.example.com",
    "audience": "factory managers",
}


def _writer_returning(*texts):
    calls = {"n": 0}

    async def _w(prompt):
        i = min(calls["n"], len(texts) - 1)
        calls["n"] += 1
        return texts[i]

    _w.calls = calls
    return _w


# ── Prompt builder ──────────────────────────────────────────────────────────

def test_deep_prompt_encodes_length_faq_and_h2_rule():
    p = owned_site.build_owned_site_prompt(_BRAND, "best widget for factories", depth="deep")
    assert "Frequently asked questions" in p
    assert "1800" in p and "3000" in p
    assert "H2" in p
    assert "question" in p.lower()


def test_standard_prompt_has_no_faq_mandate():
    p = owned_site.build_owned_site_prompt(_BRAND, "best widget for factories")
    assert "Frequently asked questions" not in p
    p_explicit = owned_site.build_owned_site_prompt(_BRAND, "best widget for factories", depth="standard")
    assert "Frequently asked questions" not in p_explicit


# ── _extract_faq ─────────────────────────────────────────────────────────────

_BODY_WITH_FAQ = (
    "# Deep Guide To Widgets\n\n"
    "## What is a widget?\n"
    "Widgets are precision-machined components used on factory lines.\n\n"
    "## Frequently asked questions\n\n"
    "### Is it safe for continuous use?\n"
    "Yes — it is rated for 24/7 operation based on independent lab tests.\n\n"
    "### How much does it cost?\n"
    "Pricing starts at $99 per unit for bulk factory orders.\n\n"
    "### Does it work offline?\n"
    "No, it requires a network connection to report telemetry.\n"
)

_BODY_WITHOUT_FAQ = (
    "# Guide To Widgets\n\n"
    "## What is a widget?\n"
    "Widgets are precision-machined components.\n"
)


def test_extract_faq_parses_three_pairs():
    pairs = owned_site._extract_faq(_BODY_WITH_FAQ)
    assert len(pairs) == 3
    assert pairs[0]["question"] == "Is it safe for continuous use?"
    assert "24/7" in pairs[0]["answer"]
    assert pairs[1]["question"] == "How much does it cost?"
    assert pairs[2]["question"] == "Does it work offline?"


def test_extract_faq_returns_empty_when_section_missing():
    assert owned_site._extract_faq(_BODY_WITHOUT_FAQ) == []


# ── generate_owned_site_draft(depth="deep") ─────────────────────────────────

@pytest.mark.asyncio
async def test_generate_deep_draft_emits_faqpage_jsonld():
    writer = _writer_returning(_BODY_WITH_FAQ)
    d = await owned_site.generate_owned_site_draft(
        writer, _BRAND, "best widget for factories", date_published="2026-06-03", depth="deep",
    )
    assert "@graph" in d.jsonld
    faq_node = next(n for n in d.jsonld["@graph"] if n["@type"] == "FAQPage")
    assert len(faq_node["mainEntity"]) == 3
    assert faq_node["mainEntity"][0]["name"] == "Is it safe for continuous use?"


@pytest.mark.asyncio
async def test_generate_standard_draft_has_no_faqpage_when_no_faq_section():
    writer = _writer_returning(_BODY_WITHOUT_FAQ)
    d = await owned_site.generate_owned_site_draft(
        writer, _BRAND, "best widget for factories", date_published="2026-06-03",
    )
    assert d.jsonld.get("@type") == "Article"
    assert "@graph" not in d.jsonld


# ── _gen_owned_site_piece: deep raises the writer token cap ────────────────

@pytest.mark.asyncio
async def test_gen_owned_site_piece_deep_uses_8000_token_cap():
    from types import SimpleNamespace
    from unittest.mock import patch
    from app.services.clustering_service import _gen_owned_site_piece

    cluster = SimpleNamespace(id=1, brand_id=999101)
    brand_row = SimpleNamespace(name="Acme Widgets", website_url="https://acme.example.com")
    prompt_row = SimpleNamespace(text="best widget for factories")

    captured_kwargs: list[dict] = []

    async def _fake_call_claude(prompt, **kwargs):
        captured_kwargs.append(kwargs)
        return _BODY_WITH_FAQ

    with patch("app.services.drafting.client.call_claude", AsyncMock(side_effect=_fake_call_claude)):
        deep_res = await _gen_owned_site_piece(
            cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
            brief_context=None, pack=None, tier="pro", depth="deep",
        )
    assert deep_res[0] == "ok", deep_res
    assert captured_kwargs and all(k.get("max_tokens") == 8000 for k in captured_kwargs)
    # Deep body carries an FAQ -> the appended JSON-LD block must include FAQPage.
    assert "FAQPage" in deep_res[3]

    captured_kwargs.clear()
    with patch("app.services.drafting.client.call_claude", AsyncMock(side_effect=_fake_call_claude)):
        std_res = await _gen_owned_site_piece(
            cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
            brief_context=None, pack=None, tier="pro",
        )
    assert std_res[0] == "ok", std_res
    assert captured_kwargs and all(k.get("max_tokens") == 3000 for k in captured_kwargs)


# ── Router: depth threaded through regenerate-piece ─────────────────────────

@pytest.mark.asyncio
async def test_regenerate_piece_route_forwards_deep_depth(client, monkeypatch):
    await register_and_login(client, "deeppage@example.com")
    brand = await create_brand(client, "Deep Brand")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    from app.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models import ContentCluster, ContentDraft

    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster_id = cluster.id

    captured = {}

    async def fake_regenerate_piece(db, *, cluster_id, platform, tier, depth="standard"):
        captured["platform"] = platform
        captured["depth"] = depth
        draft = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster_id,
            platform=platform, status="draft", title="T", content_text="Body.",
            source="cluster",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        return draft

    monkeypatch.setattr("app.routers.clusters.regenerate_piece", AsyncMock(side_effect=fake_regenerate_piece))

    resp = await client.post(
        f"/api/clusters/{brand['id']}/{cluster_id}/regenerate-piece",
        json={"platform": "owned_site", "depth": "deep"},
    )
    assert resp.status_code == 200, resp.text
    assert captured["platform"] == "owned_site"
    assert captured["depth"] == "deep"


@pytest.mark.asyncio
async def test_regenerate_piece_route_defaults_depth_to_standard(client, monkeypatch):
    await register_and_login(client, "shallowpage@example.com")
    brand = await create_brand(client, "Shallow Brand")
    r = await client.get(f"/api/brands/{brand['id']}")
    prompt_id = r.json()["prompts"][0]["id"]

    from app.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models import ContentCluster, ContentDraft

    async with AsyncSessionLocal() as db:
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one()
        cluster_id = cluster.id

    captured = {}

    async def fake_regenerate_piece(db, *, cluster_id, platform, tier, depth="standard"):
        captured["depth"] = depth
        draft = ContentDraft(
            brand_id=brand["id"], prompt_id=prompt_id, cluster_id=cluster_id,
            platform=platform, status="draft", title="T", content_text="Body.",
            source="cluster",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        return draft

    monkeypatch.setattr("app.routers.clusters.regenerate_piece", AsyncMock(side_effect=fake_regenerate_piece))

    resp = await client.post(
        f"/api/clusters/{brand['id']}/{cluster_id}/regenerate-piece",
        json={"platform": "linkedin"},
    )
    assert resp.status_code == 200, resp.text
    assert captured["depth"] == "standard"
