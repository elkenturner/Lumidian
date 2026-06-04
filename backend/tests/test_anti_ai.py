"""Tests for the anti-AI writing enforcement engine (Layer C foundation)."""
from app.services.drafting import anti_ai


# ── Hard fails (assistant-voice leaks) ──────────────────────────────────────

def test_assistant_leak_always_blocks():
    r = anti_ai.scan("As an AI language model, I can help you draft this post.")
    assert r.blocked is True
    assert r.passed is False
    assert any(v.category == "assistant_leak" for v in r.violations)


def test_chat_opener_blocks():
    r = anti_ai.scan("Certainly! Here is a draft about cancer screening for your brand.")
    assert r.blocked is True


# ── High-precision constructions fail with near-zero tolerance ──────────────

def test_antithesis_construction_fails():
    r = anti_ai.scan("Early detection isn't just a feature, it's the whole point of the test.")
    assert r.passed is False
    assert any(v.category == "construction" for v in r.violations)


def test_in_conclusion_fails():
    r = anti_ai.scan("The data is clear. In conclusion, screening saves lives and money.")
    assert r.passed is False


def test_smoking_gun_word_fails_alone():
    # "delve" + "tapestry" are S1/FP-LOW — should fail even in short text
    r = anti_ai.scan("Let us delve into the rich tapestry of modern diagnostics.")
    assert r.passed is False
    assert any(v.category == "lexicon" for v in r.violations)


# ── False-positive safety (must NOT over-flag legit human writing) ──────────

def test_clean_human_text_passes():
    text = (
        "We ran the breath test on 1,400 patients at Hackensack last spring. "
        "Most got results in two days. A few took longer. The dogs flagged 11 "
        "early-stage cases the blood panel missed, which surprised even our lab lead, "
        "Dr. Ruiz. That is the number we keep coming back to."
    )
    r = anti_ai.scan(text)
    assert r.passed is True, f"clean text flagged: {[v.detail for v in r.violations]} score={r.score}"


def test_single_common_word_does_not_flag():
    # "robust" / "significant" are FP-HIGH — must not fail on their own
    text = ("The study used a robust sample of 1,200 people across three clinics. "
            "Results held up across every subgroup we checked, which matters for a "
            "test marketed to general practitioners who see mixed populations daily.")
    r = anti_ai.scan(text)
    assert r.passed is True


def test_short_simple_sentences_not_penalized_for_shortness():
    # ESL-bias guard: short/simple sentences alone must not fail (only UNIFORMITY does)
    text = ("The test is fast. It uses breath. Dogs help too. We tried it in May. "
            "It found early cancer. Doctors liked it. Patients did too. We will scale it. "
            "More clinics want in. That is the plan for now and the months ahead, honestly.")
    r = anti_ai.scan(text)
    # may flag rhythm uniformity if truly uniform, but must not block / explode
    assert r.blocked is False


# ── Scoring mechanics ───────────────────────────────────────────────────────

def test_breadth_multiplier_increases_score():
    # text hitting lexicon + construction + structure should score higher than one category
    one = anti_ai.scan("We delve into the data.")
    many = anti_ai.scan(
        "In today's fast-paced world, we delve into the intricate tapestry. "
        "It's not just data, it's insight.\n- **Speed:** fast\n- **Scale:** big\n- **Trust:** high"
    )
    assert many.score > one.score
    assert many.metrics["categories_firing"] >= 2


def test_em_dash_density_flagged():
    text = "A — B — C — D — E — F is the pattern here in this very short line indeed."
    r = anti_ai.scan(text)
    assert any(v.category == "structure" and "Em-dash" in v.detail for v in r.violations)


# ── Feedback + autofix ──────────────────────────────────────────────────────

def test_feedback_lists_concrete_tells():
    r = anti_ai.scan("In conclusion, we delve into the tapestry of results.")
    fb = anti_ai.feedback_for_regeneration(r)
    assert "delve" in fb.lower() or "tapestry" in fb.lower() or "conclusion" in fb.lower()
    assert fb.startswith("Your draft reads as AI-generated")


def test_feedback_empty_when_passed():
    r = anti_ai.scan("We tested it on 1,400 patients last spring. The dogs caught 11 cases.")
    assert anti_ai.feedback_for_regeneration(r) == ""


def test_autofix_is_safe_and_cosmetic():
    fixed = anti_ai.autofix("Certainly! The result — unexpectedly — was fast. I hope this helps")
    assert "—" not in fixed           # em-dash gone
    assert not fixed.lower().startswith("certainly")
    assert "hope this helps" not in fixed.lower()
    assert "result" in fixed                # content preserved


def test_passes_helper():
    assert anti_ai.passes("We shipped the test to 12 clinics in March and tracked outcomes.") is True
    assert anti_ai.passes("As an AI, I'd be happy to help you delve into this tapestry.") is False


# ── enforce() — the canonical gate loop ─────────────────────────────────────

import pytest


@pytest.mark.asyncio
async def test_enforce_clean_text_no_regen():
    text, report, regens = await anti_ai.enforce("We tested it on 1,400 patients in May. Eleven cases surfaced.")
    assert report.passed is True
    assert regens == 0


@pytest.mark.asyncio
async def test_enforce_regenerates_until_clean():
    clean = "We ran it on 1,400 patients in May. The dogs caught eleven early cases."
    calls = {"n": 0}

    async def regen(feedback):
        calls["n"] += 1
        return clean

    slop = "In today's fast-paced world, we delve into the tapestry. It's not just X, it's Y. In conclusion."
    text, report, regens = await anti_ai.enforce(slop, regenerate=regen, max_retries=2)
    assert report.passed is True
    assert regens == 1
    assert "delve" not in text.lower()


@pytest.mark.asyncio
async def test_enforce_keeps_best_and_stops_at_max():
    slop = "In today's fast-paced world we delve into the tapestry. It's not just X, it's Y. In conclusion."

    async def regen(feedback):
        return slop  # never improves

    text, report, regens = await anti_ai.enforce(slop, regenerate=regen, max_retries=2)
    assert report.passed is False
    assert regens == 2


@pytest.mark.asyncio
async def test_enforce_survives_writer_exception():
    slop = "We delve into the rich tapestry. In conclusion, it underscores the realm."

    async def regen(feedback):
        raise RuntimeError("LLM down")

    text, report, regens = await anti_ai.enforce(slop, regenerate=regen, max_retries=2)
    assert report.passed is False     # couldn't fix, but didn't crash
    assert regens == 0
