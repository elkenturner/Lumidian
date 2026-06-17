"""Brand vs. competitors horizontal bar chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import (
    LUMIDIAN_INK,
    LUMIDIAN_MUTED,
    LUMIDIAN_PRIMARY,
    apply_lumidian_style,
)


# A small dictionary of competitor names whose conventional casing can't be
# recovered from `.title()` (camel-case brands, multi-word brands stored as one
# slug, etc.). Lowercase key → display value.
_DISPLAY_OVERRIDES: dict[str, str] = {
    "startengine":     "StartEngine",
    "dalmoregroup":    "Dalmore Group",
    "dalmore group":   "Dalmore Group",
    "wefunder":        "Wefunder",
    "republic":        "Republic",
    "seedinvest":      "SeedInvest",
    "fundable":        "Fundable",
    "indiegogo":       "Indiegogo",
    "kickstarter":     "Kickstarter",
    "g2":              "G2",
    "trustradius":     "TrustRadius",
    "capterra":        "Capterra",
    "ycombinator":     "Y Combinator",
    "y combinator":    "Y Combinator",
}


def _title_case_name(s: str) -> str:
    """Render a competitor name in its conventional casing.

    1. Manual override table for known camel-case / multi-word brands.
    2. If any uppercase already present, keep as-is.
    3. Fallback: `.title()`.
    """
    if not s:
        return s
    key = s.strip().lower()
    if key in _DISPLAY_OVERRIDES:
        return _DISPLAY_OVERRIDES[key]
    if any(ch.isupper() for ch in s):
        return s
    return s.title()


def render_competitor_compare(*, brand_score: float, competitor_scores: dict[str, float]) -> bytes:
    """Horizontal bar chart: brand mention count vs. each competitor's."""
    apply_lumidian_style()

    if not competitor_scores:
        fig, ax = plt.subplots(figsize=(7.0, 1.8))
        ax.text(0.5, 0.5, "No competitors tracked", ha="center", va="center",
                color=LUMIDIAN_MUTED, transform=ax.transAxes)
        ax.set_axis_off()
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="svg", bbox_inches="tight")
        plt.close(fig)
        return buf.getvalue()

    entries: list[tuple[str, float, bool]] = [("Your brand", float(brand_score), True)]
    for name, score in competitor_scores.items():
        entries.append((_title_case_name(name), float(score), False))
    entries.sort(key=lambda e: -e[1])

    labels = [e[0] for e in entries]
    values = [e[1] for e in entries]
    colors = [LUMIDIAN_PRIMARY if e[2] else LUMIDIAN_MUTED for e in entries]
    max_val = max(values) if values else 1.0
    xlim = max(max_val * 1.18, max_val + 4)

    height = max(2.2, 0.45 * len(labels) + 0.9)
    fig, ax = plt.subplots(figsize=(7.0, height))
    bars = ax.barh(range(len(labels)), values, color=colors, height=0.6)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, fontsize=10, color=LUMIDIAN_INK)
    ax.invert_yaxis()
    ax.set_xlim(0, xlim)
    ax.set_xlabel("Mentions this week", fontsize=9, color=LUMIDIAN_MUTED)
    ax.tick_params(axis="x", labelsize=8)
    ax.grid(axis="x", linestyle=":", linewidth=0.4, alpha=0.5)
    ax.set_axisbelow(True)

    for bar, v in zip(bars, values):
        ax.text(
            v + xlim * 0.012, bar.get_y() + bar.get_height() / 2,
            f"{v:.0f}", va="center", fontsize=9, color=LUMIDIAN_INK,
        )

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
