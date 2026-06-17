"""Model-mix donut chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import (
    LUMIDIAN_MUTED,
    MODEL_COLORS,
    apply_lumidian_style,
)

_FRIENDLY_MODEL_LABEL = {
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
}


def _pretty(raw: str) -> str:
    """Convert a raw model key (or ModelEnum.x repr) to a presentable label."""
    s = str(raw)
    if "." in s:
        s = s.rsplit(".", 1)[-1]
    return _FRIENDLY_MODEL_LABEL.get(s.lower(), s)


def render_model_mix(scores_by_model: dict[str, float]) -> bytes:
    """Donut chart of per-model score contribution. Empty → placeholder."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(4.0, 3.6))

    items = [(k, float(v)) for k, v in scores_by_model.items() if v and float(v) > 0]
    if items:
        items.sort(key=lambda p: -p[1])
        labels = [_pretty(k) for k, _ in items]
        values = [v for _, v in items]
        colors = [MODEL_COLORS.get(str(k).rsplit(".", 1)[-1].lower(), LUMIDIAN_MUTED) for k, _ in items]
        wedges, _wt = ax.pie(
            values,
            colors=colors,
            startangle=90,
            wedgeprops=dict(width=0.32, edgecolor="white", linewidth=1.2),
        )
        legend_entries = [f"{lbl}  {val:.1f}" for lbl, val in zip(labels, values)]
        ax.legend(
            wedges,
            legend_entries,
            loc="center left",
            bbox_to_anchor=(1.0, 0.5),
            frameon=False,
            fontsize=9,
            labelcolor=LUMIDIAN_MUTED,
        )
    else:
        ax.text(0.5, 0.5, "No model scores yet", ha="center", va="center",
                color=LUMIDIAN_MUTED, transform=ax.transAxes)
    ax.set_axis_off()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
