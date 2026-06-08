"""Lumidian matplotlib style — applied at the start of every chart function.

Charts produced through this module use Lumidian brand fonts, colors, and
type-scale so they read as part of the same document, not as a foreign element.
"""
from __future__ import annotations

import matplotlib as mpl

LUMIDIAN_INK = "#0B1220"
LUMIDIAN_PAPER = "#FAF7F2"
LUMIDIAN_PRIMARY = "#2447EE"
LUMIDIAN_MUTED = "#546880"
LUMIDIAN_BORDER = "#E5E0D7"
LUMIDIAN_DELTA_UP = "#10A37F"
LUMIDIAN_DELTA_DOWN = "#DC2626"
MODEL_COLORS = {
    "chatgpt":    "#10A37F",
    "claude":     "#F97316",
    "perplexity": "#8B5CF6",
    "gemini":     "#3B82F6",
}


def apply_lumidian_style() -> None:
    """Apply Lumidian brand to matplotlib rcParams. Idempotent."""
    mpl.rcParams.update({
        "font.family":        "Inter",
        "font.size":          9.0,
        "axes.edgecolor":     LUMIDIAN_MUTED,
        "axes.labelcolor":    LUMIDIAN_INK,
        "axes.titlecolor":    LUMIDIAN_INK,
        "axes.labelsize":     9.0,
        "axes.titlesize":     11.0,
        "axes.spines.top":    False,
        "axes.spines.right":  False,
        "axes.linewidth":     0.5,
        "xtick.color":        LUMIDIAN_MUTED,
        "ytick.color":        LUMIDIAN_MUTED,
        "xtick.labelsize":    8.0,
        "ytick.labelsize":    8.0,
        "figure.facecolor":   LUMIDIAN_PAPER,
        "axes.facecolor":     LUMIDIAN_PAPER,
        "grid.color":         LUMIDIAN_BORDER,
        "grid.linewidth":     0.4,
        "lines.linewidth":    2.0,
    })
