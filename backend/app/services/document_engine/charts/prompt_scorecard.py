"""Worst-N prompts horizontal bar chart.

Replaces the original heatmap, which produced a blank/single-column chart when
no per-model breakdown was available. This chart shows the prompts with the
lowest visibility scores — the ones that need the most work — sorted so the
bars cluster visibly at the top of the chart.
"""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import (
    LUMIDIAN_DELTA_DOWN,
    LUMIDIAN_DELTA_UP,
    LUMIDIAN_INK,
    LUMIDIAN_MUTED,
    apply_lumidian_style,
)


def render_prompt_scorecard(rows: list[tuple[str, dict[str, float]]]) -> bytes:
    """Horizontal bar chart of the worst-scoring prompts.

    rows is a list of (prompt_text, {key: score}) tuples. We take the FIRST
    value from each prompt's score dict as that prompt's score (this lets the
    caller pass {"this week": N} for the common single-axis case or pick a
    specific model key). Sorted by score ascending so the lowest scorers
    appear at the top.
    """
    apply_lumidian_style()
    if not rows:
        fig, ax = plt.subplots(figsize=(7.0, 1.8))
        ax.text(0.5, 0.5, "No prompts scored yet", ha="center", va="center",
                color=LUMIDIAN_MUTED, transform=ax.transAxes)
        ax.set_axis_off()
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="svg", bbox_inches="tight")
        plt.close(fig)
        return buf.getvalue()

    pairs: list[tuple[str, float]] = []
    for label, scores in rows:
        if isinstance(scores, dict) and scores:
            value = float(next(iter(scores.values())))
        else:
            value = 0.0
        pairs.append((label, value))

    pairs.sort(key=lambda p: p[1])
    pairs = pairs[:14]

    labels = [p[0] for p in pairs]
    values = [p[1] for p in pairs]
    colors = [
        LUMIDIAN_DELTA_DOWN if v < 20 else (LUMIDIAN_MUTED if v < 50 else LUMIDIAN_DELTA_UP)
        for v in values
    ]

    # When the value is 0, draw a minimum-width pill so the row is visible.
    # Real values get their natural bar; zero rows get a 2-unit indicator.
    display_values = [max(v, 2.0) if v == 0 else v for v in values]

    height = max(2.5, 0.36 * len(labels) + 0.9)
    fig, ax = plt.subplots(figsize=(7.5, height))
    bars = ax.barh(range(len(labels)), display_values, color=colors, height=0.62,
                   edgecolor="white", linewidth=0.6)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels([_truncate(label) for label in labels], fontsize=9.5,
                       color=LUMIDIAN_INK)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel("Visibility this week (%)", fontsize=9, color=LUMIDIAN_MUTED)
    ax.tick_params(axis="x", labelsize=8)
    ax.grid(axis="x", linestyle=":", linewidth=0.4, alpha=0.4)
    ax.set_axisbelow(True)

    for bar, v in zip(bars, values):
        # Label sits just right of the rendered bar (display_values may differ from real v)
        bar_end = bar.get_width()
        ax.text(
            bar_end + 1.8, bar.get_y() + bar.get_height() / 2,
            f"{v:.0f}",
            va="center", fontsize=8.5,
            color=LUMIDIAN_INK if v > 0 else LUMIDIAN_DELTA_DOWN,
            fontweight="bold" if v == 0 else "normal",
        )

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def _truncate(text: str, max_chars: int = 55) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"
