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
