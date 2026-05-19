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


from pathlib import Path
from unittest.mock import patch, MagicMock

from app.services.video_pipeline import audio_extractor


def test_probe_duration_parses_ffprobe_output(tmp_path):
    fake_video = tmp_path / "vid.mp4"
    fake_video.write_bytes(b"fake")
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="42.5\n", stderr="")
        assert audio_extractor.probe_duration(fake_video) == 42.5


def test_probe_duration_returns_none_on_failure(tmp_path):
    fake_video = tmp_path / "vid.mp4"
    fake_video.write_bytes(b"fake")
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="bad")
        assert audio_extractor.probe_duration(fake_video) is None


def test_extract_audio_returns_dst_path_on_success(tmp_path):
    src = tmp_path / "vid.mp4"
    src.write_bytes(b"fake")
    dst = tmp_path / "vid.m4a"

    def fake_run(cmd, *args, **kwargs):
        # Simulate ffmpeg writing the output file
        dst.write_bytes(b"audio")
        return MagicMock(returncode=0, stderr="")

    with patch("app.services.video_pipeline.audio_extractor.subprocess.run", side_effect=fake_run):
        out = audio_extractor.extract_audio(src, dst)
    assert out == dst
    assert dst.exists()


def test_extract_audio_raises_on_ffmpeg_failure(tmp_path):
    src = tmp_path / "vid.mp4"
    src.write_bytes(b"fake")
    dst = tmp_path / "vid.m4a"
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stderr="bad codec")
        try:
            audio_extractor.extract_audio(src, dst)
        except audio_extractor.AudioExtractionError as e:
            assert "bad codec" in str(e)
        else:
            raise AssertionError("expected AudioExtractionError")


def test_should_chunk_returns_false_for_small_file(tmp_path):
    small = tmp_path / "small.m4a"
    small.write_bytes(b"x" * 1000)
    assert audio_extractor.should_chunk(small) is False


def test_should_chunk_returns_true_for_large_file(tmp_path):
    big = tmp_path / "big.m4a"
    big.write_bytes(b"x" * (25 * 1024 * 1024))  # 25 MB > 24 MB threshold
    assert audio_extractor.should_chunk(big) is True


import asyncio
from unittest.mock import AsyncMock, patch

from app.services.video_pipeline import transcriber


def test_offset_segments_shifts_timestamps():
    segs = [
        {"start": 0.0, "end": 2.0, "text": "a"},
        {"start": 2.0, "end": 4.0, "text": "b"},
    ]
    out = transcriber.offset_segments(segs, offset=10.0)
    assert out == [
        {"start": 10.0, "end": 12.0, "text": "a"},
        {"start": 12.0, "end": 14.0, "text": "b"},
    ]


def test_concatenate_text():
    assert transcriber.concatenate_text(["Hello.", " World."]) == "Hello. World."
    assert transcriber.concatenate_text(["  Hi  ", "there"]) == "Hi there"


def test_transcribe_chunks_reassembles(tmp_path):
    chunk_a = tmp_path / "a.m4a"; chunk_a.write_bytes(b"a")
    chunk_b = tmp_path / "b.m4a"; chunk_b.write_bytes(b"b")

    async def fake_call_whisper(path):
        if path.name == "a.m4a":
            return {"text": "Hello.", "segments": [{"start": 0.0, "end": 2.0, "text": "Hello."}]}
        return {"text": "World.", "segments": [{"start": 0.0, "end": 1.5, "text": "World."}]}

    with patch.object(transcriber, "_call_whisper", side_effect=fake_call_whisper):
        result = asyncio.run(transcriber.transcribe_chunks([(chunk_a, 0.0), (chunk_b, 2.0)]))
    assert result["text"] == "Hello. World."
    assert result["segments"] == [
        {"start": 0.0, "end": 2.0, "text": "Hello."},
        {"start": 2.0, "end": 3.5, "text": "World."},
    ]


def test_transcribe_chunks_raises_on_provider_error(tmp_path):
    chunk = tmp_path / "a.m4a"; chunk.write_bytes(b"a")

    async def fake_call_whisper(path):
        raise transcriber.TranscriptionError("rate limited")

    with patch.object(transcriber, "_call_whisper", side_effect=fake_call_whisper):
        try:
            asyncio.run(transcriber.transcribe_chunks([(chunk, 0.0)]))
        except transcriber.TranscriptionError as e:
            assert "rate limited" in str(e)
        else:
            raise AssertionError("expected TranscriptionError")


import json
from app.services.video_pipeline import metadata_generator


def test_build_prompt_includes_brand_profile_fields():
    profile = {
        "company_description": "Acme makes widgets.",
        "tone_of_voice": "direct, technical",
        "target_audience": "engineering managers",
        "approved_language": "ship, retention",
        "what_not_to_say": "synergy, leverage",
        "key_stats": "60% retention",
    }
    out = metadata_generator.build_prompt(brand_name="Acme", brand_profile=profile, transcript="Hello world.")
    assert "Acme" in out
    assert "direct, technical" in out
    assert "Hello world." in out
    assert "synergy" in out  # what_not_to_say included


def test_parse_response_success():
    raw = json.dumps({
        "title": "How does X work?",
        "description": "X is...",
        "chapters": [{"ts_seconds": 0, "label": "Intro"}],
        "tags": ["a", "b"],
        "jsonld": {"@type": "VideoObject"},
    })
    out = metadata_generator.parse_response(raw)
    assert out.title == "How does X work?"
    assert out.chapters[0].label == "Intro"
    assert out.jsonld == {"@type": "VideoObject"}


def test_parse_response_invalid_json_raises():
    try:
        metadata_generator.parse_response("not json")
    except metadata_generator.MetadataGenerationError:
        pass
    else:
        raise AssertionError("expected MetadataGenerationError")


def test_parse_response_missing_field_raises():
    raw = json.dumps({"title": "x"})  # missing description, chapters, tags, jsonld
    try:
        metadata_generator.parse_response(raw)
    except metadata_generator.MetadataGenerationError:
        pass
    else:
        raise AssertionError("expected MetadataGenerationError")


def test_generate_metadata_calls_claude(monkeypatch):
    fake_response = AsyncMock()
    fake_response.content = [type("Block", (), {"text": json.dumps({
        "title": "T", "description": "D",
        "chapters": [{"ts_seconds": 0, "label": "L"}],
        "tags": ["t"], "jsonld": {"@type": "VideoObject"},
    })})]

    async def fake_create(**_kwargs):
        return fake_response

    fake_client = type("C", (), {"messages": type("M", (), {"create": staticmethod(fake_create)})()})()

    with patch.object(metadata_generator, "_get_client", return_value=fake_client):
        result = asyncio.run(metadata_generator.generate_metadata(
            brand_name="X", brand_profile={}, transcript="hello"
        ))
    assert result.title == "T"
