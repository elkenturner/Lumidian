"""Tests for matplotlib chart rendering used in agency PDFs."""
from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from app.services.document_engine.charts._style import apply_lumidian_style, LUMIDIAN_PRIMARY


def test_apply_lumidian_style_sets_colors():
    import matplotlib as mpl
    apply_lumidian_style()
    assert mpl.rcParams["axes.edgecolor"].lower() in {"#546880", "#0b1220"}
    assert "Inter" in str(mpl.rcParams["font.family"])


def test_lumidian_primary_is_brand_blue():
    assert LUMIDIAN_PRIMARY.lower() == "#2447ee"


from datetime import date, timedelta

from app.services.document_engine.charts.visibility_over_time import render_visibility_over_time
from app.services.document_engine.charts.model_mix import render_model_mix
from app.services.document_engine.charts.prompt_scorecard import render_prompt_scorecard
from app.services.document_engine.charts.competitor_compare import render_competitor_compare


def _assert_valid_svg(svg_bytes: bytes) -> None:
    assert svg_bytes.startswith(b"<?xml") or svg_bytes.startswith(b"<svg")
    root = ET.fromstring(svg_bytes.decode("utf-8"))
    assert "svg" in root.tag


def test_visibility_over_time_returns_svg():
    points = [(date.today() - timedelta(days=i), 30 + i) for i in range(10, 0, -1)]
    svg = render_visibility_over_time(points)
    _assert_valid_svg(svg)


def test_visibility_over_time_handles_empty():
    svg = render_visibility_over_time([])
    _assert_valid_svg(svg)  # placeholder "No data" chart


def test_model_mix_returns_svg():
    svg = render_model_mix({"chatgpt": 40, "claude": 30, "perplexity": 20, "gemini": 10})
    _assert_valid_svg(svg)


def test_prompt_scorecard_returns_svg():
    rows = [("prompt 1", {"chatgpt": 80, "claude": 60, "perplexity": 45, "gemini": 70})]
    svg = render_prompt_scorecard(rows)
    _assert_valid_svg(svg)


def test_competitor_compare_returns_svg():
    svg = render_competitor_compare(brand_score=72, competitor_scores={"Foo": 55, "Bar": 80})
    _assert_valid_svg(svg)
