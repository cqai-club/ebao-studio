#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from config import clear_last_assets, get_api_key, get_base_url, get_last_assets, remember_base_url, remember_last_assets
from estimate_modes import estimate_modes as estimate_script_modes
from inferflow_client import InferFlowClient, InferFlowError, normalize_tts_script_text


TERMINAL_STATUSES = {"completed", "partial_success", "failed", "canceled"}
ASPECT_RATIO_TOLERANCE = 0.03
DISPLAY_FILE_LABELS = {
    "digital_human_avatar": "数字人图片",
    "digital_human_voice": "参考音频",
}
SCRIPT_TEXT_FILE_SUFFIXES = {
    ".txt",
    ".md",
    ".doc",
    ".docx",
    ".pdf",
    ".json",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".wav",
    ".mp3",
    ".m4a",
    ".aac",
    ".mp4",
    ".mov",
    ".zip",
}
SCRIPT_TEXT_PAYLOAD_KEYS = {
    "avatar_id",
    "voice_id",
    "avatar_image",
    "voice_audio",
    "script_text",
    "file",
    "path",
}
SCRIPT_TEXT_INVALID_MESSAGE = (
    "script_text 必须是完整口播文案，不要填写文件路径、URL、JSON、API Key 或命令参数。\n"
    "如需使用本地文案文件，请使用 script_text=@/path/to/script.txt。"
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def safe_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def default_output_dir(skill_code: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path.cwd() / "outputs" / "inferflow" / skill_code / stamp


def load_inputs(args: argparse.Namespace) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if args.inputs_json:
        values.update(json.loads(Path(args.inputs_json).expanduser().read_text(encoding="utf-8-sig")))
    for item in args.input or []:
        if "=" not in item:
            raise SystemExit(f"--input must use name=value format: {item}")
        key, value = item.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def option_values(options: list[Any] | None) -> set[str]:
    values: set[str] = set()
    for option in options or []:
        if isinstance(option, dict):
            if option.get("enabled") is False:
                continue
            values.add(str(option.get("value") or ""))
        else:
            values.add(str(option))
    return {item for item in values if item}


def text_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if text.startswith("@"):
        return Path(text[1:]).expanduser().read_text(encoding="utf-8").strip()
    return text.strip()


def local_input_path(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.startswith("@"):
        return ""
    try:
        path = Path(text).expanduser().resolve()
    except Exception:
        return ""
    return str(path) if path.exists() else ""


def is_probable_file_or_path(value: str) -> bool:
    text = value.strip().strip("\"'")
    lower = text.lower()
    if re.match(r"^(https?|file)://\S+$", lower):
        return True
    if re.match(r"^[a-z]:[\\/].+", text, re.IGNORECASE):
        return True
    if re.match(r"^(~|\.{1,2})[\\/].+", text):
        return True
    if re.match(r"^/[^\s]+(?:/[^\s]+)+$", text):
        return True
    suffix = Path(lower.lstrip("@")).suffix
    if suffix in SCRIPT_TEXT_FILE_SUFFIXES and len(text.split()) <= 3:
        return True
    path_chars = sum(1 for char in text if char in "\\/:=.@_-")
    natural_chars = len(re.findall("[\u4e00-\u9fffA-Za-z0-9]", text))
    return len(text) <= 160 and natural_chars <= 24 and path_chars >= max(3, natural_chars)


def is_probable_json_payload(value: str) -> bool:
    text = value.strip()
    if not ((text.startswith("{") and text.endswith("}")) or (text.startswith("[") and text.endswith("]"))):
        return False
    lower = text.lower()
    return any(key in lower for key in SCRIPT_TEXT_PAYLOAD_KEYS)


def is_probable_cli_or_asset_reference(value: str) -> bool:
    text = value.strip()
    lower = text.lower()
    if lower.startswith(("python ", "python3 ", "node ", "npx ", "curl ")):
        return True
    if "--input" in lower or "--skill-code" in lower or "run_skill.py" in lower:
        return True
    if re.search(r"\b(?:avatar_image|voice_audio|avatar_id|voice_id|script_text)\s*=", lower):
        return True
    if re.fullmatch(r"ngg_sk_[A-Za-z0-9_-]+", text):
        return True
    if re.fullmatch(r"(?:avatar|voice|run|req)_[A-Za-z0-9_-]+", text):
        return True
    return False


def is_probable_mojibake(value: str) -> bool:
    markers = ("鎴戞", "铏氭嫙", "銆", "锛", "鐨勫", "鍙戝", "浠ュ", "涓")
    return sum(value.count(marker) for marker in markers) >= 2


def validate_script_text_for_speech(value: Any) -> str:
    text = normalize_tts_script_text(text_value(value))
    if is_probable_mojibake(text):
        raise SystemExit("口播文案编码异常，请将文案保存为 UTF-8 后重新提交。")
    if len(re.findall("[\u4e00-\u9fffA-Za-z0-9]", text)) < 10:
        raise SystemExit(SCRIPT_TEXT_INVALID_MESSAGE)
    if is_probable_file_or_path(text):
        raise SystemExit(SCRIPT_TEXT_INVALID_MESSAGE)
    if is_probable_json_payload(text):
        raise SystemExit(SCRIPT_TEXT_INVALID_MESSAGE)
    if is_probable_cli_or_asset_reference(text):
        raise SystemExit(SCRIPT_TEXT_INVALID_MESSAGE)
    return text


def upload_file(client: InferFlowClient, field: dict, value: Any) -> tuple[str, Any]:
    path = Path(str(value)).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(path)
    upload_to = field.get("upload_to")
    target_name = str(field.get("maps_to") or field.get("name"))
    upload_endpoint = str(field.get("upload_endpoint") or "").strip()
    if upload_endpoint:
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,60}_id", target_name):
            raise InferFlowError(
                400,
                "invalid_upload_contract",
                "The public file upload contract is invalid.",
            )
        print(f"正在上传{public_file_label(field)}...")
        result = client.upload_schema_asset(
            path,
            upload_endpoint=upload_endpoint,
            upload_to=str(upload_to or ""),
            name=path.stem,
        )
        return target_name, result["asset_id"]
    if upload_to == "digital_human_avatar":
        print(f"正在上传{public_file_label(field)}...")
        result = client.upload_avatar(path)
        return target_name, result["avatar_id"]
    if upload_to == "digital_human_voice":
        print(f"正在上传{public_file_label(field)}...")
        result = client.upload_voice(path)
        return target_name, result["voice_id"]
    if upload_to == "temp_public_asset":
        print(f"正在上传{public_file_label(field)}...")
        result = client.upload_temp_asset(path)
        return target_name, result["asset_id"]
    raise InferFlowError(
        400,
        "invalid_upload_contract",
        "The public file upload contract is invalid.",
    )


def image_paths_from_value(value: Any) -> list[Path]:
    if isinstance(value, (list, tuple)):
        return [Path(str(item)).expanduser().resolve() for item in value if str(item).strip()]
    raw = str(value).strip()
    if raw.startswith("@"):
        lines = Path(raw[1:]).expanduser().read_text(encoding="utf-8").splitlines()
        return [Path(line.strip()).expanduser().resolve() for line in lines if line.strip()]
    path = Path(raw).expanduser().resolve()
    if path.is_dir():
        suffixes = {".png", ".jpg", ".jpeg", ".webp"}
        return sorted([item for item in path.iterdir() if item.is_file() and item.suffix.lower() in suffixes])
    parts = [item.strip() for item in raw.split(";") if item.strip()]
    if len(parts) > 1:
        return [Path(item).expanduser().resolve() for item in parts]
    return [path]


def structured_text(value: Any) -> str:
    text = str(value or "").strip()
    if text.startswith("@"):
        return Path(text[1:]).expanduser().read_text(encoding="utf-8-sig").strip()
    return text


def parse_string_list(value: Any, field: dict) -> list[str]:
    if isinstance(value, list):
        items = value
    else:
        text = structured_text(value)
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            decoded = [item for item in re.split(r"[\n;；|]+", text) if item.strip()]
        if not isinstance(decoded, list):
            raise SystemExit(f"{field.get('label') or field.get('name')} 必须是字符串数组。")
        items = decoded
    clean = [str(item).strip() for item in items if str(item or "").strip()]
    min_count = int(field.get("min_count") or 0)
    max_count = int(field.get("max_count") or 0)
    if min_count and len(clean) < min_count:
        raise SystemExit(f"{field.get('label') or field.get('name')} 至少需要 {min_count} 项。")
    if max_count and len(clean) > max_count:
        raise SystemExit(f"{field.get('label') or field.get('name')} 最多允许 {max_count} 项。")
    return clean


def parse_object(value: Any, field: dict) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = structured_text(value)
    try:
        decoded = json.loads(text or "{}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{field.get('label') or field.get('name')} 必须是 JSON 对象。") from exc
    if not isinstance(decoded, dict):
        raise SystemExit(f"{field.get('label') or field.get('name')} 必须是 JSON 对象。")
    return decoded


def parse_boolean(value: Any, field: dict) -> bool:
    if isinstance(value, bool):
        return value
    if not isinstance(value, str):
        raise SystemExit(f"{field.get('label') or field.get('name')} must be a boolean.")
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise SystemExit(f"{field.get('label') or field.get('name')} must be true or false.")


NUMBER_TEXT_PATTERN = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\Z")


def parse_number(value: Any, field: dict) -> int | float:
    label = field.get("label") or field.get("name")
    if isinstance(value, bool):
        raise SystemExit(f"{label} must be a finite number.")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        raise SystemExit(f"{label} must be a finite number.")
    if not isinstance(value, str):
        raise SystemExit(f"{label} must be a finite number.")
    normalized = value.strip()
    if not NUMBER_TEXT_PATTERN.fullmatch(normalized):
        raise SystemExit(f"{label} must be a finite number.")
    if "." not in normalized and "e" not in normalized.lower():
        return int(normalized)
    parsed = float(normalized)
    if not math.isfinite(parsed):
        raise SystemExit(f"{label} must be a finite number.")
    return parsed


def parse_select(value: Any, field: dict) -> Any:
    label = field.get("label") or field.get("name")
    options = field.get("options") or []

    def enabled_originals():
        for option in options:
            if isinstance(option, dict) and option.get("enabled") is False:
                continue
            yield option.get("value") if isinstance(option, dict) else option

    if not isinstance(value, str):
        # 服务端 schema 默认值可能是非字符串（如数值型选项 1024），直接匹配原始选项值则透传
        for original in enabled_originals():
            if original == value:
                return original
        raise SystemExit(f"{label} must be a string matching an enabled option.")
    selected = value.strip()
    for original in enabled_originals():
        # 命中后还原选项原始类型（如数值），避免服务端拒绝字符串形式
        if str(original) == selected:
            return original
    allowed = option_values(options)
    if not allowed or not selected or selected not in allowed:
        raise SystemExit(f"{label} must match an enabled option.")
    return selected


def parse_mapped_file_asset_id(value: Any, field: dict) -> str:
    label = field.get("label") or field.get("name")
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"{label} must be a non-empty public asset id string.")
    return value.strip()


def upload_multi_file(client: InferFlowClient, field: dict, value: Any) -> tuple[str, list[Any]]:
    upload_to = field.get("upload_to")
    target_name = str(field.get("maps_to") or field.get("name"))
    paths = image_paths_from_value(value)
    min_count = int(field.get("min_count") or 0)
    max_count = int(field.get("max_count") or 0)
    if min_count and len(paths) < min_count:
        raise SystemExit(f"{field.get('label') or field.get('name')} 至少需要 {min_count} 个文件，当前 {len(paths)} 个。")
    if max_count and len(paths) > max_count:
        raise SystemExit(f"{field.get('label') or field.get('name')} 最多允许 {max_count} 个文件，当前 {len(paths)} 个。")
    if upload_to != "temp_public_asset":
        raise SystemExit(f"暂不支持的多文件上传目标：{upload_to or '(missing)'}")
    asset_ids: list[str] = []
    for index, path in enumerate(paths, start=1):
        if not path.exists():
            raise FileNotFoundError(path)
        print(f"正在上传 {field.get('label') or field.get('name')} {index}/{len(paths)}：{path.name}")
        result = client.upload_temp_asset(path)
        asset_ids.append(result["asset_id"])
    return target_name, asset_ids


def public_file_label(field: dict) -> str:
    upload_to = str(field.get("upload_to") or "")
    return DISPLAY_FILE_LABELS.get(upload_to, str(field.get("label") or field.get("name") or "文件"))


def image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        data = path.read_bytes()
    except OSError:
        return None, None
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data[:2] == b"\xff\xd8":
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            segment_length = int.from_bytes(data[index : index + 2], "big")
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height = int.from_bytes(data[index + 3 : index + 5], "big")
                width = int.from_bytes(data[index + 5 : index + 7], "big")
                return width, height
            index += max(segment_length, 2)
    return None, None


def file_display_summary(field: dict, path: Path) -> dict[str, Any]:
    label = public_file_label(field)
    summary: dict[str, Any] = {
        "message": f"{label}已读取",
        "format": path.suffix.lower().lstrip(".") or None,
    }
    if str(field.get("upload_to") or "") == "digital_human_avatar":
        width, height = image_dimensions(path)
        if width and height:
            summary["width"] = width
            summary["height"] = height
            summary["aspect_ratio"] = round(width / height, 6)
    return summary


def display_inputs_for_dry_run(skill: dict, raw_inputs: dict[str, Any]) -> dict[str, Any]:
    display: dict[str, Any] = {}
    for field in skill.get("inputs") or []:
        name = str(field.get("name") or "")
        target_name = str(field.get("maps_to") or name)
        value = raw_inputs.get(name, raw_inputs.get(target_name, field.get("default")))
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if str(field.get("type") or "") == "file" and name in raw_inputs:
            path = Path(str(value)).expanduser().resolve()
            display[target_name] = file_display_summary(field, path)
        elif str(field.get("type") or "") == "text":
            display[target_name] = {"message": "口播文案已读取"} if target_name == "script_text" else str(value).strip()
        elif str(field.get("type") or "") == "select":
            display[target_name] = str(value).strip()
    return display


def mode_estimate_for_dry_run(skill: dict, planned_inputs: dict[str, Any]) -> dict[str, Any] | None:
    script_text = planned_inputs.get("script_text")
    if not isinstance(script_text, str) or not script_text.strip():
        return None
    billing = skill.get("billing") or {}
    unit_credits = int(billing.get("unit_credits") or 13)
    min_billable_units = int(billing.get("min_billable_units") or 10)
    unit_name = str(billing.get("unit_name") or "秒")
    return estimate_script_modes(
        script_text,
        unit_credits=unit_credits,
        min_billable_units=min_billable_units,
        unit_name=unit_name,
    )


def validate_local_inputs_for_dry_run(skill: dict, raw_inputs: dict[str, Any]) -> dict[str, Any]:
    planned: dict[str, Any] = {}
    fields = skill.get("inputs") or []
    allowed_names = set()
    for field in fields:
        name = str(field.get("name") or "")
        target_name = str(field.get("maps_to") or name)
        if name:
            allowed_names.add(name)
        if target_name:
            allowed_names.add(target_name)
    unknown = sorted([key for key in raw_inputs if key not in allowed_names])
    if unknown:
        raise SystemExit(f"未知输入字段：{', '.join(unknown)}")

    for field in fields:
        name = str(field.get("name") or "")
        if not name:
            continue
        target_name = str(field.get("maps_to") or name)
        field_type = str(field.get("type") or "text")
        has_mapped_value = (
            field_type in {"file", "multi_file"}
            and target_name in raw_inputs
            and target_name != name
        )
        value = raw_inputs.get(name, raw_inputs.get(target_name, field.get("default")))
        required = bool(field.get("required", True))
        if value is None or (isinstance(value, str) and not value.strip()):
            if required:
                raise SystemExit(f"缺少必填输入：{field.get('label') or name}")
            continue
        if has_mapped_value:
            planned[target_name] = (
                parse_mapped_file_asset_id(raw_inputs[target_name], field)
                if field_type == "file"
                else raw_inputs[target_name]
            )
            continue
        if field_type == "file":
            path = Path(str(value)).expanduser().resolve()
            if not path.exists():
                raise FileNotFoundError(path)
            planned[target_name] = {
                "source": str(path),
                "upload_to": field.get("upload_to"),
                "upload_endpoint": field.get("upload_endpoint"),
            }
        elif field_type == "multi_file":
            paths = image_paths_from_value(value)
            min_count = int(field.get("min_count") or 0)
            max_count = int(field.get("max_count") or 0)
            if min_count and len(paths) < min_count:
                raise SystemExit(f"{field.get('label') or name} 至少需要 {min_count} 个文件，当前 {len(paths)} 个。")
            if max_count and len(paths) > max_count:
                raise SystemExit(f"{field.get('label') or name} 最多允许 {max_count} 个文件，当前 {len(paths)} 个。")
            missing = [str(path) for path in paths if not path.exists()]
            if missing:
                raise FileNotFoundError(missing[0])
            planned[target_name] = {"sources": [str(path) for path in paths], "upload_to": field.get("upload_to")}
        elif field_type == "text":
            planned[target_name] = validate_script_text_for_speech(value) if target_name == "script_text" else text_value(value)
        elif field_type == "select":
            planned[target_name] = parse_select(value, field)
        elif field_type == "number":
            planned[target_name] = parse_number(value, field)
        elif field_type == "string_list":
            planned[target_name] = parse_string_list(value, field)
        elif field_type == "object":
            planned[target_name] = parse_object(value, field)
        elif field_type == "boolean":
            planned[target_name] = parse_boolean(value, field)
        else:
            planned[target_name] = value
    return planned


def prepare_inputs(client: InferFlowClient, skill: dict, raw_inputs: dict[str, Any]) -> dict[str, Any]:
    prepared: dict[str, Any] = {}
    fields = skill.get("inputs") or []
    for field in fields:
        name = str(field.get("name") or "")
        if not name:
            continue
        target_name = str(field.get("maps_to") or name)
        field_type = str(field.get("type") or "text")
        if (
            field_type in {"file", "multi_file"}
            and target_name != name
            and target_name in raw_inputs
        ):
            prepared[target_name] = (
                parse_mapped_file_asset_id(raw_inputs[target_name], field)
                if field_type == "file"
                else raw_inputs[target_name]
            )
            continue
        value = raw_inputs.get(name, raw_inputs.get(target_name, field.get("default")))
        required = bool(field.get("required", True))
        if value is None or (isinstance(value, str) and not value.strip()):
            if required:
                raise SystemExit(f"缺少必填输入：{field.get('label') or name}")
            continue
        if field_type == "file":
            uploaded_name, uploaded_value = upload_file(client, field, value)
            prepared[uploaded_name] = uploaded_value
        elif field_type == "multi_file":
            uploaded_name, uploaded_value = upload_multi_file(client, field, value)
            prepared[uploaded_name] = uploaded_value
        elif field_type == "text":
            prepared[target_name] = validate_script_text_for_speech(value) if target_name == "script_text" else text_value(value)
        elif field_type == "select":
            prepared[target_name] = parse_select(value, field)
        elif field_type == "number":
            prepared[target_name] = parse_number(value, field)
        elif field_type == "string_list":
            prepared[target_name] = parse_string_list(value, field)
        elif field_type == "object":
            prepared[target_name] = parse_object(value, field)
        elif field_type == "boolean":
            prepared[target_name] = parse_boolean(value, field)
        else:
            prepared[target_name] = value
    return prepared


def find_remote_asset(items: list[dict], asset_id: str) -> dict | None:
    return next(
        (
            item
            for item in items
            if str(item.get("avatar_id") or item.get("voice_id") or item.get("id") or "") == asset_id
        ),
        None,
    )


def apply_last_digital_human_assets(
    client: InferFlowClient,
    raw_inputs: dict[str, Any],
    *,
    base_url: str,
    api_key: str,
) -> dict[str, Any]:
    resolved = dict(raw_inputs)
    need_avatar = not str(resolved.get("avatar_id") or resolved.get("avatar_image") or "").strip()
    need_voice = not str(resolved.get("voice_id") or resolved.get("voice_audio") or "").strip()
    if not need_avatar and not need_voice:
        return resolved
    cached = get_last_assets(base_url, api_key)
    avatar_cache = cached.get("avatar") if isinstance(cached.get("avatar"), dict) else {}
    voice_cache = cached.get("voice") if isinstance(cached.get("voice"), dict) else {}
    avatars = client.list_avatars() if need_avatar else []
    voices = client.list_voices() if need_voice else []
    avatar = find_remote_asset(avatars, str(avatar_cache.get("id") or "")) if need_avatar else None
    voice = find_remote_asset(voices, str(voice_cache.get("id") or "")) if need_voice else None
    if (need_avatar and not avatar) or (need_voice and not voice):
        clear_last_assets(base_url, api_key)
        raise SystemExit("上次使用的素材已删除或过期，请重新选择已有素材或上传新素材。")
    if avatar:
        resolved["avatar_id"] = avatar["avatar_id"]
    if voice:
        resolved["voice_id"] = voice["voice_id"]
    return resolved


def remember_prepared_digital_human_assets(
    client: InferFlowClient,
    prepared: dict[str, Any],
    *,
    base_url: str,
    api_key: str,
) -> None:
    avatar_id = str(prepared.get("avatar_id") or "")
    voice_id = str(prepared.get("voice_id") or "")
    if not avatar_id or not voice_id:
        return
    avatar = find_remote_asset(client.list_avatars(), avatar_id)
    voice = find_remote_asset(client.list_voices(), voice_id)
    if avatar and voice:
        remember_last_assets(base_url, api_key, avatar=avatar, voice=voice)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按 InferFlow 云端 Skill Schema 创建并轮询任务。")
    parser.add_argument("--skill-code", required=True)
    parser.add_argument("--inputs-json", help="包含公开输入字段的 JSON 文件。")
    parser.add_argument("--input", action="append", help="单个输入，格式 name=value。可重复。文本文件可写 @/path/to/file.txt。")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--no-save-key", action="store_true")
    parser.add_argument("--poll-interval", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument("--no-poll", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="只校验余额、Skill、payload 和本地输出目录，不上传文件、不创建任务。")
    parser.add_argument(
        "--reuse-last-assets",
        choices=["yes", "no"],
        default="no",
        help="digital_human_standard 是否复用已由用户确认的上次数字人和音色。默认 no，不会静默复用。",
    )
    parser.add_argument(
        "--ngg-v4-local-render",
        choices=["ask", "yes", "no"],
        default="no",
        help="digital_human_standard 完成后是否立即创建并本地渲染 NGG V4 包。默认 no；对话引导层会在原片下载后单独询问。",
    )
    return parser.parse_args()


def available_credits(payload: dict) -> int:
    value = payload.get("available")
    if value is None:
        value = payload.get("balance", 0) - payload.get("frozen", 0)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def should_render_ngg_v4(args: argparse.Namespace, skill_code: str) -> bool:
    if skill_code != "digital_human_standard":
        return False
    if args.ngg_v4_local_render == "yes":
        return True
    if args.ngg_v4_local_render == "no":
        return False
    print("NGG V4 剪辑选择已交给数字人引导流程处理；如需命令行立即渲染，请显式添加 --ngg-v4-local-render yes。")
    return False


def safe_extract_zip(zip_path: Path, target_dir: Path) -> None:
    target_dir = target_dir.resolve()
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            target_path = (target_dir / member.filename).resolve()
            try:
                target_path.relative_to(target_dir)
            except ValueError as exc:
                raise RuntimeError(f"Unsafe zip member: {member.filename}") from exc
        archive.extractall(target_dir)


def npm_command() -> str:
    command = shutil.which("npm.cmd") or shutil.which("npm")
    if not command:
        raise RuntimeError("未找到 npm。请先安装 Node.js LTS 后重试本地 Remotion 渲染。")
    return command


def render_ngg_v4_locally(client: InferFlowClient, run_id: str, output_dir: Path) -> Path:
    print("正在创建 NGG V4 本地 Remotion 渲染包...")
    package_output = client.create_ngg_v4_edit_package(run_id, canvas_mode="source")
    download_url = package_output.get("download_url")
    if not download_url:
        raise RuntimeError("NGG V4 渲染包响应缺少 download_url。")
    zip_path = client.download_output(download_url, output_dir / "ngg_v4_render_package.zip")
    print(f"渲染包已下载：{zip_path}")

    package_dir = output_dir / "ngg-v4-local-render"
    safe_extract_zip(zip_path, package_dir)
    print(f"渲染包已解压：{package_dir}")

    remotion_dir = package_dir / "06_remotion"
    if not (remotion_dir / "package.json").exists():
        raise RuntimeError("NGG V4 渲染包缺少 06_remotion/package.json。")
    npm = npm_command()
    print("正在安装 Remotion 依赖...")
    subprocess.run([npm, "install"], cwd=remotion_dir, check=True)
    print("正在执行 TypeScript 检查...")
    subprocess.run([npm, "run", "typecheck"], cwd=remotion_dir, check=True)
    print("正在执行本地 Remotion 渲染...")
    subprocess.run([npm, "run", "render"], cwd=remotion_dir, check=True)

    final_video = remotion_dir / "outputs" / "final_ngg_v4.mp4"
    if not final_video.exists() or final_video.stat().st_size <= 0:
        raise RuntimeError("Remotion 渲染结束，但未找到有效的 final_ngg_v4.mp4。")
    print(f"NGG V4 精剪视频已生成：{final_video}")
    return final_video


def main() -> int:
    args = parse_args()
    base_url = get_base_url(args.base_url)
    if args.base_url:
        remember_base_url(base_url)
    api_key = get_api_key(args.api_key, save_key=not args.no_save_key)
    client = InferFlowClient(api_key=api_key, base_url=base_url)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else default_output_dir(args.skill_code).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw_inputs = load_inputs(args)
        if args.skill_code == "digital_human_standard" and args.reuse_last_assets == "yes":
            raw_inputs = apply_last_digital_human_assets(client, raw_inputs, base_url=base_url, api_key=api_key)
        if args.dry_run:
            credits = client.get_credits()
            skills = client.list_skills()
            skill_codes = [item.get("code") for item in skills.get("items", [])]
            if args.skill_code not in skill_codes:
                raise SystemExit(f"Skill 不在当前可调用列表中：{args.skill_code}")
            skill = client.get_skill(args.skill_code)
            planned_inputs = validate_local_inputs_for_dry_run(skill, raw_inputs)
            display_inputs = display_inputs_for_dry_run(skill, raw_inputs)
            mode_estimate = mode_estimate_for_dry_run(skill, planned_inputs)
            payload = {
                "mode": "dry_run",
                "skill_code": args.skill_code,
                "skill_name": skill.get("name"),
                "available_credits": available_credits(credits),
                "skill_codes": skill_codes,
                "planned_output_dir": str(output_dir),
                "planned_inputs": planned_inputs,
                "display_inputs": display_inputs,
                "mode_estimate": mode_estimate,
                "video_aspect_ratio_tolerance": ASPECT_RATIO_TOLERANCE,
                "will_upload_files": False,
                "will_create_run": False,
            }
            safe_write_json(output_dir / "dry_run.json", payload)
            print(f"Dry run 通过。本地目录规划：{output_dir}")
            print("已校验余额、Skill 列表、payload；未上传文件，未创建任务。")
            return 0
        skill = client.get_skill(args.skill_code)
        prepared = prepare_inputs(client, skill, raw_inputs)
        safe_write_json(
            output_dir / "request.json",
            {"skill_code": args.skill_code, "inputs": {key: value for key, value in prepared.items() if not str(key).lower().endswith("_key")}},
        )
        if args.skill_code == "digital_human_standard":
            print("素材上传完成，正在创建生成任务。")
        print(f"正在创建 InferFlow 任务：{skill.get('name') or args.skill_code}...")
        created = client.create_skill_run(args.skill_code, prepared)
        safe_write_json(output_dir / "created.json", created)
        run_id = created.get("run_id")
        if not run_id:
            raise InferFlowError(502, "invalid_response", "创建任务响应里没有 run id。", created)
        if args.skill_code == "digital_human_standard" and not args.no_save_key:
            try:
                remember_prepared_digital_human_assets(
                    client,
                    prepared,
                    base_url=base_url,
                    api_key=api_key,
                )
            except InferFlowError as exc:
                print(f"素材复用记录未更新：{exc.message}", file=sys.stderr)
        print(f"任务已创建：{run_id}")
        if args.no_poll:
            return 0

        status = created
        import time

        deadline = time.time() + max(1, args.timeout)
        while status.get("status") not in TERMINAL_STATUSES:
            if time.time() >= deadline:
                raise TimeoutError(f"InferFlow run did not finish within {args.timeout} seconds: {run_id}")
            status = client.get_run(run_id)
            safe_write_json(output_dir / "status.json", status)
            print(
                f"状态={status.get('status')} "
                f"进度={status.get('progress_percent')} "
                f"步骤={status.get('current_step')}"
            )
            if status.get("status") in TERMINAL_STATUSES:
                break
            time.sleep(max(1, args.poll_interval))

        safe_write_json(output_dir / "status.json", status)
        if status.get("status") not in {"completed", "partial_success"}:
            print(f"任务结束，状态={status.get('status')}：{status.get('error_message') or ''}")
            return 2

        outputs = client.list_outputs(run_id)
        safe_write_json(output_dir / "outputs.json", outputs)
        downloaded_files: dict[str, str] = {}
        for item in outputs.get("items", []):
            if item.get("type") != "file" or not item.get("download_url"):
                continue
            suffix = f".{item.get('format')}" if item.get("format") else ""
            final_path = client.download_output(item["download_url"], output_dir / f"{item.get('name') or 'output'}{suffix}")
            downloaded_files[str(item.get("name") or "output")] = str(final_path)
            print(f"输出已下载：{final_path}")
        if args.skill_code == "digital_human_standard" and downloaded_files.get("video"):
            avatar_image_path = local_input_path(raw_inputs.get("avatar_image"))
            script_text_value = text_value(raw_inputs.get("script_text") or prepared.get("script_text") or "")
            next_step = {
                "run_id": run_id,
                "video_path": downloaded_files["video"],
                "avatar_image_path": avatar_image_path,
                "script_text": script_text_value,
                "publish_package_skill": "ngg-publish-package-openai",
                "prompt": "是否继续生成精剪视频、发布包和 3 尺寸主图？",
                "options": [
                    {"value": "1", "label": "不剪辑，只保留数字人原片"},
                    {"value": "2", "label": "生成精剪视频、发布包和 3 尺寸主图"},
                ],
                "note": "选项 2 会下载 NGG V4 剪辑包、本地渲染精剪视频，并生成发布包交接文件；随后由 ngg-publish-package-openai 使用 Codex 内置图片生成能力生成 3 尺寸主图。",
                "postprocess_command": f"python scripts/create_postprocess_package.py --run-id {run_id} --output-dir {output_dir}",
            }
            safe_write_json(output_dir / "digital_human_next_step.json", next_step)
            print()
            print("原片已生成完成。")
            video_markdown_path = str(downloaded_files["video"]).replace("\\", "/")
            print("视频预览：")
            print(f"![数字人原片]({video_markdown_path})")
            print(f"本地地址：{downloaded_files['video']}")
            print()
            print("是否继续生成精剪视频、发布包和 3 尺寸主图？")
            print("1. 不剪辑，只保留数字人原片")
            print("2. 生成精剪视频、发布包和 3 尺寸主图")
            print("说明：主图将由 ngg-publish-package-openai 调用 Codex 内置图片生成能力完成，并在对话中预览。")
        if should_render_ngg_v4(args, args.skill_code):
            final_video = render_ngg_v4_locally(client, run_id, output_dir)
            safe_write_json(output_dir / "ngg_v4_local_render.json", {"final_video": str(final_video)})
            final_video_markdown_path = str(final_video).replace("\\", "/")
            print()
            print("精剪视频预览：")
            print(f"![精剪视频]({final_video_markdown_path})")
        return 0
    except InferFlowError as exc:
        safe_write_json(output_dir / "error.json", {"code": exc.code, "message": exc.message})
        print(f"InferFlow API error {exc.status_code} {exc.code}: {exc.message}", file=sys.stderr)
        for line in exc.detail_lines():
            print(line, file=sys.stderr)
        return 1
    except Exception as exc:
        safe_write_json(output_dir / "error.json", {"code": "local_error", "message": str(exc)})
        print(f"本地处理失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
