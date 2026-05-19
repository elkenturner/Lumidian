"""Pure functions for converting transcript segments into SubRip/WebVTT formats."""

from __future__ import annotations


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = int(round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _format_vtt_timestamp(seconds: float) -> str:
    return _format_srt_timestamp(seconds).replace(",", ".")


def segments_to_srt(segments: list[dict]) -> str:
    """Render Whisper segments as a SubRip (.srt) string."""
    lines = []
    for idx, seg in enumerate(segments, start=1):
        start = _format_srt_timestamp(float(seg["start"]))
        end = _format_srt_timestamp(float(seg["end"]))
        text = str(seg["text"]).strip()
        lines.append(f"{idx}\n{start} --> {end}\n{text}\n\n")
    return "".join(lines)


def segments_to_vtt(segments: list[dict]) -> str:
    """Render Whisper segments as a WebVTT (.vtt) string."""
    parts = ["WEBVTT\n\n"]
    for seg in segments:
        start = _format_vtt_timestamp(float(seg["start"]))
        end = _format_vtt_timestamp(float(seg["end"]))
        text = str(seg["text"]).strip()
        parts.append(f"{start} --> {end}\n{text}\n\n")
    return "".join(parts)
