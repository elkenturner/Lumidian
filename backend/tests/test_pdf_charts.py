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
