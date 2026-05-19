"""Tests for the agency video pipeline + endpoints."""

from app.services.video_pipeline import captions


def test_segments_to_srt_basic():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello world."},
        {"start": 2.5, "end": 5.0, "text": "Second line."},
    ]
    out = captions.segments_to_srt(segments)
    assert out == (
        "1\n00:00:00,000 --> 00:00:02,500\nHello world.\n\n"
        "2\n00:00:02,500 --> 00:00:05,000\nSecond line.\n\n"
    )


def test_segments_to_srt_handles_hours():
    segments = [{"start": 3661.123, "end": 3662.456, "text": "Late."}]
    out = captions.segments_to_srt(segments)
    assert out.startswith("1\n01:01:01,123 --> 01:01:02,456\nLate.\n\n")


def test_segments_to_vtt_basic():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello."},
    ]
    out = captions.segments_to_vtt(segments)
    assert out == "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello.\n\n"


def test_segments_to_srt_empty():
    assert captions.segments_to_srt([]) == ""


def test_segments_to_vtt_empty():
    assert captions.segments_to_vtt([]) == "WEBVTT\n\n"
