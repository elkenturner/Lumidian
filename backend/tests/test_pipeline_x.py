"""Tests for X-specific pipeline functions: character enforcement and thread parsing."""
from app.services.drafting.pipeline import enforce_x_char_limit, parse_x_thread


# ── enforce_x_char_limit ───────────────────────────────────────────────────────

def test_enforce_short_post_unchanged():
    text = "This is a short tweet."
    assert enforce_x_char_limit(text, "x_post") == text


def test_enforce_post_over_280_trimmed():
    text = "A" * 300
    result = enforce_x_char_limit(text, "x_post")
    assert len(result) <= 280


def test_enforce_post_trims_at_word_boundary():
    words = "word " * 60  # 300 chars
    result = enforce_x_char_limit(words.strip(), "x_post")
    assert len(result) <= 280
    assert not result.endswith(" ")


def test_enforce_thread_per_tweet_limit():
    raw = "1/ " + "A" * 300 + "\n2/ Short tweet here"
    result = enforce_x_char_limit(raw, "x_thread")
    tweets = parse_x_thread(result)
    for tweet in tweets:
        assert len(tweet) <= 280


def test_enforce_non_x_platform_unchanged():
    text = "A" * 500
    assert enforce_x_char_limit(text, "reddit") == text


def test_enforce_reply_over_280_trimmed():
    text = "B" * 300
    result = enforce_x_char_limit(text, "x_reply")
    assert len(result) <= 280


# ── parse_x_thread ─────────────────────────────────────────────────────────────

def test_parse_thread_numbered():
    raw = "1/ First tweet\n2/ Second tweet\n3/ Third tweet"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 3
    assert tweets[0] == "1/ First tweet"
    assert tweets[1] == "2/ Second tweet"
    assert tweets[2] == "3/ Third tweet"


def test_parse_thread_with_blank_lines():
    raw = "1/ First tweet\n\n2/ Second tweet\n\n3/ Third tweet"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 3


def test_parse_thread_no_numbering_returns_whole():
    raw = "Just a single tweet with no numbering"
    tweets = parse_x_thread(raw)
    assert len(tweets) == 1
    assert tweets[0] == raw


def test_parse_thread_strips_whitespace():
    raw = "1/  First tweet with spaces  \n2/  Second tweet  "
    tweets = parse_x_thread(raw)
    assert tweets[0] == "1/ First tweet with spaces"
    assert tweets[1] == "2/ Second tweet"
