"""Tests for the owned-site generator (Layer B1) — no live LLM calls."""
import json

import pytest

from app.services.drafting import owned_site


_BRAND = {
    "name": "SpotitEarly",
    "description": "an early cancer screening test using breath samples and trained dogs",
    "url": "https://spotitearly.com",
    "audience": "primary care physicians",
    "what_not_to_say": "do not claim FDA approval",
}

# A clean, human-sounding draft that passes the anti-AI gate.
_CLEAN = (
    "# SpotitEarly screens for early cancer with a breath test\n\n"
    "## How it works\n"
    "You breathe into a tube. Trained dogs and an AI model read the sample. "
    "In a 2025 trial at Hackensack, the method flagged 11 early-stage cases a blood "
    "panel missed. Results came back in two days for most patients, per the study [S1].\n\n"
    "## Who it is for\n"
    "Primary care physicians use it as a first-line check. It is not a replacement for "
    "biopsy. SpotitEarly positions it as a triage step before invasive testing.\n"
)


def _writer_returning(*texts):
    """Build an async writer stub that returns the given texts in order."""
    calls = {"n": 0}

    async def _w(prompt):
        i = min(calls["n"], len(texts) - 1)
        calls["n"] += 1
        return texts[i]

    _w.calls = calls
    return _w


# ── Prompt builder ──────────────────────────────────────────────────────────

def test_prompt_encodes_citation_drivers_and_query():
    p = owned_site.build_owned_site_prompt(_BRAND, "best early cancer screening startups")
    assert "best early cancer screening startups" in p
    assert "ANSWER-FIRST" in p
    assert "SpotitEarly" in p
    assert "NEVER say: do not claim FDA approval" in p
    # anti-AI rules are baked in
    assert "delve" in p.lower() and "in conclusion" in p.lower()


def test_prompt_includes_evidence_and_voice_and_avoid():
    ev = [{"title": "Hackensack trial", "url": "https://x.com/t", "snippet": "11 cases found"}]
    p = owned_site.build_owned_site_prompt(
        _BRAND, "q", evidence=ev, voice="terse, clinical, first-person plural",
        avoid="- Remove the phrase 'delve'",
    )
    assert "[S1] Hackensack trial" in p
    assert "VOICE — mirror this voice" in p
    assert "REVISION" in p and "delve" in p


# ── JSON-LD ─────────────────────────────────────────────────────────────────

def test_jsonld_article_is_valid_and_serializable():
    ld = owned_site.build_jsonld("Headline here", _BRAND, "2026-06-03")
    assert ld["@type"] == "Article"
    assert ld["datePublished"] == "2026-06-03" == ld["dateModified"]
    assert ld["author"]["name"] == "SpotitEarly"
    assert ld["mainEntityOfPage"]["@id"] == "https://spotitearly.com"
    json.dumps(ld)  # must be serializable


def test_jsonld_with_faq_uses_graph():
    ld = owned_site.build_jsonld(
        "H", _BRAND, "2026-06-03",
        faq=[{"question": "Is it FDA approved?", "answer": "It is in clinical trials."}],
    )
    assert "@graph" in ld
    types = {node["@type"] for node in ld["@graph"]}
    assert types == {"Article", "FAQPage"}
    assert ld["@graph"][1]["mainEntity"][0]["name"] == "Is it FDA approved?"


# ── Generation loop (gating through anti_ai) ────────────────────────────────

@pytest.mark.asyncio
async def test_clean_draft_passes_first_try():
    writer = _writer_returning(_CLEAN)
    d = await owned_site.generate_owned_site_draft(writer, _BRAND, "q", date_published="2026-06-03")
    assert d.anti_ai_passed is True
    assert d.attempts == 1
    assert d.flagged_for_review is False
    assert d.jsonld["@type"] == "Article"


@pytest.mark.asyncio
async def test_aislop_then_clean_triggers_regeneration():
    slop = ("In today's fast-paced world, we delve into the rich tapestry of screening. "
            "It's not just a test, it's a revolution. In conclusion, it underscores the future.")
    writer = _writer_returning(slop, _CLEAN)
    d = await owned_site.generate_owned_site_draft(writer, _BRAND, "q", date_published="2026-06-03")
    assert d.attempts == 2            # regenerated once
    assert d.anti_ai_passed is True
    assert d.flagged_for_review is False
    assert writer.calls["n"] == 2


@pytest.mark.asyncio
async def test_persistent_slop_is_flagged_not_shipped():
    slop = ("In today's fast-paced world, we delve into the tapestry. "
            "It's not just X, it's Y. In conclusion, it underscores the realm.")
    writer = _writer_returning(slop)  # always returns slop
    d = await owned_site.generate_owned_site_draft(
        writer, _BRAND, "q", date_published="2026-06-03", max_retries=2)
    assert d.anti_ai_passed is False
    assert d.flagged_for_review is True
    assert d.attempts == 3            # initial + 2 retries
