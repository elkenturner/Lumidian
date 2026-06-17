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
    fig, ax = plt.subplots(figsize=(7.0, 2.6))
    if points:
        points_sorted = sorted(points, key=lambda p: p[0])
        xs = [d for d, _ in points_sorted]
        ys = [v for _, v in points_sorted]
        ax.fill_between(xs, ys, 0, color=LUMIDIAN_PRIMARY, alpha=0.08)
        ax.plot(xs, ys, color=LUMIDIAN_PRIMARY, linewidth=2.2, marker="o",
                markersize=4, markeredgecolor="white", markeredgewidth=1.0)
        y_max = max(ys) if ys else 1.0
        ax.set_ylim(0, max(y_max * 1.18, y_max + 5))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        ax.tick_params(axis="x", labelsize=8)
        ax.tick_params(axis="y", labelsize=8)
        ax.set_ylabel("Visibility %", fontsize=9, color=LUMIDIAN_MUTED)
        ax.grid(axis="y", linestyle=":", linewidth=0.4, alpha=0.5)
        ax.set_axisbelow(True)
        # Annotate the most recent point
        ax.annotate(
            f"{ys[-1]:.1f}",
            xy=(xs[-1], ys[-1]),
            xytext=(6, 6),
            textcoords="offset points",
            fontsize=9,
            color=LUMIDIAN_PRIMARY,
            fontweight="bold",
        )
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
