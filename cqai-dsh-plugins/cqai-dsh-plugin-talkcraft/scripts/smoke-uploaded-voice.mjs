import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JobStore } from '../src/store.ts'
import { Pipeline } from '../src/pipeline.ts'

const voice = process.argv[2]
if (!voice || !existsSync(voice)) throw new Error('Usage: node --experimental-transform-types scripts/smoke-uploaded-voice.mjs <spoken-wav>')
const upstream = fileURLToPath(new URL('../upstream/', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'talkcraft-voice-smoke-'))
const store = new JobStore(root)
try {
  const job = store.create({title: '上传配音冒烟', text: '大家好，今天聊聊视频制作。'})
  const voiceInput = store.file(job.id, `inputs/${basename(voice)}`)
  copyFileSync(voice, voiceInput)
  store.upload(job, 'voice', `inputs/${basename(voice)}`, basename(voice))
  for (const [index, name] of ['chart-grow.png', 'chapter-title-card.png'].entries()) {
    const input = `inputs/material-${index}.png`
    copyFileSync(join(upstream, 'gallery', 'thumbs', name), store.file(job.id, input))
    store.upload(job, 'image', input, name)
  }
  const agent = {run: async cwd => writeFileSync(join(cwd, 'asset_plan.json'), '{"assets":["用户上传图片"]}\n')}
  const pipeline = new Pipeline(store, agent, {read: async () => ({})}, upstream)
  await pipeline.prepare(job, new AbortController().signal)
  if (!pipeline.verified(job, 'prepare')) throw new Error('prepare artifacts are invalid')
  if (!existsSync(store.file(job.id, 'remotion/package.json'))) throw new Error('Remotion project manifest is missing')
  if (!existsSync(store.file(job.id, 'remotion/public/full.wav'))) throw new Error('workbench narration is missing')
  const sources = readFileSync(store.file(job.id, 'sources.md'), 'utf8')
  if (!sources.includes('chart-grow.png') || !sources.includes('chapter-title-card.png')) throw new Error('uploaded sources are missing')
  console.log(`TalkCraft uploaded-voice preparation passed: ${store.directory(job.id)}`)
} finally {
  const first = [...store.jobs.keys()][0]
  if (first) {
    const link = store.file(first, 'remotion/node_modules')
    if (existsSync(link)) rmSync(link, {force: true})
  }
  const target = resolve(root), base = resolve(tmpdir())
  if (!target.startsWith(base + sep)) throw new Error('unsafe smoke cleanup')
  rmSync(target, {recursive: true, force: true})
}
