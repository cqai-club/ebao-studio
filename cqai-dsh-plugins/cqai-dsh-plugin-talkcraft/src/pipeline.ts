import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { EDGE_VOICES, isEdgeVoiceId, type Job, type Stage, type VoiceSource } from './protocol.ts'
import { JobStore } from './store.ts'
import { TalkCraftAgents } from './agent.ts'
import { command, health, linkJobRuntime, pythonExecutable } from './runtime.ts'
import { candidateLocalFile, downloadSelected, searchCandidates } from './media.ts'
import { Secrets } from './secrets.ts'

const present = (path: string) => existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const validJson = (path: string): boolean => {
  if (!present(path)) return false
  try {JSON.parse(readFileSync(path, 'utf8')); return true} catch {return false}
}
const validShotDraft = (path: string): boolean => {
  if (!validJson(path)) return false
  const shots = JSON.parse(readFileSync(path, 'utf8')) as unknown
  return Array.isArray(shots) && shots.length > 0 && shots[0]?.id === 's01'
}
const validTimestamps = (path: string): boolean => {
  if (!validJson(path)) return false
  const value = JSON.parse(readFileSync(path, 'utf8')) as {total?: unknown; sentences?: unknown}
  return typeof value.total === 'number' && Number.isFinite(value.total) && value.total > 0
    && Array.isArray(value.sentences) && value.sentences.length > 0
    && value.sentences.every((row: unknown) => {
      if (!row || typeof row !== 'object') return false
      const sentence = row as {text?: unknown; start?: unknown; end?: unknown; words?: unknown}
      return typeof sentence.text === 'string' && sentence.text.length > 0
        && typeof sentence.start === 'number' && Number.isFinite(sentence.start)
        && typeof sentence.end === 'number' && Number.isFinite(sentence.end)
        && sentence.start >= 0 && sentence.end >= sentence.start
        && Array.isArray(sentence.words)
    })
}
const voiceSource = (job: Job): VoiceSource => job.uploads.some(item => item.kind === 'voice') ? 'upload' : job.voiceSource ?? 'fish'
export class Pipeline {
  private runs = new Map<string, AbortController>()
  private runPromises = new Map<string, Promise<void>>()
  private readonly agentSessionJobs = new Map<string, string>()
  constructor(readonly store: JobStore, readonly agents: TalkCraftAgents, readonly secrets: Secrets, readonly upstream: string) {}
  dispose(): void {for (const controller of this.runs.values()) controller.abort()}
  private trackAgentSession(job: Job, sessionId: string): void {this.agentSessionJobs.set(sessionId, job.id)}
  recordBackgroundStep(owner: string, status: string): void {
    if (status !== 'completed' && status !== 'failed') return
    const id = this.agentSessionJobs.get(owner)
    const job = id && this.store.jobs.get(id)
    if (!job || job.status !== 'running' || !job.stage) return
    const stage = {prepare: '声音与素材', shotbook: '分镜', sample: '有声试片', finish: '成片', review: '审片'}[job.stage]
    this.store.log(job, `${stage}：后台步骤${status === 'completed' ? '已完成，继续制作' : '失败，正在检查'}`)
  }
  async diagnosis(job: Job): Promise<string[]> {
    const h = await health(this.upstream)
    const errors = await this.agents.preflight()
    for (const key of ['node', 'python', 'ffmpeg', 'ffprobe', 'remotion', 'browser'] as const) if (!h[key]) errors.push(`${key} 尚未就绪；${h.prepare}`)
    const source = voiceSource(job)
    const voice = source === 'upload'
    const voiceUpload = job.uploads.find(item => item.kind === 'voice')
    const keys = await this.secrets.publicState()
    if (voiceUpload && h.ffprobe) {
      try {
        const probe = await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', this.store.file(job.id, voiceUpload.file)], {timeout: 20000})
        const duration = Number.parseFloat(probe.output.trim())
        if (probe.code !== 0 || !Number.isFinite(duration) || duration < 0.5) errors.push('上传配音为空、损坏或短于 0.5 秒，请重新上传')
      } catch {errors.push('上传配音无法读取，请重新上传')}
    }
    if ((voice || source === 'edge' || present(this.store.file(job.id, 'audio/full.wav'))) && !h.asrModel
      && !validTimestamps(this.store.file(job.id, 'audio/timestamps.json'))
      && !validTimestamps(this.store.file(job.id, 'audio/timestamps.pending.json'))) errors.push('字级对齐 ASR 模型缺失；请按插件准备说明安装 FireRed 模型')
    if (source === 'upload' && !voiceUpload && !present(this.store.file(job.id, 'audio/full.wav'))) errors.push('请先上传成品配音')
    if (source === 'fish' && !keys.fish && !present(this.store.file(job.id, 'audio/full.wav'))) errors.push('请在口播视频制作的设置中填写 Fish Audio 密钥，或上传成品配音')
    if (source === 'edge' && !h.edgeTts && !present(this.store.file(job.id, 'audio/edge.mp3')) && !present(this.store.file(job.id, 'audio/full.wav'))) errors.push(`Edge TTS 依赖未准备；${h.prepare}`)
    if (source === 'edge' && job.edgeSubmission === 'completed'
      && !present(this.store.file(job.id, 'audio/edge.mp3')) && !present(this.store.file(job.id, 'audio/full.wav')))
      errors.push('Edge TTS 已生成的音频文件丢失；请上传备份配音或重新建任务')
    if (!job.uploads.some(item => item.kind !== 'voice') && (job.onlineSearch === false || (!keys.pexels && !keys.pixabay))) errors.push('请上传画面素材，或启用在线找素材并配置 Pexels/Pixabay 密钥')
    if (job.fishSubmission === 'uncertain' && !voice) errors.push('上次 Fish Audio 请求结果不明；请上传音频或人工确认后重新建任务')
    if (source === 'edge' && job.edgeSubmission === 'uncertain'
      && !present(this.store.file(job.id, 'audio/edge.mp3')) && !present(this.store.file(job.id, 'audio/full.wav')))
      errors.push('上次 Edge TTS 请求结果不明；请在任务页明确选择重试，或上传成品配音')
    return errors
  }
  retryEdge(id: string): Job {
    const job = this.store.get(id)
    if (this.runs.has(id) || job.status === 'running') throw new Error('请先停止正在制作的任务')
    if (voiceSource(job) !== 'edge' || job.edgeSubmission !== 'uncertain') throw new Error('当前任务不需要重试 Edge TTS')
    if (present(this.store.file(id, 'audio/edge.mp3')) || present(this.store.file(id, 'audio/full.wav')))
      throw new Error('已有可恢复的配音文件，请直接继续制作')
    rmSync(this.store.file(id, 'audio/edge.pending.mp3'), {force: true})
    job.edgeSubmission = undefined
    job.status = 'interrupted'
    this.store.log(job, '用户明确选择重试 Edge TTS')
    return job
  }
  async start(id: string): Promise<Job> {
    const job = this.store.get(id)
    if (this.runs.has(id) || job.status === 'running') throw new Error('任务已经运行')
    if (job.status === 'awaiting-shotbook' || job.status === 'awaiting-sample') throw new Error('请先确认或退回当前阶段')
    if (job.status === 'completed') throw new Error('任务已完成，可从工作台重新导出')
    const errors = await this.diagnosis(job)
    if (this.store.isDeleting(id)) throw new Error('视频正在删除')
    if (errors.length) throw new Error(errors.join('；'))
    const controller = new AbortController()
    this.runs.set(id, controller)
    job.status = 'running'; job.error = undefined; this.store.persist(job)
    const run = this.execute(job, controller).finally(() => {this.runs.delete(id); this.runPromises.delete(id)})
    this.runPromises.set(id, run)
    return job
  }
  async delete(id: string, closeEditor: () => Promise<void>): Promise<void> {
    this.store.beginDelete(id)
    try {
      this.runs.get(id)?.abort()
      const running = this.runPromises.get(id)
      if (running) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([running, new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error('制作进程未能及时停止，请稍后重试删除')), 45000)
          })])
        } finally {if (timer) clearTimeout(timer)}
      }
      await closeEditor()
      await this.store.deleteJob(id)
    } finally {this.store.endDelete(id)}
  }
  async cancel(id: string): Promise<Job> {
    const job = this.store.get(id)
    this.runs.get(id)?.abort()
    job.status = 'cancelled'; this.store.log(job, '用户取消任务')
    return job
  }
  async approve(id: string, gate: 'shotbook' | 'sample', accepted: boolean, feedback: string, selected?: string[]): Promise<Job> {
    const job = this.store.get(id)
    const expected = gate === 'shotbook' ? 'awaiting-shotbook' : 'awaiting-sample'
    if (job.status !== expected) throw new Error('当前不在此确认阶段')
    if (!accepted && !feedback.trim()) throw new Error('退回时请填写修改意见')
    if (gate === 'shotbook' && selected) {
      if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string')) throw new Error('素材选择无效')
      const known = new Set(job.candidates.map(item => item.id))
      if (selected.some(id => !known.has(id))) throw new Error('素材候选不存在')
      const next = new Set(selected)
      const changed = job.candidates.some(item => item.selected !== next.has(item.id))
      job.candidates = job.candidates.map(item => ({...item, selected: next.has(item.id)}))
      writeFileSync(this.store.file(id, 'media_candidates.json'), JSON.stringify(job.candidates, null, 2))
      if (changed) {
        for (const item of job.candidates.filter(candidate => !candidate.selected)) rmSync(this.store.file(id, candidateLocalFile(item)), {force: true})
        accepted = false; feedback = `素材选择已变化；请根据新的选用结果重做分镜。${feedback}`
        job.completedStages = job.completedStages.filter(stage => stage !== 'prepare')
        rmSync(this.store.file(id, 'asset_plan.json'), {force: true})
        delete job.stageSessions?.prepare
        delete job.stageSessions?.shotbook
        delete job.stageSessions?.sample
        job.shotbookDraftSession = undefined
        job.shotbookRepairSession = undefined
      }
    }
    if (accepted) {
      if (gate === 'shotbook') job.approvedShotbook = true
      else job.approvedSample = true
      job.status = 'interrupted'; job.feedback = undefined
      this.store.log(job, `${gate} 已确认`)
      return await this.start(id)
    }
    const redo: Stage = gate === 'shotbook' ? 'shotbook' : 'sample'
    if (gate === 'shotbook') {job.approvedShotbook = false; job.approvedSample = false}
    else job.approvedSample = false
    job.completedStages = job.completedStages.filter(stage => stage !== redo && (gate !== 'shotbook' || stage !== 'sample'))
    job.feedback = feedback.slice(0, 5000); job.status = 'interrupted'
    if (gate === 'shotbook') job.shotbookRepairSession = undefined
    this.store.log(job, `${gate} 退回修改`)
    return await this.start(id)
  }
  private verified(job: Job, stage: Stage): boolean {
    const file = (relative: string) => present(this.store.file(job.id, relative))
    const json = (relative: string) => validJson(this.store.file(job.id, relative))
    if (stage === 'prepare') return file('audio/full.wav') && validTimestamps(this.store.file(job.id, 'audio/timestamps.json')) && json('media_candidates.json') && json('asset_plan.json') && file('sources.md')
    if (stage === 'shotbook') return file('SHOTBOOK.md') && json('remotion/shots.json')
    if (stage === 'sample') return file('remotion/out/preview/s01.mp4')
    if (stage === 'finish') return file('delivery.mp4')
    if (!json('review/decision.json')) return false
    return (JSON.parse(readFileSync(this.store.file(job.id, 'review/decision.json'), 'utf8')) as {pass?: unknown}).pass === true
  }
  private async execute(job: Job, controller: AbortController): Promise<void> {
    try {
      for (const stage of ['prepare', 'shotbook', 'sample', 'finish', 'review'] as const) {
        if (controller.signal.aborted) throw new Error('任务已取消')
        if (job.completedStages.includes(stage) && this.verified(job, stage)) {
          if (stage === 'shotbook') await this.checkShotbook(job, controller.signal)
          if (stage === 'sample') await this.checkVideoFile(this.store.file(job.id, 'remotion/out/preview/s01.mp4'), controller.signal)
          if (stage === 'finish') await this.checkVideoFile(this.store.file(job.id, 'delivery.mp4'), controller.signal)
          if (stage === 'shotbook' && !job.approvedShotbook) {job.status = 'awaiting-shotbook'; this.store.log(job, '请确认分镜及素材来源'); return}
          if (stage === 'sample' && !job.approvedSample) {job.status = 'awaiting-sample'; this.store.log(job, '请观看有声样板镜并确认'); return}
          continue
        }
        job.completedStages = job.completedStages.filter(item => item !== stage)
        this.store.stage(job, stage)
        if (stage === 'prepare') await this.prepare(job, controller.signal)
        else await this.agentStage(job, stage, controller.signal)
        if (!this.verified(job, stage)) throw new Error(`${stage} 阶段缺少已验证产物`)
        if (stage === 'shotbook') await this.checkShotbook(job, controller.signal)
        if (stage === 'sample') await this.checkVideoFile(this.store.file(job.id, 'remotion/out/preview/s01.mp4'), controller.signal)
        if (stage === 'finish') await this.checkVideoFile(this.store.file(job.id, 'delivery.mp4'), controller.signal)
        if (stage === 'review') {
          const decision = JSON.parse(readFileSync(this.store.file(job.id, 'review/decision.json'), 'utf8')) as {pass?: unknown; issues?: unknown}
          if (decision.pass !== true) throw new Error(`独立审片未通过：${JSON.stringify(decision.issues ?? [])}`)
        }
        this.store.completeStage(job, stage)
        if (stage === 'shotbook') {job.status = 'awaiting-shotbook'; this.store.log(job, '请确认分镜及素材来源'); return}
        if (stage === 'sample') {job.status = 'awaiting-sample'; this.store.log(job, '请观看有声样板镜并确认'); return}
      }
      job.status = 'completed'; job.stage = null
      this.store.artifact(job, 'delivery.mp4', '成片 MP4')
      this.store.log(job, '制作完成')
    } catch (error) {
      if (job.status === 'cancelled') return
      job.status = controller.signal.aborted ? 'cancelled' : 'failed'
      job.error = message(error).slice(0, 800)
      this.store.log(job, `制作停止：${job.error}`)
    } finally {
      for (const [sessionId, id] of this.agentSessionJobs) if (id === job.id) this.agentSessionJobs.delete(sessionId)
    }
  }
  private async prepare(job: Job, signal: AbortSignal): Promise<void> {
    const root = this.store.directory(job.id)
    linkJobRuntime(root, this.upstream)
    const voice = job.uploads.find(item => item.kind === 'voice')
    const wav = this.store.file(job.id, 'audio/full.wav')
    const timestamps = this.store.file(job.id, 'audio/timestamps.json')
    if (voiceSource(job) === 'edge' && present(wav) && job.edgeSubmission === 'uncertain') {
      job.edgeSubmission = 'completed'; this.store.persist(job)
    }
    if (!present(wav)) {
      if (voice) {
        const pending = this.store.file(job.id, 'audio/full.pending.wav')
        const result = await command('ffmpeg', ['-y', '-i', this.store.file(job.id, voice.file), '-ar', '24000', '-ac', '1', pending], {signal, timeout: 120000})
        if (result.code !== 0 || !present(pending)) throw new Error('配音转换失败，请检查音频文件')
        renameSync(pending, wav)
      } else if (voiceSource(job) === 'edge') {
        const mp3 = this.store.file(job.id, 'audio/edge.mp3')
        if (!present(mp3)) {
          if (job.edgeSubmission === 'uncertain') throw new Error('上次 Edge TTS 请求结果不明；请明确选择重试或上传配音')
          if (job.edgeSubmission === 'completed') throw new Error('Edge TTS 已生成的音频文件丢失；不会自动重复生成')
          const selectedVoice = job.edgeVoice ?? EDGE_VOICES[0].id
          if (!isEdgeVoiceId(selectedVoice)) throw new Error('Edge TTS 声音无效')
          const pending = this.store.file(job.id, 'audio/edge.pending.mp3')
          rmSync(pending, {force: true})
          job.edgeSubmission = 'uncertain'; this.store.persist(job)
          const result = await command(pythonExecutable(this.upstream), [join(this.upstream, '..', 'scripts', 'tts_edge.py'), this.store.file(job.id, 'script.json'), pending, selectedVoice],
            {cwd: root, env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}, signal, timeout: 270000})
          if (result.code !== 0 || !present(pending)) throw new Error(`Edge TTS 配音失败（退出码 ${result.code}）；不会自动重试。请检查服务或网络后明确重试`)
          const probe = await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', pending], {signal, timeout: 20000})
          const duration = Number.parseFloat(probe.output.trim())
          if (probe.code !== 0 || !Number.isFinite(duration) || duration < 0.5) throw new Error('Edge TTS 返回的音频无效；不会自动重试')
          renameSync(pending, mp3)
          job.edgeSubmission = 'completed'; this.store.persist(job)
        }
        const pendingWav = this.store.file(job.id, 'audio/full.pending.wav')
        const converted = await command('ffmpeg', ['-y', '-i', mp3, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', pendingWav], {signal, timeout: 120000})
        if (converted.code !== 0 || !present(pendingWav)) throw new Error('Edge TTS 配音转换失败，可继续任务重试本地转换')
        renameSync(pendingWav, wav)
      } else {
        const key = (await this.secrets.read()).fish
        if (!key) throw new Error('未设置 Fish Audio 密钥')
        job.fishSubmission = 'uncertain'; this.store.persist(job)
        const result = await command(pythonExecutable(this.upstream), [join(this.upstream, 'scripts', 'tts_fishaudio.py'), this.store.file(job.id, 'script.json'), wav, timestamps, '--mode', 'stream'],
          {cwd: root, env: {...process.env, FISH_AUDIO_API_KEY: key, PYTHONUTF8: '1'}, signal, timeout: 360000})
        if (result.code !== 0 || !present(wav) || !present(timestamps)) throw new Error('Fish Audio 请求未确认成功；不会自动重复提交。请检查服务结果或上传音频')
        job.fishSubmission = 'completed'; this.store.persist(job)
      }
    }
    const pending = this.store.file(job.id, 'audio/timestamps.pending.json')
    if (!validTimestamps(timestamps) && validTimestamps(pending)) renameSync(pending, timestamps)
    if (!validTimestamps(timestamps)) {
      const model = process.env.FIRERED_ASR_MODEL_DIR ?? join(this.upstream, 'runtime', 'models', 'firered')
      const result = await command(pythonExecutable(this.upstream), [join(this.upstream, 'scripts', 'timestamps_cpu.py'), wav, this.store.file(job.id, 'script.json'), pending, '--model-dir', model],
        {cwd: root, env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}, signal, timeout: 900000})
      if (result.code !== 0 || !validTimestamps(pending)) throw new Error(`字级对齐失败：${result.output.slice(-500)}`)
      renameSync(pending, timestamps)
    }
    if (!validTimestamps(timestamps)) throw new Error('字级时间轴文件损坏，请重新生成')
    mkdirSync(this.store.file(job.id, 'remotion/public'), {recursive: true})
    copyFileSync(wav, this.store.file(job.id, 'remotion/public/full.wav'))
    for (const item of job.uploads.filter(item => item.kind !== 'voice')) {
      const dest = this.store.file(job.id, `remotion/public/assets/${basename(item.file)}`)
      mkdirSync(join(root, 'remotion', 'public', 'assets'), {recursive: true})
      if (!present(dest)) copyFileSync(this.store.file(job.id, item.file), dest)
    }
    if (!validJson(this.store.file(job.id, 'media_candidates.json'))) {
      let queries: string[] | undefined
      const needsSearch = job.onlineSearch !== false && job.uploads.filter(item => item.kind !== 'voice').length < 2
      const credentials = needsSearch ? await this.secrets.publicState() : undefined
      if (credentials?.pexels || credentials?.pixabay) {
        const queryFile = this.store.file(job.id, 'media_queries.json')
        if (!validJson(queryFile)) {
          await this.agents.run(root, '你是 TalkCraft 素材检索策划。只写当前任务目录；不用任何服务密钥。', `阅读 script.txt 与 audio/timestamps.json，提炼最多两个具体、易在 Pexels/Pixabay 搜到的画面检索词。写入 ${queryFile}，格式为 {"queries":["...","..."]}。不要下载素材。`, signal,
            {onSessionId: id => this.trackAgentSession(job, id)})
        }
        const value = validJson(queryFile) ? JSON.parse(readFileSync(queryFile, 'utf8')) as {queries?: unknown} : null
        if (!Array.isArray(value?.queries) || !value.queries.some(item => typeof item === 'string' && item.trim())) throw new Error('素材检索 Agent 未生成有效关键词')
        queries = value.queries.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 2)
      }
      await searchCandidates(job, this.secrets, this.store, queries, signal)
    }
    if (!job.uploads.some(item => item.kind !== 'voice') && !job.candidates.some(item => item.selected)) {
      throw new Error('没有可用的画面素材；请上传图片或视频，或检查 Pexels/Pixabay 的检索结果')
    }
    await downloadSelected(job, this.store, signal)
    const sources = [
      '# 素材来源',
      '',
      ...job.uploads.filter(item => item.kind !== 'voice').map(item => `- 用户上传：${item.name}；文件：${item.file}；用途：待分镜确定。`),
      ...job.candidates.filter(item => item.selected).map(item => `- ${item.provider}：${item.source || item.id}；作者：${item.author || '未知'}；文件：${candidateLocalFile(item)}；用途：待分镜确定。`),
      '',
    ]
    writeFileSync(this.store.file(job.id, 'sources.md'), sources.join('\n'))
    if (!validJson(this.store.file(job.id, 'asset_plan.json'))) {
      const assets = [...job.uploads.filter(item => item.kind !== 'voice').map(item => item.file), ...job.candidates.filter(item => item.selected).map(item => item.id)]
      const prompt = `阅读 ${this.store.file(job.id, 'script.json')}、${timestamps}、${this.store.file(job.id, 'media_candidates.json')} 和 remotion/public/assets。为每句配音制定素材与视觉方案，写入 ${this.store.file(job.id, 'asset_plan.json')}。必须列出所用素材路径、来源、用途；优先使用用户上传素材，远端候选只允许使用 selected=true 的项。不要下载新素材，也不要使用任何密钥。`
      await this.agents.run(root, '你是 TalkCraft 素材与字级时间轴策划。只写当前任务目录；使用文件和终端工具，不请求用户聊天确认。', prompt, signal,
        {onSessionId: id => this.trackAgentSession(job, id)})
      if (!validJson(this.store.file(job.id, 'asset_plan.json'))) throw new Error(`Agent 未生成有效素材方案；已有素材：${assets.join(', ')}`)
    }
    this.store.artifact(job, 'audio/timestamps.json', '字级时间轴')
    this.store.artifact(job, 'audio/full.wav', '配音音频')
  }
  private async agentStage(job: Job, stage: Exclude<Stage, 'prepare'>, signal: AbortSignal): Promise<void> {
    const root = this.store.directory(job.id)
    const skill = join(this.upstream, 'SKILL.md')
    const feedback = job.feedback ? `\n用户修改意见：${job.feedback}\n` : ''
    const common = `工程目录 ${root}。TalkCraft 固定源码 ${this.upstream}，阅读 ${skill} 中当前阶段，并按实际选用的镜头和卡读取对应 references；不要遍历整个参考库。该 SKILL.md 的「每片开工升级运行时」只适用于原仓库，在此插件中已由独立的一次性准备流程替代；绝对不要运行 check-runtime.sh、npm install/ci/update 或任何自动升级命令。画幅 ${job.aspect}，有声配音 audio/full.wav，时间戳 audio/timestamps.json。Remotion/React 19 依赖在 ${join(this.upstream, 'runtime', 'node_modules')}，绝对不能导入 DSH Client React 18。仅写本任务目录，使用 Windows 可用的 Node/Python/ffmpeg 命令，不用 rsync/open/Unix 专属命令。在 PowerShell 中运行 Python 时设置 PYTHONIOENCODING=utf-8；中文文件始终按 UTF-8 读写。${feedback}`
    const stagePrompts: Record<Exclude<Stage, 'prepare'>, string> = {
      shotbook: `${common}\n先读 script.txt、audio/timestamps.json、asset_plan.json、media_candidates.json 和 sources.md，再读 SKILL.md 第④阶段、references/shot-design.md 与 cinematography.md 第4节。素材描述以 asset_plan.json 为准；无界面 Agent 不要反复调用 read_image。先写非空的 SHOTBOOK.md 和 remotion/shots.json（镜头 ID 从 s01 起，时间连续），再按第④阶段细化每镜的素材路径、来源、节拍、版式和选卡；仅查所选卡的文档。每镜必须用机器可读的独立行：\`- 素材：图（remotion/public/assets/实际文件名.jpg）\`、\`- 蒙皮行：卡名 → 改了什么皮\`，不能用 \`- **素材**：\` 或仅写在自然语言段落里。G0 写版式节奏表。运行 preflight 检查并修正失败项。不要进入样板镜。`,
      sample: `${common}\n用户已确认 SHOTBOOK。按第⑤阶段创建完整 Remotion 工程骨架，只精做 s01 样板镜，包含成品配音和字幕。运行 node ${join(this.upstream, 'scripts', 'render_shots.mjs')} --shots shots.json --only s01 --seg-audio --preview-dir out/preview，在 remotion 目录执行；确保 remotion/out/preview/s01.mp4 是真实可播放且有声音的样板镜。不要制作其余镜头。`,
      finish: `${common}\n用户已确认有声样板镜。按第⑤⑥阶段实现其余镜头、字幕、转场与动效，运行机器检查与 node ${join(this.upstream, 'scripts', 'render_shots.mjs')} --shots shots.json --all --parallel 2 --concat out/assembled.mp4 --audio out/full-mix.wav --mux out/finished.mp4，在 remotion 目录执行。确认音轨后把 remotion/out/finished.mp4 复制到任务根 delivery.mp4。`,
      review: `${common}\n这是新的独立审片上下文。只读检查 SHOTBOOK.md、remotion/shots.json、delivery.mp4、机器验收结果和抽帧；按 TalkCraft 第⑦阶段独立审片。写 review/decision.json 为 {"pass":true|false,"issues":[{"severity":"P0|P1|P2","detail":"..."}]}。发现 P0/P1 时 pass=false。不得修改成片或分镜。`,
    }
    const progress = () => ({resumeSessionId: job.stageSessions?.[stage], onSessionId: (id: string) => {job.stageSessions ??= {}; job.stageSessions[stage] = id; this.trackAgentSession(job, id); this.store.persist(job)}})
    if (stage === 'shotbook' && (!present(this.store.file(job.id, 'SHOTBOOK.md')) || !validShotDraft(this.store.file(job.id, 'remotion/shots.json')))) {
      await this.agents.run(root, '你是 TalkCraft 分镜草稿撰写者。当前步骤只负责先写文件；只写任务目录，不访问其他插件数据。',
        `只读 ${this.store.file(job.id, 'script.txt')}、${this.store.file(job.id, 'audio/timestamps.json')}、${this.store.file(job.id, 'asset_plan.json')} 和 ${this.store.file(job.id, 'sources.md')}。现在先写 ${this.store.file(job.id, 'remotion/shots.json')}，格式为从 s01 开始、时间连续的非空镜头数组 [{"id":"s01","start":0,"end":...}]；再写 ${this.store.file(job.id, 'SHOTBOOK.md')}，含每镜的 ### S01 起止秒标题、画面意图、已选素材的真实文件路径与来源，以及 ## 未完成 / 未采集清单。每镜把实际图片写成独立的 \`- 素材：图（remotion/public/assets/实际文件名.jpg）\` 行；这行是后续机器验收所需的格式。此步只需可修改的草稿，不读 SKILL.md、references、卡库或插件代码，也不运行检查。${feedback}`,
        signal, {resumeSessionId: job.shotbookDraftSession,
          onSessionId: id => {job.shotbookDraftSession = id; this.trackAgentSession(job, id); this.store.persist(job)}})
      if (!present(this.store.file(job.id, 'SHOTBOOK.md')) || !validShotDraft(this.store.file(job.id, 'remotion/shots.json'))) throw new Error('Agent 未写出初版分镜或镜头表')
    }
    await this.agents.run(root, `TalkCraft 独立制作阶段：${stage}。严格按固定 SKILL.md、模板和卡库执行；不得访问其他插件数据。`, stagePrompts[stage], signal, progress())
    if (stage === 'shotbook') {
      try {await this.checkShotbook(job, signal)}
      catch (error) {
        if (signal.aborted) throw error
        await this.agents.run(root, '你是 TalkCraft 分镜机器验收修复者。只修改当前任务的分镜、镜头表及相关标注。',
          `现有 SHOTBOOK.md 和 remotion/shots.json 已写出，但机器验收失败：${message(error)}。直接读取这两个文件及失败项，补足真实素材路径、每镜机器可读的「- 素材：图（实际文件路径）」和「- 蒙皮行：所选卡名 → 改了什么皮」、选卡及版式，运行 preflight.py --project "${root}" --shotbook SHOTBOOK.md --shots remotion/shots.json --voice audio/full.wav --fps 30 直到通过。只做这一步，不重新阅读整个 SKILL 或卡库。`,
          signal, {resumeSessionId: job.shotbookRepairSession,
            onSessionId: id => {job.shotbookRepairSession = id; this.trackAgentSession(job, id); this.store.persist(job)}})
        await this.checkShotbook(job, signal)
      }
    }
    if (stage === 'shotbook') this.store.artifact(job, 'SHOTBOOK.md', '分镜脚本')
    if (stage === 'sample') this.store.artifact(job, 'remotion/out/preview/s01.mp4', '有声样板镜')
    job.feedback = undefined; this.store.persist(job)
  }
  private async checkShotbook(job: Job, signal: AbortSignal): Promise<void> {
    const shots = JSON.parse(readFileSync(this.store.file(job.id, 'remotion/shots.json'), 'utf8')) as unknown
    if (!Array.isArray(shots) || shots.length === 0 || shots[0]?.id !== 's01') throw new Error('分镜表必须包含 s01 样板镜')
    const result = await command(pythonExecutable(this.upstream), [join(this.upstream, 'scripts', 'preflight.py'), '--project', this.store.directory(job.id), '--shotbook', 'SHOTBOOK.md', '--shots', 'remotion/shots.json', '--voice', 'audio/full.wav', '--fps', '30'], {cwd: this.store.directory(job.id), env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}, signal, timeout: 120000})
    if (result.code !== 0) throw new Error(`分镜机器验收失败：${result.output.slice(-800)}`)
  }
  private async checkVideoFile(path: string, signal: AbortSignal): Promise<void> {
    const result = await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path], {signal, timeout: 20000})
    if (result.code !== 0 || !result.output.includes('video') || !result.output.includes('audio')) throw new Error('成片必须包含可读的视频轨与音频轨')
  }
}
