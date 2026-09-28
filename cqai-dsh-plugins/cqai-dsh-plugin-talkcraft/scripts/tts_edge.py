"""Generate one TalkCraft narration with the plugin's own Edge TTS runtime.

Usage: python tts_edge.py script.json output.mp3 voice-id
The caller keeps output.mp3 pending until it verifies and commits the audio.
"""

import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts


VOICE_ID = re.compile(r"[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}-[A-Za-z0-9-]{1,70}Neural(?:-V[0-9]+)?")


async def main(script_path: Path, output_path: Path, voice: str) -> None:
    if not VOICE_ID.fullmatch(voice):
        raise ValueError("Unsupported Edge TTS voice")
    sentences = json.loads(script_path.read_text(encoding="utf-8"))["sentences"]
    if not isinstance(sentences, list) or not sentences or not all(isinstance(item, str) for item in sentences):
        raise ValueError("Invalid TalkCraft script")
    text = "\n".join(item.strip() for item in sentences if item.strip())
    if not text:
        raise ValueError("TalkCraft script is empty")
    await asyncio.wait_for(edge_tts.Communicate(text, voice).save(str(output_path)), timeout=240)
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("Edge TTS returned no audio")
    print(f"Edge TTS audio ready: {output_path.stat().st_size} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]))
