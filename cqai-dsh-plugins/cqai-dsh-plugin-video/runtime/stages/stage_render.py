# ============================================================
# 阶段 5：Remotion 本地渲染（render-studio 模板）
# ============================================================
import argparse
import json
import os
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDIO = os.path.join(BASE, 'render-studio')


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
        print('[stage5] 缺少视频或组件包，跳过渲染。')
        sys.exit(0)

    # 同步素材到渲染工程
    os.makedirs(os.path.join(STUDIO, 'public'), exist_ok=True)
    os.makedirs(os.path.join(STUDIO, 'src', 'motion'), exist_ok=True)
    shutil.copyfile(video, os.path.join(STUDIO, 'public', 'video.mp4'))
    shutil.copyfile(pkg, os.path.join(STUDIO, 'src', 'motion', 'MotionPackage.tsx'))

    # 安装依赖（首次）
    if not os.path.isdir(os.path.join(STUDIO, 'node_modules')):
        print('[stage5] 首次渲染：安装 Remotion 依赖（约 1 分钟）…')
        subprocess.run(['npm', 'install', '--no-audit', '--no-fund'], cwd=STUDIO, check=True)

    # 类型检查（可选，失败不阻断）
    subprocess.run(['npx', 'tsc', '--noEmit'], cwd=STUDIO, timeout=300)

    # 渲染
    print('[stage5] Remotion 渲染中（视视频时长 5-15 分钟）…')
    remotion = os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming', 'npm', 'remotion.cmd')
    cmd = [remotion] if os.path.isfile(remotion) else ['npx', 'remotion']
    subprocess.run(
        cmd + ['render', 'src/index.ts', 'Main', 'out/final.mp4', '--concurrency', '8'],
        cwd=STUDIO, check=True, timeout=3600,
    )

    final = os.path.join(STUDIO, 'out', 'final.mp4')
    target = os.path.join(out, 'final_video.mp4')
    shutil.copyfile(final, target)
    with open(state_file, 'w', encoding='utf-8') as f:
        state['render_ok'] = True
        state['final_video'] = target
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage5] 成片完成：%s' % target)


if __name__ == '__main__':
    main()
