# ============================================================
# 阶段 3：由 plan.json 生成动效组件包 TSX
# 复用 templates/motion_components_core.tsx 中的标准组件实现，
# 只重写 CAPTIONS、MOTION_TIMELINE、时长常量与画中画切换点。
# ============================================================
import argparse
import base64
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(BASE, 'templates', 'motion_components_core.tsx')

# 画中画布局位置（1920×1080 画布）
RIGHT_PANEL = {'TitleReveal': (840, 110), 'KeywordBurst': (840, 420), 'EndLockup': (840, 170)}
CENTERED = {
    'Leaderboard': (420, 380),
    'Checklist': (420, 230),
    'StatGrid': (420, 220),
    'BulletStack': (420, 240),
    'KeywordBurst': (520, 400),
}
CENTERED_TYPES = {'Leaderboard', 'Checklist', 'StatGrid', 'BulletStack'}


def probe_duration(video):
    sys.path.insert(0, BASE)
    from runner import duration_of
    return duration_of(video)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-llm', action='store_true')
    ap.add_argument('--skip-covers', action='store_true')
    args = ap.parse_args()
    out = args.out
    state_file = os.path.join(out, 'pipeline_state.json')
    state = json.load(open(state_file, encoding='utf-8')) if os.path.isfile(state_file) else {}
    plan_file = os.path.join(out, 'plan.json')
    if not os.path.isfile(plan_file):
        print('[stage3] 缺少 plan.json（先运行阶段 script 或提供文案）')
        sys.exit(1)
    plan = json.load(open(plan_file, encoding='utf-8'))

    # 视频时长（未生成数字人时用文案估算）
    video = state.get('digitalhuman_video', '')
    duration = probe_duration(video) if video and os.path.isfile(video) else state.get('config', {}).get('duration', 180)
    fps = 25
    total_frames = round(duration * fps)

    # ---- 字幕时间（未提供则按字数比例分配）----
    caps = plan.get('captions', [])
    has_times = all('start' in c and 'end' in c for c in caps)
    if not has_times:
        total_chars = sum(len(re.sub(r'\s', '', c['text'])) for c in caps) or 1
        t = 0.0
        for c in caps:
            d = duration * len(re.sub(r'\s', '', c['text'])) / total_chars
            c['start'] = round(t, 2)
            c['end'] = round(t + d, 2)
            t += d
    if not caps:
        raise ValueError('文案没有可用字幕，请补充口播文案')
    # Scale the entire caption timeline to the actual media length.
    source_end = caps[-1].get('end', duration) or duration
    for caption in caps:
        caption['start'] = round(caption['start'] * duration / source_end, 3)
        caption['end'] = round(caption['end'] * duration / source_end, 3)
    caps[-1]['end'] = min(caps[-1]['end'], round(duration, 2))

    # ---- 时间轴实例 ----
    instances = plan.get('instances', [])
    big_phase_start = None  # 第一个居中展示组件的开始时间
    big_phase_end = None    # 最后一个居中展示组件的结束时间
    timeline = []
    for inst in instances:
        cid = inst.get('componentId')
        anchors = [int(a) for a in inst.get('anchor', [])]
        anchors = [a % len(caps) for a in anchors]
        if not anchors:
            continue
        st = min(caps[a]['start'] for a in anchors)
        en = max(caps[a]['end'] for a in anchors)
        props = dict(inst.get('props') or {})
        if cid == 'TitleReveal':
            props.update(plan.get('title', {}))
        if cid == 'EndLockup':
            props.update(title='感谢观看', subtitle='')

        centered = cid in CENTERED_TYPES
        if cid == 'TitleReveal':
            pos = RIGHT_PANEL['TitleReveal']
        elif cid == 'EndLockup':
            pos = RIGHT_PANEL['EndLockup']
        elif cid == 'KeywordBurst':
            # 开场（第一个居中组件之前）用右面板，否则居中
            pos = RIGHT_PANEL['KeywordBurst']
        elif centered:
            pos = CENTERED[cid]
            if big_phase_start is None:
                big_phase_start = st
            big_phase_end = max(big_phase_end or 0, en)
        else:
            pos = (420, 300)

        # 逐条弹出时间：多条目组件把 anchor 按顺序映射到条目
        item_text_keys = [k for k in props if re.match(r'^[isd][1-4]$', k)]
        item_times = []
        if len(anchors) > 1 and item_text_keys:
            for i, a in enumerate(anchors):
                item_times.append(round(caps[a]['start'] - st, 2))
            if item_text_keys:
                props['itemStarts'] = '|'.join('%.2f' % t for t in item_times)

        entry = {
            'componentId': cid,
            'startFrame': round(st * fps),
            'durationInFrames': max(3, round((en - st) * fps)),
            'position': {'x': pos[0], 'y': pos[1], 'scale': 1},
            'backgroundOpacity': 0.0 if cid in {'ChapterMarker', 'CaptionHighlight'} else 0.8,
            'props': props,
        }
        timeline.append(entry)

    # 常驻组件
    always = [
        {'componentId': 'ChapterMarker', 'startFrame': 0, 'durationInFrames': total_frames,
         'position': {'x': 0, 'y': 0, 'scale': 1}, 'backgroundOpacity': 0, 'props': {}},
        {'componentId': 'StatusMonitor', 'startFrame': 0, 'durationInFrames': total_frames,
         'position': {'x': 1680, 'y': 14, 'scale': 1}, 'backgroundOpacity': 0.72,
         'props': {'label': 'LIVE · ' + plan.get('title', {}).get('kicker', '教程'), 'dotColor': '#f87171'}},
        {'componentId': 'CaptionHighlight', 'startFrame': 0, 'durationInFrames': total_frames,
         'position': {'x': 0, 'y': 960, 'scale': 1}, 'backgroundOpacity': 0,
         'props': {'fontSize': 36, 'accentColor': '#67e8f9'}},
    ]
    timeline = always + timeline

    # 画中画切换点
    pip_big_until = big_phase_start if big_phase_start is not None else round(duration * 0.2, 2)
    end_lock = next((e for e in timeline if e['componentId'] == 'EndLockup'), None)
    pip_small_until = round((end_lock['startFrame'] / fps), 2) if end_lock else round(duration - 10, 2)

    # ---- 改写模板 ----
    code = open(TEMPLATE, encoding='utf-8').read()
    # 标题文案（TitleReveal 默认 props）
    title = plan.get('title', {})
    code = re.sub(
        r'export const FPS = [\d.]+;',
        'export const FPS = %d;' % fps, code, count=1)
    code = re.sub(
        r'export const DURATION_IN_FRAMES = [\d]+;',
        'export const DURATION_IN_FRAMES = %d;' % total_frames, code, count=1)
    # 画中画切换点（模板无该导出时插入）
    pip_lines = (
        '\nexport const PIP_BIG_UNTIL = %s;\n'
        'export const PIP_SMALL_UNTIL = %s;\n'
    ) % (pip_big_until, pip_small_until)
    if 'export const PIP_BIG_UNTIL' in code:
        code = re.sub(r'export const PIP_BIG_UNTIL = [\d.]+;', 'export const PIP_BIG_UNTIL = %s;' % pip_big_until, code, count=1)
        code = re.sub(r'export const PIP_SMALL_UNTIL = [\d.]+;', 'export const PIP_SMALL_UNTIL = %s;' % pip_small_until, code, count=1)
    else:
        code = re.sub(r'export const DURATION_IN_FRAMES = [\d]+;',
                      'export const DURATION_IN_FRAMES = %d;%s' % (total_frames, pip_lines),
                      code, count=1)
    code = code.replace('kicker: "BREAKING · AI TOOLS"', 'kicker: %s' % json.dumps(title.get('kicker', 'BREAKING'), ensure_ascii=False), 1)
    code = code.replace('line1: "DeepSeek Harness"', 'line1: %s' % json.dumps(title.get('line1', 'DeepSeek Harness'), ensure_ascii=False), 1)
    code = code.replace('line2: "保姆级教程"', 'line2: %s' % json.dumps(title.get('line2', ''), ensure_ascii=False), 1)
    code = code.replace('sub: "三分钟讲透：从安装到插件玩法"', 'sub: %s' % json.dumps(title.get('sub', ''), ensure_ascii=False), 1)

    # CAPTIONS 块
    cap_lines = ['const CAPTIONS: {text: string; start: number; end: number}[] = [']
    for c in caps:
        cap_lines.append('  {text: %s, start: %s, end: %s},' % (json.dumps(c['text'], ensure_ascii=False), c['start'], c['end']))
    cap_lines.append('];')
    code = re.sub(
        r'const CAPTIONS: \{text: string; start: number; end: number\}\[\] = \[.*?\n\];',
        lambda _: '\n'.join(cap_lines), code, count=1, flags=re.DOTALL)

    # MOTION_TIMELINE 块
    tl_lines = ['export const MOTION_TIMELINE = [']
    for e in timeline:
        tl_lines.append('  {')
        tl_lines.append('    componentId: "%s",' % e['componentId'])
        tl_lines.append('    startFrame: %d,' % e['startFrame'])
        tl_lines.append('    durationInFrames: %d,' % e['durationInFrames'])
        tl_lines.append('    position: {x: %d, y: %d, scale: 1},' % (e['position']['x'], e['position']['y']))
        tl_lines.append('    backgroundOpacity: %s,' % e['backgroundOpacity'])
        if e['props']:
            tl_lines.append('    props: {')
            for k, v in e['props'].items():
                if isinstance(v, str):
                    tl_lines.append('      %s: %s,' % (k, json.dumps(v, ensure_ascii=False)))
                else:
                    tl_lines.append('      %s: %s,' % (k, json.dumps(v)))
            tl_lines.append('    },')
        tl_lines.append('  },')
    tl_lines.append('];')
    code = re.sub(
        r'export const MOTION_TIMELINE = \[.*?\n\];',
        lambda _: '\n'.join(tl_lines), code, count=1, flags=re.DOTALL)

    # 二维码：若配置了 qr 图片则替换内置二维码
    qr_path = state.get('config', {}).get('qr', '')
    if qr_path and os.path.isfile(qr_path):
        uri = 'data:image/jpeg;base64,' + base64.b64encode(open(qr_path, 'rb').read()).decode()
        code = re.sub(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+', uri, code, count=1)

    os.makedirs(os.path.join(out, 'motion'), exist_ok=True)
    pkg_path = os.path.join(out, 'motion', 'MotionPackage.tsx')
    open(pkg_path, 'w', encoding='utf-8').write(code)
    with open(state_file, 'w', encoding='utf-8') as f:
        state['motionpack_ok'] = True
        state['motion_package'] = pkg_path
        state['pip_big_until'] = pip_big_until
        state['pip_small_until'] = pip_small_until
        state['duration'] = round(duration, 2)
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage3] 组件包完成：%d 条字幕，%d 个时间轴实例，画中画 %s/%ss' % (
        len(caps), len(timeline), pip_big_until, pip_small_until))


if __name__ == '__main__':
    main()
