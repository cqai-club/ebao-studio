# ============================================================
# 阶段 2：数字人生成（复用 inferflow-codex 技能的 run_skill.py）
# 需要：~/.inferflow/config.json 中有 API Key（或 INFERFLOW_API_KEY）
# ============================================================
import argparse
import glob
import json
import os
import subprocess
import sys
import time


def find_skill_script(name):
    for root in [os.path.expanduser('~/.agents/skills'), os.path.expanduser('~/.codex/skills'), os.path.expanduser('~/.dsh/skills')]:
        for cand in glob.glob(os.path.join(root, 'inferflow-codex', 'scripts', name)):
            if os.path.isfile(cand):
                return cand
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-llm', action='store_true')
    ap.add_argument('--skip-covers', action='store_true')
    args = ap.parse_args()
    out = args.out
    state_file = os.path.join(out, 'pipeline_state.json')
    state = json.load(open(state_file, encoding='utf-8')) if os.path.isfile(state_file) else {}
    cfg = state.get('config', {})

    if state.get('digitalhuman_ok'):
        print('[stage2] 数字人已生成，跳过。')
        sys.exit(0)

    avatar = cfg.get('avatar', '')
    voice = cfg.get('voice', '')
    script_txt = os.path.join(out, 'script.txt')
    if not (avatar and voice and os.path.isfile(script_txt)):
        print('[stage2] 缺少素材（--avatar / --voice / 阶段1文案），跳过数字人生成。')
        sys.exit(1)

    run_skill = find_skill_script('run_skill.py')
    if not run_skill:
        print('[stage2] 未找到 inferflow-codex 技能，请先安装（见 README）。')
        sys.exit(1)

    dh_out = os.path.join(out, 'digital_human')
    cmd = [
        sys.executable, run_skill,
        '--skill-code', 'digital_human_standard',
        '--input', 'avatar_image=' + avatar,
        '--input', 'voice_audio=' + voice,
        '--input', 'script_text=@' + script_txt,
        '--input', 'segmentation_mode=fast_segments',
        '--output-dir', dh_out,
    ]
    print('[stage2] 上传素材并创建数字人任务（预计 10-30 分钟）…')
    subprocess.run(cmd, check=True)

    videos = glob.glob(os.path.join(dh_out, 'video.mp4'))
    if not videos:
        print('[stage2] 数字人任务结束但未找到 video.mp4')
        sys.exit(1)

    with open(state_file, 'w', encoding='utf-8') as f:
        state['digitalhuman_ok'] = True
        state['digitalhuman_video'] = videos[0]
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage2] 数字人视频完成：%s' % videos[0])


if __name__ == '__main__':
    main()
