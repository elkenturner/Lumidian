"""Visibility-over-time line chart."""
from __future__ import annotations

import io
from datetime import date

import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from app.services.document_engine.charts._style import (
    LUMIDIAN_MUTED,
    LUMIDIAN_PRIMARY,
    apply_lumidian_style,
)


def render_visibility_over_time(points: list[tuple[date, float]]) -> bytes:
    """Render visibility-over-time line chart as SVG bytes. Empty input → 'No data' chart."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(6.0, 2.4))
    if points:
        xs = [d for d, _ in points]
        ys = [v for _, v in points]
        ax.plot(xs, ys, color=LUMIDIAN_PRIMARY, marker="o", markersize=3)
        ax.set_ylim(bottom=0)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        ax.set_ylabel("Visibility %")
    else:
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center",
                color=LUMIDIAN_MUTED, transform=ax.transAxes)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
