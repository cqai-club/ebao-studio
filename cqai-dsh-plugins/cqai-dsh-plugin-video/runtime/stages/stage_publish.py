# ============================================================
# 阶段 7：发布准备（抖音/小红书）
# - DeepSeek 生成标题/简介/话题标签
# - 通义万相生成 3:4 / 4:3 / 16:9 网感封面（含标题排版）
# - 写出 publish_package_handoff.json（可直接交给
#   publish-video-multiplatform 技能完成平台上传）
# ============================================================
import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, 'stages'))
from stage_script import call_deepseek, dashscope_key  # noqa: E402


def wanx_image(key, prompt, size, out_path, negative='文字,字母,数字,水印,logo'):
    body = {
        'model': 'wan2.2-t2i-flash',
        'input': {'prompt': prompt, 'negative_prompt': negative},
        'parameters': {'size': size, 'n': 1},
    }
    req = urllib.request.Request(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
        data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': 'Bearer ' + key,
            'X-DashScope-Async': 'enable',
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        task_id = json.loads(r.read().decode('utf-8'))['output']['task_id']
    for _ in range(80):
        time.sleep(3)
        req2 = urllib.request.Request(
            'https://dashscope.aliyuncs.com/api/v1/tasks/' + task_id,
            headers={'Authorization': 'Bearer ' + key},
        )
        with urllib.request.urlopen(req2, timeout=60) as r2:
            st = json.loads(r2.read().decode('utf-8'))['output']
        if st.get('task_status') == 'SUCCEEDED':
            urllib.request.urlretrieve(st['results'][0]['url'], out_path)
            return out_path
        if st.get('task_status') == 'FAILED':
            return None
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
    plan_file = os.path.join(out, 'plan.json')
    plan = json.load(open(plan_file, encoding='utf-8')) if os.path.isfile(plan_file) else {}
    title = plan.get('title', {})
    title_text = (title.get('line1', '') + ' ' + title.get('line2', '')).strip() or cfg.get('title', 'AI 口播短视频')

    # ---- 标题/简介/话题 ----
    meta = {'title': title_text, 'description': '', 'tags': [], 'source': 'offline'}
    if not args.skip_llm:
        try:
            prompt = (
                '为这条短视频生成发布元数据，只输出 JSON：'
                '{"title": "抖音/小红书标题（≤30字，带网感钩子）",'
                '"description": "简介（≤100字，含 1-2 个 emoji 和行动号召）",'
                '"tags": ["话题1", "话题2", "话题3", "话题4", "话题5"]}。\n'
                '视频主题：%s\n口播稿开头：%s'
            ) % (title_text, (state.get('script_text') or '')[:200])
            data = json.loads(call_deepseek(prompt))
            meta = {'title': data['title'], 'description': data['description'],
                    'tags': data.get('tags', [])[:8], 'source': 'deepseek'}
        except Exception as exc:
            print('[stage7] 元数据生成失败，使用离线默认值：%s' % exc)

    # ---- 封面 ----
    covers = {}
    if not args.skip_covers:
        key = os.environ.get('DASHSCOPE_API_KEY')
        try:
            key = key or next(
                l.split(':', 1)[1].strip().strip('"').strip("'")
                for l in open(os.path.join(os.environ.get('DSH_HOME', os.path.expanduser('~/.dsh')), '.credentials.yaml'), encoding='utf-8')
                if l.startswith('DASHSCOPE_API_KEY')
            )
        except Exception:
            pass
        if key:
            char = '一个半写实卡通风格的3D动画男性角色，黑色短发，深蓝色衬衫，表情自信微笑'
            scene = '深蓝色科技空间，漂浮的全息UI面板和发光数据流，青色霓虹主光'
            base_p = ('主体：%s。姿势：双手张开展示漂浮的全息科技卡片。背景：%s。'
                      '不要出现任何文字水印logo。') % (char, scene)
            jobs = [
                ('cover_3x4.png', '768*1024', base_p + '竖版3:4构图，画面上方留出干净深色区域用于放标题。'),
                ('cover_4x3.png', '1024*768', base_p + '横版4:3构图，人物位于右侧，左侧留出干净深色区域。'),
                ('cover_16x9.png', '1280*720', base_p + '宽屏16:9构图，人物位于右侧三分之一，左侧大面积干净深色背景。'),
            ]
            for name, size, prompt in jobs:
                path = os.path.join(out, name)
                got = wanx_image(key, prompt, size, path)
                covers[name] = path if got else None
                print('[stage7] 封面 %s：%s' % (name, 'ok' if got else '失败'))
        else:
            print('[stage7] 未找到 DASHSCOPE_API_KEY，跳过封面生成。')

    # ---- 发布包 ----
    handoff = {
        'video': state.get('final_video', ''),
        'title': meta['title'],
        'description': meta['description'],
        'tags': meta['tags'],
        'covers': {k: v for k, v in covers.items() if v},
        'platforms': ['douyin', 'xiaohongshu'],
        'ai_generated_disclosure': '本视频包含 AI 生成内容',
        'note': '交给 publish-video-multiplatform 技能完成账号登录与发布；也可在预览台审阅后手动上传。',
    }
    handoff_path = os.path.join(out, 'publish_package_handoff.json')
    with open(handoff_path, 'w', encoding='utf-8') as f:
        json.dump(handoff, f, ensure_ascii=False, indent=2)
    with open(state_file, 'w', encoding='utf-8') as f:
        state['publish_ok'] = True
        state['publish_meta'] = meta
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage7] 发布包完成：%s' % handoff_path)
    print('  标题：%s' % meta['title'])
    print('  话题：%s' % '、'.join(meta['tags']))


if __name__ == '__main__':
    main()
