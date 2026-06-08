"""Tests for typst shell-out renderer."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app.services.document_engine.typst_renderer import (
    TypstCompileError,
    render_pdf,
)


pytestmark = pytest.mark.skipif(
    shutil.which("typst") is None,
    reason="typst CLI not installed",
)


def test_render_pdf_compiles_minimal_template(tmp_path: Path):
    template_path = tmp_path / "main.typ"
    template_path.write_text("""
#let data = json("data.json")
= Hello #data.name
""", encoding="utf-8")
    (tmp_path / "data.json").write_text(json.dumps({"name": "Acme"}), encoding="utf-8")

    pdf_bytes = render_pdf(template_path=template_path, data={"name": "Acme"})

    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 500


def test_render_pdf_raises_on_compile_error(tmp_path: Path):
    template_path = tmp_path / "main.typ"
    template_path.write_text("#this is not valid typst", encoding="utf-8")

    with pytest.raises(TypstCompileError) as exc:
        render_pdf(template_path=template_path, data={})
    assert "typst" in str(exc.value).lower()
