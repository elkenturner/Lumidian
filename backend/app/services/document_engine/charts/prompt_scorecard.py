"""Prompt × model scorecard heatmap."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt
import numpy as np

from app.services.document_engine.charts._style import apply_lumidian_style


def render_prompt_scorecard(rows: list[tuple[str, dict[str, float]]]) -> bytes:
    """Heatmap rows = prompts, cols = models, cells = 0-100 scores. Empty → placeholder."""
    apply_lumidian_style()
    if not rows:
        fig, ax = plt.subplots(figsize=(6, 2))
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center", transform=ax.transAxes)
        ax.set_axis_off()
    else:
        prompts = [r[0] for r in rows]
        models = list(rows[0][1].keys())
        data = np.array([[r[1].get(m, 0.0) for m in models] for r in rows])
        fig, ax = plt.subplots(figsize=(6.0, 0.4 * len(prompts) + 1.2))
        im = ax.imshow(data, aspect="auto", cmap="Blues", vmin=0, vmax=100)
        ax.set_xticks(range(len(models)), labels=models)
        ax.set_yticks(range(len(prompts)), labels=prompts)
        plt.colorbar(im, ax=ax, shrink=0.6, label="Visibility %")
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
