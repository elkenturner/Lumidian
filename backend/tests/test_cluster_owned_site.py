"""
Tests for the owned-site cluster anchor piece (Task 7):
  - CLUSTER_PLATFORMS puts owned_site first, alongside the 5 existing platforms
  - build_owned_site_prompt accepts a cluster `brief` and folds it into the prompt
  - marking an owned_site cluster draft posted with a URL attaches it as the
    cluster's pillar (pillar_url / pillar_mode)

Fix pass (review findings):
  - _gen_owned_site_piece must fold the cluster-level low_evidence flag into its
    returned low_ev, mirroring every other platform's `low_ev or low_evidence`.
  - a real end-to-end exercise of _gen_owned_site_piece (only call_claude
    patched) so the JSON-LD append, evidence filtering, and low_ev derivation
    are all covered by an actual run through generate_owned_site_draft.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from tests.conftest import create_brand, register_and_login

# Clean, human-sounding owned-site page that passes the anti-AI gate on the
# first attempt — keeps the integration test cheap (one writer call).
_CLEAN_OWNED_BODY = (
    "# Acme Widgets ships the fastest widget on the market\n\n"
    "## How it performs\n"
    "Independent lab tests clocked the Acme widget at 3.2 seconds per cycle. "
    "That beat every competitor tested in the same 2025 benchmark run.\n\n"
    "## Who it's built for\n"
    "Manufacturing teams use it on the line. It is not meant for hobbyist use."
)

# asyncio_mode=auto (pytest.ini) runs the async test below without a marker;
# no module-level pytestmark here since this file also has plain sync tests.


def test_owned_site_is_first_cluster_platform():
    from app.services.clustering_service import CLUSTER_PLATFORMS
    assert CLUSTER_PLATFORMS[0] == "owned_site"
    assert set(CLUSTER_PLATFORMS) == {"owned_site", "linkedin", "medium", "reddit", "quora", "x"}


def test_owned_site_prompt_accepts_brief():
    from app.services.drafting.owned_site import build_owned_site_prompt
    p = build_owned_site_prompt(
        {"name": "Acme"}, "best widget?",
        evidence=[{"title": "T", "url": "https://e.com", "snippet": "s"}],
        brief="POSITIONING: the fastest widget",
    )
    assert "the fastest widget" in p


async def test_marking_owned_site_draft_posted_attaches_pillar(client: httpx.AsyncClient):
    """PUT the draft to posted with a posted_url -> cluster.pillar_url/pillar_mode set."""
    await register_and_login(client, email="pillarattach@example.com")
    brand = await create_brand(client, name="Pillar Attach Brand")
    prompt_id = brand["prompts"][0]["id"]

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import ContentCluster, ContentDraft

    async with AsyncSessionLocal() as db:
        # Brand creation auto-provisions a cluster per prompt — reuse it rather
        # than violating the ContentCluster.prompt_id UNIQUE constraint.
        cluster = (await db.execute(
            select(ContentCluster).where(ContentCluster.prompt_id == prompt_id)
        )).scalar_one_or_none()
        if cluster is None:
            cluster = ContentCluster(
                brand_id=brand["id"],
                prompt_id=prompt_id,
                status="ready",
                pillar_mode="none",
                version=1,
            )
            db.add(cluster)
            await db.commit()
            await db.refresh(cluster)
        cluster_id = cluster.id

        draft = ContentDraft(
            brand_id=brand["id"],
            prompt_id=prompt_id,
            cluster_id=cluster_id,
            platform="owned_site",
            status="draft",
            title="Best Widget Guide",
            content_text="Body content.",
            source="cluster",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    posted_url = "https://acme.com/answers/widgets"
    resp = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"status": "posted", "posted_url": posted_url},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "posted"

    async with AsyncSessionLocal() as db:
        refreshed_cluster = await db.get(ContentCluster, cluster_id)
        assert refreshed_cluster.pillar_mode == "attached"
        assert refreshed_cluster.pillar_url == posted_url


async def test_gen_owned_site_piece_folds_cluster_low_evidence():
    """Finding 1: every other cluster platform does `low_ev = low_ev or low_evidence`
    (see _gen in regenerate_cluster). _gen_owned_site_piece must do the same —
    a brand-authority-fallback cluster (ready_low_evidence) with real crawled
    URLs in its pack must still mark the owned_site anchor low_evidence=True,
    or the frontend badge is inconsistently absent on the anchor piece.
    """
    from app.services.clustering_service import _gen_owned_site_piece

    cluster = SimpleNamespace(id=1, brand_id=999001)
    brand_row = SimpleNamespace(name="Acme Widgets", website_url="https://acme.example.com")
    prompt_row = SimpleNamespace(text="best widget for factories")
    # Non-empty, real (non-internal) evidence — without the fix, low_ev would
    # come back False here because `not evidence` is False.
    pack = SimpleNamespace(sources=[
        {"title": "Lab Report", "url": "https://labs.example.com/report", "snippet": "s"},
    ])

    with patch("app.services.drafting.client.call_claude", new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = _CLEAN_OWNED_BODY
        result = await _gen_owned_site_piece(
            cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
            brief_context=None, pack=pack, tier="pro", low_evidence=True,
        )

    assert result[0] == "ok", result
    assert result[1] == "owned_site"
    low_ev = result[-1]
    assert low_ev is True


async def test_gen_owned_site_piece_end_to_end_real_pipeline():
    """Finding 2: exercise the REAL _gen_owned_site_piece -> generate_owned_site_draft
    -> anti_ai.enforce pipeline with only call_claude patched, so the JSON-LD
    append and internal:// evidence filtering are covered by an actual run
    rather than a mocked-out writer path.
    """
    from app.services.clustering_service import _gen_owned_site_piece

    cluster = SimpleNamespace(id=2, brand_id=999002)
    brand_row = SimpleNamespace(name="Acme Widgets", website_url="https://acme.example.com")
    prompt_row = SimpleNamespace(text="best widget for factories")
    pack = SimpleNamespace(sources=[
        {"title": "Lab Report", "url": "https://labs.example.com/report", "snippet": "Independent testing"},
        {"title": "Internal Crawl", "url": "internal://crawl/page-1", "snippet": "internal crawl notes"},
    ])

    captured_prompts: list[str] = []

    async def _fake_call_claude(prompt, **kwargs):
        captured_prompts.append(prompt)
        return _CLEAN_OWNED_BODY

    mock_claude = AsyncMock(side_effect=_fake_call_claude)
    with patch("app.services.drafting.client.call_claude", mock_claude):
        result = await _gen_owned_site_piece(
            cluster=cluster, brand_row=brand_row, prompt_row=prompt_row,
            brief_context=None, pack=pack, tier="pro",
        )

    assert result[0] == "ok", result
    assert result[1] == "owned_site"
    _, _, title, body, score, citations, low_ev = result
    assert title  # non-empty; derived from the body's H1 via jsonld headline
    assert citations == []
    assert "Schema markup (JSON-LD" in body

    assert captured_prompts, "call_claude should have been invoked at least once"
    first_prompt = captured_prompts[0]
    # internal:// pack sources must be filtered out of what the writer sees...
    assert "internal://" not in first_prompt
    # ...while a real https evidence source survives into the prompt.
    assert "https://labs.example.com/report" in first_prompt
