"""Local stdio adapter for the vendored MoneyPrinterTurbo pipeline.

The Cordis host owns authentication, model selection, persistence and file access.
Only this child imports MoneyPrinterTurbo; no HTTP listener or API key is exposed.
"""
import json
import math
import os
import shutil
import sys
import traceback
from pathlib import Path

WIRE = sys.stdout
sys.stdout = sys.stderr
RUNTIME = Path(__file__).resolve().parent
MPT = RUNTIME / "mpt"
sys.path.insert(0, str(MPT))
os.chdir(MPT)

# Explicit overrides take precedence over the common application tool. Keep the
# private imageio binary as a fallback for independently installed engines.
configured_ffmpeg = os.environ.get("IMAGEIO_FFMPEG_EXE") or os.environ.get("FFMPEG_PATH") or os.environ.get("CQAI_FFMPEG")
if not configured_ffmpeg:
    import imageio_ffmpeg
    configured_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
os.environ["IMAGEIO_FFMPEG_EXE"] = configured_ffmpeg


def send(kind, **data):
    WIRE.write("MPT_EVENT " + json.dumps({"type": kind, **data}, ensure_ascii=False, default=str) + "\n")
    WIRE.flush()


def request(kind, **data):
    send(kind, **data)
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("Cordis host disconnected")
    response = json.loads(line)
    if not response.get("ok"):
        raise RuntimeError(str(response.get("error") or "CQAI Club request failed"))
    return response.get("value")


