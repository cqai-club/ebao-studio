"""Resolve shared media tools, with legacy TalkCraft snapshot fallbacks."""

from __future__ import annotations

import json
import os
import platform
import re
import sys
from pathlib import Path

COMMON_FFMPEG_VERSION = "4.0.519"
COMMON_FFMPEG_PROVIDER = "imageio-ffmpeg@0.6.0"


def _snapshot() -> Path | None:
    root = Path(__file__).resolve().parents[2]
    return root if (root / ".snapshot-ready").is_file() else None


def media_bin(name: str) -> str:
    if name not in {"ffmpeg", "ffprobe"}:
        raise ValueError("unsupported media tool")
    snapshot = _snapshot()
    explicit = os.environ.get(f"CQAI_{name.upper()}")
    if explicit and Path(explicit).is_file() and Path(explicit).stat().st_size > 0:
        return explicit
    system = {"win32": "win32", "darwin": "darwin"}.get(sys.platform, "linux")
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if arch is None:
        raise RuntimeError(f"unsupported media architecture: {platform.machine()}")
    base = f"compositor-{system}-{arch}"
    home = os.environ.get("CQAI_MEDIA_TOOLS_HOME")
    if home is None:
        dsh_home = os.environ.get("DSH_HOME")
        if dsh_home:
            home = str(Path(dsh_home) / "media-tools")
        elif snapshot is not None:
            home = str(snapshot.parents[2] / "media-tools")
    if home:
        directory = Path(home) / "ffmpeg" / COMMON_FFMPEG_VERSION
        try:
            marker = json.loads((directory / ".media-tools-ready.json").read_text(encoding="utf-8"))
            suffix = "-msvc" if system == "win32" else ("-gnu" if platform.libc_ver()[0] == "glibc" else "-musl") if system == "linux" else ""
            package = base + suffix
            ffmpeg_path = marker.get("ffmpegPath")
            # Adopt only a fully published installation for this platform.
            if (marker.get("version") == COMMON_FFMPEG_VERSION and
                    marker.get("package") == "@remotion/" + package and
                    marker.get("ffmpegProvider") == COMMON_FFMPEG_PROVIDER and
                    isinstance(ffmpeg_path, str) and
                    re.fullmatch(r"imageio/imageio_ffmpeg/binaries/ffmpeg-[A-Za-z0-9_.-]+", ffmpeg_path)):
                root = directory / "node_modules" / "@remotion" / package
                manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
                binary = directory / ffmpeg_path if name == "ffmpeg" else root / ("ffprobe.exe" if system == "win32" else "ffprobe")
                if name == "ffprobe" and system == "darwin":
                    if marker.get("ffprobePath") != "bin/ffprobe" or not binary.is_file() or binary.stat().st_size == 0:
                        raise ValueError("shared ffprobe launcher is not ready")
                    binary = directory / "bin" / "ffprobe"
                binary.resolve().relative_to(directory.resolve())
                if manifest.get("version") == COMMON_FFMPEG_VERSION and binary.is_file() and binary.stat().st_size > 0:
                    return str(binary)
        except (OSError, ValueError, TypeError, AttributeError):
            pass
    if snapshot is None:
        return name  # Original source-tree developer workflow.
    root = snapshot / "upstream" / "runtime" / "node_modules" / "@remotion"
    for package in (root / base, *root.glob(f"{base}-*")):
        binary = package / (f"{name}.exe" if system == "win32" else name)
        if binary.is_file():
            return str(binary)
    raise FileNotFoundError(f"app-private Remotion {name} is missing")


def node_bin() -> str:
    explicit = os.environ.get("CQAI_NODE")
    if explicit and Path(explicit).is_file():
        return explicit
    snapshot = _snapshot()
    if snapshot is None:
        return "node"
    binary = snapshot.parent.parent / "bin" / ("node.cmd" if sys.platform == "win32" else "node")
    if not binary.is_file():
        raise FileNotFoundError("app-private Node launcher is missing")
    return str(binary)
