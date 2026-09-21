# ============================================================
# 阶段 1：文案提取与优化 → script.txt + plan.json
# 支持 .docx / .md / .txt；默认用 DeepSeek 生成 3 分钟口播稿
# 和结构化动效计划（captions + instances），失败时降级为离线模板。
# ============================================================
import argparse
import json
import os
import re
import sys
import zipfile
import urllib.request


def extract_docx(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.DOTALL)
    lines = []
    for p in paras:
        texts = re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p)
        line = ''.join(texts).strip()
        if line:
            lines.append(line)
    return '\n'.join(lines)


def extract_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.docx':
        return extract_docx(path)
    with open(path, encoding='utf-8', errors='ignore') as f:
        return f.read()


def dashscope_key():
    if os.environ.get('DEEPSEEK_API_KEY'):
        return os.environ['DEEPSEEK_API_KEY']
    cred = os.path.join(os.environ.get('DSH_HOME', os.path.expanduser('~/.dsh')), '.credentials.yaml')
    if not os.path.isfile(cred):
        return None
    for line in open(cred, encoding='utf-8', errors='ignore'):
        if line.startswith('DEEPSEEK_API_KEY'):
            return line.split(':', 1)[1].strip().strip('"').strip("'")
    return None


def call_deepseek(prompt, json_mode=True):
    key = dashscope_key()
    if not key:
        return None
    body = {
        'model': 'deepseek-chat',
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.7,
        'max_tokens': 4000,
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    req = urllib.request.Request(
        'https://api.deepseek.com/chat/completions',
        data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode('utf-8'))
    return data['choices'][0]['message']['content']


def split_sentences(text):
    out = []
    for seg in re.split(r'(?<=[。！？])', re.sub(r'\s+', ' ', text)):
        seg = seg.strip()
        if seg:
            out.append(seg)
    return out


def offline_plan(raw, title, duration):
    """无 LLM 时的降级方案：逐句字幕 + 最小动效实例。"""
    keep = split_sentences(raw)
    if not keep:
        raise ValueError('文案为空')
    total = sum(len(s) for s in keep) or 1
    captions = []
    t = 0.0
    for s in keep:
        d = duration * len(s) / total
        captions.append({'text': s, 'start': round(t, 2), 'end': round(t + d, 2)})
        t += d
    title_line = (title or '').strip()
    if not title_line:
        first = keep[0] if keep else ''
        title_line = first[:14] or '口播短视频'
    plan = {
        'title': {'line1': title_line[:14], 'line2': '', 'kicker': '保姆级教程', 'sub': ''},
        'captions': captions,
        'instances': [
            {'componentId': 'TitleReveal', 'anchor': [0], 'props': {}},
            {'componentId': 'KeywordBurst', 'anchor': [1] if len(captions) > 1 else [0],
             'props': {'word': (captions[1]['text'][:10] if len(captions) > 1 else title_line), 'word2': '', 'sub': ''}},
            {'componentId': 'EndLockup', 'anchor': [len(captions) - 1], 'props': {}},
        ],
        'source': 'offline-template',
    }
    return plan, '\n\n'.join(keep)


LLM_PROMPT = """你是一名短视频口播编导。下面是一篇原始文案。请完成两件事，并只输出一个 JSON 对象（不要输出任何解释）：

{{
  "script": "优化后的口播稿：口语化、约{minutes}分钟（约{chars}字），保留核心信息，分自然段",
  "plan": {{
    "title": {{"line1": "主标题第一行（6-12字，含数字或热点词）", "line2": "第二行（可选，可为空字符串）", "kicker": "角标（如：保姆级教程/深度拆解）", "sub": "副标题一句话（可选）"}},
    "captions": [{{"text": "逐句字幕（与 script 完全一致的句子）"}}],
    "instances": [
      {{"componentId": "TitleReveal", "anchor": [0], "props": {{}}}},
      {{"componentId": "KeywordBurst", "anchor": [1,2,3], "props": {{"word": "关键词", "word2": "次级词", "sub": "说明"}}}},
      {{"componentId": "Leaderboard", "anchor": [4], "props": {{"kicker": "LAB TEST", "title": "数据卡标题", "labelA": "对比前", "valueA": 30, "labelB": "对比后", "valueB": 5, "unit": "名", "gainText": "排名提升 25 位"}}}},
      {{"componentId": "Checklist", "anchor": [5,6,7,8], "props": {{"kicker": "清单角标", "i1": "条目一", "s1": "说明一", "i2": "条目二", "s2": "说明二", "i3": "条目三", "s3": "说明三", "i4": "条目四", "s4": "说明四"}}}},
      {{"componentId": "StatGrid", "anchor": [9,10,11,12], "props": {{"kicker": "矩阵角标", "i1": "卡片一", "d1": "描述一", "i2": "卡片二", "d2": "描述二", "i3": "卡片三", "d3": "描述三", "i4": "卡片四", "d4": "描述四"}}}},
      {{"componentId": "BulletStack", "anchor": [13,14,15], "props": {{"kicker": "要点角标", "i1": "要点一", "s1": "说明一", "i2": "要点二", "s2": "说明二", "i3": "要点三", "s3": "说明三"}}}},
      {{"componentId": "EndLockup", "anchor": [-1], "props": {{}}}}
    ]
  }}
}}

规则：
1. captions 必须与 script 逐句一致（按。！？断句）；
2. instances 的 anchor 是 caption 下标（-1 表示最后一句），每个组件只覆盖与其台词相关的句子；
3. 组件顺序必须按台词先后排列，且互相不重叠（KeywordBurst 与 TitleReveal 可相邻衔接）；
4. 不要编造组件，只用上面列出的 7 种；不合适的组件直接省略；
5. script 不要超过约 {chars} 字。

原始文案：
{raw}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-llm', action='store_true')
    args = ap.parse_args()
    out = args.out
    state_file = os.path.join(out, 'pipeline_state.json')
    state = json.load(open(state_file, encoding='utf-8')) if os.path.isfile(state_file) else {}
    cfg = state.get('config', {})

    script_src = cfg.get('script_src', '')
    if not script_src or not os.path.isfile(script_src):
        print('[stage1] 未提供 --script，跳过文案阶段（沿用已有 plan.json）')
        if os.path.isfile(os.path.join(out, 'plan.json')):
            sys.exit(0)
        sys.exit(1)

    raw = extract_text(script_src)
    duration = cfg.get('duration', 180)
    chars = int(duration * 5.2)
    minutes = round(duration / 60)

    script_text = None
    plan = None
    if not args.skip_llm:
        try:
            prompt = LLM_PROMPT.format(minutes=minutes, chars=chars, raw=raw[:6000])
            content = call_deepseek(prompt)
            data = json.loads(content)
            script_text = data.get('script')
            plan = data.get('plan')
            plan['source'] = 'deepseek'
        except Exception as exc:
            print('[stage1] DeepSeek 优化失败，使用离线模板：%s' % exc)
    if not script_text or not plan or not plan.get('captions'):
        plan, script_text = offline_plan(raw, cfg.get('title', ''), duration)

    with open(os.path.join(out, 'script.txt'), 'w', encoding='utf-8') as f:
        f.write(script_text)
    with open(os.path.join(out, 'plan.json'), 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    with open(state_file, 'w', encoding='utf-8') as f:
        state['script_ok'] = True
        state['script_text'] = script_text
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage1] 文案完成：%d 字，%d 句字幕，%d 个动效实例' % (
        len(script_text), len(plan['captions']), len(plan['instances'])))


if __name__ == '__main__':
    main()
