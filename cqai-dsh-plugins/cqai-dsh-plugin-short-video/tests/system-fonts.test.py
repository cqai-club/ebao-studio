"""Font discovery regression tests, without engine or network dependencies."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from system_fonts import font_roots, system_fonts


class SystemFontsTest(unittest.TestCase):
    def test_platform_directories(self):
        with patch("sys.platform", "darwin"):
            self.assertEqual(font_roots(), [Path("/System/Library/Fonts"),
                             Path("/Library/Fonts"), Path.home() / "Library/Fonts"])
        with patch("sys.platform", "win32"), patch.dict("os.environ", {"WINDIR": "C:/Windows"}):
            self.assertEqual(font_roots(), [Path("C:/Windows/Fonts")])
        with patch("sys.platform", "linux"):
            self.assertIn(Path("/usr/share/fonts"), font_roots())

    def test_nested_fonts_are_unique_and_chinese_default_survives_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            supplemental = root / "Supplemental"
            supplemental.mkdir()
            for index in range(310):
                (supplemental / f"A-{index:03d}.ttf").write_bytes(b"fixture")
            chinese = root / "STHeiti Medium.ttc"
            chinese.write_bytes(b"fixture")
            (supplemental / "Arial.ttf").write_bytes(b"fixture")
            (root / "ignore.txt").write_bytes(b"fixture")
            fonts = system_fonts([root, supplemental, root / "missing"])
            self.assertEqual(len(fonts), 300)
            self.assertEqual(len({font["path"] for font in fonts}), 300)
            self.assertEqual(fonts[0]["path"], str(chinese.resolve()))
            self.assertFalse(any(font["name"] == "ignore.txt" for font in fonts))

    def test_empty_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(system_fonts([Path(temporary)]), [])


if __name__ == "__main__":
    unittest.main()
