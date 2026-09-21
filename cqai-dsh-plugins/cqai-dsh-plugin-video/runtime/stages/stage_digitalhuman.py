"""Account auth and cloud requests are owned by the desktop Host, never Python."""
import argparse
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--skip-llm', action='store_true')
    parser.add_argument('--skip-covers', action='store_true')
    args = parser.parse_args()
    out = Path(args.out)
    state_file = out / 'pipeline_state.json'
    state = json.loads(state_file.read_text(encoding='utf-8'))
    if state.get('digitalhuman_ok'):
        return
    print('EJIANBAO_CLOUD_REQUEST', flush=True)
    response = json.loads(sys.stdin.readline() or '{}')
    if not response.get('ok'):
        raise RuntimeError(response.get('error', '请从 e剪宝入口启动制作'))
    video = out / 'digital_human' / 'video.mp4'
    if not video.is_file() or video.stat().st_size == 0:
        raise RuntimeError('未收到云端视频文件')
    state.update(digitalhuman_ok=True, digitalhuman_video=str(video))
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    print('数字人原片已通过产品账户服务下载。', flush=True)


if __name__ == '__main__':
    main()
