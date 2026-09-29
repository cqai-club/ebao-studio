"""Resolve media tools from this TalkCraft snapshot's app-private runtime."""

from __future__ import annotations

import platform
import sys
from pathlib import Path


def _snapshot() -> Path | None:
    root = Path(__file__).resolve().parents[2]
    return root if (root / ".snapshot-ready").is_file() else None


def media_bin(name: str) -> str:
    if name not in {"ffmpeg", "ffprobe"}:
        raise ValueError("unsupported media tool")
    snapshot = _snapshot()
    if snapshot is None:
        return name  # Original source-tree developer workflow.
    system = {"win32": "win32", "darwin": "darwin"}.get(sys.platform, "linux")
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if arch is None:
        raise RuntimeError(f"unsupported media architecture: {platform.machine()}")
    root = snapshot / "upstream" / "runtime" / "node_modules" / "@remotion"
    base = f"compositor-{system}-{arch}"
    for package in (root / base, *root.glob(f"{base}-*")):
        binary = package / (f"{name}.exe" if system == "win32" else name)
        if binary.is_file():
            return str(binary)
    raise FileNotFoundError(f"app-private Remotion {name} is missing")


def node_bin() -> str:
    snapshot = _snapshot()
    if snapshot is None:
        return "node"
    binary = snapshot.parent.parent / "bin" / ("node.cmd" if sys.platform == "win32" else "node")
    if not binary.is_file():
        raise FileNotFoundError("app-private Node launcher is missing")
    return str(binary)
