import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { EDGE_VOICES, isEdgeVoiceId, type Artifact, type Job, type JobDocument, type Stage, type UploadKind } from './protocol.ts'

const DOCUMENT_FILES = [['sources.md', '素材来源'], ['SHOTBOOK.md', '分镜脚本']] as const
const MAX_DOCUMENT_BYTES = 1024 * 1024

export class JobStore {
  readonly jobs = new Map<string, Job>()
  private readonly deleting = new Set<string>()
  constructor(readonly root: string) {
    mkdirSync(root, {recursive: true})
    for (const id of readdirSync(root)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue
      try {
        const job = JSON.parse(readFileSync(join(root, id, 'job.json'), 'utf8')) as Job
        if (job.id !== id) continue
        if (job.status === 'running') { job.status = 'interrupted'; job.logs.push('上次运行已中断，可从已验证的阶段继续。'); this.persist(job) }
        this.jobs.set(id, job)
      } catch { /* ignore an incomplete directory, never synthesize a job */ }
    }
  }
  directory(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务 ID 无效')
    return join(this.root, id)
  }
  file(id: string, relative: string): string {
    const root = this.directory(id)
    const full = resolve(root, relative)
    if (full === root || !full.startsWith(root + sep)) throw new Error('路径不在任务目录内')
    return full
  }
  get(id: string): Job {if (this.deleting.has(id)) throw new Error('视频正在删除'); const job = this.jobs.get(id); if (!job) throw new Error('任务不存在'); return job}
  documents(id: string): JobDocument[] {
    this.get(id)
    const root = realpathSync(this.directory(id))
    const documents: JobDocument[] = []
    for (const [file, name] of DOCUMENT_FILES) {
      const path = this.file(id, file)
      try {
        const entry = lstatSync(path)
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        const actual = realpathSync(path)
        if (!actual.startsWith(root + sep)) continue
        const tooLarge = entry.size > MAX_DOCUMENT_BYTES
        documents.push({file, name, size: entry.size, tooLarge, text: tooLarge ? '' : readFileSync(actual, 'utf8')})
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return documents
  }
  beginDelete(id: string): void {this.get(id); this.deleting.add(id)}
  endDelete(id: string): void {this.deleting.delete(id)}
  isDeleting(id: string): boolean {return this.deleting.has(id)}
  async deleteJob(id: string): Promise<void> {
    if (!this.deleting.has(id) || !this.jobs.has(id)) throw new Error('任务不存在或未开始删除')
    const directory = this.directory(id)
    const entry = lstatSync(directory)
    const root = realpathSync(this.root)
    const parent = dirname(realpathSync(directory))
    if (!entry.isDirectory() || entry.isSymbolicLink() || (process.platform === 'win32' ? parent.toLowerCase() !== root.toLowerCase() : parent !== root)) {
      throw new Error('任务目录路径无效，未执行删除')
    }
    await rm(directory, {recursive: true, maxRetries: 2, retryDelay: 100})
    this.jobs.delete(id)
  }
  create(input: unknown): Job {
    if (!input || typeof input !== 'object') throw new Error('请填写视频信息')
    const value = input as Record<string, unknown>
    const title = String(value.title ?? '').trim().slice(0, 120)
    const text = String(value.text ?? '').trim()
    const aspect = value.aspect === '9:16' ? '9:16' : '16:9'
    if (value.voiceSource !== undefined && !['upload', 'edge', 'fish'].includes(String(value.voiceSource))) throw new Error('配音来源无效')
    if (value.edgeVoice !== undefined && !isEdgeVoiceId(value.edgeVoice)) throw new Error('Edge TTS 声音无效')
    const voiceSource = value.voiceSource as Job['voiceSource']
    const edgeVoice = voiceSource === 'edge' ? String(value.edgeVoice ?? EDGE_VOICES[0].id) : undefined
    if (!text || text.length > 10000) throw new Error('请输入 1 至 10000 字的口播稿')
    const id = randomUUID(); const now = new Date().toISOString()
    const job: Job = {id, title: title || '未命名口播视频', text, aspect, voiceSource, edgeVoice, onlineSearch: value.onlineSearch !== false, createdAt: now, updatedAt: now,
      status: 'draft', stage: null, uploads: [], candidates: [], artifacts: [], logs: [], completedStages: []}
    mkdirSync(join(this.directory(id), 'inputs'), {recursive: true})
    mkdirSync(join(this.directory(id), 'audio'), {recursive: true})
    mkdirSync(join(this.directory(id), 'remotion', 'public'), {recursive: true})
    writeFileSync(this.file(id, 'script.txt'), text + '\n')
    const sentences = text.split(/(?<=[。！？!?；;])\s*|\r?\n+/u).map(line => line.trim()).filter(Boolean)
    writeFileSync(this.file(id, 'script.json'), JSON.stringify({sentences}, null, 2))
    this.jobs.set(id, job); this.persist(job)
    return job
  }
  persist(job: Job): void {
    job.updatedAt = new Date().toISOString()
    const target = this.file(job.id, 'job.json')
    const temp = target + '.tmp'
    writeFileSync(temp, JSON.stringify(job, null, 2))
    renameSync(temp, target)
  }
  log(job: Job, message: string): void {job.logs.push(`${new Date().toLocaleTimeString()} ${message}`); job.logs = job.logs.slice(-100); this.persist(job)}
  stage(job: Job, stage: Stage): void {job.status = 'running'; job.stage = stage; job.stageStartedAt = new Date().toISOString(); job.error = undefined; this.log(job, `开始：${stage}`)}
  completeStage(job: Job, stage: Stage): void {if (!job.completedStages.includes(stage)) job.completedStages.push(stage); this.log(job, `完成：${stage}`)}
  artifact(job: Job, file: string, name: string): void {
    const path = this.file(job.id, file)
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) throw new Error(`${name} 未生成`)
    const artifact: Artifact = {file, name, size: statSync(path).size}
    job.artifacts = [...job.artifacts.filter(item => item.file !== file), artifact]
    this.persist(job)
  }
  upload(job: Job, kind: UploadKind, file: string, name: string): void {
    job.uploads = [...job.uploads.filter(item => !(item.kind === kind && kind === 'voice')), {kind, file, name}]
    if (kind === 'voice') job.voiceSource = 'upload'
    this.persist(job)
  }
  list(): Job[] {return [...this.jobs.values()].filter(job => !this.deleting.has(job.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => ({...job, logs: job.logs.slice(-30)}))}
}
