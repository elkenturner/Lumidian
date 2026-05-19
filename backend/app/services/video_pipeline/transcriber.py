"""OpenAI Whisper API wrapper with chunk reassembly + retry."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from openai import OpenAI, APIError, AuthenticationError, RateLimitError

logger = logging.getLogger(__name__)

WHISPER_SEM = asyncio.Semaphore(2)
MAX_RETRIES = 3
RETRY_BACKOFFS_SECONDS = [10, 30, 90]


class TranscriptionError(RuntimeError):
    """Whisper request failed permanently (after retries) or returned malformed data."""


class TranscriptionAuthError(TranscriptionError):
    """API key invalid — do not retry."""


def offset_segments(segments: list[dict], *, offset: float) -> list[dict]:
    """Return a new list of segments with start/end shifted by `offset` seconds."""
    return [
        {"start": float(s["start"]) + offset, "end": float(s["end"]) + offset, "text": s["text"]}
        for s in segments
    ]


def concatenate_text(parts: list[str]) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


async def _call_whisper(audio_path: Path) -> dict:
    """One Whisper call with retry. Returns {'text': str, 'segments': [...]}."""
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            async with WHISPER_SEM:
                # The OpenAI SDK is sync; offload to a thread so the semaphore is meaningful.
                def _do_call():
                    with open(audio_path, "rb") as f:
                        return client.audio.transcriptions.create(
                            model="whisper-1",
                            file=f,
                            response_format="verbose_json",
                            timestamp_granularities=["segment"],
                        )
                resp = await asyncio.to_thread(_do_call)
            return {
                "text": getattr(resp, "text", "") or "",
                "segments": [
                    {"start": s["start"], "end": s["end"], "text": s["text"]}
                    for s in (getattr(resp, "segments", None) or [])
                ],
            }
        except AuthenticationError as e:
            raise TranscriptionAuthError(str(e)) from e
        except (RateLimitError, APIError) as e:
            last_exc = e
            if attempt < MAX_RETRIES:
                delay = RETRY_BACKOFFS_SECONDS[attempt]
                logger.warning("Whisper transient error (attempt %d): %s. Retrying in %ds.", attempt + 1, e, delay)
                await asyncio.sleep(delay)
                continue
        except Exception as e:
            raise TranscriptionError(str(e)) from e
    raise TranscriptionError(f"Whisper failed after {MAX_RETRIES + 1} attempts: {last_exc}")


async def transcribe_chunks(chunks: list[tuple[Path, float]]) -> dict:
    """Transcribe each chunk in order, reassemble. Each chunk is (path, start_offset_seconds).

    Returns {'text': str, 'segments': [{'start','end','text'}, ...]}.
    """
    texts: list[str] = []
    segments: list[dict] = []
    for path, offset in chunks:
        chunk_result = await _call_whisper(path)
        texts.append(chunk_result["text"])
        segments.extend(offset_segments(chunk_result["segments"], offset=offset))
    return {"text": concatenate_text(texts), "segments": segments}
