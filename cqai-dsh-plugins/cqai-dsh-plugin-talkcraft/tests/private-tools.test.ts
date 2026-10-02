import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const python = process.env.MPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const available = spawnSync(python, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], {windowsHide: true, timeout: 10000}).status === 0

describe('owned Python media tool adapter', () => {
  it.skipIf(!available)('prefers published shared tools, rejects partial installs, and keeps legacy fallbacks', () => {
    const source = fileURLToPath(new URL('../upstream/scripts/private_tools.py', import.meta.url))
    const result = spawnSync(python, ['-c', `
import importlib.util, json, os, platform, sys, tempfile
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("private_tools", sys.argv[1])
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)
with tempfile.TemporaryDirectory(prefix="talkcraft-python-tools-") as temporary:
    home = Path(temporary)
    snapshot = home / "talkcraft" / "runtime" / "v1-test"
    script = snapshot / "upstream" / "scripts" / "private_tools.py"
    script.parent.mkdir(parents=True)
    (snapshot / ".snapshot-ready").write_text("1", encoding="utf-8")
    tools.__file__ = str(script)
    system = {"win32": "win32", "darwin": "darwin"}.get(sys.platform, "linux")
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}[platform.machine().lower()]
    suffix = "-msvc" if system == "win32" else ("-gnu" if platform.libc_ver()[0] == "glibc" else "-musl") if system == "linux" else ""
    package = f"compositor-{system}-{arch}" + suffix
    extension = ".exe" if system == "win32" else ""
    legacy = snapshot / "upstream" / "runtime" / "node_modules" / "@remotion" / package
    shared = home / "media-tools" / "ffmpeg" / tools.COMMON_FFMPEG_VERSION
    common = shared / "node_modules" / "@remotion" / package
    for root in [legacy, common]:
        root.mkdir(parents=True)
        for name in ["ffmpeg", "ffprobe"]:
            (root / (name + extension)).write_text("fixture", encoding="utf-8")
    ffmpeg_path = "imageio/imageio_ffmpeg/binaries/ffmpeg-fixture" + extension
    common_ffmpeg = shared / ffmpeg_path
    common_ffmpeg.parent.mkdir(parents=True)
    common_ffmpeg.write_text("fixture", encoding="utf-8")
    ready = {"version": tools.COMMON_FFMPEG_VERSION, "package": "@remotion/" + package,
             "ffmpegProvider": tools.COMMON_FFMPEG_PROVIDER, "ffmpegPath": ffmpeg_path}
    (common / "package.json").write_text(json.dumps({"version": tools.COMMON_FFMPEG_VERSION}), encoding="utf-8")
    marker = shared / ".media-tools-ready.json"
    with patch.dict(os.environ, {}, clear=True):
        assert tools.media_bin("ffmpeg") == str(legacy / ("ffmpeg" + extension))
        marker.write_text(json.dumps(ready), encoding="utf-8")
        assert tools.media_bin("ffmpeg") == str(common_ffmpeg)
        assert tools.media_bin("ffprobe") == str(common / ("ffprobe" + extension))
        marker.write_text("{broken", encoding="utf-8")
        assert tools.media_bin("ffmpeg") == str(legacy / ("ffmpeg" + extension))
        marker.write_text(json.dumps({**ready, "version": "wrong"}), encoding="utf-8")
        assert tools.media_bin("ffprobe") == str(legacy / ("ffprobe" + extension))
        for invalid in [{**ready, "ffmpegProvider": "compositor"},
                        {**ready, "ffmpegPath": "../ffmpeg"},
                        {**ready, "ffmpegPath": "imageio/imageio_ffmpeg/binaries/../../ffmpeg"},
                        {**ready, "ffmpegPath": "imageio/imageio_ffmpeg/binaries/ffmpeg-sub/child.exe"}]:
            marker.write_text(json.dumps(invalid), encoding="utf-8")
            assert tools.media_bin("ffmpeg") == str(legacy / ("ffmpeg" + extension))
            assert tools.media_bin("ffprobe") == str(legacy / ("ffprobe" + extension))
        override = home / "explicit-ffmpeg"
        override.write_text("fixture", encoding="utf-8")
        os.environ["CQAI_FFMPEG"] = str(override)
        assert tools.media_bin("ffmpeg") == str(override)
        os.environ["CQAI_FFMPEG"] = str(home / "missing")
        assert tools.media_bin("ffmpeg") == str(legacy / ("ffmpeg" + extension))
        marker.write_text(json.dumps(ready), encoding="utf-8")
        (common / ("ffprobe" + extension)).unlink()
        assert tools.media_bin("ffprobe") == str(legacy / ("ffprobe" + extension))
        node = home / "media-tools" / "bin" / ("node.cmd" if system == "win32" else "node")
        node.parent.mkdir(parents=True)
        node.write_text("fixture", encoding="utf-8")
        os.environ["CQAI_NODE"] = str(node)
        assert tools.node_bin() == str(node)
print("shared and legacy adapter assertions passed")
`, source], {encoding: 'utf8', windowsHide: true, timeout: 10000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}})
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('shared and legacy adapter assertions passed')
  })
})
