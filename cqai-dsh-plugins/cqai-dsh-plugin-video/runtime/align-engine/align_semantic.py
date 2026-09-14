# -*- coding: utf-8 -*-
"""语义校准引擎：把动效组件包的时间轴重新对齐到视频真实口播音频。

两层策略：
  tier=semantic  用 vosk 离线语音识别（词级时间戳，若模型可用）
  tier=energy    用能量包络检测语音段 + 动态规划对齐（无需模型，句子级）

用法:
  python align_semantic.py --video <mp4> --package <tsx> --out <dir>
输出 <out>/calibrated.tsx 和 <out>/report.json
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

# ---------------------------------------------------------------- utilities
def norm(text: str) -> str:
    """Normalize for matching: drop whitespace/punctuation, lowercase latin."""
    return re.sub(r'[\s，。！？、；：""''（）《》【】…—·,\.\!\?;:()<>\[\]"\'\-]', '', text).lower()


def find_ffmpeg():
    for cand in [
        os.environ.get('FFMPEG_PATH'),
    ]:
        if cand and os.path.isfile(cand):
            return cand
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    import shutil
    p = shutil.which('ffmpeg')
    if p:
        return p
    return None


def extract_wav(video: str, out_wav: str) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError('找不到 ffmpeg，无法提取音频')
    subprocess.run(
        [ffmpeg, '-y', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', out_wav],
        check=True,
    )


def read_wav(path):
    with wave.open(path, 'rb') as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return sr, data


# ---------------------------------------------------------------- tier 1: sherpa-onnx (SenseVoice)
def transcribe_sherpa(wav_path):
    """Return words [{word, start, end}] from SenseVoice, or None."""
    model_dir = os.path.join(os.path.dirname(__file__), 'models', 'sensevoice')
    model_file = os.path.join(model_dir, 'model.int8.onnx')
    tokens_file = os.path.join(model_dir, 'tokens.txt')
    if not (os.path.isfile(model_file) and os.path.isfile(tokens_file)):
        return None
    try:
        import sherpa_onnx
    except Exception:
        return None
    try:
        rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_file,
            tokens=tokens_file,
            num_threads=6,
            use_itn=True,
            debug=False,
        )
        s = rec.create_stream()
        with wave.open(wav_path, 'rb') as wf:
            sr = wf.getframerate()
            while True:
                chunk = wf.readframes(int(sr * 0.5))
                if not chunk:
                    break
                samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
                s.accept_waveform(sr, samples)
        rec.decode_stream(s)
        res = s.result
        tokens = list(getattr(res, 'tokens', []) or [])
        stamps = list(getattr(res, 'timestamps', []) or [])
        if len(tokens) < 10 or len(tokens) != len(stamps):
            return None
        words = []
        non_empty = [(i, t, st) for i, (t, st) in enumerate(zip(tokens, stamps)) if norm(t)]
        for idx, (i, tok, st) in enumerate(non_empty):
            en = non_empty[idx + 1][2] if idx + 1 < len(non_empty) else st + 0.35
            words.append({'word': tok, 'start': round(st, 3), 'end': round(max(en, st + 0.05), 3)})
        if len(words) < 10:
            return None
        return words
    except Exception:
        return None

def vosk_model_dir():
    for cand in [
        os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-small-cn-0.22'),
        os.path.join(os.path.dirname(__file__), 'vosk-model-small-cn-0.22'),
    ]:
        if os.path.isdir(cand):
            return cand
    return None


def transcribe_vosk(wav_path):
    model_dir = vosk_model_dir()
    if not model_dir:
        return None
    try:
        import vosk
    except Exception:
        return None
    try:
        model = vosk.Model(model_dir)
        rec = vosk.KaldiRecognizer(model, 16000)
        rec.SetWords(True)
        words = []
        with wave.open(wav_path, 'rb') as wf:
            while True:
                chunk = wf.readframes(4000)
                if not chunk:
                    break
                if rec.AcceptWaveform(chunk):
                    res = json.loads(rec.Result())
                    for w in res.get('result', []):
                        words.append({'word': w['word'], 'start': float(w['start']), 'end': float(w['end'])})
        res = json.loads(rec.FinalResult())
        for w in res.get('result', []):
            words.append({'word': w['word'], 'start': float(w['start']), 'end': float(w['end'])})
        if len(words) < 10:
            return None
        return words
    except Exception:
        return None


# ---------------------------------------------------------------- tier 2: energy DP
def energy_bursts(sr, data):
    frame_len = int(sr * 0.01)
    n = len(data) // frame_len
    rms = np.sqrt(np.mean(data[: n * frame_len].reshape(n, frame_len) ** 2, axis=1))
    rms_db = 20 * np.log10(rms + 1e-8)
    noise = float(np.percentile(rms_db, 10))
    thresh = max(noise + 14, -42)
    active = rms_db > thresh
    min_gap = int(0.16 / 0.01)
    min_burst = int(0.09 / 0.01)
    bursts = []
    i = 0
    while i < n:
        if not active[i]:
            i += 1
            continue
        s = i
        while i < n and active[i]:
            i += 1
        bursts.append([s, i])
    merged = []
    for s, e in bursts:
        if merged and (s - merged[-1][1]) <= min_gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s * 0.01, e * 0.01) for s, e in merged if (e - s) >= min_burst]


def align_energy(sentences, burst_times):
    total_chars = sum(max(1, len(norm(t))) for t in sentences) or 1
    speech_total = sum(e - s for s, e in burst_times)
    expected = [len(norm(t)) / total_chars * speech_total for t in sentences]
    durs = [e - s for s, e in burst_times]
    pref = [0.0]
    for d in durs:
        pref.append(pref[-1] + d)

    def span(k, j):
        return pref[j + 1] - pref[k]

    n_s, n_b = len(sentences), len(durs)
    if n_s == 0 or n_b == 0:
        return []
    if n_s > n_b:
        # Preserve caption identity; fewer pauses must not merge caption indexes.
        start, finish = burst_times[0][0], burst_times[-1][1]
        result = []
        for text in sentences:
            end = start + (finish - burst_times[0][0]) * max(1, len(norm(text))) / total_chars
            result.append({'text': text, 'start': round(start, 3), 'end': round(end, 3)})
            start = end
        return result

    INF = 1e18
    f = [[INF] * n_b for _ in range(n_s)]
    back = [[-1] * n_b for _ in range(n_s)]
    for j in range(n_b):
        f[0][j] = (span(0, j) - expected[0]) ** 2
    for i in range(1, n_s):
        for j in range(i, n_b):
            best, best_k = INF, -1
            for k in range(i, j + 1):
                prev = f[i - 1][k - 1]
                if prev >= INF:
                    continue
                cost = prev + (span(k, j) - expected[i]) ** 2
                if cost < best:
                    best, best_k = cost, k
            f[i][j] = best
            back[i][j] = best_k
    assign = [0] * n_s
    j = n_b - 1
    for i in range(n_s - 1, -1, -1):
        k = back[i][j] if i > 0 else 0
        assign[i] = (k, j)
        j = k - 1
    if j >= 0:
        assign[0] = (0, assign[0][1])
    bounds = []
    for i, (k, jj) in enumerate(assign):
        if i == 0:
            start = burst_times[k][0]
        else:
            prev_end = burst_times[assign[i - 1][1]][1]
            start = (prev_end + burst_times[k][0]) / 2
        bounds.append(start)
    bounds.append(burst_times[-1][1])
    for i in range(1, len(bounds)):
        if bounds[i] <= bounds[i - 1]:
            bounds[i] = bounds[i - 1] + 0.05
    out = []
    for i, t in enumerate(sentences):
        out.append({'text': t, 'start': round(bounds[i], 2), 'end': round(bounds[i + 1], 2)})
    return out


# ---------------------------------------------------------------- sentence timing
def _match_span(key, transcript, words, pos):
    """Find char span of key in transcript (exact or fuzzy). Returns (start_char, end_char)."""
    idx = transcript.find(key, pos)
    if idx >= 0:
        return idx, idx + len(key)
    import difflib
    win = len(key)
    best = None
    step = max(1, win // 30)
    for i in range(pos, max(pos + 1, len(transcript) - win + 1), step):
        seg = transcript[i: i + win + 6]
        if abs(len(seg) - win) > 8:
            continue
        ratio = difflib.SequenceMatcher(None, key, seg).ratio()
        if best is None or ratio > best[0]:
            best = (ratio, i)
    if best and best[0] >= 0.5:
        return best[1], best[1] + win
    return None


def _char_span_to_words(key, start_char, end_char, words):
    """Map transcript char span to token indices (skip empty tokens)."""
    acc = 0
    spans = []
    for wi, w in enumerate(words):
        wlen = len(norm(w['word']))
        if wlen == 0:
            continue
        spans.append((wi, acc, acc + wlen))
        acc += wlen
    first = last = None
    for wi, s, e in spans:
        if s <= start_char < e and first is None:
            first = wi
        if s <= end_char - 1 < e:
            last = wi
    return first, last


# module-level cache for item-level matching (set inside time_sentences)
_WORDS = []
_TRANSCRIPT = ''


def time_sentences(sentence_texts, wav_path, sr, data):
    global _WORDS, _TRANSCRIPT
    words = transcribe_sherpa(wav_path)
    if not words:
        words = transcribe_vosk(wav_path)
    if words:
        _WORDS = words
        _TRANSCRIPT = ''.join(norm(w['word']) for w in words)
        out = []
        pos = 0
        ok = 0
        for t in sentence_texts:
            key = norm(t)
            span = _match_span(key, _TRANSCRIPT, _WORDS, pos)
            if span:
                wi_start, wi_end = _char_span_to_words(key, span[0], span[1], words)
                if wi_start is not None and wi_end is not None and wi_end >= wi_start:
                    out.append({
                        'text': t,
                        'start': round(words[wi_start]['start'], 2),
                        'end': round(min(words[wi_end]['end'], words[-1]['end']), 2),
                    })
                    pos = span[1]
                    ok += 1
                    continue
            out.append({'text': t, 'start': None, 'end': None})
        if ok >= max(3, len(sentence_texts) * 0.6):
            for i, s in enumerate(out):
                if s['start'] is None:
                    prev = next((x for x in reversed(out[:i]) if x['start'] is not None), None)
                    nxt = next((x for x in out[i + 1:] if x['start'] is not None), None)
                    if prev and nxt:
                        s['start'] = round((prev['end'] + nxt['start']) / 2, 2)
                        s['end'] = s['start']
                    elif prev:
                        s['start'] = s['end'] = round(prev['end'], 2)
                    elif nxt:
                        s['start'] = s['end'] = round(nxt['start'], 2)
            for i, s in enumerate(out):
                if s['end'] <= s['start']:
                    nxt = next((x for x in out[i + 1:] if x['start'] is not None), None)
                    s['end'] = round(nxt['start'] if nxt else s['start'] + 0.5, 2)
            return out, 'semantic'
    bursts = energy_bursts(sr, data)
    return align_energy(sentence_texts, bursts), 'energy'


# ---------------------------------------------------------------- package parse/rewrite
CAP_RE = re.compile(
    r'const CAPTIONS: \{text: string; start: number; end: number\}\[\] = \[.*?\n\];',
    re.DOTALL,
)


def parse_captions(code: str):
    m = CAP_RE.search(code)
    if not m:
        return []
    body = m.group(0)
    out = []
    for item in re.findall(r'\{text: (.*?), start: ([\d.]+), end: ([\d.]+)\}', body):
        text = json.loads(item[0])
        out.append({'text': text, 'start': float(item[1]), 'end': float(item[2])})
    return out


def parse_timeline(code: str):
    m = re.search(r'export const MOTION_TIMELINE = \[(.*?)\n\];', code, re.DOTALL)
    if not m:
        return []
    body = m.group(1)
    out = []
    for block in re.findall(r'\{\n(.*?)\n  \}', body, re.DOTALL):
        cid = re.search(r'componentId: "([^"]+)"', block)
        sf = re.search(r'startFrame: (\d+)', block)
        dur = re.search(r'durationInFrames: (\d+)', block)
        item_starts = re.search(r'itemStarts: "([^"]+)"', block)
        texts = {}
        for k in ('i1', 'i2', 'i3', 'i4'):
            t = re.search(r'%s: "([^"]*)"' % k, block)
            if t:
                texts[k] = t.group(1)
        out.append({
            'componentId': cid.group(1) if cid else '',
            'startFrame': int(sf.group(1)) if sf else 0,
            'durationInFrames': int(dur.group(1)) if dur else 0,
            'itemStarts': item_starts.group(1) if item_starts else None,
            'texts': texts,
            'block': block,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--package', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    wav = os.path.join(args.out, 'align_audio.wav')
    extract_wav(args.video, wav)
    sr, data = read_wav(wav)

    code = open(args.package, encoding='utf-8').read()
    old_caps = parse_captions(code)
    old_insts = parse_timeline(code)
    if not old_caps:
        raise RuntimeError('组件包里没有找到 CAPTIONS 字幕时间轴')

    new_caps, tier = time_sentences([c['text'] for c in old_caps], wav, sr, data)
    if not new_caps:
        new_caps, tier = old_caps, 'estimated'

    # ---------- rewrite CAPTIONS ----------
    lines = ['const CAPTIONS: {text: string; start: number; end: number}[] = [']
    for c in new_caps:
        lines.append('  {text: %s, start: %s, end: %s},' % (json.dumps(c['text'], ensure_ascii=False), c['start'], c['end']))
    lines.append('];')
    code = CAP_RE.sub(lambda _: '\n'.join(lines), code, count=1)

    # ---------- re-time instances via caption overlap ----------
    old_by_idx = {i: c for i, c in enumerate(old_caps)}
    new_by_idx = {i: c for i, c in enumerate(new_caps)}
    report_insts = []
    for inst in old_insts:
        old_s, old_e = inst['startFrame'] / 25.0, (inst['startFrame'] + inst['durationInFrames']) / 25.0
        # captions with meaningful (>80ms) intersection with the instance range
        overlap = []
        for i, c in old_by_idx.items():
            lo = max(old_s, c['start'])
            hi = min(old_e, c['end'])
            if hi - lo > 0.08:
                overlap.append(i)
        if not overlap:
            report_insts.append({
                'componentId': inst['componentId'],
                'start': round(old_s, 2), 'end': round(old_e, 2),
                'items': [],
            })
            continue
        ns = min(new_by_idx[i]['start'] for i in overlap)
        ne = max(new_by_idx[i]['end'] for i in overlap)
        ne = min(ne, max(c['end'] for c in new_caps))  # clamp to composition duration
        # item times: semantic match first, fuzzy second, proportional fallback
        items = []
        item_times = []
        old_starts = [float(x) for x in inst['itemStarts'].split('|')] if inst['itemStarts'] else []
        old_dur = max(0.001, old_e - old_s)
        for idx, (key, txt) in enumerate(inst['texts'].items()):
            if not txt:
                continue
            k = norm(txt)
            hit = None
            if k:
                for ci in overlap:
                    ck = norm(new_by_idx[ci]['text'])
                    if k in ck:
                        frac = ck.find(k) / max(1, len(ck))
                        hit = new_by_idx[ci]['start'] + (new_by_idx[ci]['end'] - new_by_idx[ci]['start']) * frac
                        break
                if hit is None and _WORDS:
                    span = _match_span(k, _TRANSCRIPT, _WORDS, 0)
                    if span:
                        ws, we = _char_span_to_words(k, span[0], span[1], _WORDS)
                        if ws is not None and we is not None:
                            cand = _WORDS[ws]['start']
                            # only accept hits inside the instance's own time window
                            if ns - 0.6 <= cand <= ne + 0.6:
                                hit = cand
            if hit is None and old_starts and idx < len(old_starts):
                frac = old_starts[idx] / old_dur
                hit = ns + frac * (ne - ns)
            if hit is None:
                continue
            items.append({'text': txt, 'time': round(hit, 2)})
            item_times.append(max(0.0, round(hit - ns, 2)))
        # patch block: startFrame/durationInFrames/itemStarts
        nb = inst['block']
        nb = re.sub(r'startFrame: \d+', 'startFrame: %d' % round(ns * 25), nb)
        nb = re.sub(r'durationInFrames: \d+', 'durationInFrames: %d' % max(3, round((ne - ns) * 25)), nb)
        if item_times:
            joined = '|'.join('%.2f' % t for t in item_times)
            if inst['itemStarts'] is not None:
                nb = re.sub(r'itemStarts: "[^"]*"', 'itemStarts: "%s"' % joined, nb)
            else:
                nb = nb.replace('accentColor', 'itemStarts: "%s",\n      accentColor' % joined, 1)
        code = code.replace(inst['block'], nb)
        report_insts.append({
            'componentId': inst['componentId'],
            'start': round(ns, 2),
            'end': round(ne, 2),
            'items': items,
        })

    out_tsx = os.path.join(args.out, 'calibrated.tsx')
    open(out_tsx, 'w', encoding='utf-8').write(code)
    report = {
        'tier': tier,
        'sentences': new_caps,
        'instances': report_insts,
        'calibratedTsx': out_tsx,
    }
    with open(os.path.join(args.out, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
