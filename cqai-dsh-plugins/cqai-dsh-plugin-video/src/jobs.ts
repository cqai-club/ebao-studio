import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { STAGES, type Job, type Options, type Stage } from './protocol.ts'

export function validateOptions(value: unknown): Options {
  const v = value as Partial<Options> | null
  if (!v || typeof v.title !== 'string' || v.title.length > 120 || typeof v.text !== 'string' || v.text.length > 50000
    || v.mode === 'digitalhuman' && v.text.length > 5000
    || !['video', 'digitalhuman', 'plan'].includes(v.mode ?? '') || !Number.isFinite(v.duration) || v.duration! < 2 || v.duration! > 1800
    || ['optimize', 'covers', 'studio'].some(k => typeof v[k as keyof Options] !== 'boolean')) throw new Error('请检查标题、文案和时长（2–1800 秒）')
  return {title: v.title.trim(), text: v.text.trim(), mode: v.mode!, duration: v.duration!, optimize: v.optimize!, covers: v.covers!, studio: v.studio!}
}
export function validId(id: string): boolean { return /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id) }
const OUTPUTS = ['final_video.mp4', 'script.txt', 'plan.json', 'motion/MotionPackage.tsx', 'publish_package_handoff.json', 'cover_3x4.png', 'cover_4x3.png', 'cover_16x9.png', 'align_tmp/report.json']
export class JobStore {
  readonly jobs = new Map<string, Job>()
  private active?: {id: string; child: ChildProcess; done: Promise<void>; controller: AbortController}
  managedGenerate?: (job: Job, signal: AbortSignal) => Promise<void>
  constructor(readonly root: string, readonly runtime: string, readonly python = process.env.EJIANBAO_PYTHON || 'python') {
    mkdirSync(root, {recursive: true})
    for (const id of readdirSync(root)) {
      if (!validId(id)) continue
      try {
        const job = JSON.parse(readFileSync(join(root, id, 'job.json'), 'utf8')) as Job
        if (job.id !== id) continue
        if (job.status === 'running') { job.status = 'interrupted'; job.error = '应用退出导致任务中断，可继续任务'; this.save(job) }
        this.jobs.set(id, job)
      } catch { /* Ignore incomplete directories; never read outside job storage. */ }
    }
  }
  dir(id: string): string { if (!validId(id)) throw new Error('无效任务'); return join(this.root, id) }
  get(id: string): Job { const job = this.jobs.get(id); if (!job) throw new Error('任务不存在'); return job }
  save(job: Job): void {
    const dir = this.dir(job.id); mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'job.json.tmp'), JSON.stringify(job, null, 2))
    renameSync(join(dir, 'job.json.tmp'), join(dir, 'job.json'))
  }
  create(options: Options): Job {
    const job: Job = {id: randomUUID(), createdAt: new Date().toISOString(), options, status: 'draft', stages: {}, uploads: {}, logs: [], artifacts: []}
    this.save(job); this.jobs.set(job.id, job); return job
  }
  log(job: Job, line: string): void {
    // Third-party tools may print provider keys; redact common credential shapes.
    const clean = line.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/((?:api[_-]?key|token|secret)\s*[=:]\s*)[^\s,}]+/gi, '$1[redacted]')
    job.logs.push(clean.slice(0, 1500)); job.logs = job.logs.slice(-160)
  }
  collect(job: Job): void {
    job.artifacts = OUTPUTS.flatMap(file => {
      const path = join(this.dir(job.id), file)
      return existsSync(path) ? [{file, name: file.split('/').pop()!, size: statSync(path).size}] : []
    })
  }
  async prepare(id: string): Promise<Job> {
    const job = this.start(id, true)
    await this.active!.done
    if (job.status !== 'draft') throw new Error(job.error || '文案准备失败')
    return job
  }
  start(id: string, preparing = false): Job {
    if (this.active) throw new Error('已有制作任务正在运行，请等待完成或取消')
    const job = this.get(id)
    if (job.status === 'completed') throw new Error('任务已完成，请新建任务')
    const {options, uploads} = job
    if (!options.text && !uploads.script) throw new Error('请填写口播文案或上传文案文件')
    if (options.mode === 'video' && !uploads.video) throw new Error('请上传口播视频')
    if (options.mode === 'digitalhuman' && (!uploads.avatar || !uploads.voice)) throw new Error('请上传授权形象照和参考录音')
    if (options.mode === 'digitalhuman' && !preparing && this.managedGenerate && !job.cloud) throw new Error('请先获取并确认报价')
    job.status = 'running'; job.error = undefined
    this.log(job, '开始制作 · ' + new Date().toLocaleString()); this.save(job)
    const controller = new AbortController()
    const child = spawn(this.python, ['-u', join(this.runtime, 'runner.py'), '--out', this.dir(id), ...(preparing ? ['--prepare-only'] : [])], {
      cwd: this.runtime, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, INFERFLOW_API_KEY: '', EJIANBAO_MANAGED_ACCOUNT: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'},
      detached: process.platform !== 'win32',
    })
    let pending = ''
    let cloudRequested = false
    let cloudWork: Promise<void> | undefined
    child.stdin!.on('error', () => {})
    const onLine = (line: string) => {
      if (line === 'EJIANBAO_CLOUD_REQUEST' && !cloudRequested) {
        cloudRequested = true
        cloudWork = (async () => {
          try {
            if (!this.managedGenerate) throw new Error('产品视频服务未配置')
            await this.managedGenerate(job, controller.signal)
            if (!controller.signal.aborted) child.stdin!.write('{"ok":true}\n')
          } catch (error) {
            if (!controller.signal.aborted) {
              job.error = error instanceof Error ? error.message : '云端生成失败'; this.save(job)
              child.stdin!.write(JSON.stringify({ok: false, error: job.error}) + '\n')
            }
          }
        })()
      } else if (line.startsWith('EJIANBAO_EVENT ')) {
        try {
          const e = JSON.parse(line.slice(15)) as {stage: Stage; status: 'running' | 'completed' | 'skipped'}
          if (STAGES.includes(e.stage) && ['running', 'completed', 'skipped'].includes(e.status)) {job.stage = e.stage; job.stages[e.stage] = e.status}
        } catch { this.log(job, line) }
      } else if (line.trim()) this.log(job, line)
      this.collect(job); this.save(job)
    }
    child.stdout!.setEncoding('utf8').on('data', (text: string) => {
      pending += text; const lines = pending.split(/\r\n|\n|\r/); pending = lines.pop() ?? ''
      for (const line of lines) onLine(line)
      if (pending.length > 6000) {onLine(pending); pending = ''}
    })
    child.stderr!.setEncoding('utf8').on('data', (text: string) => {for (const line of text.split(/\r?\n/)) if (line.trim()) this.log(job, line); this.save(job)})
    child.once('error', error => {job.error = `无法启动 Python：${error.message}`})
    const done = new Promise<void>(resolveDone => child.once('close', async (code) => {
      if (pending) onLine(pending)
      if (job.status !== 'cancelled' && job.status !== 'interrupted') {
        job.status = code === 0 ? preparing ? 'draft' : 'completed' : 'failed'
        if (code !== 0) {job.error ??= '制作失败，请查看日志后继续任务'; if (job.stage) job.stages[job.stage] = 'failed'}
      }
      controller.abort(); await cloudWork; this.collect(job); this.save(job); this.active = undefined; resolveDone()
    }))
    this.active = {id, child, done, controller}; return job
  }
  async cancel(id: string, interrupted = false): Promise<void> {
    const active = this.active
    if (!active || active.id !== id) throw new Error('任务未在运行')
    const job = this.get(id); job.status = interrupted ? 'interrupted' : 'cancelled'; this.save(job)
    active.controller.abort()
    if (job.cloud?.submissionStarted) this.log(job, '已停止本地等待，云端任务继续运行；继续任务时查询原任务，不重复生成。')
    if (active.child.pid !== undefined) {
      if (process.platform === 'win32') {
        await new Promise<void>((done, reject) => {
          const stop = spawn('taskkill.exe', ['/PID', String(active.child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'})
          stop.once('error', reject); stop.once('close', () => done())
        })
      } else { try {process.kill(-active.child.pid, 'SIGTERM')} catch {active.child.kill('SIGTERM')} }
    }
    await active.done
  }
  async dispose(): Promise<void> {if (this.active) await this.cancel(this.active.id, true)}
}
