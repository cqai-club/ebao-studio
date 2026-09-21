# ============================================================
# 阶段 6：自动导入动效预览台（上传视频 + 导入组件包）
# 之后就可以在预览台里审阅、拖动微调、导出。
# ============================================================
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request


def http_json(url, method='GET', body=None, headers=None, timeout=30):
    req = urllib.request.Request(url, method=method)
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if data is not None:
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-llm', action='store_true')
    ap.add_argument('--skip-covers', action='store_true')
    args = ap.parse_args()
    out = args.out
    state_file = os.path.join(out, 'pipeline_state.json')
    state = json.load(open(state_file, encoding='utf-8')) if os.path.isfile(state_file) else {}
    studio = state.get('config', {}).get('studio_url', 'http://127.0.0.1:41735')

    try:
        health = http_json(studio + '/api/health', timeout=5)
    except Exception:
        print('[stage6] 预览台未运行（%s）。请双击 local-launcher.cmd 启动后再运行 --stage studio。' % studio)
        sys.exit(0)

    video = state.get('digitalhuman_video', '')
    pkg = state.get('motion_package', '')
    if not (video and os.path.isfile(video)):
        print('[stage6] 缺少视频文件，跳过导入。')
        sys.exit(0)

    # 上传视频（curl 更稳）
    duration = state.get('duration', 0)
    r = subprocess.run(
        [shutil.which('curl') or 'curl', '--noproxy', '*', '-s', '-X', 'POST', '--data-binary', '@' + video,
         '-H', 'x-file-name: video.mp4',
         '-H', 'x-video-duration: %.3f' % float(duration),
         studio + '/api/upload-video'],
        capture_output=True, text=True, timeout=300,
    )
    try:
        up = json.loads(r.stdout)
        video_url = up.get('videoUrl', '').split('?')[0]
    except Exception:
        up = {}
        video_url = ''
    print('[stage6] 视频上传：%s' % ('ok ' + video_url if up.get('ok') else '失败 ' + r.stdout[-200:]))

    if not up.get('ok') or not video_url:
        raise RuntimeError('预览台视频上传失败')

    # 同步工作区草稿（让界面显示视频）
    if video_url:
        try:
            st = http_json(studio + '/api/state')
            draft = st.get('workspaceDraft') or {}
            draft['videoName'] = 'video.mp4'
            draft['videoUrl'] = video_url
            draft['videoDuration'] = float(duration)
            http_json(studio + '/api/workspace-draft', 'POST', draft)
        except Exception as exc:
            raise RuntimeError('预览台草稿同步失败') from exc

    # 导入组件包
    if pkg and os.path.isfile(pkg):
        code = open(pkg, encoding='utf-8').read()
        try:
            res = http_json(studio + '/api/import-component', 'POST',
                            {'filename': 'MotionPackage.tsx', 'code': code})
            print('[stage6] 组件包导入：%s（%d 个时间轴实例随包生效）' % (
                res.get('filename', ''), len(res.get('history', []))))
        except Exception as exc:
            raise RuntimeError('预览台组件导入失败') from exc

    with open(state_file, 'w', encoding='utf-8') as f:
        state['studio_ok'] = True
        json.dump(state, f, ensure_ascii=False, indent=2)
    print('[stage6] 完成。请在浏览器打开 %s 审阅动效（F5 刷新）。' % studio)


if __name__ == '__main__':
    main()
