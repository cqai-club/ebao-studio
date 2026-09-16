from __future__ import annotations

import json
import os
import hashlib
from pathlib import Path


DEFAULT_BASE_URL = "https://saas.inferflow.dev/openapi/v1"
CONFIG_DIR = Path.home() / ".inferflow"
CONFIG_PATH = CONFIG_DIR / "config.json"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_config(config: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def get_base_url(explicit: str | None = None) -> str:
    if explicit:
        return explicit.rstrip("/")
    env_value = os.getenv("INFERFLOW_BASE_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")
    return str(load_config().get("base_url") or DEFAULT_BASE_URL).rstrip("/")


def get_api_key(explicit: str | None = None, *, save_key: bool = True) -> str:
    if explicit:
        if save_key:
            config = load_config()
            config["api_key"] = explicit.strip()
            save_config(config)
        return explicit.strip()
    env_value = os.getenv("INFERFLOW_API_KEY", "").strip()
    if env_value:
        return env_value
    config = load_config()
    stored = str(config.get("api_key") or "").strip()
    if stored:
        return stored
    api_key = input("请输入 InferFlow API Key: ").strip()
    if not api_key:
        raise SystemExit("必须提供 InferFlow API Key。")
    if save_key:
        config["api_key"] = api_key
        save_config(config)
    return api_key


def remember_base_url(base_url: str) -> None:
    config = load_config()
    config["base_url"] = base_url.rstrip("/")
    save_config(config)


def api_key_fingerprint(base_url: str, api_key: str) -> str:
    normalized = f"{base_url.rstrip('/')}|{api_key.strip()}".encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()[:24]


def get_last_assets(base_url: str, api_key: str) -> dict:
    profiles = load_config().get("asset_profiles") or {}
    if not isinstance(profiles, dict):
        return {}
    profile = profiles.get(api_key_fingerprint(base_url, api_key)) or {}
    return profile if isinstance(profile, dict) else {}


def remember_last_assets(base_url: str, api_key: str, *, avatar: dict, voice: dict) -> None:
    config = load_config()
    profiles = config.get("asset_profiles")
    if not isinstance(profiles, dict):
        profiles = {}
    profiles[api_key_fingerprint(base_url, api_key)] = {
        "api_key_fingerprint": api_key_fingerprint(base_url, api_key),
        "avatar": {"id": str(avatar.get("id") or avatar.get("avatar_id") or ""), "name": str(avatar.get("name") or "数字人图片")},
        "voice": {"id": str(voice.get("id") or voice.get("voice_id") or ""), "name": str(voice.get("name") or "参考音频")},
    }
    config["asset_profiles"] = profiles
    save_config(config)


def clear_last_assets(base_url: str, api_key: str) -> None:
    config = load_config()
    profiles = config.get("asset_profiles")
    if not isinstance(profiles, dict):
        return
    profiles.pop(api_key_fingerprint(base_url, api_key), None)
    config["asset_profiles"] = profiles
    save_config(config)
