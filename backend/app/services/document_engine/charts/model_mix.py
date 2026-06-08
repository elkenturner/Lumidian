"""Model-mix donut chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import MODEL_COLORS, apply_lumidian_style


def render_model_mix(scores_by_model: dict[str, float]) -> bytes:
    """Donut chart of per-model contribution. Empty → placeholder."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(3.2, 3.2))
    if any(v > 0 for v in scores_by_model.values()):
        labels = list(scores_by_model.keys())
        values = [scores_by_model[k] for k in labels]
        colors = [MODEL_COLORS.get(k.lower(), "#888888") for k in labels]
        wedges, _ = ax.pie(values, colors=colors, startangle=90, wedgeprops=dict(width=0.35))
        ax.legend(wedges, labels, loc="center", frameon=False)
    else:
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center", transform=ax.transAxes)
    ax.set_axis_off()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
