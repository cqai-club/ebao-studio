import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JobStore } from '../src/store.ts'
import { Workbench } from '../src/workbench.ts'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'talkcraft-workbench-smoke-'))
const store = new JobStore(root)
const editor = new Workbench(store, join(packageRoot, 'upstream'))
try {
  const jobs = ['第一条视频。', '第二条视频。'].map(text => {
    const job = store.create({text})
    job.completedStages = ['sample']; job.approvedSample = true; store.persist(job)
    mkdirSync(store.file(job.id, 'remotion/src'), {recursive: true})
    writeFileSync(store.file(job.id, 'remotion/src/shots.ts'), 'export const SHOTS = [];\n')
    return job
  })
  const first = await editor.open(jobs[0].id)
  const page = await fetch(first)
  if (page.status !== 200 || !(await page.text()).includes('TalkCraft Workbench')) throw new Error('first workbench did not load')
  const pipeline = await fetch(new URL('/api/pipeline', first))
  if (pipeline.status !== 200 || !(await pipeline.json()).linked) throw new Error('project mapping failed')
  const saved = await fetch(new URL('/api/pipeline/overrides', first), {method: 'POST', headers: {'content-type': 'application/json', 'x-workbench-project': encodeURIComponent(store.directory(jobs[0].id))}, body: JSON.stringify({s01: {scale: 1.1}})})
  if (saved.status !== 200 || JSON.parse(readFileSync(store.file(jobs[0].id, 'remotion/overrides.json'), 'utf8')).s01.scale !== 1.1) throw new Error('shot parameter write-back failed')
  const second = await editor.open(jobs[1].id)
  if (first === second || (await fetch(second)).status !== 200) throw new Error('task switch failed')
  let oldClosed = false
  try {await fetch(first, {signal: AbortSignal.timeout(1500)})} catch {oldClosed = true}
  if (!oldClosed) throw new Error('old workbench remains reachable')
  console.log('TalkCraft workbench loaded, wrote shot parameters, mapped two jobs, and closed the old service')
} finally {
  await editor.close()
  const target = resolve(root), base = resolve(tmpdir())
  if (!target.startsWith(base + sep)) throw new Error('unsafe smoke cleanup')
  rmSync(target, {recursive: true, force: true})
}
