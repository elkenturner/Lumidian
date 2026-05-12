from app.services.drafting.models import (
    writer_model_for_tier,
    rewriter_model_for_tier,
    CRITIC_MODEL,
    CROSS_REF_SUMMARY_MODEL,
    SHORT_REPLY_MODEL,
)


def test_writer_model_for_tier_pro_returns_opus():
    assert writer_model_for_tier("pro") == "claude-opus-4-7"


def test_writer_model_for_tier_growth_returns_sonnet():
    assert writer_model_for_tier("starter") == "claude-sonnet-4-6"


def test_writer_model_for_tier_starter_returns_sonnet():
    assert writer_model_for_tier("basic") == "claude-sonnet-4-6"


def test_writer_model_for_tier_free_returns_sonnet():
    assert writer_model_for_tier(None) == "claude-sonnet-4-6"


def test_rewriter_model_for_tier_growth_and_pro_returns_opus():
    assert rewriter_model_for_tier("starter") == "claude-opus-4-7"
    assert rewriter_model_for_tier("pro") == "claude-opus-4-7"


def test_critic_model_is_sonnet():
    assert CRITIC_MODEL == "claude-sonnet-4-6"


def test_cross_ref_and_short_reply_are_haiku():
    assert CROSS_REF_SUMMARY_MODEL == "claude-haiku-4-5-20251001"
    assert SHORT_REPLY_MODEL == "claude-haiku-4-5-20251001"
