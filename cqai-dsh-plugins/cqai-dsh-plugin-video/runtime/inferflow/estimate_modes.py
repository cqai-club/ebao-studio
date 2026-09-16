#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path


CHARS_PER_SECOND = 4.5
FAST_MAX_SECONDS = 25
LONG_MAX_SECONDS = 110
MAX_PARALLEL_SEGMENTS = 5
AUTO_FAST_SECONDS = 30
DEFAULT_UNIT_CREDITS = 13
DEFAULT_MIN_BILLABLE_UNITS = 10
DEFAULT_UNIT_NAME = "秒"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def text_weight(text: str) -> int:
    compact = re.sub(r"\s+", "", text or "")
    cjk = len(re.findall(r"[\u3400-\u9fff]", compact))
    non_cjk = len(compact) - cjk
    return cjk + max(0, math.ceil(non_cjk / 4))


def read_script(args: argparse.Namespace) -> str:
    if args.script:
        return args.script
    if args.script_file:
        return Path(args.script_file).expanduser().read_text(encoding="utf-8")
    raise SystemExit("请提供 --script 或 --script-file。")


def fmt_seconds(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} 秒"
    minutes = seconds // 60
    remain = seconds % 60
    return f"{minutes} 分 {remain} 秒" if remain else f"{minutes} 分钟"


def wait_range_minutes(estimated_seconds: int, segment_count: int, *, long_mode: bool) -> tuple[int, int]:
    waves = max(1, math.ceil(segment_count / MAX_PARALLEL_SEGMENTS))
    duration_factor = max(0, math.ceil(estimated_seconds / 60))
    if long_mode:
        return 9 + waves * 6 + duration_factor, 18 + waves * 12 + duration_factor * 2
    return (
        4 + waves + duration_factor + max(0, segment_count // 3),
        8 + waves * 4 + duration_factor + math.ceil(segment_count / 2),
    )


def billing_estimate(
    estimated_seconds: int,
    *,
    unit_credits: int = DEFAULT_UNIT_CREDITS,
    min_billable_units: int = DEFAULT_MIN_BILLABLE_UNITS,
    unit_name: str = DEFAULT_UNIT_NAME,
) -> dict:
    billable_units = max(estimated_seconds, min_billable_units)
    return {
        "estimated_billable_units": billable_units,
        "estimated_billable_seconds": billable_units if unit_name == "秒" else None,
        "unit_credits": unit_credits,
        "unit_name": unit_name,
        "min_billable_units": min_billable_units,
        "estimated_credits": billable_units * unit_credits,
        "billing_rule": f"{unit_credits} 积分 / {unit_name}，最低按 {min_billable_units} {unit_name}计费",
        "settlement_note": "预计消耗仅用于生成前参考，最终会按实际输出时长结算。",
    }


def estimate_modes(
    script: str,
    *,
    unit_credits: int = DEFAULT_UNIT_CREDITS,
    min_billable_units: int = DEFAULT_MIN_BILLABLE_UNITS,
    unit_name: str = DEFAULT_UNIT_NAME,
) -> dict:
    estimated_seconds = max(1, math.ceil(text_weight(script) / CHARS_PER_SECOND))
    fast_segments = max(1, math.ceil(estimated_seconds / FAST_MAX_SECONDS))
    long_segments = max(1, math.ceil(estimated_seconds / LONG_MAX_SECONDS))
    fast_wait = wait_range_minutes(estimated_seconds, fast_segments, long_mode=False)
    long_wait = wait_range_minutes(estimated_seconds, long_segments, long_mode=True)
    billing = billing_estimate(
        estimated_seconds,
        unit_credits=unit_credits,
        min_billable_units=min_billable_units,
        unit_name=unit_name,
    )
    return {
        "estimated_seconds": estimated_seconds,
        "estimated_duration": fmt_seconds(estimated_seconds),
        **billing,
        "auto_mode": "fast_segments" if estimated_seconds <= AUTO_FAST_SECONDS else None,
        "fast_segments": fast_segments,
        "long_segments": long_segments,
        "fast_wait_minutes": list(fast_wait),
        "long_wait_minutes": list(long_wait),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="估算 InferFlow 数字人生成模式。")
    parser.add_argument("--script", default=None)
    parser.add_argument("--script-file", default=None)
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON。")
    parser.add_argument("--unit-credits", type=int, default=DEFAULT_UNIT_CREDITS)
    parser.add_argument("--min-billable-units", type=int, default=DEFAULT_MIN_BILLABLE_UNITS)
    parser.add_argument("--unit-name", default=DEFAULT_UNIT_NAME)
    args = parser.parse_args()

    script = read_script(args)
    result = estimate_modes(
        script,
        unit_credits=args.unit_credits,
        min_billable_units=args.min_billable_units,
        unit_name=args.unit_name,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"预计口播时长：约 {result['estimated_duration']}")
    print(f"预计计费时长：{result['estimated_billable_units']} {result['unit_name']}")
    print(f"公开收费标准：{result['billing_rule']}")
    print(f"预计消耗积分：{result['estimated_credits']} 积分")
    print(result["settlement_note"])
    print()
    if result["auto_mode"] == "fast_segments":
        print(
            "当前文案较短，已自动选择分段生成。"
            f"预计等待约 {result['fast_wait_minutes'][0]}-{result['fast_wait_minutes'][1]} 分钟。"
        )
        print()
        print("等待时长为粗略估算，实际会受队列、素材和远端生成速度影响。")
        print("生成模式：fast_segments")
        return 0

    print("请选择生成模式：")
    print(
        f"1. 分段生成：更快。系统会分段生成后自动拼接成完整视频，"
        f"预计等待约 {result['fast_wait_minutes'][0]}-{result['fast_wait_minutes'][1]} 分钟。"
    )
    print(
        f"2. 完整生成：更连续，适合更重视口型和画面连贯性的内容，"
        f"预计等待约 {result['long_wait_minutes'][0]}-{result['long_wait_minutes'][1]} 分钟。"
    )
    print()
    print("等待时长为粗略估算，实际会受队列、素材和远端生成速度影响。")
    print("请回复 1 或 2。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
