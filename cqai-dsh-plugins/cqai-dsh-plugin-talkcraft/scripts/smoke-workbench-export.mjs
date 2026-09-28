import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JobStore } from '../src/store.ts'
import { Workbench } from '../src/workbench.ts'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'talkcraft-export-smoke-'))
const store = new JobStore(root)
const editor = new Workbench(store, join(packageRoot, 'upstream'))
const run = (bin, args) => {
  const result = spawnSync(bin, args, {encoding: 'utf8', windowsHide: true})
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr?.slice(-1000)}`)
  return result.stdout
}
try {
  const job = store.create({title: '导出冒烟', text: '大家好，今天聊聊视频制作。'})
  job.approvedSample = true
  store.persist(job)
  mkdirSync(store.file(job.id, 'remotion/src'), {recursive: true})
  const voice = store.file(job.id, 'remotion/public/full.wav')
  run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-ar', '24000', '-ac', '1', voice])
  const url = await editor.open(job.id)
  const clip = (id, cardId, props) => ({id, cardId, start: 0, duration: 45, inOffset: 0, speed: 1, opacity: 1, scale: 1, x: 0, y: 0, props})
  const project = {name: 'TalkCraft smoke', fps: 30, width: 960, height: 540, tracks: [
    {id: 'audio', name: '配音', clips: [clip('voice', 'audio-clip', {file: 'full.wav', volume: 1})]},
    {id: 'visual', name: '画面', clips: [clip('visual', 'text-basic', {content: '口播视频', fontSize: 60})]},
  ]}
  const start = await fetch(new URL('/api/export', url), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({project})})
  if (start.status !== 200) throw new Error(`export did not start: ${start.status} ${await start.text()}`)
  const {id} = await start.json()
  let state
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const response = await fetch(new URL(`/api/export/${id}`, url))
    state = await response.json()
    if (state.status !== 'running') break
  }
  if (state?.status !== 'done' || !existsSync(state.output)) throw new Error(`export failed: ${JSON.stringify(state)?.slice(-1000)}`)
  const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', state.output])
  if (!streams.includes('video') || !streams.includes('audio')) throw new Error(`MP4 lacks video or audio: ${streams}`)
  const preview = await fetch(new URL(`/api/export/${id}/file`, url), {headers: {range: 'bytes=0-31'}})
  if (preview.status !== 206) throw new Error(`export preview range failed: ${preview.status}`)
  console.log(`TalkCraft workbench exported a voiced MP4: ${state.output}`)
} finally {
  await editor.close()
  const target = resolve(root), base = resolve(tmpdir())
  if (!target.startsWith(base + sep)) throw new Error('unsafe smoke cleanup')
  rmSync(target, {recursive: true, force: true})
}