def system_fonts():
    roots = []
    if os.name == "nt":
        roots.append(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts")
    else:
        roots.extend([Path("/usr/share/fonts"), Path("/usr/local/share/fonts"),
                      Path.home() / ".local/share/fonts"])
    fonts = []
    for root in roots:
        if not root.is_dir():
            continue
        for item in root.rglob("*"):
            if item.is_file() and item.suffix.lower() in {".ttf", ".ttc", ".otf"}:
                fonts.append({"name": item.name, "path": str(item.resolve())})
    return sorted(fonts, key=lambda item: item["name"].lower())[:300]

def voice_timing_path(task_dir):
    return task_dir / ".private" / "voice-timing.json"


def save_voice_timing(task_dir, sub_maker):
    cues = getattr(sub_maker, "cues", None)
    if not cues:
        return
    if len(cues) > 100000:
        raise ValueError("voice timing has too many cues")
    records = []
    for cue in cues:
        offset = round(cue.start.total_seconds() * 10000000)
        duration = round((cue.end - cue.start).total_seconds() * 10000000)
        records.append({"offset": offset, "duration": duration, "text": cue.content})
    target = voice_timing_path(task_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    temporary.replace(target)


def load_voice_timing(task_dir):
    source = voice_timing_path(task_dir)
    if not source.is_file():
        return None
    if source.stat().st_size > 8000000:
        raise ValueError("voice timing file is too large")
    records = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(records, list) or not 0 < len(records) <= 100000:
        raise ValueError("invalid voice timing file")
    from edge_tts import SubMaker
    sub_maker = SubMaker()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("invalid voice timing cue")
        offset, duration, content = record.get("offset"), record.get("duration"), record.get("text")
        if (type(offset) is not int or type(duration) is not int or
                offset < 0 or duration <= 0 or offset + duration > 864000000000 or
                not isinstance(content, str) or len(content) > 1000):
            raise ValueError("invalid voice timing cue")
        sub_maker.feed({"type": "WordBoundary", "offset": offset,
                        "duration": duration, "text": content})
    return sub_maker


def main():
    data_root = Path(os.environ["MPT_DSH_DATA_ROOT"]).resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) < 2:
        raise ValueError("operation is required")
    operation = sys.argv[1]
    if operation == "health":
        try:
            from app.models.schema import VideoParams
            from app.utils import utils
            from app.services import voice
            del VideoParams
            ffmpeg_error = None
            try:
                ffmpeg_ready = utils.check_ffmpeg_ready()
            except Exception as exc:
                ffmpeg_ready = False
                ffmpeg_error = f"{type(exc).__name__}: {exc}"
            send("health", python=True, pythonPackages=True, ffmpeg=ffmpeg_ready,
                 **({"error": ffmpeg_error} if ffmpeg_error else {}),
                 voices=[name for name in voice.get_all_azure_voices(["zh-CN", "en-US"]) if "-V2-" not in name], fonts=system_fonts(),
                 uv=bool(shutil.which("uv")))
        except Exception as exc:
            send("health", python=False, pythonPackages=False, ffmpeg=False, error=f"{type(exc).__name__}: {exc}",
                 uv=bool(shutil.which("uv")))
        return
    if operation not in {"run", "content"} or len(sys.argv) != 3:
        raise ValueError("expected: bridge.py <run|content> <request.json>")

    request_path = Path(sys.argv[2]).resolve()
    if not request_path.is_relative_to(data_root):
        raise ValueError("request must be inside plugin data directory")
    payload = json.loads(request_path.read_text(encoding="utf-8"))
    if operation == "content":
        from app.models.schema import VideoParams
        from app.services import llm

        params = VideoParams.model_validate(payload["params"])
        action = payload["action"]
        if action == "preview":
            send(
                "content_result",
                prompt=llm.build_script_prompt(
                    video_subject=params.video_subject,
                    language=params.video_language,
                    paragraph_number=params.paragraph_number,
                    video_script_prompt=params.video_script_prompt,
                    custom_system_prompt=params.custom_system_prompt,
                ),
                defaultSystemPrompt=llm.DEFAULT_SCRIPT_SYSTEM_PROMPT,
            )
            return

        llm._generate_response = lambda prompt, app_config=None: request(
            "llm_request", prompt=prompt
        )
        if action == "script":
            script = llm.generate_script(
                video_subject=params.video_subject,
                language=params.video_language,
                paragraph_number=params.paragraph_number,
                video_script_prompt=params.video_script_prompt,
                custom_system_prompt=params.custom_system_prompt,
            )
            if not script or "Error: " in script:
                raise RuntimeError(str(script or "视频文案生成失败"))
        elif action == "terms":
            script = params.video_script
        else:
            raise ValueError("invalid content action")

        terms = llm.generate_terms(
            params.video_subject,
            script,
            amount=8 if params.match_materials_to_script else 5,
            match_script_order=params.match_materials_to_script,
        )
        if not terms:
            raise RuntimeError("素材关键词生成失败")
        send("content_result", script=script, terms=terms)
        return

    task_id = payload["id"]
    if not isinstance(task_id, str) or not task_id.isascii() or not task_id.replace("-", "").isalnum():
        raise ValueError("invalid task id")
    stop_at = payload.get("stopAt", "video")
    if stop_at not in {"script", "terms", "audio", "subtitle", "materials", "video"}:
        raise ValueError("invalid pipeline stage")

    from app.config import config
    from app.models.schema import VideoParams
    config.app["enable_redis"] = False
    config.app["upload_post_auto_upload"] = False
    config.app["upload_post_enabled"] = False
    from app.services import llm, material, state, task
    from app.utils import utils
    for key in ("pexels_api_keys", "pixabay_api_keys", "coverr_api_keys"):
        value = os.environ.get({"pexels_api_keys": "MPT_PEXELS_API_KEY", "pixabay_api_keys": "MPT_PIXABAY_API_KEY", "coverr_api_keys": "MPT_COVERR_API_KEY"}[key], "")
        config.app[key] = [value] if value else []

    config.app["subtitle_provider"] = payload.get("settings", {}).get("subtitle_provider", "edge")
    config.app["video_codec"] = payload.get("settings", {}).get("video_codec", "libx264")

    image_model = payload.get("imageModel", "")
    if image_model:
        config.app["openai_image_base_url"] = "http://cordis.internal/v1"
        config.app["openai_image_model"] = image_model
        config.app["openai_image_api_keys"] = []

    def cqai_text(prompt, app_config=None):
        del app_config
        return request("llm_request", prompt=prompt)

    def cqai_image(endpoint, image_payload):
        del endpoint
        response = request("image_request", payload=image_payload)
        class ImageResponse:
            def json(self):
                return response
        return material._parse_openai_image_response(ImageResponse(), "")

    llm._generate_response = cqai_text
    material._request_openai_image = cqai_image

    original_download_videos = material.download_videos
    def download_videos(*args, **kwargs):
        if kwargs.get("source") != "cqai_video":
            return original_download_videos(*args, **kwargs)
        prepared = payload.get("preparedMaterials")
        if prepared is not None:
            if not isinstance(prepared, list) or not prepared or any(
                not isinstance(group, list) or not group for group in prepared
            ):
                raise ValueError("prepared video materials are invalid")
            return [str(Path(file).resolve()) for group in prepared for file in group]

        from app.models.schema import MaterialInfo
        task_id = kwargs["task_id"]
        duration = float(params.target_duration_seconds)
        clip_seconds = int(kwargs["max_clip_duration"])
        terms = [str(term).strip() for term in kwargs["search_terms"] if str(term).strip()]
        if not math.isfinite(duration) or duration <= 0 or clip_seconds <= 0:
            raise ValueError("CQAI video requires a positive finite audio and clip duration")
        if not terms:
            raise ValueError("CQAI video requires material keywords")
        clip_count = math.ceil(duration / clip_seconds) * int(params.video_count)
        if clip_count > 100:
            raise ValueError("CQAI video would require more than 100 paid clips; shorten the narration or increase clip duration")

        output_dir = (Path(utils.task_dir(task_id)) / "cqai-materials").resolve()
        paths = []
        sources = []
        for index in range(clip_count):
            term = terms[index % len(terms)]
            result = request("video_request", index=index, prompt=term, seconds=clip_seconds)
            term = result["prompt"]
            expected = output_dir / f"clip-{index}.mp4"
            path = Path(result["path"]).resolve()
            if path != expected or not path.is_file():
                raise ValueError("CQAI video returned a file outside this task")
            item = MaterialInfo(provider="cqai_video", url=str(path), duration=clip_seconds,
                                source_info={"search_term": term, "asset_id": result["taskId"]})
            paths.append(str(path))
            sources.append(material._material_source_record(item, str(path)))
            material._persist_material_sources(task_id, sources)
        return paths

    material.download_videos = download_videos

    previous_update = state.state.update_task
    def update(task_id, *args, **kwargs):
        previous_update(task_id, *args, **kwargs)
        snapshot = state.state.get_task(task_id)
        send("progress", state=snapshot)
    state.state.update_task = update

    params = VideoParams.model_validate(payload["params"])
    if params.audio_source in {"upload", "video_original"}:
        config.app["subtitle_provider"] = "whisper"
    if params.subtitle_enabled and stop_at == "video":
        fonts = system_fonts()
        chosen = params.font_name
        allowed = {item["path"] for item in fonts}
        if chosen and chosen not in allowed:
            raise ValueError("font must be selected from installed system fonts")
        if not chosen:
            if not fonts:
                raise ValueError("no system font found; disable subtitles or install a font")
            preferred = next((f for f in fonts if f["name"].lower() in {"msyh.ttc", "dejavusans.ttf", "arial.ttf"}), fonts[0])
            params.font_name = preferred["path"]
    if params.video_source == "local":
        uploaded = payload.get("uploads", {}).get("material", [])
        local_root = Path(utils.storage_dir("local_videos", create=True)).resolve()
        from app.models.schema import MaterialInfo
        params.video_materials = [
            MaterialInfo(provider="local", url=str((local_root / name).resolve()))
            for name in uploaded
            if (local_root / name).resolve().is_relative_to(local_root)
        ]
    if payload.get("uploads", {}).get("audio"):
        params.custom_audio_file = str((Path(utils.task_dir(task_id)) / payload["uploads"]["audio"]).resolve())
    if payload.get("uploads", {}).get("bgm"):
        params.bgm_type = "custom"
        params.bgm_file = payload["uploads"]["bgm"]

    original_generate_audio = task.generate_audio

    def generate_audio_with_timing(*args, **kwargs):
        audio_file, audio_duration, sub_maker = original_generate_audio(*args, **kwargs)
        task_dir = Path(utils.task_dir(task_id)).resolve()
        if stop_at == "audio" and audio_file and sub_maker is not None:
            save_voice_timing(task_dir, sub_maker)
        elif (stop_at in {"subtitle", "video"} and params.subtitle_enabled and
              config.app["subtitle_provider"] == "edge" and
              payload.get("uploads", {}).get("audio") and not payload.get("reuseSubtitle")):
            sub_maker = load_voice_timing(task_dir)
            if sub_maker is None:
                raise ValueError("confirmed audio has no Edge timing; select Whisper or regenerate the voice preview")
        return audio_file, audio_duration, sub_maker

    task.generate_audio = generate_audio_with_timing

    if payload.get("reuseSubtitle") and params.audio_source != "video_original":
        if not payload.get("uploads", {}).get("audio"):
            raise ValueError("reused subtitle requires preview audio")
        cached_subtitle = (Path(utils.task_dir(task_id)) / "subtitle.srt").resolve()
        if not cached_subtitle.is_file():
            cached_subtitle = (Path(utils.task_dir(task_id)) / "subtitle-1.srt").resolve()
        if not cached_subtitle.is_relative_to(Path(utils.task_dir(task_id)).resolve()):
            raise ValueError("invalid reused subtitle path")
        if params.subtitle_enabled and not cached_subtitle.is_file():
            raise ValueError("reused subtitle file is missing")

        def use_preview_subtitle(task_id, params, video_script, sub_maker, audio_file):
            return str(cached_subtitle) if params.subtitle_enabled and cached_subtitle.stat().st_size else ""

        task.generate_subtitle = use_preview_subtitle

    result = task.start(task_id, params, stop_at=stop_at,
                        prepared_material_groups=payload.get("preparedMaterials"))
    snapshot = state.state.get_task(task_id) or {}
    send("result", result=result, state=snapshot)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        send("fatal", error=f"{type(exc).__name__}: {exc}")
        sys.exit(1)
