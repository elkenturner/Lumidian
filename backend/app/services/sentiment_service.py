"""
Sentiment Service — classify brand mention sentiment using Claude Haiku.

Public API
----------
classify_sentiments_for_run(query_results, brand_name) -> None
    Sets qr.sentiment on each QueryResult where mentioned=True.
    Persists results back to the database via bulk UPDATE.

Called once per tracking run after all query results are committed.
Never called at dashboard page-load time.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import QueryResult

logger = logging.getLogger(__name__)

_BATCH_SIZE = 40

# ── Keyword fallback ──────────────────────────────────────────────────────────

_POSITIVE = frozenset({
    "recommend", "best", "top", "leading", "innovative", "trusted",
    "effective", "reliable", "excellent", "great", "popular", "preferred",
    "accurate", "proven", "strong", "successful", "pioneer", "leader",
    "outstanding", "superior", "award", "favorite", "impressive", "notable",
    "advanced", "powerful", "comprehensive", "robust", "breakthrough",
    "well-known", "widely used", "industry leader", "cutting-edge",
    "praised", "acclaimed", "reputable", "established",
})

_NEGATIVE = frozenset({
    "worst", "poor", "bad", "unreliable", "failed", "failing",
    "problem", "issue", "concern", "risk", "not recommended",
    "avoid", "negative", "weak", "limited", "controversial",
    "scam", "fraud", "overrated", "disappointing", "criticism",
    "difficult", "expensive", "lacking", "inferior", "outdated",
    "buggy", "slow", "inaccurate", "misleading", "deceptive",
})


def _classify_keywords(response_text: str, brand_name: str) -> str:
    brand_lower = brand_name.lower()
    sentences = re.split(r'(?<=[.!?\n])\s+', response_text)
    brand_sentences = [s for s in sentences if brand_lower in s.lower()]
    context = " ".join(brand_sentences[:5] if brand_sentences else sentences[:2]).lower()
    pos = sum(1 for w in _POSITIVE if w in context)
    neg = sum(1 for w in _NEGATIVE if w in context)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


# ── Claude batch classification ───────────────────────────────────────────────

async def _classify_batch_claude(
    samples: list[tuple[str, str]],  # (response_text, brand_name)
) -> list[str]:
    """
    Call Claude Haiku once with a batch of responses to classify.
    Falls back to keyword classification if Claude is unavailable or fails.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.info("[sentiment] No ANTHROPIC_API_KEY — using keyword fallback for %d samples", len(samples))
        return [_classify_keywords(text, brand) for text, brand in samples]

    brand_name = samples[0][1]
    items_text = "\n\n".join(
        f"{i}. {text[:400].replace(chr(10), ' ')}"
        for i, (text, _) in enumerate(samples, 1)
    )

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=api_key)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            system=(
                f'Classify how "{brand_name}" is described in each AI response. '
                'Return ONLY a JSON array with one label per item. '
                'Each label must be exactly "positive", "neutral", or "negative". '
                'Example output: ["positive","neutral","negative"]'
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Classify the sentiment toward {brand_name} in each response:\n\n"
                        + items_text
                    ),
                }
            ],
        )
        raw = resp.content[0].text.strip()
        logger.debug("[sentiment] Claude raw response: %r", raw[:200])
        # Extract JSON array even if Claude wraps it in prose
        match = re.search(r'\[.*?\]', raw, re.DOTALL)
        if match:
            raw = match.group(0)
        labels = json.loads(raw)
        if isinstance(labels, list) and len(labels) == len(samples):
            valid = {"positive", "neutral", "negative"}
            cleaned = [str(l).lower() if str(l).lower() in valid else "neutral" for l in labels]
            logger.info(
                "[sentiment] Claude classified %d responses: %s",
                len(cleaned),
                {l: cleaned.count(l) for l in valid},
            )
            return cleaned
        logger.warning(
            "[sentiment] Claude returned %d labels for %d samples — keyword fallback",
            len(labels) if isinstance(labels, list) else 0,
            len(samples),
        )
    except Exception as exc:
        logger.warning("[sentiment] Claude batch failed — keyword fallback: %s", exc)

    return [_classify_keywords(text, brand) for text, brand in samples]


# ── Public entry point ────────────────────────────────────────────────────────

async def classify_sentiments_for_run(
    query_results: list["QueryResult"],
    brand_name: str,
) -> None:
    """
    Classify and persist sentiment for all mentioned QueryResult rows.

    - Filters to rows where mentioned=True and response_text is not None
    - Classifies in batches using Claude Haiku (keyword fallback if unavailable)
    - Persists via bulk UPDATE grouped by label (3 queries total, not N)
    - Non-fatal: caller should wrap in try/except
    """
    to_classify = [
        qr for qr in query_results
        if qr.mentioned and qr.response_text and qr.error != "api_key_not_configured"
    ]

    logger.info(
        "[sentiment] classify_sentiments_for_run called — brand=%r total=%d to_classify=%d",
        brand_name, len(query_results), len(to_classify),
    )

    if not to_classify:
        logger.info("[sentiment] No mentioned responses to classify — skipping")
        return

    # Classify in batches
    for i in range(0, len(to_classify), _BATCH_SIZE):
        batch = to_classify[i : i + _BATCH_SIZE]
        samples = [(qr.response_text, brand_name) for qr in batch]
        labels = await _classify_batch_claude(samples)
        for qr, label in zip(batch, labels):
            qr.sentiment = label

    # Collect IDs per label for bulk UPDATE (3 UPDATE statements instead of N SELECTs)
    ids_by_label: dict[str, list[int]] = {"positive": [], "neutral": [], "negative": []}
    skipped = 0
    for qr in to_classify:
        if qr.sentiment in ids_by_label and qr.id is not None:
            ids_by_label[qr.sentiment].append(qr.id)
        else:
            skipped += 1

    if skipped:
        logger.warning("[sentiment] %d rows skipped (no id or unknown label)", skipped)

    total_updated = sum(len(v) for v in ids_by_label.values())
    logger.info(
        "[sentiment] Persisting %d labels: positive=%d neutral=%d negative=%d",
        total_updated,
        len(ids_by_label["positive"]),
        len(ids_by_label["neutral"]),
        len(ids_by_label["negative"]),
    )

    if total_updated == 0:
        logger.warning("[sentiment] Nothing to persist — all IDs were None or label unknown")
        return

    from app.database import AsyncSessionLocal
    from app.models import QueryResult as QRModel
    from sqlalchemy import update

    async with AsyncSessionLocal() as db:
        for label, ids in ids_by_label.items():
            if ids:
                await db.execute(
                    update(QRModel)
                    .where(QRModel.id.in_(ids))
                    .values(sentiment=label)
                )
        await db.commit()

    logger.info("[sentiment] Sentiment persisted successfully for %d rows", total_updated)
