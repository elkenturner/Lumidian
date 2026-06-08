"""Tests for REQUIRED_FIELDS preflight."""
from __future__ import annotations

import pytest

from app.services.document_engine.preflight import MissingDataError, check_required


def test_check_required_passes_when_all_present():
    data = {"brand": {"name": "Acme"}, "brand_profile": {"tone_of_voice": "Direct"}}
    check_required(["brand.name", "brand_profile.tone_of_voice"], data)


def test_check_required_returns_missing_paths():
    data = {"brand": {"name": "Acme"}, "brand_profile": {"tone_of_voice": None}}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name", "brand_profile.tone_of_voice", "brand_profile.target_audience"], data)
    assert sorted(exc.value.missing) == sorted(["brand_profile.tone_of_voice", "brand_profile.target_audience"])


def test_check_required_treats_empty_string_and_empty_list_as_missing():
    data = {"brand": {"name": ""}, "profile": {"tags": []}}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name", "profile.tags"], data)
    assert sorted(exc.value.missing) == sorted(["brand.name", "profile.tags"])


def test_check_required_handles_dotted_path_into_missing_dict():
    data = {"brand": None}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name"], data)
    assert exc.value.missing == ["brand.name"]
