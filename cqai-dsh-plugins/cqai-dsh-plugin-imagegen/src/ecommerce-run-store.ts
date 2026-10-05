/** Durable product-set plans and host orchestration. Queue observations, run
 * mutations and image copies share one serialization lane; opening a run is a
 * read and can never enqueue work. No generated image depends on history's
 * bounded index or on a mounted browser. */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { imageDataRoot } from './image-storage-path.ts'
import { generationOrigin } from './history-origin.ts'
import { listHistory, readHistoryImage, removeHistory } from './history-store.ts'
import type { ImageGenerationRuntime } from './generation-runtime.ts'
import type { GenerateRequest, GenerationTask, GeneratedImage, HistoryEntry, HistoryImageRef } from './protocol.ts'
import { ECOMMERCE_API, type EcommerceRun, type EcommerceRunAttempt, type EcommerceRunSlot, type EcommerceRunSubmit, type EcommerceRunSummary } from './ecommerce-run-protocol.ts'

export interface EcommerceLegacyHistory {
  list(): Promise<HistoryEntry[]>
  readImage(file: string): Promise<{ data: Buffer; mime: string } | undefined>
  /** Explicit user deletion also removes this run's bounded-history rows. */
  remove?(id: string): Promise<unknown>
}
export interface EcommerceRunStoreOptions {
  runtime: Pick<ImageGenerationRuntime, 'queue'>
  history?: EcommerceLegacyHistory
  root?: () => string
  resolveRequest?: (request: GenerateRequest) => Promise<GenerateRequest>
}
interface StoredRun extends EcommerceRun { requestId?: string; legacyHistoryIds?: string[] }
interface RunIndex { version: 1; runs: StoredRun[]; removed: string[]; deletedRequests?: string[]; pendingCleanup?: StoredRun[] }
interface RootState { directory: string; index: RunIndex; committed: RunIndex }
const ACTIVE = new Set(['queued', 'running'])
const IMAGE_DATA = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([a-zA-Z0-9+/]+={0,2})$/
const SAFE_ID = /^(?:[a-f0-9-]{36}|legacy-[a-f0-9]{32})$/
const SAFE_FILE = /^[a-f0-9]{64}\.(?:png|jpg|webp|gif|bmp)$/
const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const clone = <T>(value: T): T => structuredClone(value)
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
const isMain = (slot: EcommerceRunSlot): boolean => slot.key === 'main' || slot.key.startsWith('main-')
const terminal = (run: EcommerceRun): boolean => !ACTIVE.has(run.status)
const extension = (mime: string): string => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' })[mime] ?? 'png'
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): boolean => Array.isArray(value) && value.every(item => typeof item === 'string')
const SLOT_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'])
const RUN_STATUSES = new Set([...SLOT_STATUSES, 'partial-failed'])

function validDraft(value: unknown): boolean {
  if (!object(value)) return false
  if (['projectId', 'projectName', 'category', 'platform', 'language', 'size', 'productName', 'promptInfo'].some(key => typeof value[key] !== 'string')) return false
  if (!Array.isArray(value.slots) || value.slots.some(slot => !object(slot) || typeof slot.key !== 'string'
    || typeof slot.label !== 'string' || typeof slot.description !== 'string' || typeof slot.enabled !== 'boolean'
    || !Number.isInteger(slot.count) || Number(slot.count) < 1 || Number(slot.count) > 100
    || (slot.refRole !== undefined && !['none', 'product', 'packaging', 'detail', 'style'].includes(String(slot.refRole))))) return false
  if (value.promptOverrides !== undefined && (!object(value.promptOverrides) || Object.values(value.promptOverrides).some(item => typeof item !== 'string'))) return false
  if (['customLanguage', 'sellingPoints', 'protectedFeatures', 'styleHint'].some(key => value[key] !== undefined && typeof value[key] !== 'string')) return false
  return true
}

