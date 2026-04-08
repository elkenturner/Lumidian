"""Tests for Pro-only platform gating."""
import pytest
from fastapi import HTTPException

from app.dependencies import is_pro_only_platform, require_pro_for_platform


def test_linkedin_is_pro_only():
    assert is_pro_only_platform("linkedin") is True
    assert is_pro_only_platform("linkedin_article") is True
    assert is_pro_only_platform("linkedin_post") is True
    assert is_pro_only_platform("linkedin_reply") is True


def test_x_is_pro_only():
    assert is_pro_only_platform("x") is True
    assert is_pro_only_platform("x_thread") is True
    assert is_pro_only_platform("x_post") is True
    assert is_pro_only_platform("x_reply") is True


def test_existing_platforms_not_pro_only():
    assert is_pro_only_platform("reddit") is False
    assert is_pro_only_platform("quora") is False
    assert is_pro_only_platform("medium") is False
    assert is_pro_only_platform("wikipedia") is False
    assert is_pro_only_platform("reddit_reply") is False


class _FakeUser:
    def __init__(self, tier: str | None):
        self.subscription_tier = tier
        self.is_admin = False


class _FakeAdmin:
    def __init__(self):
        self.subscription_tier = None
        self.is_admin = True


def test_require_pro_allows_pro_user():
    user = _FakeUser("pro")
    require_pro_for_platform("linkedin", user)  # should not raise


def test_require_pro_blocks_starter_user():
    user = _FakeUser("starter")
    with pytest.raises(HTTPException) as exc_info:
        require_pro_for_platform("linkedin", user)
    assert exc_info.value.status_code == 403


def test_require_pro_blocks_free_user():
    user = _FakeUser(None)
    with pytest.raises(HTTPException) as exc_info:
        require_pro_for_platform("x_thread", user)
    assert exc_info.value.status_code == 403


def test_require_pro_allows_admin_bypass():
    admin = _FakeAdmin()
    require_pro_for_platform("linkedin_article", admin)  # should not raise


def test_require_pro_allows_non_pro_platform():
    user = _FakeUser("starter")
    require_pro_for_platform("reddit", user)  # should not raise


def test_require_pro_allows_non_pro_platform_free():
    user = _FakeUser(None)
    require_pro_for_platform("quora", user)  # should not raise
