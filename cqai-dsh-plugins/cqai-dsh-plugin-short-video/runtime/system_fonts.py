"""Discover installed subtitle fonts across Desktop platforms."""
import os
import sys
from pathlib import Path


PREFERRED_FONTS = (
    "msyh.ttc", "pingfang.ttc", "stheiti medium.ttc", "stheiti light.ttc",
    "notosanscjk-regular.ttc", "notosanssc-regular.otf", "wqy-microhei.ttc",
    "arial unicode.ttf", "dejavusans.ttf", "arial.ttf",
)


def font_roots():
    if sys.platform == "win32":
        return [Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"]
    if sys.platform == "darwin":
        return [Path("/System/Library/Fonts"), Path("/Library/Fonts"),
                Path.home() / "Library/Fonts"]
    return [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"),
            Path.home() / ".local/share/fonts"]


def system_fonts(roots=None):
    fonts = {}
    for root in font_roots() if roots is None else roots:
        try:
            for item in root.rglob("*"):
                if item.suffix.lower() not in {".ttf", ".ttc", ".otf"}:
                    continue
                try:
                    if item.is_file():
                        path = str(item.resolve())
                        fonts[path] = {"name": item.name, "path": path}
                except OSError:
                    continue
        except OSError:
            continue
    # Keep useful Chinese defaults even when a machine has more than 300 fonts.
    priorities = {name: index for index, name in enumerate(PREFERRED_FONTS)}
    return sorted(fonts.values(), key=lambda font: (
        priorities.get(font["name"].lower(), len(priorities)),
        font["name"].lower(), font["path"],
    ))[:300]
