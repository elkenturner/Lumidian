"""Shell-out wrapper around the `typst` CLI.

Render flow:
  1. Caller passes a template file path + a JSON-serializable data dict.
  2. We write data to a temporary file alongside the template.
  3. Invoke `typst compile --font-path <fonts> --input data=<path>` (data file
     read by `json(sys.inputs.data)` inside templates) — but simpler: write
     `data.json` into a workdir and have templates do `#let data = json("data.json")`.
  4. Read the produced PDF bytes; raise TypstCompileError on non-zero exit.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_FONTS_DIR = (
    Path(__file__).parent / "templates" / "fonts"
).resolve()


class TypstCompileError(RuntimeError):
    """Raised when `typst compile` exits non-zero."""


def render_pdf(*, template_path: Path, data: dict[str, Any]) -> bytes:
    """Render a Typst template to PDF bytes with data injected as data.json.

    The template should reference `json("data.json")` to read the data.
    """
    typst_bin = shutil.which("typst")
    if typst_bin is None:
        raise TypstCompileError("typst CLI not found on PATH. Install via brew install typst or apt.")

    with tempfile.TemporaryDirectory(prefix="lumidian-pdf-") as workdir_str:
        workdir = Path(workdir_str)
        local_template = workdir / template_path.name
        local_template.write_text(template_path.read_text(encoding="utf-8"), encoding="utf-8")

        # Also copy any sibling _*.typ partials so imports resolve
        for sibling in template_path.parent.glob("_*.typ"):
            (workdir / sibling.name).write_text(sibling.read_text(encoding="utf-8"), encoding="utf-8")

        # Write data
        (workdir / "data.json").write_text(json.dumps(data, default=str), encoding="utf-8")

        out_pdf = workdir / "out.pdf"
        cmd = [
            typst_bin,
            "compile",
            "--font-path", str(_FONTS_DIR),
            str(local_template),
            str(out_pdf),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60, text=True)
        except subprocess.TimeoutExpired as e:
            raise TypstCompileError("typst compile timed out after 60s") from e

        if proc.returncode != 0:
            logger.error("typst stderr: %s", proc.stderr)
            raise TypstCompileError(f"typst compile failed: {proc.stderr.strip()}")

        return out_pdf.read_bytes()
