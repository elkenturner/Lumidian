"""Rules-content tests: the prompt/spec text encodes the July 2026 research decisions."""
from app.services.drafting.platforms import (
    PLATFORM_SPECS,
    PLATFORM_MAX_TOKENS,
    build_subreddit_strategy,
    classify_subreddit,
)
from app.services.drafting.prompts import build_prompt


def _joined_rules(platform: str) -> str:
    return " ".join(PLATFORM_SPECS[platform]["rules"]).lower()


def test_reddit_disclosure_is_conditional_on_endorsement():
    rules = _joined_rules("reddit")
    assert "recommends" in rules or "endorse" in rules  # conditional trigger
    assert "full disclosure" in rules                    # casual phrasing modeled
    assert "neutral factual" in rules                    # neutral mention needs none
    # The old blanket rule must be gone
    assert "disclose brand affiliation if the brand is mentioned" not in rules


def test_reddit_has_authenticity_and_prose_attribution_rules():
    rules = _joined_rules("reddit")
    assert "tradeoff" in rules or "competitor" in rules   # real-evaluation rule
    assert "in prose" in rules or "never a bare link" in rules
    assert "question" in _joined_rules("reddit")          # question-phrased title guidance


def test_reddit_posting_tip_warns_about_account_readiness():
    tip = PLATFORM_SPECS["reddit"]["posting_tip"].lower()
    assert "karma" in tip and "30" in tip


def test_quora_disclosure_lives_in_credential():
    rules = _joined_rules("quora")
    assert "credential" in rules
    tip = PLATFORM_SPECS["quora"]["posting_tip"].lower()
    assert "credential" in tip


def test_x_tips_mention_own_brand_labeling():
    assert "label" in PLATFORM_SPECS["x_post"]["posting_tip"].lower()
    assert "label" in PLATFORM_SPECS["x_thread"]["posting_tip"].lower()


def test_reddit_comment_spec_exists():
    spec = PLATFORM_SPECS["reddit_comment"]
    assert spec["format"] == "thread_reply"
    assert spec["word_range"] == (100, 300)
    rules = _joined_rules("reddit_comment")
    assert "no links" in rules or "no outbound links" in rules
    assert PLATFORM_MAX_TOKENS["reddit_comment"] == 900
    # reply variants stay out of the standalone-content platform list
    from app.services.drafting.platforms import CONTENT_PLATFORMS
    assert "reddit_comment" not in CONTENT_PLATFORMS


def test_classify_subreddit_does_not_mangle_r_initial_names():
    # A bare r-initial name (e.g. scanner-stored "rust") must classify the
    # same as its "r/"-prefixed form — the old .lstrip("r/") strips leading
    # 'r' and '/' characters individually, turning "rust" into "ust".
    assert classify_subreddit("rust") == classify_subreddit("r/rust")


def test_classify_subreddit_relationships_is_restricted():
    # "relationships" starts with 'r'; the old char-class lstrip("r/") turns
    # it into "elationships", which misses the "restricted" name-signal
    # check entirely. It must still be classified "restricted".
    assert classify_subreddit("relationships") == "restricted"


def test_build_subreddit_strategy_preserves_r_initial_name():
    out = build_subreddit_strategy("rust", "Acme", "allowed")
    assert "r/rust" in out
    assert "r/ust" not in out


def test_core_prompt_bans_fake_customer_voice():
    p = build_prompt(
        brand_name="Acme", platform="reddit", prompt_text="best widget?",
        visibility_pct=10.0, profile_context="", response_analysis="",
        platform_spec=PLATFORM_SPECS["reddit"],
    )
    assert "satisfied customer" in p.lower() or "fake-customer" in p.lower() or "as a customer" in p.lower()
