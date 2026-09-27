"""Local FFmpeg smoke check for AI material audio, without remote or Whisper calls.

Run with the short-video engine Python: python tests/original-audio-smoke.py
"""

import json
import atexit
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime" / "mpt"
CONFIG_FILE = RUNTIME / "config.toml"
if not CONFIG_FILE.exists():
    atexit.register(lambda: CONFIG_FILE.unlink(missing_ok=True))
sys.path.insert(0, str(RUNTIME))
os.chdir(RUNTIME)

from app.models.schema import VideoAspect, VideoConcatMode, VideoParams  # noqa: E402
from app.services import task, video  # noqa: E402


def run(*args: str) -> bytes:
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def probe(file: Path) -> tuple[float, bool]:
    data = json.loads(run(
        "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
        "-of", "json", str(file),
    ))
    return float(data["format"]["duration"]), any(
        stream["codec_type"] == "audio" for stream in data["streams"]
    )


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(audio.astype(np.float64))))) if audio.size else 0.0


def main() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("FFmpeg and FFprobe are required for this smoke check")
    with tempfile.TemporaryDirectory(prefix="dsh-original-audio-") as directory:
        folder = Path(directory)
        spoken = folder / "with-audio.mp4"
        silent = folder / "without-audio.mp4"
        combined = folder / "combined.mp4"
        final = folder / "final.mp4"
        run(
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x160:r=24:d=1",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
            "-c:v", "libx264", "-c:a", "aac", "-shortest", str(spoken),
        )
        run(
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x160:r=24:d=1",
            "-c:v", "libx264", "-an", str(silent),
        )
        assert video.probe_video_audio(str(spoken))[1]
        assert not video.probe_video_audio(str(silent))[1]
        with patch.object(VideoAspect, "to_resolution", lambda self: (160, 160)):
            video.combine_videos(
                combined_video_path=str(combined), video_paths=[str(spoken), str(silent)],
                audio_file=None, target_duration=3, preserve_audio=True,
                video_aspect=VideoAspect.square, video_concat_mode=VideoConcatMode.sequential,
                max_clip_duration=1, threads=1,
            )
            duration, has_audio = probe(combined)
            assert has_audio and 1.8 <= duration < 2.5, (duration, has_audio)
            params = VideoParams(
                video_subject="audio smoke", video_script="audio smoke",
                video_aspect="1:1", audio_source="video_original",
                subtitle_enabled=False, bgm_type="none", video_clip_duration=1,
            )
            video.generate_video(
                video_path=str(combined), audio_path=None, subtitle_path="",
                output_file=str(final), params=params,
            )
        final_duration, final_audio = probe(final)
        assert final_audio and abs(final_duration - duration) < 0.25
        pcm = run(
            "ffmpeg", "-v", "error", "-i", str(final), "-vn", "-ac", "1",
            "-ar", "16000", "-f", "s16le", "-",
        )
        samples = np.frombuffer(pcm, dtype=np.int16) / 32768.0
        assert rms(samples[2000:12000]) > 0.005, "first clip lost its original sound"
        assert rms(samples[20000:28000]) < 0.003, "silent clip gained unexpected sound"
        accelerated = folder / "accelerated.mp4"
        with patch.object(VideoAspect, "to_resolution", lambda self: (160, 160)):
            video.combine_videos(
                combined_video_path=str(accelerated), video_paths=[str(spoken), str(silent)],
                audio_file=None, target_duration=3, preserve_audio=True,
                video_aspect=VideoAspect.square, video_concat_mode=VideoConcatMode.sequential,
                max_clip_duration=1, clip_speed=2, threads=1,
            )
        accelerated_duration, accelerated_audio = probe(accelerated)
        assert accelerated_audio and 0.9 <= accelerated_duration < 1.3
        fast_pcm = run(
            "ffmpeg", "-v", "error", "-i", str(accelerated), "-vn", "-ac", "1",
            "-ar", "16000", "-f", "s16le", "-",
        )
        fast_samples = np.frombuffer(fast_pcm, dtype=np.int16) / 32768.0
        assert rms(fast_samples[2000:6000]) > 0.005, "sped-up clip lost its sound"
        assert rms(fast_samples[11000:15000]) < 0.003, "sped-up sound leaked into the silent clip"
        tts_params = VideoParams(video_subject="TTS without preview", audio_source="tts")
        timeline = object()
        def fake_tts(**kwargs: object) -> object:
            Path(str(kwargs["voice_file"])).write_bytes(b"local TTS fixture")
            return timeline
        with (
            patch.object(task.utils, "task_dir", return_value=str(folder)),
            patch.object(task.voice, "tts", side_effect=fake_tts),
            patch.object(task.voice, "get_audio_duration", return_value=1.1),
        ):
            generated, seconds, marks = task.generate_audio("tts-smoke", tts_params, "direct narration", voice_preview=None)
        assert Path(generated).is_file() and seconds == 2 and marks is timeline
        upload_params = VideoParams(video_subject="upload smoke", audio_source="upload")
        with (
            patch.object(task, "_mark_task_failed"),
            patch.object(task.voice, "tts", side_effect=AssertionError("missing upload fell back to TTS")),
        ):
            assert task.generate_audio("upload-smoke", upload_params, "unrelated script") == (None, None, None)
        upload_params.subtitle_enabled = True
        def fake_upload_transcribe(*, subtitle_file: str, **_kwargs: object) -> None:
            Path(subtitle_file).write_text(
                "1\n00:00:00,100 --> 00:00:00,700\n实际旁白\n\n", encoding="utf-8",
            )
        with (
            patch.dict(task.config.app, {"subtitle_provider": "whisper"}),
            patch.object(task.subtitle, "WhisperModel", object()),
            patch.object(task.subtitle, "create", side_effect=fake_upload_transcribe),
            patch.object(task.subtitle, "correct", side_effect=AssertionError("upload transcript was overwritten")),
            patch.object(task.utils, "task_dir", return_value=str(folder)),
        ):
            task.generate_subtitle("upload-smoke", upload_params, "与实际语音不同的文案", None, str(spoken))
        assert "实际旁白" in (folder / "subtitle.srt").read_text(encoding="utf-8")
        font = next((
            file for file in [
                Path(os.environ.get("WINDIR", "")) / "Fonts" / "arial.ttf",
                Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            ] if file.is_file()
        ), None)
        if font:
            os.environ["MPT_DSH_DATA_ROOT"] = str(folder)
            params = VideoParams(
                video_subject="audio smoke", video_script="与实际语音不同的文案",
                video_aspect="1:1", audio_source="video_original",
                subtitle_enabled=True, bgm_type="none", video_clip_duration=1,
                target_duration_seconds=2, video_count=2, font_name=str(font),
                font_size=20,
            )
            def fake_transcribe(*, subtitle_file: str, **_kwargs: object) -> None:
                Path(subtitle_file).write_text(
                    "1\n00:00:00,200 --> 00:00:00,700\n实际语音\n\n",
                    encoding="utf-8",
                )
            with (
                patch.object(VideoAspect, "to_resolution", lambda self: (160, 160)),
                patch.object(task.subtitle, "create", side_effect=fake_transcribe),
                patch.object(task.sm.state, "update_task"),
            ):
                preview = task.generate_original_audio_videos(
                    "smoke-task", params, [[str(spoken), str(silent)], [str(silent), str(silent)]],
                    stop_at="subtitle",
                )
            assert preview["videos"] == []
            captions = folder / "storage" / "tasks" / "smoke-task"
            assert "实际语音" in (captions / "subtitle-1.srt").read_text(encoding="utf-8")
            assert (captions / "subtitle-2.srt").read_text(encoding="utf-8") == ""
            (captions / "subtitle-1.srt").write_text(
                "1\n00:00:00,200 --> 00:00:00,700\n修改后的字幕\n\n", encoding="utf-8",
            )
            with (
                patch.object(VideoAspect, "to_resolution", lambda self: (160, 160)),
                patch.object(task.subtitle, "create", side_effect=AssertionError("edited subtitle was transcribed again")),
                patch.object(task.sm.state, "update_task"),
            ):
                result = task.generate_original_audio_videos(
                    "smoke-task", params, [[str(spoken), str(silent)], [str(silent), str(silent)]],
                    stop_at="video",
                )
            assert len(result["videos"]) == 2
            assert "修改后的字幕" in (captions / "subtitle-1.srt").read_text(encoding="utf-8")
            assert (captions / "subtitle-2.srt").read_text(encoding="utf-8") == ""
            assert all(probe(Path(file))[1] for file in result["videos"])
        print("original audio and silent-clip smoke check passed")


if __name__ == "__main__":
    main()
