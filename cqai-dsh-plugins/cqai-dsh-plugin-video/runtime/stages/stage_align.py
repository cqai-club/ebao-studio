# ============================================================
# 阶段 4：口播语义校准（复用 align-engine）
# ============================================================
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-llm', action='store_true')
    ap.add_argument('--skip-covers', action='store_true')
    args = ap.parse_args()
    out = args.out
    state_file = os.path.join(out, 'pipeline_state.json')
    state = json.load(open(state_file, encoding='utf-8')) if os.path.isfile(state_file) else {}

    video = state.get('digitalhuman_video', '')
    pkg = state.get('motion_package', '')
    if not (video and os.path.isfile(video) and pkg and os.path.isfile(pkg)):
        print('[stage4] 缺少视频或组件包，跳过语义校准。')
        sys.exit(0)

    engine = os.path.join(BASE, 'align-engine', 'align_semantic.py')
    if not os.path.isfile(engine):
        print('[stage4] 缺少 align-engine/align_semantic.py，跳过。')
        sys.exit(0)
    tmp = os.path.join(out, 'align_tmp')
    r = subprocess.run(
        [sys.executable, engine, '--video', video, '--package', pkg, '--out', tmp],
        capture_output=True, text=True, timeout=900,
    )
    if r.returncode != 0 or not os.path.isfile(os.path.join(tmp, 'calibrated.tsx')):
        print('[stage4] 语义校准失败（%s），继续使用未校准组件包。' % (r.stderr[-200:] if r.stderr else 'engine error'))
        sys.exit(0)

    shutil.copyfile(os.path.join(tmp, 'calibrated.tsx'), pkg)
    report = os.path.join(tmp, 'report.json')
    if os.path.isfile(report):
        rep = json.load(open(report, encoding='utf-8'))
        with open(state_file, 'w', encoding='utf-8') as f:
            state['align_ok'] = True
            state['align_tier'] = rep.get('tier', 'energy')
            state['align_report'] = rep
            json.dump(state, f, ensure_ascii=False, indent=2)
        # 画中画切换点跟随校准结果
        for i in rep.get('instances', []):
            if i.get('componentId') == 'Leaderboard':
                state['pip_big_until'] = i['start']
            if i.get('componentId') == 'EndLockup':
                state['pip_small_until'] = i['start']
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        code = open(pkg, encoding='utf-8').read()
        for key in ['PIP_BIG_UNTIL', 'PIP_SMALL_UNTIL']:
            value = state.get(key.lower())
            if value is not None:
                code = re.sub(r'export const ' + key + r' = [\d.]+;', 'export const %s = %s;' % (key, value), code)
        open(pkg, 'w', encoding='utf-8').write(code)
        if state['align_tier'] == 'estimated':
            print('[stage4] 未识别到可用语音停顿，保留按文字长度估算的字幕时间。')
        print('[stage4] 语义校准完成（tier=%s），组件包已更新。' % state['align_tier'])
    sys.exit(0)


if __name__ == '__main__':
    main()
