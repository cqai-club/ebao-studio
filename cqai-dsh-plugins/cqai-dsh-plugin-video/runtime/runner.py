"""e剪宝 task adapter. Each job has isolated inputs, outputs and render sources."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

BASE = Path(__file__).resolve().parent

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).is_file() else {}

def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def ffmpeg():
    if os.environ.get('FFMPEG_PATH'):
        return os.environ['FFMPEG_PATH']
    executable = shutil.which('ffmpeg')
    if executable:
        return executable
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise RuntimeError('未找到 FFmpeg，请安装 FFmpeg 或 imageio-ffmpeg')

def duration_of(path):
    import re
    result = subprocess.run([ffmpeg(), '-hide_banner', '-i', str(path)], capture_output=True, encoding='utf-8', errors='replace', timeout=30)
    m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', result.stderr)
    if not m:
        raise RuntimeError('无法识别口播视频时长，请选择有效的视频文件')
    seconds = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    if not 2 <= seconds <= 1800:
        raise RuntimeError('口播视频需在 2 秒到 30 分钟之间')
    return seconds

def event(stage, status):
    print('EJIANBAO_EVENT ' + json.dumps({'stage': stage, 'status': status}), flush=True)

def health():
    import importlib.util
    try:
        ff = ffmpeg()
    except RuntimeError:
        ff = None
    return {'python': True, 'version': sys.version.split()[0], 'ffmpeg': bool(ff),
            'numpy': importlib.util.find_spec('numpy') is not None,
            'render': (BASE / 'render-studio/node_modules/@remotion/cli').is_dir(),
            'inferflow': any((Path.home() / root / 'inferflow-codex/scripts/run_skill.py').is_file() for root in ['.agents/skills', '.codex/skills', '.dsh/skills']),
            'semantic': (BASE / 'align-engine/models/sensevoice/model.int8.onnx').is_file()}

def render(out, state):
    template = BASE / 'render-studio'
    if not (template / 'node_modules/@remotion/cli/remotion-cli.js').is_file():
        raise RuntimeError('尚未安装渲染依赖，请在插件 runtime/render-studio 中运行 npm install')
    work = out / 'render-work'
    work.mkdir(exist_ok=True)
    shutil.copytree(template / 'src', work / 'src', dirs_exist_ok=True)
    (work / 'public').mkdir(exist_ok=True)
    shutil.copyfile(state['digitalhuman_video'], work / 'public/video.mp4')
    (work / 'src/motion').mkdir(exist_ok=True)
    shutil.copyfile(state['motion_package'], work / 'src/motion/MotionPackage.tsx')
    for filename in ['package.json', 'tsconfig.json']:
        shutil.copyfile(template / filename, work / filename)
    modules = work / 'node_modules'
    if not modules.exists():
        if os.name == 'nt':
            # Node creates a Windows junction without administrator symlink privileges.
            subprocess.run([shutil.which('node') or 'node', '-e', 'require("fs").symlinkSync(process.argv[1],process.argv[2],"junction")', str(template / 'node_modules'), str(modules)], check=True)
        else:
            modules.symlink_to(template / 'node_modules', target_is_directory=True)
    node = shutil.which('node')
    if not node:
        raise RuntimeError('找不到 Node.js，请安装 Node.js 22 或更高版本')
    command = [node, str(template / 'node_modules/@remotion/cli/remotion-cli.js'), 'render', 'src/index.ts', 'Main', str(out / 'final_video.mp4'), '--concurrency', '2', '--log', 'info']
    browser = os.environ.get('EJIANBAO_BROWSER_EXECUTABLE')
    if not browser and os.name == 'nt':
        for program_root in [os.environ.get('PROGRAMFILES(X86)', ''), os.environ.get('PROGRAMFILES', ''), os.environ.get('LOCALAPPDATA', '')]:
            for suffix in ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']:
                candidate = Path(program_root) / suffix
                if candidate.is_file():
                    browser = str(candidate)
                    break
            if browser:
                break
    if browser:
        command += ['--browser-executable', browser]
    subprocess.run(command, cwd=work, check=True, timeout=7200)
    state['render_ok'] = True
    state['final_video'] = str(out / 'final_video.mp4')
    write(out / 'pipeline_state.json', state)

def run(out):
    out = out.resolve()
    job = read(out / 'job.json'); options = job['options']; uploads = job['uploads']
    state_path = out / 'pipeline_state.json'; state = read(state_path)
    cfg = {'title': options['title'], 'duration': options['duration'], 'studio_url': 'http://127.0.0.1:41735', 'references': []}
    for key, field in [('script', 'script_src'), ('avatar', 'avatar'), ('voice', 'voice')]:
        if key in uploads:
            cfg[field] = str(out / uploads[key]['file'])
    if options['text']:
        (out / 'input-script.txt').write_text(options['text'], encoding='utf-8')
        cfg['script_src'] = str(out / 'input-script.txt')
    if options['mode'] == 'video':
        source = out / uploads['video']['file']
        cfg['duration'] = duration_of(source)
        state.update(digitalhuman_ok=True, digitalhuman_video=str(source))
    state['config'] = cfg; write(state_path, state)
    files = {'script': 'stage_script.py', 'digitalhuman': 'stage_digitalhuman.py', 'motionpack': 'stage_motion_pack.py', 'align': 'stage_align.py', 'studio': 'stage_studio.py', 'publish': 'stage_publish.py'}
    flags = {'script': 'script_ok', 'digitalhuman': 'digitalhuman_ok', 'motionpack': 'motionpack_ok', 'align': 'align_ok', 'render': 'render_ok', 'studio': 'studio_ok', 'publish': 'publish_ok'}
    artifacts = {'script': 'plan.json', 'motionpack': 'motion/MotionPackage.tsx', 'render': 'final_video.mp4', 'publish': 'publish_package_handoff.json'}
    for stage in ['script', 'digitalhuman', 'motionpack', 'align', 'render', 'studio', 'publish']:
        state = read(state_path)
        disabled = (stage == 'digitalhuman' and options['mode'] != 'digitalhuman') or (options['mode'] == 'plan' and stage in ['align', 'render', 'studio']) or (stage == 'studio' and not options['studio'])
        if disabled:
            event(stage, 'skipped'); continue
        if state.get(flags[stage]) and (stage not in artifacts or (out / artifacts[stage]).is_file()):
            event(stage, 'completed'); continue
        event(stage, 'running')
        if stage == 'render':
            render(out, state)
        else:
            cmd = [sys.executable, '-u', str(BASE / 'stages' / files[stage]), '--out', str(out)]
            if not options['optimize']:
                cmd.append('--skip-llm')
            if not options['covers'] and stage != 'script':
                cmd.append('--skip-covers')
            env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
            if stage == 'align': env['FFMPEG_PATH'] = ffmpeg()
            subprocess.run(cmd, check=True, env=env, timeout=7200)
        state = read(state_path)
        if stage in artifacts and not (out / artifacts[stage]).is_file():
            raise RuntimeError('阶段未生成预期产物：' + stage)
        if not state.get(flags[stage]):
            print('提示：' + stage + ' 未完成，保留原有素材。', flush=True)
            event(stage, 'skipped')
        else:
            event(stage, 'completed')
    print('制作完成。' if options['mode'] != 'plan' else '动效方案已生成，可下载文案与组件包。', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path)
    parser.add_argument('--health', action='store_true')
    args = parser.parse_args()
    if args.health:
        print(json.dumps(health()))
    else:
        try: run(args.out)
        except Exception as exc:
            print('制作中断：' + str(exc), file=sys.stderr, flush=True)
            sys.exit(1)
