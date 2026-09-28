"""Synthesize a short Edge TTS voice sample for TalkCraft's voice picker."""

import asyncio
import re
import sys
from pathlib import Path

import edge_tts


VOICE_ID = re.compile(r"[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}-[A-Za-z0-9-]{1,70}Neural(?:-V[0-9]+)?")


async def main(output: Path, voice: str, text: str) -> None:
    if not VOICE_ID.fullmatch(voice) or not 1 <= len(text.strip()) <= 80:
        raise ValueError("Invalid Edge TTS preview request")
    await asyncio.wait_for(edge_tts.Communicate(text, voice).save(str(output)), timeout=35)
    if not output.is_file() or output.stat().st_size < 128:
        raise RuntimeError("Edge TTS returned no preview audio")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), sys.argv[2], sys.argv[3]))
