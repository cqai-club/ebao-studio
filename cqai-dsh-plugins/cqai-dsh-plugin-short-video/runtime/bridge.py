"""Local stdio adapter for the vendored MoneyPrinterTurbo pipeline.

The Cordis host owns authentication, model selection, persistence and file access.
Only this child imports MoneyPrinterTurbo; no HTTP listener or API key is exposed.
"""
import json
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
            send("health", python=True, ffmpeg=utils.check_ffmpeg_ready(),
                 voices=[name for name in voice.get_all_azure_voices(["zh-CN", "en-US"]) if "-V2-" not in name], fonts=system_fonts(),
                 uv=bool(shutil.which("uv")))
        except Exception as exc:
            send("health", python=False, ffmpeg=False, error=f"{type(exc).__name__}: {exc}",
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
        value = payload.get("settings", {}).get(key, "")
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

    previous_update = state.state.update_task
    def update(task_id, *args, **kwargs):
        previous_update(task_id, *args, **kwargs)
        snapshot = state.state.get_task(task_id)
        send("progress", state=snapshot)
    state.state.update_task = update

    params = VideoParams.model_validate(payload["params"])
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

    if payload.get("reuseSubtitle"):
        if not payload.get("uploads", {}).get("audio"):
            raise ValueError("reused subtitle requires preview audio")
        cached_subtitle = (Path(utils.task_dir(task_id)) / "subtitle.srt").resolve()
        if not cached_subtitle.is_relative_to(Path(utils.task_dir(task_id)).resolve()):
            raise ValueError("invalid reused subtitle path")
        if params.subtitle_enabled and not cached_subtitle.is_file():
            raise ValueError("reused subtitle file is missing")

        def use_preview_subtitle(task_id, params, video_script, sub_maker, audio_file):
            return str(cached_subtitle) if params.subtitle_enabled else ""

        task.generate_subtitle = use_preview_subtitle

    result = task.start(task_id, params, stop_at=stop_at)
    snapshot = state.state.get_task(task_id) or {}
    send("result", result=result, state=snapshot)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        send("fatal", error=f"{type(exc).__name__}: {exc}")
        sys.exit(1)
