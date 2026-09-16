import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const runtime = resolve(process.argv[2] || join(root, '.portable/runtime'))
const videoRuntime = resolve(process.argv[3] || join(root, 'cqai-dsh-plugins/cqai-dsh-plugin-video/runtime'))
const python = join(runtime, 'python312/python.exe')
const node = join(runtime, 'node/node.exe')
const ffmpeg = join(runtime, 'python312/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
const work = join(root, '.portable', 'smoke-' + Date.now())
const env = {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', EJIANBAO_NODE: node,
  EJIANBAO_BROWSER_EXECUTABLE: join(runtime, 'browser/chrome-headless-shell.exe'), FFMPEG_PATH: ffmpeg,
  PATH: join(runtime, 'node') + ';' + process.env.SystemRoot + '/System32', INFERFLOW_API_KEY: '', EJIANBAO_MANAGED_ACCOUNT: '1'}
function run(exe, args, input) {
  const result = spawnSync(exe, args, {env, encoding: 'utf8', input, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 ** 2})
  if (result.status !== 0) throw new Error(result.stdout + '\n' + result.stderr)
  console.log(result.stdout.slice(-2500))
  return result.stdout
}
const health = JSON.parse(run(python, [join(videoRuntime, 'runner.py'), '--health']))
if (!health.python || !health.numpy || !health.ffmpeg || !health.render) throw new Error('Incomplete portable runtime')
mkdirSync(join(work, 'inputs'), {recursive: true})
run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x26344b:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(work, 'inputs/video.mp4')])
writeFileSync(join(work, 'job.json'), JSON.stringify({options: {title: '便携渲染测试', text: '这是便携版测试。字幕和动效随视频一起呈现。', duration: 4, mode: 'video', optimize: false, covers: false, studio: false}, uploads: {video: {file: 'inputs/video.mp4'}}}))
run(python, [join(videoRuntime, 'runner.py'), '--out', work])
const relocated = work + '-移动后'
for (let attempt = 0; ; attempt++) {
  try {renameSync(work, relocated); break}
  catch (error) {if (attempt >= 15) throw error; await delay(1000)}
}
const statePath = join(relocated, 'pipeline_state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8')); state.render_ok = false
writeFileSync(statePath, JSON.stringify(state))
run(python, [join(videoRuntime, 'runner.py'), '--out', relocated])
const video = readFileSync(join(relocated, 'final_video.mp4'))
if (video.length < 10000 || video.subarray(4, 8).toString() !== 'ftyp') throw new Error('Invalid output video')
console.log('PORTABLE_RENDER_AND_RELOCATION_OK', video.length, relocated)
