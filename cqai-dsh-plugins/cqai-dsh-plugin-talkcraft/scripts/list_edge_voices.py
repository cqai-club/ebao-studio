"""Return the current Edge TTS voice catalog as compact UTF-8 JSON."""

import asyncio
import json

import edge_tts


async def main() -> None:
    entries = await edge_tts.list_voices()
    voices = [
        {"id": item["ShortName"], "locale": item["Locale"], "gender": item["Gender"]}
        for item in entries
    ]
    print(json.dumps(voices, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(main())
