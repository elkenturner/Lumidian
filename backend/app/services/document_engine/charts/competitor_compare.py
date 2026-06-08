"""Brand vs competitors grouped-bar chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import (
    LUMIDIAN_MUTED,
    LUMIDIAN_PRIMARY,
    apply_lumidian_style,
)


def render_competitor_compare(*, brand_score: float, competitor_scores: dict[str, float]) -> bytes:
    """Horizontal bar chart: brand vs competitors."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(6.0, 0.5 * (1 + len(competitor_scores)) + 0.8))
    if competitor_scores:
        labels = ["Your brand"] + list(competitor_scores.keys())
        values = [brand_score] + [competitor_scores[k] for k in competitor_scores]
        colors = [LUMIDIAN_PRIMARY] + [LUMIDIAN_MUTED] * len(competitor_scores)
        ax.barh(labels, values, color=colors)
        ax.set_xlim(0, 100)
        ax.set_xlabel("Visibility %")
        ax.invert_yaxis()
    else:
        ax.text(0.5, 0.5, "No competitors tracked", ha="center", va="center", transform=ax.transAxes)
        ax.set_axis_off()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