function validSavedRun(value: unknown): boolean {
  if (!object(value)) return false
  const run = value as unknown as StoredRun
  if (typeof run.id !== 'string' || !SAFE_ID.test(run.id) || !Number.isFinite(run.createdAt) || !Number.isFinite(run.updatedAt)
    || !RUN_STATUSES.has(run.status) || !Array.isArray(run.slots) || run.slots.length === 0
    || (run.requestId !== undefined && typeof run.requestId !== 'string')
    || (run.legacyHistoryIds !== undefined && !strings(run.legacyHistoryIds))
    || (run.legacy !== undefined && typeof run.legacy !== 'boolean')) return false
  const prefix = `${ECOMMERCE_API.asset}/${run.id}/`
  const validUrl = (url: unknown): boolean => typeof url === 'string' && url.startsWith(prefix) && SAFE_FILE.test(url.slice(prefix.length))
  const validImages = (images: unknown): boolean => Array.isArray(images) && images.every(image => object(image) && validUrl(image.url) && typeof image.mime === 'string')
  const validRequest = (request: unknown): boolean => object(request) && (request.mode === 'text' || request.mode === 'edit')
    && ['model', 'prompt', 'size', 'quality', 'detail'].every(key => typeof request[key] === 'string')
    && Number.isInteger(request.n) && Number(request.n) >= 1 && Number(request.n) <= 4
    && ['projectName', 'projectId', 'slotKey', 'slotLabel', 'channelId', 'channel', 'refName', 'upstream'].every(key => request[key] === undefined || typeof request[key] === 'string')
    && (request.image === undefined || validUrl(request.image))
    && (request.images === undefined || (Array.isArray(request.images) && request.images.every(validUrl)))
  if (run.config === undefined && !run.legacy) return false
  if (run.config !== undefined && (!object(run.config) || !validDraft(run.config.draft)
    || ['providerId', 'model', 'quality', 'detail'].some(key => typeof (run.config as unknown as Record<string, unknown>)[key] !== 'string')
    || !Array.isArray(run.config.assets) || run.config.assets.some(asset => !object(asset) || typeof asset.id !== 'string' || typeof asset.name !== 'string'
      || !['product', 'packaging', 'detail', 'style'].includes(asset.role) || !validUrl(asset.url)))) return false
  return run.slots.every(slot => object(slot) && typeof slot.key === 'string' && typeof slot.label === 'string'
    && SLOT_STATUSES.has(slot.status) && Number.isInteger(slot.attempt) && slot.attempt >= 0 && validRequest(slot.request) && validImages(slot.images)
    && (slot.blockedByMain === undefined || typeof slot.blockedByMain === 'boolean')
    && (slot.attempts === undefined || (Array.isArray(slot.attempts) && slot.attempts.every(attempt => object(attempt)
      && Number.isInteger(attempt.number) && attempt.number >= 1 && SLOT_STATUSES.has(attempt.status) && validRequest(attempt.request) && validImages(attempt.images)))))
}

function validIndex(value: unknown): value is RunIndex {
  return object(value) && value.version === 1 && Array.isArray(value.runs) && value.runs.every(validSavedRun)
    && strings(value.removed) && (value.deletedRequests === undefined || strings(value.deletedRequests))
    && (value.pendingCleanup === undefined || (Array.isArray(value.pendingCleanup) && value.pendingCleanup.every(validSavedRun)))
}

export class EcommerceRunError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

/** Reject malformed plans before persisting assets or making billable calls. */
export function validateEcommerceRunSubmit(value: unknown): asserts value is EcommerceRunSubmit {
  if (value === null || typeof value !== 'object') throw new EcommerceRunError('电商任务参数无效', 'bad-request')
  const input = value as EcommerceRunSubmit
  if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200
    || typeof input.model !== 'string' || !input.model.trim()
    || typeof input.providerId !== 'string' || !input.providerId.trim() || typeof input.quality !== 'string' || typeof input.detail !== 'string'
    || !validDraft(input.draft) || !Array.isArray(input.assets)
    || !Array.isArray(input.requests) || input.requests.length === 0 || input.requests.length > 100) {
    throw new EcommerceRunError('请提供完整的商品配置与图片计划', 'bad-request')
  }
  for (const field of ['projectId', 'projectName', 'category', 'platform', 'language', 'size', 'productName', 'promptInfo'] as const) {
    if (typeof input.draft[field] !== 'string') throw new EcommerceRunError(`商品配置缺少 ${field}`, 'bad-request')
  }
  if (input.assets.length > 40 || input.assets.some(asset => !asset || typeof asset.id !== 'string'
    || typeof asset.name !== 'string' || !['product', 'packaging', 'detail', 'style'].includes(asset.role)
    || typeof asset.dataUrl !== 'string' || !IMAGE_DATA.test(asset.dataUrl))) {
    throw new EcommerceRunError('商品素材必须是 PNG、JPEG、WebP、GIF 或 BMP 图片', 'bad-request')
  }
  const keys = new Set<string>()
  for (const request of input.requests) {
    const key = typeof request?.slotKey === 'string' ? request.slotKey.trim() : ''
    if (!request || (request.mode !== 'text' && request.mode !== 'edit')
      || typeof request.prompt !== 'string' || !request.prompt.trim()
      || typeof request.model !== 'string' || !request.model.trim()
      || typeof request.size !== 'string' || typeof request.quality !== 'string' || typeof request.detail !== 'string'
      || !Number.isInteger(request.n) || request.n < 1 || request.n > 4
      || typeof request.slotKey !== 'string' || !key || keys.has(key)
      || request.canvas !== undefined || request.comparisonId !== undefined || request.comparisonModels !== undefined
      || ['refName', 'channelId', 'channel', 'upstream', 'projectId', 'projectName', 'slotLabel'].some(key => {
        const value = (request as unknown as Record<string, unknown>)[key]
        return value !== undefined && typeof value !== 'string'
      })
      || (request.image !== undefined && !IMAGE_DATA.test(request.image))
      || (request.images !== undefined && (!Array.isArray(request.images) || request.images.some(image => typeof image !== 'string' || !IMAGE_DATA.test(image))))
      || (request.mode === 'edit' && !request.image && !request.images?.length)) {
      throw new EcommerceRunError('每个图片计划需包含唯一位置、提示词和真实参考图', 'bad-request')
    }
    keys.add(key)
  }
}

