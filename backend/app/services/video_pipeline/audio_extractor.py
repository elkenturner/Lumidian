"""ffmpeg-based audio extraction and chunking."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Whisper's hard cap is 25 MB. We chunk at 24 MB to leave headroom.
CHUNK_THRESHOLD_BYTES = 24 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 600  # 10 min ceiling per ffmpeg call


class AudioExtractionError(RuntimeError):
    """ffmpeg or ffprobe returned non-zero or the input has no audio."""


def probe_duration(video_path: Path) -> float | None:
    """Return the duration of `video_path` in seconds, or None if ffprobe fails."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("ffprobe failed for %s: %s", video_path, e)
        return None
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def extract_audio(src: Path, dst: Path) -> Path:
    """Extract mono 96 kbps AAC audio from `src` to `dst`. Raises on failure."""
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vn", "-acodec", "aac",
        "-b:a", "96k", "-ac", "1",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=DEFAULT_TIMEOUT_SECONDS)
    if result.returncode != 0:
        # Keep only the tail of stderr so we don't blow up error_message.
        tail = (result.stderr or "")[-500:]
        raise AudioExtractionError(f"ffmpeg failed: {tail}")
    if not dst.exists() or dst.stat().st_size == 0:
        raise AudioExtractionError("ffmpeg produced no audio output (no audio track?)")
    return dst


def should_chunk(audio_path: Path) -> bool:
    """Return True if the audio file is too large for a single Whisper call."""
    return audio_path.stat().st_size > CHUNK_THRESHOLD_BYTES


def chunk_audio(audio_path: Path, chunk_dir: Path) -> list[tuple[Path, float]]:
    """Split `audio_path` into ≤24 MB pieces at 10-minute time boundaries.

    Returns a list of (chunk_path, start_offset_seconds) tuples in order.

    Time-based splitting (not silence detection) is used for v1 — silence detect
    adds an extra ffmpeg pass and the typical agency video is short enough that
    chunking is the rare path anyway. Can swap to silence boundaries later if
    timestamp continuity becomes an issue.
    """
    chunk_dir.mkdir(parents=True, exist_ok=True)
    duration = probe_duration(audio_path) or 0.0
    if duration <= 0:
        raise AudioExtractionError("could not determine audio duration for chunking")

    chunk_seconds = 600  # 10 min — well under Whisper's size cap at 96 kbps mono
    chunks: list[tuple[Path, float]] = []
    start = 0.0
    idx = 0
    while start < duration:
        out = chunk_dir / f"chunk_{idx:03d}.m4a"
        cmd = [
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ss", str(start), "-t", str(chunk_seconds),
            "-c", "copy", str(out),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=DEFAULT_TIMEOUT_SECONDS)
        if result.returncode != 0:
            raise AudioExtractionError(f"ffmpeg chunk failed: {result.stderr[-500:]}")
        chunks.append((out, start))
        start += chunk_seconds
        idx += 1
    return chunks