export class EcommerceRunStore {
  private pending: Promise<void> = Promise.resolve()
  private readonly roots = new Map<string, RootState>()
  private readonly taskRoots = new Map<string, RootState>()
  private readonly history: EcommerceLegacyHistory
  private readonly unsubscribe: () => void
  private disposed = false
  private readonly observations = new Map<string, GenerationTask>()
  private retryTimer?: ReturnType<typeof setTimeout>
  private retryDelay = 100

  constructor(private readonly options: EcommerceRunStoreOptions) {
    this.history = options.history ?? { list: listHistory, readImage: readHistoryImage, remove: id => removeHistory(id, 'ecommerce') }
    this.unsubscribe = options.runtime.queue.subscribe(task => {
      this.observations.set(task.id, task)
      this.queueObservation(task.id)
    })
  }

  /** Release only the observer (tests / host disposal); never cancels calls. */
  dispose(): Promise<void> {
    this.disposed = true
    this.unsubscribe()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.observations.clear()
    return this.pending
  }

  private assertAlive(): void {
    if (this.disposed) throw new EcommerceRunError('电商任务服务已关闭，请刷新应用', 'store-disposed')
  }

  private queueObservation(id: string): void {
    void this.mutate(async () => {
      const task = this.observations.get(id)
      if (!task) return
      await this.observe(task)
      if (this.observations.get(id) === task) this.observations.delete(id)
    }).catch(error => {
      if (this.disposed) return
      console.error('[e图宝] 电商任务保存失败，将重试保存:', messageOf(error))
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined
          for (const key of this.observations.keys()) this.queueObservation(key)
        }, this.retryDelay)
        this.retryTimer.unref?.()
        this.retryDelay = Math.min(5000, this.retryDelay * 2)
      }
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      this.assertAlive()
      try { return await operation() }
      catch (error) {
        // A rejected write must never make cancelled/deleted state appear in
        // memory. Retain the last successful durable snapshot for every root.
        for (const state of new Set([...this.roots.values(), ...this.taskRoots.values()])) state.index = clone(state.committed)
        throw error
      }
    }
    const result = this.pending.then(execute, execute)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  private async state(): Promise<RootState> {
    const directory = path.join((this.options.root ?? imageDataRoot)(), 'ecommerce')
    const known = this.roots.get(directory)
    if (known !== undefined) { await this.cleanup(known); return known }
    await fs.mkdir(directory, { recursive: true })
    let index: RunIndex = { version: 1, runs: [], removed: [] }
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8'))
      if (!validIndex(parsed)) {
        throw new EcommerceRunError('电商历史文件格式无效，请保留原文件后恢复备份', 'storage-corrupt')
      }
      index = parsed as RunIndex
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state: RootState = { directory, index, committed: clone(index) }
    // A persisted task id is not proof that an upstream call can be safely
    // reissued after restart. Explicit retry is the only resubmission path.
    for (const run of index.runs) {
      if (!ACTIVE.has(run.status)) continue
      for (const slot of run.slots) if (ACTIVE.has(slot.status)) {
        slot.status = 'interrupted'
        slot.error = '应用重启，原生成结果未确认；请检查后手动重试'
        const attempt = slot.attempts?.at(-1)
        if (attempt && ACTIVE.has(attempt.status)) { attempt.status = 'interrupted'; attempt.error = slot.error; attempt.finishedAt = Date.now() }
      }
      run.status = 'interrupted'
      run.updatedAt = Math.max(Date.now(), run.updatedAt + 1)
    }
    await this.save(state)
    await this.cleanup(state)
    await this.importLegacy(state)
    this.roots.set(directory, state)
    return state
  }

  private async save(state: RootState): Promise<void> {
    this.assertAlive()
    if (!validIndex(state.index)) throw new EcommerceRunError('电商任务数据不完整，已保留原文件；请检查历史元数据或恢复备份', 'storage-corrupt')
    const file = path.join(state.directory, 'index.json')
    const temporary = `${file}.tmp-${randomUUID()}`
    await fs.writeFile(temporary, JSON.stringify(state.index), 'utf8')
    this.assertAlive()
    await fs.rename(temporary, file)
    state.committed = clone(state.index)
  }

  private wire(run: StoredRun): EcommerceRun {
    const { requestId: _requestId, legacyHistoryIds: _legacyHistoryIds, ...wire } = run
    return clone(wire)
  }

  private summary(run: StoredRun): EcommerceRunSummary {
    const first = run.slots.find(slot => isMain(slot) && slot.images.length > 0) ?? run.slots.find(slot => slot.images.length > 0)
    return {
      id: run.id,
      name: run.config?.draft.productName.trim() || run.config?.draft.projectName.trim() || run.slots[0]?.request.projectName?.trim() || '未命名商品',
      createdAt: run.createdAt, updatedAt: run.updatedAt, status: run.status,
      done: run.slots.filter(slot => slot.status === 'completed').length, total: run.slots.length,
      model: run.config?.model ?? run.slots[0]?.request.model ?? '', size: run.config?.draft.size ?? run.slots[0]?.request.size ?? '',
      searchText: [run.config?.draft.promptInfo, ...run.slots.map(slot => slot.request.prompt)].filter(Boolean).join('\n'),
      ...first?.images[0] === undefined ? {} : { thumbnail: clone(first.images[0]) },
      ...run.legacy ? { legacy: true } : {},
    }
  }

  async list(): Promise<EcommerceRunSummary[]> {
    return this.mutate(async () => (await this.state()).index.runs.map(run => this.summary(run)).sort((a, b) => b.createdAt - a.createdAt))
  }

  async get(id: string): Promise<EcommerceRun | undefined> {
    return this.mutate(async () => {
      const run = (await this.state()).index.runs.find(run => run.id === id)
      return run === undefined ? undefined : this.wire(run)
    })
  }

  async submit(input: EcommerceRunSubmit): Promise<EcommerceRun> {
    validateEcommerceRunSubmit(input)
    return this.mutate(async () => {
      const state = await this.state()
      const duplicate = state.index.runs.find(run => run.requestId === input.requestId)
      if (duplicate) return this.wire(duplicate)
      if (state.index.deletedRequests?.includes(input.requestId)) throw new EcommerceRunError('原任务已删除；请创建新的生成任务', 'request-removed')
      const id = randomUUID()
      const now = Date.now()
      const run: StoredRun = {
        id, requestId: input.requestId, createdAt: now, updatedAt: now, status: 'queued',
        config: { draft: clone(input.draft), providerId: input.providerId, model: input.model, quality: input.quality, detail: input.detail, assets: [] },
        slots: [],
      }
      const urls = new Map<string, string>()
      try {
        for (const asset of input.assets) {
          const image = await this.putDataUrl(state, id, asset.dataUrl)
          urls.set(asset.dataUrl, image.url)
          run.config!.assets.push({ id: asset.id, name: asset.name, role: asset.role, url: image.url })
        }
        for (const original of input.requests) {
          const request = clone(original)
          if (!request.image && request.images?.length) {
            request.image = request.images[0]
            request.images = request.images.slice(1)
          }
          const persistReference = async (url: string): Promise<string> => {
            const existing = urls.get(url)
            if (existing) return existing
            const ref = await this.putDataUrl(state, id, url)
            urls.set(url, ref.url)
            return ref.url
          }
          if (request.image) request.image = await persistReference(request.image)
          if (request.images) request.images = await Promise.all(request.images.map(persistReference))
          request.workflow = 'ecommerce'
          request.projectId = id
          request.channelId = input.providerId.trim()
          request.slotKey = request.slotKey!.trim()
          request.slotLabel = request.slotLabel?.trim() || request.slotKey
          const projectName = input.draft.productName.trim() || input.draft.projectName.trim()
          if (projectName) request.projectName = projectName
          else delete request.projectName
          run.slots.push({ key: request.slotKey!, label: request.slotLabel || request.slotKey!, status: 'queued', attempt: 0, request, images: [], attempts: [] })
        }
        state.index.runs.unshift(run)
        await this.save(state)
      } catch (error) {
        state.index.runs = state.index.runs.filter(candidate => candidate.id !== id)
        await fs.rm(path.join(state.directory, id), { recursive: true, force: true })
        throw error
      }
      await this.schedule(state, run)
      return this.wire(run)
    })
  }

  private async putDataUrl(state: RootState, id: string, dataUrl: string): Promise<HistoryImageRef> {
    const match = IMAGE_DATA.exec(dataUrl)
    if (!match) throw new EcommerceRunError('参考图未保存在任务中，不能将图生图降级为文生图', 'reference-missing')
    return this.putImage(state, id, { b64: match[2], mime: match[1] })
  }

  private async putImage(state: RootState, id: string, image: GeneratedImage): Promise<HistoryImageRef> {
    if (!Object.hasOwn({ 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1, 'image/bmp': 1 }, image.mime)) {
      throw new EcommerceRunError('生成结果图片格式不受支持', 'image-invalid')
    }
    const data = Buffer.from(image.b64, 'base64')
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new EcommerceRunError('图片为空或超出 24 MB 限制', 'image-invalid')
    const file = `${createHash('sha256').update(data).digest('hex')}.${extension(image.mime)}`
    const directory = path.join(state.directory, id)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, file), data)
    return { url: `${ECOMMERCE_API.asset}/${id}/${file}`, mime: image.mime, ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt } }
  }

  private async hydrateReference(state: RootState, id: string, url: string): Promise<string> {
    const prefix = `${ECOMMERCE_API.asset}/${id}/`
    if (!url.startsWith(prefix)) throw new EcommerceRunError('参考图不属于本任务，已阻止重新生成', 'reference-missing')
    const file = url.slice(prefix.length)
    const asset = await this.readAssetAt(state, id, file)
    if (!asset) throw new EcommerceRunError('参考图文件丢失，请恢复原始素材后重试', 'reference-missing')
    return `data:${asset.mime};base64,${asset.data.toString('base64')}`
  }

  private async schedule(state: RootState, run: StoredRun): Promise<void> {
    this.assertAlive()
    if (run.legacy || !ACTIVE.has(run.status)) return
    const mains = run.slots.filter(isMain)
    const anchor = mains.find(slot => slot.status === 'completed' && slot.images.length > 0)?.images[0]
    const waitingForMain = mains.length > 0 && anchor === undefined
    for (const slot of run.slots) {
      if (slot.status !== 'queued' || slot.taskId !== undefined) continue
      if (waitingForMain && !isMain(slot)) {
        if (mains.every(main => !ACTIVE.has(main.status))) {
          slot.status = 'failed'
          slot.error = '主图生成失败，后续图片未提交；请先重试主图'
          slot.blockedByMain = true
        }
        continue
      }
      slot.attempt += 1
      slot.error = undefined
      const attempt: EcommerceRunAttempt = { number: slot.attempt, status: 'queued', request: clone(slot.request), images: [] }
      ;(slot.attempts ??= []).push(attempt)
      try {
        let request = clone(slot.request)
        if (request.image) request.image = await this.hydrateReference(state, run.id, request.image)
        if (request.images) request.images = await Promise.all(request.images.map(url => this.hydrateReference(state, run.id, url)))
        if (anchor && !isMain(slot)) {
          const dataUrl = await this.hydrateReference(state, run.id, anchor.url)
          const previous = [request.image, ...request.images ?? []].filter((item): item is string => Boolean(item))
          request = { ...request, mode: 'edit', image: dataUrl, images: [...new Set(previous)].filter(reference => reference !== dataUrl), refName: request.refName ? `套图主图 + ${request.refName}` : '套图主图', prompt: `${request.prompt}\n商品身份以上传的套图主图为锚点；只复用商品外观，重新设计当前图片的构图与背景。` }
        }
        if (request.mode === 'edit' && !request.image && !request.images?.length) throw new EcommerceRunError('缺少图生图参考图片', 'reference-missing')
        if (this.options.resolveRequest) request = await this.options.resolveRequest(request)
        const resolved = clone(request)
        if (resolved.image) resolved.image = (await this.putDataUrl(state, run.id, resolved.image)).url
        if (resolved.images) resolved.images = await Promise.all(resolved.images.map(async reference => (await this.putDataUrl(state, run.id, reference)).url))
        attempt.request = resolved
        // Record the real billable plan before handing it to the in-memory
        // queue. A crash here is interrupted work, never an automatic resend.
        await this.save(state)
        this.assertAlive()
        const task = this.options.runtime.queue.submit(request)
        slot.taskId = task.id
        slot.status = task.status
        attempt.taskId = task.id
        attempt.status = task.status
        attempt.startedAt = task.startedAt
        this.taskRoots.set(task.id, state)
      } catch (error) {
        slot.status = 'failed'
        slot.error = messageOf(error)
        attempt.status = 'failed'; attempt.error = slot.error; attempt.finishedAt = Date.now()
      }
    }
    this.updateStatus(run)
    await this.save(state)
    // A synchronous provider/reference failure can fail every main before any
    // queue event is published; mark its dependent plan without submitting it.
    if (waitingForMain && mains.every(main => !ACTIVE.has(main.status))) {
      for (const slot of run.slots) if (!isMain(slot) && slot.status === 'queued' && !slot.taskId) {
        slot.status = 'failed'; slot.error = '主图生成失败，后续图片未提交；请先重试主图'; slot.blockedByMain = true
      }
      this.updateStatus(run)
      await this.save(state)
    }
  }

  private async observe(task: GenerationTask): Promise<void> {
    const state = this.taskRoots.get(task.id)
    if (!state) return
    const run = state.index.runs.find(run => run.id === task.request.projectId)
    const slot = run?.slots.find(slot => slot.taskId === task.id)
      ?? run?.slots.find(slot => slot.key === task.request.slotKey && slot.taskId === undefined && ACTIVE.has(slot.status) && slot.attempts?.at(-1)?.taskId === undefined)
    if (!run || !slot || !ACTIVE.has(slot.status) || run.status === 'cancelled') return
    if (!slot.taskId) {
      slot.taskId = task.id
      const attempt = slot.attempts?.at(-1)
      if (attempt) attempt.taskId = task.id
    }
    if (task.status === 'completed') {
      try {
        if (!task.result?.images.length) throw new EcommerceRunError('生成结果为空', 'empty-result')
        slot.images = await Promise.all(task.result.images.map(image => this.putImage(state, run.id, image)))
        slot.status = 'completed'; slot.error = undefined
      } catch (error) {
        // A disk fault is a pending save of an already paid result, never a
        // reason to call the model again. Keep the observation for backoff.
        if (!(error instanceof EcommerceRunError)) throw error
        slot.status = 'failed'; slot.error = `生成结果保存失败：${messageOf(error)}`
      }
    } else {
      slot.status = task.status
      if (task.error) slot.error = task.error
    }
    const attempt = slot.attempts?.find(attempt => attempt.taskId === task.id)
    if (attempt) {
      attempt.status = slot.status
      attempt.startedAt = task.startedAt
      attempt.finishedAt = task.finishedAt
      if (task.status === 'completed' && slot.status === 'completed') attempt.images = clone(slot.images)
      attempt.error = slot.error
    }
    this.updateStatus(run)
    await this.save(state)
    if (task.status !== 'running' && task.status !== 'queued') {
      this.taskRoots.delete(task.id)
      await this.schedule(state, run)
    }
  }

  private updateStatus(run: StoredRun): void {
    const states = run.slots.map(slot => slot.status)
    if (states.includes('running')) run.status = 'running'
    else if (states.includes('queued')) run.status = run.slots.some(slot => slot.attempts?.some(attempt => attempt.startedAt !== undefined) || slot.status === 'completed') ? 'running' : 'queued'
    else if (states.every(status => status === 'completed')) run.status = 'completed'
    else if (states.includes('interrupted')) run.status = 'interrupted'
    else if (states.includes('completed')) run.status = 'partial-failed'
    else if (states.every(status => status === 'cancelled')) run.status = 'cancelled'
    else run.status = 'failed'
    // Snapshot ordering must survive same-millisecond mutations and wall-clock
    // corrections so delayed responses cannot undo another group's retry.
    run.updatedAt = Math.max(Date.now(), run.updatedAt + 1)
  }

  async cancel(id: string): Promise<EcommerceRun> {
    return this.mutate(async () => {
      const state = await this.state(); const run = this.requireRun(state, id)
      if (!terminal(run)) {
        for (const slot of run.slots) if (ACTIVE.has(slot.status)) {
          slot.status = 'cancelled'
          const attempt = slot.attempts?.at(-1)
          if (attempt && ACTIVE.has(attempt.status)) { attempt.status = 'cancelled'; attempt.finishedAt = Date.now() }
        }
        run.status = 'cancelled'; run.updatedAt = Math.max(Date.now(), run.updatedAt + 1)
        await this.save(state)
        for (const slot of run.slots) if (slot.taskId && slot.status === 'cancelled') this.options.runtime.queue.cancel(slot.taskId)
      }
      return this.wire(run)
    })
  }

  async retry(id: string, slotKey?: string): Promise<EcommerceRun> {
    return this.mutate(async () => {
      const state = await this.state(); const run = this.requireRun(state, id)
      if (run.legacy || !run.config) throw new EcommerceRunError('旧记录缺少完整配置与参考图，仅可查看结果', 'legacy-readonly')
      const targets = slotKey === undefined
        ? run.slots.filter(slot => slot.status !== 'completed' && !ACTIVE.has(slot.status))
        : run.slots.filter(slot => slot.key === slotKey)
      if (targets.length === 0) throw new EcommerceRunError('没有可重试的图片位置', 'slot-not-found')
      if (targets.some(slot => ACTIVE.has(slot.status))) throw new EcommerceRunError('此图片仍在生成，请等待完成后重试', 'slot-active')
      // Continue untouched downstream work from the originally authorized
      // plan when retrying its failed main. Never auto-repeat a billed slot.
      if (targets.some(isMain)) for (const slot of run.slots) {
        if (slot.blockedByMain && slot.attempt === 0 && !ACTIVE.has(slot.status) && !targets.includes(slot)) targets.push(slot)
      }
      // Retrying a dependent slot must not silently bypass a failed main.
      const mains = run.slots.filter(isMain)
      if (targets.some(slot => !isMain(slot)) && mains.length > 0
        && !mains.some(slot => slot.status === 'completed' && slot.images.length > 0)
        && !mains.some(slot => targets.includes(slot) || ACTIVE.has(slot.status))) {
        throw new EcommerceRunError('请先重试主图，确认商品锚点后再重试此图片', 'main-required')
      }
      for (const slot of targets) { slot.status = 'queued'; delete slot.taskId; delete slot.error; delete slot.blockedByMain }
      run.status = 'queued'; run.updatedAt = Math.max(Date.now(), run.updatedAt + 1)
      await this.save(state)
      await this.schedule(state, run)
      return this.wire(run)
    })
  }

  private requireRun(state: RootState, id: string): StoredRun {
    const run = state.index.runs.find(candidate => candidate.id === id)
    if (!run) throw new EcommerceRunError('历史任务不存在', 'not-found')
    return run
  }

  async remove(id: string): Promise<EcommerceRunSummary[]> {
    return this.mutate(async () => {
      const state = await this.state(); const run = this.requireRun(state, id)
      if (!terminal(run)) throw new EcommerceRunError('进行中的任务不能删除，请先取消', 'run-active')
      state.index.runs = state.index.runs.filter(candidate => candidate.id !== id)
      state.index.removed.push(id)
      if (run.requestId) (state.index.deletedRequests ??= []).push(run.requestId)
      ;(state.index.pendingCleanup ??= []).push(clone(run))
      await this.save(state)
      await this.cleanup(state)
      return state.index.runs.map(run => this.summary(run))
    })
  }

  /** Clear only finished product-set runs. Active work and all other sources
   * stay intact, including when a second window submits during this action. */
  async clear(): Promise<EcommerceRunSummary[]> {
    return this.mutate(async () => {
      const state = await this.state()
      const removed = state.index.runs.filter(terminal)
      state.index.runs = state.index.runs.filter(run => !terminal(run))
      state.index.removed.push(...removed.map(run => run.id))
      ;(state.index.deletedRequests ??= []).push(...removed.flatMap(run => run.requestId ? [run.requestId] : []))
      ;(state.index.pendingCleanup ??= []).push(...removed.map(clone))
      await this.save(state)
      await this.cleanup(state)
      return state.index.runs.map(run => this.summary(run))
    })
  }

  private async readAssetAt(state: RootState, id: string, file: string): Promise<{ data: Buffer; mime: string } | undefined> {
    if (!SAFE_ID.test(id) || !SAFE_FILE.test(file)) return undefined
    try {
      const data = await fs.readFile(path.join(state.directory, id, file))
      const ext = path.extname(file).slice(1)
      const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' })[ext] ?? 'image/png'
      return { data, mime }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }

  async readAsset(id: string, file: string): Promise<{ data: Buffer; mime: string } | undefined> {
    return this.mutate(async () => {
      const state = await this.state()
      if (!state.index.runs.some(run => run.id === id)) return undefined
      return this.readAssetAt(state, id, file)
    })
  }

  private async removeHistoryRows(runs: StoredRun[]): Promise<void> {
    if (!this.history.remove || runs.length === 0) return
    const runIds = new Set(runs.filter(run => !run.legacy).map(run => run.id))
    const legacyIds = new Set(runs.flatMap(run => run.legacyHistoryIds ?? []))
    const legacyRunIds = new Set(runs.filter(run => run.legacy).map(run => run.id))
    for (const entry of await this.history.list()) {
      if (generationOrigin(entry) !== 'ecommerce') continue
      this.assertAlive()
      const legacyId = `legacy-${createHash('sha256').update(entry.projectId || entry.id).digest('hex').slice(0, 32)}`
      if (legacyIds.has(entry.id) || legacyRunIds.has(legacyId) || (entry.projectId !== undefined && runIds.has(entry.projectId))) await this.history.remove(entry.id)
    }
  }

  private async cleanup(state: RootState): Promise<void> {
    const pending = state.index.pendingCleanup ?? []
    for (const run of [...pending]) {
      this.assertAlive()
      try {
        await this.removeHistoryRows([run])
        this.assertAlive()
        await fs.rm(path.join(state.directory, run.id), { recursive: true, force: true })
      } catch (error) {
        throw new EcommerceRunError(`任务已从历史中删除，文件清理尚未完成；下次访问将重试：${messageOf(error)}`, 'cleanup-failed')
      }
      state.index.pendingCleanup = state.index.pendingCleanup?.filter(candidate => candidate.id !== run.id)
      await this.save(state)
    }
  }

  private async importLegacy(state: RootState): Promise<void> {
    const entries = await this.history.list()
    const groups = new Map<string, HistoryEntry[]>()
    for (const entry of entries) {
      if (generationOrigin(entry) !== 'ecommerce') continue
      const project = entry.projectId || entry.id
      if (state.index.runs.some(run => run.id === project) || state.index.removed.includes(project)) continue
      const id = `legacy-${createHash('sha256').update(project).digest('hex').slice(0, 32)}`
      if (state.index.runs.some(run => run.id === id) || state.index.removed.includes(id)) continue
      groups.set(id, [...groups.get(id) ?? [], entry])
    }
    for (const [id, group] of groups) {
      const ordered = group.sort((a, b) => a.createdAt - b.createdAt)
      await fs.mkdir(path.join(state.directory, id), { recursive: true })
      // Never rewrite/remove the source index during migration. Preserve the
      // exact metadata before copying, and de-duplicate by stable group id.
      await fs.writeFile(path.join(state.directory, id, 'legacy-source.json'), JSON.stringify(ordered), 'utf8')
      const run: StoredRun = { id, createdAt: ordered[0].createdAt, updatedAt: ordered.at(-1)!.createdAt, status: 'completed', legacy: true, legacyHistoryIds: ordered.map(entry => entry.id), slots: [] }
      for (const entry of ordered) {
        const images: HistoryImageRef[] = []
        for (const ref of entry.images) {
          const match = /^\/api\/dsh-imagegen\/history\/image\/([a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(?:png|jpg|jpeg|webp|gif))$/.exec(ref.url)
          if (!match) continue
          const image = await this.history.readImage(match[1])
          if (image) images.push(await this.putImage(state, id, { b64: image.data.toString('base64'), mime: image.mime, ...ref.revisedPrompt === undefined ? {} : { revisedPrompt: ref.revisedPrompt } }))
        }
        run.slots.push({
          key: `${entry.slotKey || 'image'}-${entry.id}`, label: entry.slotLabel || '历史图片', attempt: 1,
          status: images.length > 0 ? 'completed' : 'failed', images,
          request: { mode: entry.mode, model: entry.model, prompt: entry.prompt, size: entry.size, quality: entry.quality, detail: entry.detail, n: entry.n, workflow: 'ecommerce', projectId: entry.projectId, projectName: entry.projectName, slotKey: entry.slotKey, slotLabel: entry.slotLabel, channelId: entry.channelId },
          ...images.length === entry.images.length ? {} : { error: '部分旧图片已不在历史文件中；原配置及参考图未保存' },
        })
      }
      this.updateStatus(run)
      run.updatedAt = ordered.at(-1)!.createdAt
      state.index.runs.push(run)
      await this.save(state)
    }
  }
}
