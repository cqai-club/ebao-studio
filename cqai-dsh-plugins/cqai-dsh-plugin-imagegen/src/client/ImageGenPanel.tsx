/**
 * The AI 生图 studio. Ordinary generation uses a two-column workspace:
 * configuration on the left and one unified live-task/history stream on the
 * right. Gallery, Infinite Canvas, and ecommerce keep their own workspaces.
 *
 * Controls ride the system UI primitives (@deepseek-ai/dsh-client-ui-primitives,
 * a platform module) so the studio matches the dsh shell look by construction.
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageGenApi } from './api.ts'
import { errorMessage, tt } from './helpers.ts'
import { TemplateLibrary } from './TemplateLibrary.tsx'
import { GooeyNav } from './GooeyNav.tsx'
import { CanvasWorkspace } from './CanvasWorkspace.tsx'
import { useImageGenLanguageTick } from './use-language.ts'
import { buildNormalGenerationStream, isNormalGeneration, normalizeSize } from './normal-generation-stream.ts'
import type { CqaiImageProviderView, EcommerceRefRole, GeneratedImage, GenerateMode, GenerateRequest, GenerationTask, GenerationTaskStatus, HistoryEntry, HistoryImageRef, ProductSetDraft, ProductSetSlot } from '../protocol.ts'
import { AGENT_IMAGE_API } from '../protocol.ts'
import type { ImageGenConfig, ImageGenScope } from './settings-scope.ts'
import { normalizeImageModels } from '../image-models.ts'
import { describeModel, promptCharLimit } from '../model-catalog.ts'
import { CHAT_IMAGE_EVENT, type ChatImageEventDetail, type ConversationService } from './conversation-sync.ts'
import css from './panel.module.css'

/** Size options, presented as aspect ratios (auto = let the model decide).
 *  The host maps each ratio onto the model's own vocabulary: aspect_ratio for
 *  Grok Imagine, the closest pixel size for OpenAI-compatible endpoints. */
const SIZES = ['auto', '1:1', '3:4', '4:3', '9:16', '2:3', '3:2', '16:9', '21:9'] as const

/** Size option keys in the locale dictionary. */
const SIZE_KEYS: Record<string, 'size.auto' | 'size.square' | 'size.portrait34' | 'size.landscape43' | 'size.portrait916' | 'size.portrait23' | 'size.landscape32' | 'size.wide169' | 'size.ultrawide21'> = {
  auto: 'size.auto',
  '1:1': 'size.square',
  '3:4': 'size.portrait34',
  '4:3': 'size.landscape43',
  '9:16': 'size.portrait916',
  '2:3': 'size.portrait23',
  '3:2': 'size.landscape32',
  '16:9': 'size.wide169',
  '21:9': 'size.ultrawide21',
}

/** Quality options, shown as output-resolution tiers (auto = let the model
 *  decide). The host maps them: resolution for Grok, quality level for
 *  OpenAI-compatible endpoints (1k→low, 2k→medium, 4k→high). */
const QUALITIES = ['auto', '1k', '2k', '4k'] as const

/** Detail options ('' = omit the passthrough). */
const DETAILS = ['', 'standard', 'high'] as const

const REF_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const MAX_REFERENCE_IMAGES = 5
// The local DSH attachment backend defaults to a 2000px per-side limit. Keep
// the full-resolution result in the studio, but normalize the conversation
// copy before it enters the native composer and durable edit staging route.
const CONVERSATION_IMAGE_MAX_DIMENSION = 2000
const CONVERSATION_IMAGE_JPEG_QUALITY = 0.9
const PREVIEW_SCALE_MIN = 0.5
const PREVIEW_SCALE_MAX = 3
const PREVIEW_SCALE_STEP = 0.25
const CONFIG_COLLAPSED_STORAGE_KEY = 'dsh-imagegen-config-collapsed'
const ECOMMERCE_DRAFT_STORAGE_KEY = 'dsh-imagegen-ecommerce-draft'
/** Reference roles an uploaded product asset can play (slot selections can
 *  also pick 'none'). */
const ECOMMERCE_ASSET_ROLES = ['product', 'packaging', 'detail', 'style'] as const
type EcommerceAssetRole = Exclude<EcommerceRefRole, 'none'>
const MAX_ECOMMERCE_ASSETS = 4
const ECOMMERCE_ROLE_PROMPT_LABELS: Record<EcommerceAssetRole, string> = {
  product: '商品主体',
  packaging: '包装',
  detail: '细节/角度',
  style: '风格参考',
}
/** One uploaded product asset. Session-only: data URLs are far too large for
 *  the localStorage draft, so assets never persist across reloads. */
interface ProductAsset {
  id: string
  dataUrl: string
  name: string
  role: EcommerceAssetRole
}

const PRODUCT_SET_SLOTS: ProductSetSlot[] = [
  { key: 'main', label: '主图', description: '干净背景，突出商品主体', count: 1, enabled: true, refRole: 'product' },
  { key: 'selling-point', label: '卖点图', description: '用画面展示商品核心卖点', count: 2, enabled: true, refRole: 'product' },
  { key: 'scene', label: '场景图', description: '真实生活或使用场景', count: 2, enabled: true, refRole: 'product' },
  { key: 'detail', label: '细节图', description: '材质、结构或工艺特写', count: 1, enabled: true, refRole: 'detail' },
  { key: 'spec', label: '规格图', description: '尺寸、容量或参数展示', count: 1, enabled: false, refRole: 'product' },
  { key: 'model', label: '使用图', description: '人物上手或穿戴效果', count: 1, enabled: false, refRole: 'product' },
]

/** Legacy quality levels saved by older versions, mapped onto resolution. */
const LEGACY_QUALITY_TO_RES: Record<string, string> = {
  low: '1k',
  medium: '2k',
  high: '4k',
}

/** Normalize a saved quality value into a current dropdown option. */
function normalizeQuality(value: string): string {
  if ((QUALITIES as readonly string[]).includes(value)) return value
  return LEGACY_QUALITY_TO_RES[value] ?? 'auto'
}

function clampPreviewScale(scale: number): number {
  return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, scale))
}

/** Keep the image canvas preference across panel remounts without making it
 * part of the host settings document. */
function readConfigCollapsed(): boolean {
  try {
    return window.localStorage.getItem(CONFIG_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const CONFIG_WIDTH_STORAGE_KEY = 'dsh-imagegen:config-width'
const CONFIG_WIDTH_MIN = 260
const CONFIG_WIDTH_MAX = 480
const CONFIG_WIDTH_DEFAULT = 300

function readConfigWidth(): number {
  try {
    const raw = window.localStorage.getItem(CONFIG_WIDTH_STORAGE_KEY)
    if (raw === null) return CONFIG_WIDTH_DEFAULT
    const value = Number(raw)
    if (Number.isFinite(value) && value > 0) return Math.min(CONFIG_WIDTH_MAX, Math.max(CONFIG_WIDTH_MIN, Math.round(value)))
  } catch { /* storage unavailable */ }
  return CONFIG_WIDTH_DEFAULT
}

/** Read the current config from the settings scope snapshot. */
function useConfig(scope: ImageGenScope): ImageGenConfig | undefined {
  const [value, setValue] = useState(scope.getSnapshot().value)
  useEffect(() => scope.subscribe(() => { setValue(scope.getSnapshot().value) }), [scope])
  return value
}

/** Track one redacted secret field without exposing its value to the panel. */
function useSecretSet(scope: ImageGenScope, field: string): boolean {
  const [isSet, setIsSet] = useState(scope.getSecretSetSnapshot(field))
  useEffect(() => scope.subscribeSecretSets(() => { setIsSet(scope.getSecretSetSnapshot(field)) }), [field, scope])
  return isSet
}

/** Tick a seconds counter while `running`. */
function useElapsed(running: boolean, startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running || startedAt === null) {
      setElapsed(0)
      return
    }
    const update = (): void => {
      setElapsed(Math.max(1, Math.round((Date.now() - startedAt) / 1000)))
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])
  return elapsed
}

/** Data URL for a generated image. */
function srcOf(image: GeneratedImage): string {
  return `data:${image.mime};base64,${image.b64}`
}

/** Decode one durable conversation attachment into the panel's image shape. */
async function attachmentToGenerated(ref: ImageAttachmentRef): Promise<GeneratedImage> {
  const query = new URLSearchParams({
    attachment_id: String(ref.attachmentId),
    media_type: ref.mediaType,
    bytes: String(ref.bytes),
    width: String(ref.width),
    height: String(ref.height),
  })
  const response = await fetch(`${AGENT_IMAGE_API}?${query.toString()}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('image read failed'))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('image decode failed')
  return { b64: dataUrl.slice(comma + 1), mime: ref.mediaType }
}

/** Convert a generated image into the browser-owned draft format. */
function generatedImageToFile(image: GeneratedImage, index: number): File {
  const binary = atob(image.b64)
  const bytes = new Uint8Array(binary.length)
  for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset)
  return new File([bytes], `dsh-image-${index + 1}.${extensionOf(image.mime)}`, { type: image.mime })
}

/** Decode a data URL into a browser File for the native composer. */
function dataUrlToFile(dataUrl: string, name: string): File {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/su.exec(dataUrl)
  if (match === null || match[1] === undefined || match[2] === undefined) throw new Error('image processing returned an invalid data URL')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset)
  return new File([bytes], name, { type: match[1] })
}

/** Read intrinsic dimensions without changing the original preview. */
function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (width < 1 || height < 1) reject(new Error('image dimensions are unavailable'))
      else resolve({ width, height })
    }
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = dataUrl
  })
}

/** Prepare the smaller conversation copy required by the host attachment policy. */
async function prepareConversationImage(image: GeneratedImage, index: number): Promise<{ file: File; dataUrl: string }> {
  const dataUrl = srcOf(image)
  const { width, height } = await imageDimensions(dataUrl)
  const longestSide = Math.max(width, height)
  if (longestSide <= CONVERSATION_IMAGE_MAX_DIMENSION) {
    return { file: generatedImageToFile(image, index), dataUrl }
  }

  const scale = CONVERSATION_IMAGE_MAX_DIMENSION / longestSide
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('image resize is unavailable in this browser')
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const sourceImage = new Image()
    sourceImage.onload = () => resolve(sourceImage)
    sourceImage.onerror = () => reject(new Error('image decode failed'))
    sourceImage.src = dataUrl
  })
  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  const resizedDataUrl = canvas.toDataURL('image/jpeg', CONVERSATION_IMAGE_JPEG_QUALITY)
  return {
    dataUrl: resizedDataUrl,
    file: dataUrlToFile(resizedDataUrl, `dsh-image-${index + 1}.jpg`),
  }
}

/** Fetch persisted history image refs and decode them back to in-memory
 *  GeneratedImage[] (base64), so the canvas/preview can reuse the same
 *  rendering path as a fresh generation. */
async function historyImagesToGenerated(refs: HistoryImageRef[]): Promise<GeneratedImage[]> {
  return Promise.all(refs.map(async ref => {
    const response = await fetch(ref.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(new Error('image read failed'))
      reader.readAsDataURL(blob)
    })
    const comma = dataUrl.indexOf(',')
    return {
      b64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
      mime: ref.mime,
      ...ref.revisedPrompt === undefined ? {} : { revisedPrompt: ref.revisedPrompt },
    }
  }))
}

/** Compact, locale-independent timestamp for history entries. */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function taskElapsedSeconds(task: GenerationTask): number | undefined {
  const startedAt = task.startedAt
  if (startedAt === undefined) return undefined
  return Math.max(0, Math.round(((task.finishedAt ?? Date.now()) - startedAt) / 1000))
}

function defaultEcommerceDraft(): ProductSetDraft {
  return {
    projectId: '', projectName: '', category: '通用商品', platform: '通用', language: '中文', customLanguage: '', size: '1:1',
    productName: '', promptInfo: '',
    slots: PRODUCT_SET_SLOTS.map(slot => ({ ...slot })),
  }
}

/** Standard copy-language choices; custom keeps uncommon locales usable. */
const ECOMMERCE_COPY_LANGUAGES = [
  ['中文', '中文'],
  ['English', 'English'],
  ['Русский', 'Русский'],
  ['日本語', '日本語'],
  ['한국어', '한국어'],
  ['Français', 'Français'],
  ['Deutsch', 'Deutsch'],
  ['Español', 'Español'],
  ['Português', 'Português'],
  ['custom', '自定义'],
] as const

function effectiveEcommerceLanguage(draft: ProductSetDraft): string {
  return draft.language === 'custom' ? draft.customLanguage?.trim() ?? '' : draft.language
}

function ecommercePrompt(draft: ProductSetDraft, slot: ProductSetSlot): string {
  const info = draft.promptInfo.trim() || '突出商品真实材质、结构和核心价值；保持商品颜色、形状、Logo、包装文字和结构真实，不添加不存在的配件'
  const language = effectiveEcommerceLanguage(draft) || '中文'
  const refClause = slot.refRole !== undefined && slot.refRole !== 'none'
    ? `本图以上传的${ECOMMERCE_ROLE_PROMPT_LABELS[slot.refRole]}图片为参考，商品与风格必须与参考图保持一致；`
    : ''
  return `电商${slot.label}：为${draft.productName.trim() || '该商品'}制作${slot.description}。商品品类：${draft.category}；平台：${draft.platform}；语言：${language}。${refClause}商品信息与要求：${info}。整体要求：商品主体清晰、比例真实、光线自然、画面干净、适合电商发布。`
}

/** Effective prompt for one image of a slot: the per-image override written in
 *  the pre-generation preview board wins over the auto-composed prompt. */
function ecommerceSlotPrompt(draft: ProductSetDraft, slot: ProductSetSlot, index: number): string {
  const override = draft.promptOverrides?.[`${slot.key}-${index + 1}`]
  return override !== undefined && override.trim() !== '' ? override : ecommercePrompt(draft, slot)
}

/** Consistency prefix for slots generated after the main image exists. */
function withAnchorNote(prompt: string): string {
  return '商品套图一致性约束：附件是本套商品的主图，图中商品（外形、颜色、材质、Logo、包装文字）必须与附件完全一致，不得重新发明商品。' + prompt
}

/** Studio tabs: the two generation modes plus the gallery view. */
type PanelTab = GenerateMode | 'gallery'

/** Top-level workspaces inside the panel. 'normal' is the classic studio;
 *  more task-oriented modes (prototype, …) can join alongside 'ecommerce'. */
type PanelWorkspace = 'normal' | 'ecommerce' | 'canvas'

type GalleryFilter = string
type ComparisonSession = { taskIds: string[]; prompt: string; comparisonId: string }
type HistoryGroup = { key: string; entries: HistoryEntry[]; models: string[] }

/** One image unit in the ecommerce results canvas: a live queue task or a
 *  restored history entry of the viewed product set. */
interface EcommerceResultItem {
  id: string
  label: string
  slotKey: string
  status: GenerationTaskStatus
  model: string
  prompt: string
  error?: string
  images: GeneratedImage[]
  /** The request to resubmit when regenerating this slot. */
  source: GenerateRequest
}

function modelsOfHistoryEntry(entry: HistoryEntry): string[] {
  return entry.comparisonModels?.length !== undefined && entry.comparisonModels.length > 1
    ? entry.comparisonModels
    : [entry.model]
}

/** Comparison runs collapse by comparisonId, product sets by projectId. */
function historyGroupKey(entry: HistoryEntry): string {
  if (entry.comparisonId !== undefined) return entry.comparisonId
  if (entry.workflow === 'ecommerce' && entry.projectId !== undefined) return `project:${entry.projectId}`
  return entry.id
}

/** Collapse the per-model history rows that belong to one comparison run. */
function groupHistoryEntries(entries: HistoryEntry[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>()
  for (const entry of entries) {
    const key = historyGroupKey(entry)
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { key, entries: [entry], models: modelsOfHistoryEntry(entry) })
    } else {
      existing.entries.push(entry)
      existing.models = [...new Set([...existing.models, ...modelsOfHistoryEntry(entry)])]
    }
  }
  return [...groups.values()]
}

function newComparisonId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return `comparison-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Render the studio. */
export function ImageGenPanel(props: {
  api: ImageGenApi
  scope: ImageGenScope
  conversation?: ConversationService
}) {
  const { api, scope, conversation } = props
  const config = useConfig(scope)
  const [cqaiProvider, setCqaiProvider] = useState<CqaiImageProviderView>({
    provider: 'cqai', immutable: true, state: 'signed-out', models: [],
  })
  const [providerId, setProviderId] = useState('cqai')
  // The plugin language follows the DSH interface (bridged from ctx.locale);
  // this tick re-renders the tree so every tt() switches live, including the
  // template library mounted inside this tree.
  useImageGenLanguageTick()
  const enabled = config?.enabled ?? true
  const customChannels = config?.channels ?? []
  const selectedCustomChannel = customChannels.find(channel => channel.id === providerId)
  const cqaiModels = cqaiProvider.models.map(model => model.alias)
  const imageModels = providerId === 'cqai'
    ? [
        ...(cqaiProvider.defaultModel === undefined ? [] : [cqaiProvider.defaultModel]),
        ...cqaiModels.filter(model => model !== cqaiProvider.defaultModel),
      ]
    : selectedCustomChannel?.models.map(model => model.alias)
      ?? normalizeImageModels(config?.imageModels)
  const defaultChannelId = providerId
  const configured = providerId === 'cqai'
    ? cqaiProvider.state === 'signed-in'
    : (selectedCustomChannel?.apiUrl ?? config?.apiUrl ?? '').trim() !== ''
  const selectedCustomKeySet = useSecretSet(
    scope,
    selectedCustomChannel === undefined ? 'apiKey' : `channelSecrets.${selectedCustomChannel.id}`,
  )
  const apiKeySet = providerId === 'cqai' ? cqaiProvider.state === 'signed-in' : selectedCustomKeySet
  const connected = enabled && configured && apiKeySet

  // CQAI login/model state is host-owned and contains no credentials. Polling
  // keeps the workbench in sync when the user finishes Logto in another tab.
  useEffect(() => {
    let disposed = false
    const refresh = (): void => {
      void api.cqaiProvider().then((next) => {
        if (!disposed) setCqaiProvider(next)
      }).catch((caught) => {
        if (!disposed) setCqaiProvider({
          provider: 'cqai', immutable: true, state: 'error', models: [], message: errorMessage(caught),
        })
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [api])

  useEffect(() => {
    if (providerId !== 'cqai' && !customChannels.some(channel => channel.id === providerId)) setProviderId('cqai')
  }, [providerId, customChannels.map(channel => channel.id).join('\u0000')])

  const [tab, setTab] = useState<PanelTab>('text')
  const [workspace, setWorkspace] = useState<PanelWorkspace>('normal')
  const [canvasImportRequest, setCanvasImportRequest] = useState<{ source: 'history' | 'gallery'; entryId: string; imageIndex: number } | undefined>()
  /** Switch to a normal-generation tab, leaving any task workspace. */
  const openTab = (next: PanelTab): void => {
    setWorkspace('normal')
    setTab(next)
  }
  const addEntryToCanvas = (source: 'history' | 'gallery', entryId: string, imageIndex = 0): void => {
    setCanvasImportRequest({ source, entryId, imageIndex })
    setWorkspace('canvas')
  }
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<string>('auto')
  const [quality, setQuality] = useState<string>('auto')
  const [count, setCount] = useState(1)
  const [detail, setDetail] = useState('')
  const [model, setModel] = useState<string>('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareModels, setCompareModels] = useState<string[]>([])
  const [modelOpen, setModelOpen] = useState(false)
  const [refImage, setRefImage] = useState<{ dataUrl: string; name: string } | null>(null)
  const [additionalRefImages, setAdditionalRefImages] = useState<Array<{ dataUrl: string; name: string }>>([])
  const [, setImages] = useState<GeneratedImage[]>([])
  const [addingToConversation, setAddingToConversation] = useState<number | string | null>(null)
  const [galleryConversationAddingId, setGalleryConversationAddingId] = useState<string | null>(null)
  const [historyConversationAddingId, setHistoryConversationAddingId] = useState<string | null>(null)
  const [conversationMessage, setConversationMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Submission is brief; actual generation stays visible until the host
  // queue reports that every queued/running task has finished.
  const [submitting, setSubmitting] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [configGuide, setConfigGuide] = useState<'generation' | 'enhancement' | 'disabled' | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null)
  const [gallery, setGallery] = useState<HistoryEntry[]>([])
  const [galleryViewingId, setGalleryViewingId] = useState<string | null>(null)
  const [galleryAdding, setGalleryAdding] = useState(false)
  const [galleryMessage, setGalleryMessage] = useState<string | null>(null)
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all')
  const galleryUploadRef = useRef<HTMLInputElement>(null)
  const [galleryRatio, setGalleryRatio] = useState('all')
  const [galleryTagFilter, setGalleryTagFilter] = useState<string | null>(null)
  const [galleryView, setGalleryView] = useState<'masonry' | 'grid'>('masonry')
  const [gallerySort, setGallerySort] = useState<'newest' | 'oldest'>('newest')
  const [galleryQuery, setGalleryQuery] = useState('')
  const [galleryTagInput, setGalleryTagInput] = useState('')
  const [editingGalleryTagsId, setEditingGalleryTagsId] = useState<string | null>(null)
  const [galleryTagEditInput, setGalleryTagEditInput] = useState('')
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set())
  const [gallerySelecting, setGallerySelecting] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyModelFilter, setHistoryModelFilter] = useState('all')
  const [historyRatioFilter, setHistoryRatioFilter] = useState('all')
  const [preview, setPreview] = useState<{ images: GeneratedImage[]; index: number } | null>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [promptCopied, setPromptCopied] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const tasksRef = useRef<GenerationTask[]>([])
  const [taskTrayOpen, setTaskTrayOpen] = useState(false)
  const [comparison, setComparison] = useState<ComparisonSession | null>(null)
  const [comparisonFullscreen, setComparisonFullscreen] = useState(false)
  const [ecommerce, setEcommerce] = useState<ProductSetDraft>(() => {
    try {
      const saved = window.localStorage.getItem(ECOMMERCE_DRAFT_STORAGE_KEY)
      if (saved !== null) {
        const merged: ProductSetDraft = { ...defaultEcommerceDraft(), ...JSON.parse(saved) as Partial<ProductSetDraft> }
        // Drafts saved before reference roles existed keep working: every slot
        // defaults to following the product image.
        if (Array.isArray(merged.slots)) {
          merged.slots = merged.slots.map(slot => ({ ...slot, refRole: slot.refRole ?? 'product' }))
        }
        // Drafts from the three-field era (卖点/保护要素/风格) fold into 参数信息.
        merged.promptInfo = typeof merged.promptInfo === 'string' ? merged.promptInfo : ''
        if (merged.promptInfo.trim() === '') {
          const legacy = [merged.sellingPoints ?? '', merged.protectedFeatures ?? '', merged.styleHint ?? '']
            .map(part => part.trim())
            .filter(part => part !== '')
          if (legacy.length > 0) merged.promptInfo = legacy.join('\n')
        }
        return merged
      }
    } catch { /* ignore malformed or unavailable storage */ }
    return defaultEcommerceDraft()
  })
  const [ecommercePreview, setEcommercePreview] = useState(false)
  const [ecommerceGenerating, setEcommerceGenerating] = useState(false)
  const [ecommerceEnhancing, setEcommerceEnhancing] = useState(false)
  const [ecommerceProjectId, setEcommerceProjectId] = useState<string | null>(null)
  const [ecommerceAssets, setEcommerceAssets] = useState<ProductAsset[]>([])
  /** History-restored product set currently shown in the results canvas. */
  const [ecommerceRestored, setEcommerceRestored] = useState<{ projectId: string; projectName: string; items: EcommerceResultItem[] } | null>(null)
  /** Pending main-image anchor: the main image task is in flight; once it
   *  completes, the remaining slots are resubmitted with it as their shared
   *  reference so every image in the set shows the same product. */
  const [ecommerceAnchor, setEcommerceAnchor] = useState<{ projectId: string; mainTaskIds: string[]; remaining: GenerateRequest[] } | null>(null)
  const [ecommerceRefOpen, setEcommerceRefOpen] = useState(false)
  const [configCollapsed, setConfigCollapsed] = useState(readConfigCollapsed)
  const [configWidth, setConfigWidth] = useState(readConfigWidth)
  const configAsideRef = useRef<HTMLElement>(null)
  const currentSessionId = conversation?.sessionId
  const modeModels = tab === 'edit'
    ? imageModels.filter(candidate => describeModel(candidate).supportsEdit)
    : imageModels
  const automaticModel = providerId === 'cqai'
    ? (cqaiProvider.defaultModel !== undefined && modeModels.includes(cqaiProvider.defaultModel)
        ? cqaiProvider.defaultModel
        : modeModels.length === 1 ? modeModels[0]! : '')
    : modeModels[0] ?? ''
  const fileInput = useRef<HTMLInputElement>(null)
  const previewStage = useRef<HTMLDivElement>(null)
  const normalHistory = history.filter(isNormalGeneration)
  const normalTasks = tasks.filter(task => isNormalGeneration(task.request))
  const activeTasks = tasks.filter(task => task.status === 'queued' || task.status === 'running')
  const activeNormalTasks = normalTasks.filter(task => task.status === 'queued' || task.status === 'running')
  const activeTask = activeNormalTasks.find(task => task.status === 'running') ?? activeNormalTasks[0]
  const generating = submitting || activeNormalTasks.length > 0
  const generationStartedAt = activeTask?.startedAt ?? activeTask?.createdAt ?? null
  useElapsed(generating, generationStartedAt)

  useEffect(() => {
    try { window.localStorage.setItem(ECOMMERCE_DRAFT_STORAGE_KEY, JSON.stringify(ecommerce)) } catch { /* optional draft persistence */ }
  }, [ecommerce])

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_COLLAPSED_STORAGE_KEY, String(configCollapsed))
    } catch {
      // Embedded shells may disable local storage; the in-memory toggle still works.
    }
  }, [configCollapsed])

  // Main-image anchor chain: when the main image task of a product set
  // completes, resubmit the remaining slots with the generated main image as
  // their shared reference. Cleared up front so a re-render cannot double-
  // submit; failures surface as a canvas error.
  useEffect(() => {
    if (ecommerceAnchor === null) return
    const anchor = ecommerceAnchor
    const mains = tasks.filter(task => anchor.mainTaskIds.includes(task.id))
    if (mains.length === 0) return
    if (mains.every(task => task.status === 'failed' || task.status === 'cancelled')) {
      setEcommerceAnchor(null)
      setError(tt('ecommerce.anchorFailed'))
      return
    }
    const done = mains.find(task => task.status === 'completed' && task.result !== undefined && task.result.images.length > 0)
    if (done === undefined) return
    setEcommerceAnchor(null)
    const dataUrl = srcOf(done.result!.images[0]!)
    const requests = anchor.remaining.map(request => ({
      ...request,
      mode: 'edit' as const,
      image: dataUrl,
      refName: 'set-main-anchor',
      prompt: withAnchorNote(request.prompt),
    }))
    void Promise.all(requests.map(request => api.taskSubmit(request)))
      .then(submitted => { setTasks(previous => [...submitted, ...previous]) })
      .catch(caught => { setError(errorMessage(caught)) })
  }, [api, tasks, ecommerceAnchor])


  // An empty model is deliberate: it means "follow the Provider default".
  // Keep only explicit, still-valid task overrides. This lets a newly saved
  // CQAI default take effect without mistaking the old automatic choice for a
  // user-selected per-task override.
  const imageModelKey = modeModels.join('\u0000')
  useEffect(() => {
    setModel(previous => previous === '' || modeModels.includes(previous) ? previous : '')
    setCompareModels(previous => {
      const retained = previous.filter(candidate => modeModels.includes(candidate))
      return retained.length > 0 ? retained : automaticModel === '' ? [] : [automaticModel]
    })
  }, [imageModelKey, automaticModel, providerId])

  const filteredGallery = gallery
    .filter(entry => {
      if (galleryFilter === 'all') return true
      if (galleryFilter === 'text' || galleryFilter === 'edit') return entry.mode === galleryFilter
      return entry.model === galleryFilter
    })
    .filter(entry => galleryRatio === 'all' || normalizeSize(entry.size) === galleryRatio)
    .filter(entry => galleryTagFilter === null || (entry.tags ?? []).includes(galleryTagFilter))
    .filter(entry => galleryQuery.trim() === '' || `${entry.prompt} ${entry.model} ${(entry.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(galleryQuery.trim().toLocaleLowerCase()))
    .slice()
    .sort((a, b) => gallerySort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt)

  const galleryTagOptions = [...new Set(gallery.flatMap(entry => entry.tags ?? []))].sort((a, b) => a.localeCompare(b))
  const galleryModels = [...new Set([...imageModels, ...gallery.map(entry => entry.model)])]

  const filteredHistory = groupHistoryEntries(history).filter(group => group.entries.some(entry => {
    const query = historyQuery.trim().toLocaleLowerCase()
    const models = modelsOfHistoryEntry(entry)
    return (query === '' || `${entry.prompt} ${models.join(' ')}`.toLocaleLowerCase().includes(query))
      && (historyModelFilter === 'all' || models.includes(historyModelFilter))
      && (historyRatioFilter === 'all' || normalizeSize(entry.size) === historyRatioFilter)
  }))

  const normalStreamItems = buildNormalGenerationStream(history, tasks, {
    query: historyQuery,
    model: historyModelFilter,
    ratio: historyRatioFilter,
  })
  const normalStreamModels = [...new Set([
    ...normalHistory.map(entry => entry.model),
    ...normalTasks.map(task => task.request.model),
  ])]
  const normalStreamRatios = [...new Set([
    ...normalHistory.map(entry => normalizeSize(entry.size)),
    ...normalTasks.map(task => normalizeSize(task.request.size)),
  ])]

  // Load the host-persisted history and gallery once on mount (they live in
  // ~/.dsh on the DSH host, so every browser/device sees the same lists).
  useEffect(() => {
    let disposed = false
    api.historyList()
      .then(entries => { if (!disposed) setHistory(entries) })
      .catch(() => { /* history unavailable — leave the list empty */ })
    api.galleryList()
      .then(entries => { if (!disposed) setGallery(entries) })
      .catch(() => { /* gallery unavailable — leave the list empty */ })
    return () => { disposed = true }
  }, [api])

  // Chat toolviews publish durable refs after they finish loading. Decode the
  // refs through the same host-authorized route and make them the current
  // canvas result for the selected session.
  useEffect(() => {
    const onChatImages = (event: Event): void => {
      const detail = (event as CustomEvent<ChatImageEventDetail>).detail
      if (detail === undefined || currentSessionId === undefined || detail.sessionId !== currentSessionId) return
      void Promise.all(detail.refs.map(attachmentToGenerated))
        .then(next => {
          openTab('text')
          setImages(next)
          setComparison(null)
          setViewingHistoryId(null)
          setGalleryViewingId(null)
          setError(null)
        })
        .catch(caught => { setError(errorMessage(caught)) })
    }
    document.addEventListener(CHAT_IMAGE_EVENT, onChatImages)
    return () => document.removeEventListener(CHAT_IMAGE_EVENT, onChatImages)
  }, [currentSessionId])

  useEffect(() => {
    let disposed = false
    const refresh = (): void => {
      void api.taskList().then(next => {
        if (disposed) return
        const newlyCompleted = next.filter(task => task.status === 'completed'
          && task.result !== undefined
          && !tasksRef.current.some(old => old.id === task.id && old.status === 'completed'))
        tasksRef.current = next
        setTasks(previous => {
          const completed = next.find(task => task.status === 'completed'
            && !previous.some(old => old.id === task.id && old.status === 'completed')
            && !comparison?.taskIds.includes(task.id))
          if (completed?.result !== undefined) {
            setImages(completed.result.images)
            if (completed.result.history !== undefined) setHistory(completed.result.history)
            setError(completed.result.historyError ?? null)
          }
          return next
        })
        if (newlyCompleted.length > 0) {
          void api.historyList().then(entries => {
            if (!disposed) setHistory(entries)
          }).catch(() => {})
        }
      }).catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [api, comparison])

  // Close the model dropdown when clicking anywhere outside it.
  const modelMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!modelOpen) return
    const onPointer = (event: MouseEvent | FocusEvent): void => {
      const target = event.target
      if (target instanceof Node && modelMenuRef.current?.contains(target)) return
      setModelOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('focusin', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('focusin', onPointer)
    }
  }, [modelOpen])

  const openSettingsGuide = (kind: 'generation' | 'enhancement' | 'disabled'): void => {
    setConfigGuide(kind)
  }

  const enhanceCurrentPrompt = async (): Promise<void> => {
    if (prompt.trim() === '' || enhancing) return
    if (cqaiProvider.state !== 'signed-in') {
      setError(cqaiProvider.message ?? (cqaiProvider.state === 'reauth-required' ? 'CQAI Club 登录已失效，请重新登录。' : '请先登录 CQAI Club 后再使用提示词增强。'))
      return
    }
    setEnhancing(true)
    setError(null)
    try {
      setPrompt(await api.enhancePrompt(prompt))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setEnhancing(false)
    }
  }

  /** AI 帮写:整理/补全电商参数信息(提示词),走提示词增强通道。 */
  const ecommerceEnhanceInfo = async (): Promise<void> => {
    if (ecommerceEnhancing) return
    if (cqaiProvider.state !== 'signed-in') {
      setError(cqaiProvider.message ?? (cqaiProvider.state === 'reauth-required' ? 'CQAI Club 登录已失效，请重新登录。' : '请先登录 CQAI Club 后再使用提示词增强。'))
      return
    }
    setEcommerceEnhancing(true)
    setError(null)
    try {
      const instruction = [
        '你是电商图文策划。请把下面的商品信息整理成一段可直接用于 AI 生图提示词的中文参数描述(120 字以内),',
        '涵盖商品主体、规格材质、核心卖点与必须保留的特征;信息缺失处按商品类目合理补全,不要解释,只输出整理结果。',
        `商品名称:${ecommerce.productName.trim() || '未提供'}`,
        `商品类目:${ecommerce.category}`,
        `商品平台:${ecommerce.platform}`,
        `已有信息:${ecommerce.promptInfo.trim() !== '' ? ecommerce.promptInfo : '无,请根据商品名称与类目合理补全'}`,
      ].join('\n')
      const result = await api.enhancePrompt(instruction)
      setEcommerce(previous => ({ ...previous, promptInfo: result }))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setEcommerceEnhancing(false)
    }
  }

  /** Read up to five reference images. The first remains the primary image;
   *  the rest travel in GenerateRequest.images for gateways that support
   *  multi-reference edits (CQAI Relay does). */
  const acceptFiles = (files: readonly File[]): void => {
    const accepted = files
      .filter(file => file.type.startsWith('image/') && file.size <= REF_IMAGE_MAX_BYTES)
      .slice(0, MAX_REFERENCE_IMAGES)
    if (accepted.length === 0) {
      setError(tt('edit.uploadHint'))
      return
    }
    void Promise.all(accepted.map(file => new Promise<{ dataUrl: string; name: string }>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve({ dataUrl: reader.result, name: file.name })
        else reject(new Error('reference image could not be read'))
      }
      reader.onerror = () => { reject(reader.error ?? new Error('reference image could not be read')) }
      reader.readAsDataURL(file)
    }))).then((next) => {
      setRefImage(next[0] ?? null)
      setAdditionalRefImages(next.slice(1))
      setError(null)
    }).catch(() => { setError(tt('edit.uploadHint')) })
  }

  const clearReferenceImages = (): void => {
    setRefImage(null)
    setAdditionalRefImages([])
  }

  /** Read uploaded product assets into session-only data-URL chips. Product
   *  refs cap at MAX_ECOMMERCE_ASSETS; the style group holds a single image
   *  that gets replaced on re-upload. */
  const acceptEcommerceFiles = (files: FileList | undefined, role: 'product' | 'style' = 'product'): void => {
    if (files === undefined) return
    const incoming = Array.from(files).filter(file => file.type.startsWith('image/') && file.size <= REF_IMAGE_MAX_BYTES)
    if (incoming.length === 0) {
      setError(tt('edit.uploadHint'))
      return
    }
    for (const file of incoming) {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') return
        const dataUrl = reader.result
        setEcommerceAssets(previous => {
          if (role === 'style') {
            const styleAsset = { id: newComparisonId(), dataUrl, name: file.name, role: 'style' as const }
            return [...previous.filter(item => item.role !== 'style'), styleAsset]
          }
          if (previous.filter(item => item.role !== 'style').length >= MAX_ECOMMERCE_ASSETS) {
            setError(tt('ecommerce.assetsFull'))
            return previous
          }
          return [...previous, { id: newComparisonId(), dataUrl, name: file.name, role: 'product' }]
        })
      }
      reader.onerror = () => { setError(tt('edit.uploadHint')) }
      reader.readAsDataURL(file)
    }
  }

  /** Run one generation. */
  const handleGenerate = async (): Promise<void> => {
    if (submitting) return
    if (!enabled) {
      openSettingsGuide('disabled')
      return
    }
    if (providerId === 'cqai' && cqaiProvider.state !== 'signed-in') {
      setError(cqaiProvider.message ?? (cqaiProvider.state === 'reauth-required' ? 'CQAI Club 登录已失效，请重新登录。' : '请先登录 CQAI Club 后再生图。'))
      return
    }
    if (!configured || !apiKeySet) {
      openSettingsGuide('generation')
      return
    }
    const promptText = prompt.trim()
    if (promptText === '') {
      setError(tt('prompt.required'))
      return
    }
    if (tab === 'edit' && refImage === null) {
      setError(tt('edit.required'))
      return
    }
    const request: GenerateRequest = {
      mode: tab === 'edit' ? 'edit' : 'text',
      model: modeModels.includes(model) ? model : automaticModel,
      prompt: promptText,
      size,
      quality,
      n: count,
      detail,
      ...defaultChannelId !== undefined ? { channelId: defaultChannelId } : {},
      ...tab === 'edit' && refImage !== null ? { image: refImage.dataUrl } : {},
      ...tab === 'edit' && additionalRefImages.length > 0 ? { images: additionalRefImages.map(image => image.dataUrl) } : {},
      ...tab === 'edit' && refImage !== null
        ? { refName: [refImage, ...additionalRefImages].map(image => image.name).join('、') }
        : {},
    }
    setError(null)
    setSubmitting(true)
    try {
      const targetModels = (compareEnabled ? compareModels : [request.model]).filter(candidate => modeModels.includes(candidate))
      if (targetModels.length === 0) {
        setError(tt('compare.selectRequired'))
        return
      }
      const comparisonId = targetModels.length > 1 ? newComparisonId() : undefined
      const comparisonFields = comparisonId === undefined ? {} : { comparisonId, comparisonModels: targetModels }
      const submitted = await Promise.all(targetModels.map(targetModel => api.taskSubmit({ ...request, model: targetModel, ...comparisonFields })))
      setTasks(previous => [...submitted, ...previous.filter(item => !submitted.some(task => task.id === item.id))])
      setComparison(comparisonId === undefined ? null : { taskIds: submitted.map(task => task.id), prompt: promptText, comparisonId })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const handleEcommerceGenerate = async (): Promise<void> => {
    if (ecommerceGenerateDisabled) return
    if (providerId === 'cqai' && cqaiProvider.state !== 'signed-in') {
      setError(cqaiProvider.message ?? (cqaiProvider.state === 'reauth-required' ? 'CQAI Club 登录已失效，请重新登录。' : '请先登录 CQAI Club 后再生图。'))
      return
    }
    if (!enabled || !configured || !apiKeySet) { openSettingsGuide('generation'); return }
    const projectId = ecommerce.projectId || newComparisonId()
    const buildRequest = (slot: ProductSetSlot, index: number): GenerateRequest => {
      // Each slot picks one reference by asset role; a slot without a matching
      // asset (or 'none') falls back to text-to-image.
      const refRole = slot.refRole ?? 'product'
      const asset = refRole === 'none' ? undefined : ecommerceAssets.find(item => item.role === refRole)
      return {
        mode: asset !== undefined ? 'edit' as const : 'text' as const,
        model: modeModels.includes(model) ? model : automaticModel,
        prompt: ecommerceSlotPrompt(ecommerce, slot, index),
        size: ecommerce.size,
        quality,
        n: 1,
        detail,
        ...(defaultChannelId !== undefined ? { channelId: defaultChannelId } : {}),
        ...(asset !== undefined ? { image: asset.dataUrl, refName: asset.name } : {}),
        workflow: 'ecommerce' as const,
        projectId,
        projectName: ecommerce.productName.trim(),
        slotKey: `${slot.key}-${index + 1}`,
        slotLabel: slot.label,
      }
    }
    // Anchor chain: with a main-image slot enabled, only the main image is
    // submitted now; the remaining slots follow once it completes (see the
    // anchor effect) so the whole set shares one product. Without a main
    // slot, every slot submits immediately with its own reference.
    const mainSlots = ecommerceSlots.filter(slot => slot.key === 'main')
    const otherSlots = ecommerceSlots.filter(slot => slot.key !== 'main')
    const anchorChain = mainSlots.length > 0 && otherSlots.length > 0
    const leadSlots = anchorChain ? mainSlots : ecommerceSlots
    const requests = leadSlots.flatMap(slot => Array.from({ length: slot.count }, (_, index) => buildRequest(slot, index)))
    const remaining = anchorChain
      ? otherSlots.flatMap(slot => Array.from({ length: slot.count }, (_, index) => {
        const { image: _image, refName: _refName, ...rest } = buildRequest(slot, index)
        return rest
      }))
      : []
    setEcommerceGenerating(true); setSubmitting(true); setError(null); setEcommerceProjectId(projectId); setEcommerceRestored(null); setEcommerceAnchor(null)
    try {
      const submitted = await Promise.all(requests.map(request => api.taskSubmit(request)))
      setTasks(previous => [...submitted, ...previous])
      setEcommercePreview(false)
      if (anchorChain) setEcommerceAnchor({ projectId, mainTaskIds: submitted.map(task => task.id), remaining })
    } catch (caught) { setError(errorMessage(caught)) } finally { setSubmitting(false); setEcommerceGenerating(false) }
  }

  /** Start over with a fresh product draft (the old results stay in history). */
  const newEcommerceProduct = (): void => {
    setEcommerce(defaultEcommerceDraft())
    setEcommercePreview(false)
    setEcommerceProjectId(null)
    setEcommerceRestored(null)
    setEcommerceAnchor(null)
    setEcommerceAssets([])
    clearReferenceImages()
    setError(null)
  }

  /** Re-run every image of one slot with its original request. */
  const regenerateEcommerceSlot = async (label: string): Promise<void> => {
    if (ecommerceGenerating) return
    const group = ecommerceMergedItems.filter(item => item.label === label)
    if (group.length === 0) return
    setEcommerceGenerating(true)
    setError(null)
    try {
      const submitted = await Promise.all(group.map(item => api.taskSubmit({ ...item.source })))
      setTasks(previous => [...submitted, ...previous])
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setEcommerceGenerating(false)
    }
  }

  /** Open one persisted product set from history: rebuild the grouped results
   *  canvas from its entries. Reference images are not persisted, so restored
   *  edit-mode slots regenerate as text-to-image. */
  const viewEcommerceProject = async (group: HistoryGroup): Promise<void> => {
    const entry = group.entries[0]
    if (entry === undefined || entry.projectId === undefined) return
    try {
      const items: EcommerceResultItem[] = await Promise.all(group.entries.map(async item => ({
        id: item.id,
        label: item.slotLabel ?? '',
        slotKey: item.slotKey ?? '',
        status: 'completed' as const,
        model: item.model,
        prompt: item.prompt,
        images: await historyImagesToGenerated(item.images),
        source: {
          mode: item.mode === 'edit' ? 'text' as const : item.mode,
          model: item.model,
          prompt: item.prompt,
          size: item.size,
          quality: item.quality,
          detail: item.detail,
          n: 1,
          ...item.channelId !== undefined ? { channelId: item.channelId } : {},
          workflow: 'ecommerce' as const,
          projectId: entry.projectId!,
          projectName: entry.projectName ?? '',
          slotKey: item.slotKey ?? '',
          slotLabel: item.slotLabel ?? '',
        },
      })))
      setWorkspace('ecommerce')
      setEcommerceRestored({ projectId: entry.projectId, projectName: entry.projectName ?? '', items })
      setEcommerceProjectId(entry.projectId)
      setEcommercePreview(false)
      setError(null)
      setViewingHistoryId(entry.id)
      setGalleryViewingId(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  /** Download a JSON manifest describing the whole product set (prompts,
   *  slots and task outcomes) so results stay reproducible outside the panel. */
  const exportEcommerceManifest = (): void => {
    const manifest = {
      project: {
        id: ecommerceProjectId,
        name: ecommerce.projectName || ecommerce.productName,
        productName: ecommerce.productName,
        category: ecommerce.category,
        platform: ecommerce.platform,
        language: ecommerce.language,
        size: ecommerce.size,
        promptInfo: ecommerce.promptInfo,
      },
      generatedAt: new Date().toISOString(),
      images: ecommerceMergedItems.map(item => ({
        slotKey: item.slotKey,
        slotLabel: item.label,
        status: item.status,
        model: item.model,
        prompt: item.prompt,
        error: item.error,
      })),
    }
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `dsh-product-set-${(ecommerce.projectName || ecommerce.productName || 'set').replace(/[^\w-]+/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openPreview = (previewImages: GeneratedImage[], index: number): void => {
    setPreview({ images: previewImages, index })
    setPreviewScale(1)
    setPromptCopied(false)
  }

  const closePreview = (): void => {
    setPreview(null)
    setPreviewScale(1)
    setPromptCopied(false)
  }

  /** Step the preview by ±1, wrapping around. */
  const stepPreview = (delta: number): void => {
    setPreviewScale(1)
    setPromptCopied(false)
    setPreview(current => {
      if (current === null) return null
      const total = current.images.length
      return { images: current.images, index: (current.index + delta + total) % total }
    })
  }

  // Keyboard navigation for the preview overlay.
  useEffect(() => {
    if (preview === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePreview()
      else if (event.key === 'ArrowLeft') stepPreview(-1)
      else if (event.key === 'ArrowRight') stepPreview(1)
      else if (event.key === '+' || event.key === '=') setPreviewScale(current => clampPreviewScale(current + PREVIEW_SCALE_STEP))
      else if (event.key === '-') setPreviewScale(current => clampPreviewScale(current - PREVIEW_SCALE_STEP))
      else if (event.key === '0') setPreviewScale(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  // A scaled image owns real scrollable space, rather than being visually
  // transformed and clipped. Recenter the viewport after every zoom or slide.
  useEffect(() => {
    if (preview === null) return
    const frame = window.requestAnimationFrame(() => {
      const stage = previewStage.current
      if (stage === null) return
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2)
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [preview, previewScale])

  const loadHistoryGroup = async (group: HistoryGroup): Promise<GeneratedImage[]> => {
    const loaded = await Promise.all(group.entries.map(entry => historyImagesToGenerated(entry.images)))
    return loaded.flat()
  }

  const viewHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
    try {
      const restored = (await historyImagesToGenerated(entry.images)).map(image => image.revisedPrompt === undefined
        ? { ...image, revisedPrompt: entry.prompt }
        : image)
      setError(null)
      setViewingHistoryId(entry.id)
      setGalleryViewingId(null)
      if (restored.length > 0) openPreview(restored, 0)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  /** View every model result from one comparison as one canvas result set. */
  const viewHistoryGroup = async (group: HistoryGroup): Promise<void> => {
    const entry = group.entries[0]
    if (entry === undefined) return
    // Product sets rebuild their grouped results canvas instead of the
    // generic image workspace.
    if (entry.workflow === 'ecommerce' && entry.projectId !== undefined) {
      await viewEcommerceProject(group)
      return
    }
    try {
      const restored = await loadHistoryGroup(group)
      setError(null)
      setViewingHistoryId(entry.id)
      setGalleryViewingId(null)
      if (restored.length > 0) openPreview(restored, 0)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  /** Remove every persisted row belonging to one comparison group. */
  const deleteHistoryGroup = async (group: HistoryGroup): Promise<void> => {
    const ids = new Set(group.entries.map(entry => entry.id))
    setHistory(previous => previous.filter(entry => !ids.has(entry.id)))
    if (viewingHistoryId !== null && ids.has(viewingHistoryId)) setViewingHistoryId(null)
    if (ecommerceRestored !== null && group.entries.some(entry => entry.projectId === ecommerceRestored.projectId)) {
      setEcommerceRestored(null)
      setEcommerceProjectId(null)
      setEcommerceAnchor(null)
    }
    try {
      let next = history
      for (const id of ids) next = await api.historyRemove(id)
      setHistory(next)
    } catch {
      // Keep the optimistic local removal.
    }
  }

  /** Reset the workspace for a fresh image-generation run. */
  const startNewCreation = (): void => {
    openTab('text')
    setPrompt('')
    clearReferenceImages()
    setImages([])
    setPreview(null)
    setPreviewScale(1)
    setPromptCopied(false)
    setViewingHistoryId(null)
    setGalleryViewingId(null)
    setGallerySelecting(false)
    setSelectedGalleryIds(new Set())
    setComparison(null)
    setComparisonFullscreen(false)
    setEcommerceRestored(null)
    setError(null)
    setConversationMessage(null)
    setGalleryMessage(null)
  }

  /** Remove all history entries. */
  const clearHistory = async (): Promise<void> => {
    if (!window.confirm(tt('history.clearConfirm'))) return
    setHistory([])
    setViewingHistoryId(null)
    try {
      setHistory(await api.historyClear())
    } catch {
      // Keep the cleared local state.
    }
  }

  /** Clear only ordinary generation rows; canvas and ecommerce history stay intact. */
  const clearNormalHistory = async (): Promise<void> => {
    if (normalHistory.length === 0 || !window.confirm(tt('history.clearNormalConfirm'))) return
    const ids = new Set(normalHistory.map(entry => entry.id))
    setHistory(previous => previous.filter(entry => !ids.has(entry.id)))
    if (viewingHistoryId !== null && ids.has(viewingHistoryId)) setViewingHistoryId(null)
    try {
      let next = history
      for (const id of ids) next = await api.historyRemove(id)
      setHistory(next)
    } catch {
      void api.historyList().then(setHistory).catch(() => {})
    }
  }

  const deleteNormalHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
    setHistory(previous => previous.filter(item => item.id !== entry.id))
    if (viewingHistoryId === entry.id) setViewingHistoryId(null)
    try {
      setHistory(await api.historyRemove(entry.id))
    } catch {
      void api.historyList().then(setHistory).catch(() => {})
    }
  }

  /** Add one generated image to the gallery (host deduplicates by content).
   *  `entry` makes the action available from a history/gallery list item (its
   *  metadata + first image are saved); otherwise the current form state is
   *  used. */
  const addToGallery = async (image: GeneratedImage, entry?: HistoryEntry): Promise<void> => {
    if (galleryAdding || (workspace === 'normal' && tab === 'gallery')) return
    const source = entry ?? viewingEntry ?? {
      mode: tab === 'edit' ? 'edit' as GenerateMode : 'text' as GenerateMode,
      model,
      prompt: prompt.trim(),
      size,
      quality,
      detail,
      ...refImage !== null ? { refName: refImage.name } : {},
    }
    setGalleryAdding(true)
    try {
      const result = await api.galleryAppend({
        id: '', // the host assigns a fresh id
        createdAt: Date.now(),
        mode: source.mode,
        model: source.model,
        prompt: source.prompt,
        size: source.size,
        quality: source.quality,
        detail: source.detail,
        n: 1,
        images: [image],
        ...source.refName === undefined ? {} : { refName: source.refName },
      })
      setGallery(result.entries)
      setGalleryMessage(result.added ? tt('gallery.added') : tt('gallery.already'))
      window.setTimeout(() => { setGalleryMessage(null) }, 2200)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setGalleryAdding(false)
    }
  }

  /** Save local image files into the asset library so the canvas and studio
   *  can reuse them later; entries dedupe by content host-side. */
  const uploadGalleryFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0 || galleryAdding) return
    setGalleryAdding(true)
    try {
      let entries: HistoryEntry[] | undefined
      for (const file of files) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error(tt('canvas.dropSub')))
          reader.readAsDataURL(file)
        })
        const separator = dataUrl.indexOf(',')
        const result = await api.galleryAppend({
          id: '',
          createdAt: Date.now(),
          mode: 'text',
          model: tt('gallery.uploadModel'),
          prompt: file.name.replace(/\.[a-z0-9]+$/i, ''),
          size: 'auto',
          quality: 'auto',
          detail: '',
          n: 1,
          images: [{ b64: separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl, mime: file.type || 'image/png' }],
        })
        entries = result.entries
      }
      if (entries !== undefined) {
        setGallery(entries)
        setGalleryMessage(tt('gallery.uploaded'))
        window.setTimeout(() => { setGalleryMessage(null) }, 2200)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setGalleryAdding(false)
    }
  }

  /** Put a generated image into the native conversation composer. */
  const addImageToConversation = async (image: GeneratedImage, index: number, actionKey: number | string = index): Promise<void> => {
    if (addingToConversation !== null) return
    if (conversation === undefined || currentSessionId === undefined) {
      setError(tt('conversation.noSession'))
      return
    }
    if (!conversation.available) {
      setError(tt('conversation.unavailable'))
      return
    }
    setAddingToConversation(actionKey)
    try {
      const prepared = await prepareConversationImage(image, index)
      const file = prepared.file
      conversation.addFile(file)
      conversation.setDraftIfEmpty(prompt)
      setConversationMessage(tt('conversation.added'))
      window.setTimeout(() => { setConversationMessage(null) }, 2200)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAddingToConversation(null)
    }
  }

  /** Add one history entry's first image to the gallery (fetches it from the
   *  history image route, then delegates to addToGallery). */
  const addHistoryEntryToGallery = async (entry: HistoryEntry): Promise<void> => {
    if (galleryAdding || entry.images.length === 0) return
    try {
      const [image] = await historyImagesToGenerated(entry.images.slice(0, 1))
      if (image === undefined) return
      await addToGallery(image, entry)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  /** Add one history entry's first image to the current chat draft. */
  const addHistoryEntryToConversation = async (entry: HistoryEntry): Promise<void> => {
    if (historyConversationAddingId !== null || addingToConversation !== null || galleryConversationAddingId !== null || entry.images.length === 0) return
    setHistoryConversationAddingId(entry.id)
    try {
      const [image] = await historyImagesToGenerated(entry.images.slice(0, 1))
      if (image === undefined) return
      await addImageToConversation(image, 0, `history:${entry.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setHistoryConversationAddingId(null)
    }
  }

  /** Load a persisted gallery image and add it to the current chat draft. */
  const addGalleryEntryToConversation = async (entry: HistoryEntry): Promise<void> => {
    if (galleryConversationAddingId !== null || addingToConversation !== null || entry.images.length === 0) return
    setGalleryConversationAddingId(entry.id)
    try {
      const [image] = await historyImagesToGenerated(entry.images.slice(0, 1))
      if (image === undefined) return
      await addImageToConversation(image, 0, `gallery:${entry.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setGalleryConversationAddingId(null)
    }
  }

  /** View a gallery image in the canvas. */
  const viewGalleryEntry = async (entry: HistoryEntry): Promise<void> => {
    try {
      const restored = await historyImagesToGenerated(entry.images)
      setImages(restored)
      setError(null)
      setViewingHistoryId(null)
      setGalleryViewingId(entry.id)
      if (restored.length > 0) openPreview(restored, 0)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  /** Remove one gallery entry. */
  const deleteGalleryEntry = async (id: string): Promise<void> => {
    setGallery(gallery.filter(entry => entry.id !== id))
    if (galleryViewingId === id) setGalleryViewingId(null)
    try {
      setGallery(await api.galleryRemove(id))
    } catch {
      // Keep the optimistic local removal.
    }
  }

  /** Remove every gallery entry. */
  const clearGalleryAll = async (): Promise<void> => {
    if (!window.confirm(tt('gallery.clearConfirm'))) return
    setGallery([])
    setGalleryViewingId(null)
    try {
      setGallery(await api.galleryClear())
    } catch {
      // Keep the cleared local state.
    }
  }

  const applyGalleryTags = async (): Promise<void> => {
    const tags = galleryTagInput.split(',').map(tag => tag.trim()).filter(Boolean)
    if (tags.length === 0 || selectedGalleryIds.size === 0) return
    try {
      let next = gallery
      for (const id of selectedGalleryIds) {
        const existing = next.find(entry => entry.id === id)?.tags ?? []
        next = await api.gallerySetTags(id, [...existing, ...tags])
      }
      setGallery(next)
      setGalleryTagInput('')
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const startEditingGalleryTags = (entry: HistoryEntry): void => {
    setEditingGalleryTagsId(entry.id)
    setGalleryTagEditInput((entry.tags ?? []).join(', '))
  }

  const saveGalleryTags = async (id: string): Promise<void> => {
    const tags = galleryTagEditInput.split(',').map(tag => tag.trim()).filter(Boolean)
    try {
      setGallery(await api.gallerySetTags(id, tags))
      setEditingGalleryTagsId(null)
      setGalleryTagEditInput('')
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const toggleGallerySelection = (id: string): void => {
    setSelectedGalleryIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearGallerySelection = (): void => {
    setSelectedGalleryIds(new Set())
    setGallerySelecting(false)
  }

  const exportGalleryJson = (): void => {
    const entries = gallery.filter(entry => selectedGalleryIds.has(entry.id))
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `dsh-imagegen-gallery-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const downloadGalleryImages = (): void => {
    gallery.filter(entry => selectedGalleryIds.has(entry.id)).forEach((entry, index) => {
      const image = entry.images[0]
      if (image === undefined) return
      const anchor = document.createElement('a')
      anchor.href = image.url
      anchor.download = `dsh-gallery-${index + 1}.${extensionOf(image.mime)}`
      anchor.click()
    })
  }

  // Prompt hard limit of the model the generate button will actually use
  // (mirrors handleGenerate's pick). Over the limit the counter turns red and
  // the button locks — the engine would fast-fail anyway, but the user sees
  // why before spending a click.
  const activeModel = modeModels.includes(model) ? model : automaticModel
  const promptLimit = promptCharLimit(activeModel)
  const promptOverLimit = promptLimit !== null && prompt.trim().length >= promptLimit

  const generateDisabled = submitting || activeModel === '' || promptOverLimit
  const ecommerceSlots = ecommerce.slots.filter(slot => slot.enabled && slot.count > 0)
  const ecommerceTotal = ecommerceSlots.reduce((total, slot) => total + slot.count, 0)
  const ecommerceGenerateDisabled = submitting || ecommerceGenerating || ecommerceSlots.length === 0 || ecommerce.productName.trim() === '' || (ecommerce.language === 'custom' && effectiveEcommerceLanguage(ecommerce) === '')
  const ecommerceFileInput = useRef<HTMLInputElement>(null)
  /** Which group (主图/风格) the shared file input uploads into. */
  const ecommerceUploadRoleRef = useRef<'product' | 'style'>('product')
  // The results canvas merges live tasks of the active project with restored
  // history entries of the same project; restored slots that were regenerated
  // this session are covered by their live counterparts (same slotKey).
  const ecommerceProjectTasks = ecommerceProjectId === null
    ? []
    : tasks.filter(task => task.request.workflow === 'ecommerce' && task.request.projectId === ecommerceProjectId)
  const liveSlotKeys = new Set(ecommerceProjectTasks.map(task => task.request.slotKey ?? task.id))
  const ecommerceMergedItems: EcommerceResultItem[] = [
    ...ecommerceProjectTasks.map(task => ({
      id: task.id,
      label: task.request.slotLabel ?? '',
      slotKey: task.request.slotKey ?? '',
      status: task.status,
      model: task.request.model,
      prompt: task.request.prompt,
      ...task.error !== undefined ? { error: task.error } : {},
      images: task.result?.images ?? [],
      source: task.request,
    })),
    ...(ecommerceRestored !== null && ecommerceRestored.projectId === ecommerceProjectId
      ? ecommerceRestored.items.filter(item => !liveSlotKeys.has(item.slotKey))
      : []),
  ]
  const ecommerceDoneCount = ecommerceMergedItems.filter(item => item.status === 'completed').length
  const ecommerceFailedCount = ecommerceMergedItems.filter(item => item.status === 'failed' || item.status === 'cancelled').length
  const ecommerceResultGroups = [...new Set(ecommerceMergedItems.map(item => item.label))]
    .filter(label => label !== '')
    .map(label => ({ label, items: ecommerceMergedItems.filter(item => item.label === label) }))
  // 套图结果左右布局:主图组独占左侧,其余分组在右侧纵排。live 任务的
  // slotKey 带序号后缀(main-1),这里按 main 前缀识别主图组。
  const ecommerceMainGroup = ecommerceResultGroups.find(group => group.items.some(item => item.slotKey === 'main' || item.slotKey.startsWith('main-'))) ?? null
  const ecommerceSideGroups = ecommerceResultGroups.filter(group => group !== ecommerceMainGroup)
  const renderEcommerceGroup = (group: { label: string, items: EcommerceResultItem[] }, main = false): React.JSX.Element => (
    <section key={group.label} className={css.ecommerceGroup} data-ecommerce-group={group.label} data-main={main ? '' : undefined}>
      <header>
        <strong>{group.label}</strong>
        <span>{group.items.filter(item => item.status === 'completed').length}/{group.items.length}</span>
        <button type="button" className={css.galleryBulkButton} disabled={ecommerceGenerating} onClick={() => { void regenerateEcommerceSlot(group.label) }}>{tt('ecommerce.results.regenerate')}</button>
      </header>
      <div className={css.ecommerceGroupGrid}>
        {group.items.map(item => (
          <div key={item.id} className={css.ecommerceTaskCard} data-status={item.status}>
            {item.status === 'completed' && item.images.length > 0 ? item.images.map((image, imageIndex) => (
              <figure
                key={imageIndex}
                className={css.imageCard}
                role="button"
                tabIndex={0}
                title={tt('preview.open')}
                onClick={() => { openPreview(item.images, imageIndex) }}
              >
                <img className={css.image} src={srcOf(image)} alt={`${group.label} ${imageIndex + 1}`} />
                <span className={css.ecommerceResultBadge}>{group.label}</span>
                <span className={css.ecommerceTaskActions} onClick={event => event.stopPropagation()}>
                  <a className={css.ecommerceActionChip} href={srcOf(image)} download={`product-${item.slotKey || item.id}-${imageIndex + 1}.${extensionOf(image.mime)}`}>{tt('download')}</a>
                  <button type="button" className={css.ecommerceActionChip} disabled={galleryAdding} onClick={() => { void addToGallery(image) }}>{tt('gallery.add')}</button>
                  <button type="button" className={css.ecommerceActionChip} disabled={conversationBusy} onClick={() => { void addImageToConversation(image, imageIndex, `${item.id}:${imageIndex}`) }}>{addingToConversation === `${item.id}:${imageIndex}` ? tt('conversation.adding') : tt('conversation.add')}</button>
                </span>
              </figure>
            )) : (
              <span className={css.ecommerceTaskState}>
                <b>{group.label}</b>
                {tt(`tasks.${item.status}` as never)}
                {item.error !== undefined ? ` · ${item.error}` : ''}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
  const conversationBusy = addingToConversation !== null || galleryConversationAddingId !== null || historyConversationAddingId !== null
  const viewingEntry = viewingHistoryId === null ? null : history.find(entry => entry.id === viewingHistoryId) ?? null
  const previewImage = preview === null ? null : preview.images[preview.index] ?? null
  const comparisonTasks = comparison === null ? [] : comparison.taskIds.map(id => tasks.find(task => task.id === id)).filter((task): task is GenerationTask => task !== undefined)
  const comparisonResults = comparisonTasks.filter(task => task.status === 'completed' && task.result !== undefined)
  const previewFrameScale = Math.max(1, previewScale)
  const previewImageScale = previewScale / previewFrameScale

  /** Drag the config panel's right edge to resize it (persisted per browser). */
  const onConfigResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const aside = configAsideRef.current
    if (aside === null) return
    const left = aside.getBoundingClientRect().left
    const onMove = (move: PointerEvent): void => {
      const width = Math.round(Math.min(CONFIG_WIDTH_MAX, Math.max(CONFIG_WIDTH_MIN, move.clientX - left)))
      setConfigWidth(width)
      try { window.localStorage.setItem(CONFIG_WIDTH_STORAGE_KEY, String(width)) } catch { /* optional */ }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.style.removeProperty('cursor')
      document.documentElement.style.removeProperty('user-select')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    document.documentElement.style.setProperty('cursor', 'col-resize')
    document.documentElement.style.setProperty('user-select', 'none')
  }

  const copyPreviewPrompt = async (text: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('copy failed')
      }
      setPromptCopied(true)
      window.setTimeout(() => { setPromptCopied(false) }, 1800)
    } catch {
      setPromptCopied(false)
    }
  }

  const addPreviewToEdit = (): void => {
    if (previewImage === null || preview === null) return
    openTab('edit')
    setRefImage({
      dataUrl: srcOf(previewImage),
      name: `dsh-image-${preview.index + 1}.${extensionOf(previewImage.mime)}`,
    })
    setAdditionalRefImages([])
    if (prompt.trim() === '' && previewImage.revisedPrompt !== undefined) setPrompt(previewImage.revisedPrompt)
    setError(null)
    closePreview()
  }

  // History is part of the official keyed main panel. The shell sidebar owns
  // navigation only; keeping data surfaces inside the panel avoids reaching
  // into private shell DOM and works for both empty and active sessions.
  const historyPanel = (
    <aside className={css.history} data-dsh-imagegen-history>
      <header className={css.historyHeader}>
        <span className={css.historyTitle}>{tt('history.title')}</span>
        <div className={css.historyHeaderActions}>
          <button
            type="button"
            className={css.historyNew}
            data-history-new=""
            aria-label={tt('canvas.new')}
            title={tt('canvas.newHint')}
            onClick={startNewCreation}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button
            type="button"
            className={css.historyNew}
            data-history-open-folder=""
            aria-label={tt('gallery.openFolder')}
            title={tt('gallery.openFolderHint')}
            onClick={() => { void api.openDataFolder() }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 4.2A1.2 1.2 0 0 1 2.7 3h2.9l1.6 1.9h6.1A1.2 1.2 0 0 1 14.5 6.1v6.2a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2z" /></svg>
          </button>
          {history.length > 0 ? (
            <button type="button" className={css.historyClear} data-history-clear="" onClick={() => { void clearHistory() }}>
              {tt('history.clear')}
            </button>
          ) : null}
        </div>
      </header>

      <div className={css.historyFilters}>
        <input className={css.historySearch} value={historyQuery} onChange={event => { setHistoryQuery(event.target.value) }} placeholder={tt('history.search')} aria-label={tt('history.search')} />
        <select value={historyModelFilter} onChange={event => { setHistoryModelFilter(event.target.value) }} aria-label={tt('history.model')}>
          <option value="all">{tt('history.allModels')}</option>
          {[...new Set(history.flatMap(entry => modelsOfHistoryEntry(entry)))].map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <select value={historyRatioFilter} onChange={event => { setHistoryRatioFilter(event.target.value) }} aria-label={tt('history.ratio')}>
          <option value="all">{tt('history.allRatios')}</option>
          {[...new Set(history.map(entry => normalizeSize(entry.size)))].map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {filteredHistory.length === 0 ? (
        <div className={css.historyEmpty}>{tt('history.empty')}</div>
      ) : (
        <div className={css.historyList}>
          {filteredHistory.map(group => {
            const entry = group.entries[0]!
            const isComparison = group.models.length > 1
            const imageCount = group.entries.reduce((total, item) => total + item.images.length, 0)
            return (
              <div
                key={group.key}
                className={css.historyItem}
                data-active={group.entries.some(item => item.id === viewingHistoryId) ? '' : undefined}
                data-comparison={isComparison ? '' : undefined}
              >
                <button
                  type="button"
                  className={css.historyMain}
                  data-dsh-imagegen-history-main=""
                  onClick={() => { void viewHistoryGroup(group) }}
                >
                  {entry.images.length > 0 ? (
                    <img className={css.historyThumb} src={entry.images[0]!.url} alt="" />
                  ) : (
                    <span className={css.historyThumbPlaceholder} />
                  )}
                  <span className={css.historyInfo}>
                    <span className={css.historyPrompt}>{entry.prompt}</span>
                    <span className={css.historyMeta}>
                      {isComparison
                        ? tt('compare.title')
                        : entry.workflow === 'ecommerce'
                          ? `${tt('ecommerce.short')}${entry.projectName !== undefined && entry.projectName !== '' ? ` · ${entry.projectName}` : ''}`
                          : tt(`mode.${entry.mode === 'edit' ? 'edit' : 'text'}` as const)}
                      {' · '}{isComparison ? group.models.join(' · ') : entry.model}
                      {' · '}{formatTime(entry.createdAt)}
                      {' · '}{imageCount} {tt('history.images')}
                    </span>
                  </span>
                </button>
                <span className={css.historyActions}>
                  {entry.images.length > 0 ? (
                    <button
                      type="button"
                      className={css.historyIconAction}
                      disabled={conversationBusy}
                      title={`${tt('conversation.add')}：${tt('conversation.addHint')}`}
                      aria-label={tt('conversation.add')}
                      data-history-add-conversation=""
                      onClick={() => { void addHistoryEntryToConversation(entry) }}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5a1.5 1.5 0 0 1-1.5 1.5H8.5L5.5 13v-2.5H4A1.5 1.5 0 0 1 2.5 9V4A1.5 1.5 0 0 1 4 2.5z" /></svg>
                    </button>
                  ) : null}
                  {entry.images.length > 0 ? (
                    <button
                      type="button"
                      className={css.historyIconAction}
                      disabled={galleryAdding}
                      title={tt('gallery.add')}
                      aria-label={tt('gallery.add')}
                      data-history-add-gallery=""
                      onClick={() => { void addHistoryEntryToGallery(entry) }}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="5.9" cy="6.1" r="1" /><path d="M13.5 10.2l-3.1-3.1L4.6 13" /></svg>
                    </button>
                  ) : null}
                  {entry.images.length > 0 ? (
                    <button
                      type="button"
                      className={css.historyIconAction}
                      title={tt('canvas.addToCanvas')}
                      aria-label={tt('canvas.addToCanvas')}
                      data-history-add-canvas=""
                      onClick={() => { addEntryToCanvas('history', entry.id, 0) }}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M5 8h6M8 5v6" /></svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={css.historyIconAction}
                    data-danger
                    title={tt('history.delete')}
                    aria-label={tt('history.delete')}
                    onClick={() => { void deleteHistoryGroup(group) }}
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5h11" /><path d="M6 4.5V3.2a.7.7 0 0 1 .7-.7h2.6a.7.7 0 0 1 .7.7v1.3" /><path d="M4.3 4.5l.6 8.1a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.6-8.1" /><path d="M6.7 7v4M9.3 7v4" /></svg>
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )

  const normalStreamPanel = (
    <div className={css.normalStream} data-dsh-imagegen-normal-feed="" data-layout="masonry">
      <header className={css.normalStreamHeader}>
        <span className={css.normalStreamHeading}>
          <strong>{tt('tasks.title')}</strong>
          <span>{tt('tasks.count', { count: normalStreamItems.length })}</span>
        </span>
        <span className={css.normalStreamHeaderActions}>
          {comparison !== null && comparisonResults.length > 0 ? (
            <button type="button" onClick={() => { setComparisonFullscreen(true) }}>{tt('compare.fullscreen')}</button>
          ) : null}
          <button type="button" aria-label={tt('canvas.new')} title={tt('canvas.newHint')} onClick={startNewCreation}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" aria-label={tt('gallery.openFolder')} title={tt('gallery.openFolderHint')} onClick={() => { void api.openDataFolder() }}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 4.2A1.2 1.2 0 0 1 2.7 3h2.9l1.6 1.9h6.1A1.2 1.2 0 0 1 14.5 6.1v6.2a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2z" /></svg>
          </button>
          {normalHistory.length > 0 ? (
            <button type="button" data-normal-feed-clear="" onClick={() => { void clearNormalHistory() }}>{tt('history.clear')}</button>
          ) : null}
        </span>
      </header>

      <div className={css.normalStreamFilters}>
        <input className={css.normalStreamSearch} value={historyQuery} onChange={event => { setHistoryQuery(event.target.value) }} placeholder={tt('history.search')} aria-label={tt('history.search')} />
        <select value={historyModelFilter} onChange={event => { setHistoryModelFilter(event.target.value) }} aria-label={tt('history.model')}>
          <option value="all">{tt('history.allModels')}</option>
          {normalStreamModels.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <select value={historyRatioFilter} onChange={event => { setHistoryRatioFilter(event.target.value) }} aria-label={tt('history.ratio')}>
          <option value="all">{tt('history.allRatios')}</option>
          {normalStreamRatios.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {error !== null ? <div className={css.normalStreamError} role="alert">{tt('canvas.error', { error })}</div> : null}

      {normalStreamItems.length === 0 ? (
        <div className={css.normalStreamEmpty}>
          <span className={css.canvasEmptyIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </span>
          <strong>{tt('history.empty')}</strong>
        </div>
      ) : (
        <div className={css.normalStreamScroll}>
          <div className={css.normalStreamMasonry}>
            {[0, 1].map(columnIndex => (
              <div key={columnIndex} className={css.normalStreamColumn} data-normal-feed-column={columnIndex}>
                {normalStreamItems.filter((_, itemIndex) => itemIndex % 2 === columnIndex).map((item, rowIndex) => {
                  const task = item.kind === 'task' ? item.task : undefined
                  const entry = item.kind === 'history' ? item.entry : undefined
                  const request = task?.request ?? entry!
                  const taskImages = task?.result?.images ?? []
                  const taskPreviewImages = taskImages.map(image => image.revisedPrompt === undefined
                    ? { ...image, revisedPrompt: request.prompt }
                    : image)
                  const imageSrc = entry?.images[0]?.url ?? (taskImages[0] === undefined ? undefined : srcOf(taskImages[0]))
                  const imageCount = entry?.images.length ?? taskImages.length
                  const status: GenerationTaskStatus = task?.status ?? 'completed'
                  const elapsedSeconds = task === undefined ? undefined : taskElapsedSeconds(task)
                  return (
                    <article
                      key={item.key}
                      className={css.normalTaskCard}
                      data-normal-feed-card=""
                      data-source={item.kind}
                      data-status={status}
                      style={{ '--dsh-normal-feed-order': rowIndex * 2 + columnIndex } as CSSProperties}
                    >
                      {imageSrc !== undefined ? (
                        <button
                          type="button"
                          className={css.normalCardMedia}
                          data-normal-feed-preview=""
                          title={tt('preview.open')}
                          onClick={() => {
                            if (entry !== undefined) void viewHistoryEntry(entry)
                            else if (taskPreviewImages.length > 0) openPreview(taskPreviewImages, 0)
                          }}
                        >
                          <img className={css.normalCardImage} src={imageSrc} alt={request.prompt} />
                          <span className={css.normalCardStatus}>{tt(`tasks.${status}` as never)}</span>
                          {imageCount > 1 ? <span className={css.normalCardImageCount}>{imageCount} {tt('history.images')}</span> : null}
                          <span className={css.normalCardZoom}>{tt('preview.open')}</span>
                        </button>
                      ) : (
                        <div className={css.normalCardPending}>
                          <span className={css.normalCardStatus}>{tt(`tasks.${status}` as never)}</span>
                          {status === 'running' || status === 'queued' ? <span className={css.bigSpinner} /> : null}
                          <strong>{status === 'queued' ? tt('canvas.queued') : status === 'running' ? tt('canvas.generating') : tt(`tasks.${status}` as never)}</strong>
                          {task?.error !== undefined ? <small>{task.error}</small> : null}
                        </div>
                      )}

                      <div className={css.normalCardBody}>
                        <span className={css.normalCardPromptRow}>
                          <strong title={request.prompt}>{request.prompt}</strong>
                          <button type="button" aria-label={tt('preview.copyPrompt')} title={tt(promptCopied ? 'preview.copied' : 'preview.copyPrompt')} onClick={() => { void copyPreviewPrompt(request.prompt) }}>
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="5" width="7" height="8" rx="1"/><path d="M3 10V3.8c0-.44.36-.8.8-.8H9"/></svg>
                          </button>
                        </span>
                        <span className={css.normalCardMeta}>
                          <span>{request.model}</span>
                          <span>{normalizeSize(request.size)}</span>
                          <span>{elapsedSeconds === undefined ? formatTime(item.createdAt) : tt('canvas.elapsed', { seconds: elapsedSeconds })}</span>
                        </span>
                        <span className={css.normalCardActions}>
                          {entry !== undefined && entry.images.length > 0 ? (
                            <>
                              <button type="button" disabled={conversationBusy} onClick={() => { void addHistoryEntryToConversation(entry) }}>{historyConversationAddingId === entry.id ? tt('conversation.adding') : tt('conversation.add')}</button>
                              <button type="button" disabled={galleryAdding} onClick={() => { void addHistoryEntryToGallery(entry) }}>{tt('gallery.add')}</button>
                              <button type="button" onClick={() => { addEntryToCanvas('history', entry.id, 0) }}>{tt('canvas.addToCanvas')}</button>
                              <a href={entry.images[0]!.url} download={`dsh-history-${entry.id}.${extensionOf(entry.images[0]!.mime)}`}>{tt('download')}</a>
                              <button type="button" data-danger="" onClick={() => { void deleteNormalHistoryEntry(entry) }}>{tt('history.delete')}</button>
                            </>
                          ) : null}
                          {task !== undefined && (status === 'queued' || status === 'running') ? <button type="button" onClick={() => { void api.taskCancel(task.id) }}>{tt('tasks.cancel')}</button> : null}
                          {task !== undefined && (status === 'failed' || status === 'cancelled') ? <button type="button" onClick={() => { void api.taskRetry(task.id) }}>{tt('tasks.retry')}</button> : null}
                          {task !== undefined && status === 'completed' && taskImages[0] !== undefined ? <a href={srcOf(taskImages[0])} download={`dsh-task-${task.id}.${extensionOf(taskImages[0].mime)}`}>{tt('download')}</a> : null}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const isGallery = workspace === 'normal' && tab === 'gallery'
  const isGeneration = workspace === 'normal' && tab !== 'gallery'
  const showsHistoryRail = workspace === 'ecommerce'

  return (
    <div className={css.panel}>
      <header className={css.panelHeader}>
        <span className={css.panelHeading}>
          <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
        </span>
        <GooeyNav
          ariaLabel={tt('workspace.label')}
          activeIndex={workspace === 'normal' ? (tab === 'gallery' ? 1 : 0) : workspace === 'canvas' ? 2 : 3}
          onSelect={index => {
            if (index === 0) openTab('text')
            else if (index === 1) openTab('gallery')
            else if (index === 2) setWorkspace('canvas')
            else setWorkspace('ecommerce')
          }}
          items={[
            { key: 'normal', label: tt('workspace.normal') },
            { key: 'gallery', label: tt('gallery.title') },
            { key: 'canvas', label: tt('workspace.canvas') },
            { key: 'ecommerce', label: <>{tt('workspace.ecommerce')}<span className={css.previewBadge}>{tt('ecommerce.badge')}</span></> },
          ]}
        />
        <span className={css.panelHeaderActions}>
          <button
            type="button"
            className={css.connectionStatus}
            data-connected={connected ? 'true' : 'false'}
            aria-label={tt(connected ? 'connection.connected' : 'connection.disconnected')}
          >
            <span className={css.connectionDot} aria-hidden="true" />
            {tt(connected ? 'connection.connected' : 'connection.disconnected')}
          </button>
        </span>
      </header>

      <div className={css.studio} data-history-rail={showsHistoryRail ? 'true' : 'false'}>
        {/* Ordinary generation owns its unified feed, while the asset library
            and infinite canvas use their full workspace. Ecommerce keeps the
            legacy project-history rail until its dedicated history lands. */}
        {showsHistoryRail ? historyPanel : null}
        <div className={css.generation} data-workspace={workspace}>
          {/* ------------------------------------------------ config sidebar */}
          <aside
            ref={configAsideRef}
            className={css.config}
            data-dsh-imagegen-normal-config={isGeneration ? '' : undefined}
            style={{ '--dsh-imagegen-config-width': `${configWidth}px` } as CSSProperties}
            data-collapsed={configCollapsed ? 'true' : 'false'}
            data-gallery={workspace === 'normal' && tab === 'gallery' ? 'true' : undefined}
          >
            <div className={css.configResizer} title={tt('config.resizeHint')} onPointerDown={onConfigResizeStart} />
          <div className={css.configHeader}>
            <button
              type="button"
              className={css.configToggle}
              aria-expanded={!configCollapsed}
              aria-label={tt(configCollapsed ? 'panel.expandConfig' : 'panel.collapseConfig')}
              title={tt(configCollapsed ? 'panel.expandConfig' : 'panel.collapseConfig')}
              onClick={() => { setConfigCollapsed(previous => !previous) }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={configCollapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'} />
              </svg>
            </button>
          </div>
          {isGallery ? (
            <div className={css.galleryFilters}>
              <div className={css.galleryFilterHeading}>{tt('gallery.categories')}</div>
              {[
                ['all', tt('gallery.all')],
                ['text', tt('mode.text')],
                ['edit', tt('mode.edit')],
                ...galleryModels.map(value => [value, value]),
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={css.galleryFilter}
                  data-active={galleryFilter === value ? '' : undefined}
                  onClick={() => { setGalleryFilter(value) }}
                >
                  <span>{label}</span>
                  <span className={css.galleryFilterCount}>{gallery.filter(entry => value === 'all' || value === 'text' || value === 'edit' ? (value === 'all' ? true : entry.mode === value) : entry.model === value).length}</span>
                </button>
              ))}
              <div className={css.galleryFilterDivider} />
              <div className={css.galleryFilterHeading}>{tt('gallery.ratio')}</div>
              <div className={css.galleryRatioList}>
                {(['all', '1:1', '3:4', '4:3', '16:9'] as const).map(ratio => (
                  <button key={ratio} type="button" className={css.galleryRatio} data-active={galleryRatio === ratio ? '' : undefined} onClick={() => { setGalleryRatio(ratio) }}>
                    {ratio === 'all' ? tt('gallery.all') : ratio}
                  </button>
                ))}
              </div>
              {galleryTagOptions.length > 0 ? (
                <>
                  <div className={css.galleryFilterDivider} />
                  <div className={css.galleryFilterHeading}>{tt('gallery.tags')}</div>
                  <div className={css.galleryTagFilterList}>
                    {galleryTagOptions.map(tag => (
                      <button key={tag} type="button" className={css.galleryTagFilter} data-active={galleryTagFilter === tag ? '' : undefined} onClick={() => { setGalleryTagFilter(previous => previous === tag ? null : tag) }}>
                        <span>{tag}</span>
                        <span>{gallery.filter(entry => (entry.tags ?? []).includes(tag)).length}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className={css.galleryFilterNote}>{tt('gallery.filterHint')}</div>
            </div>
          ) : null}
          <div className={css.configScroll}>
            {/* generation sub-modes live inside the normal workspace */}
            {workspace === 'normal' && tab !== 'gallery' ? (
              <section className={css.card}>
                <div className={css.modeRow} role="tablist" aria-label={tt('panel.title')}>
                  <Pill active={tab === 'text'} onClick={() => { setTab('text') }} className={css.modePill}>{tt('mode.text')}</Pill>
                  <Pill active={tab === 'edit'} onClick={() => { setTab('edit') }} className={css.modePill}>{tt('mode.edit')}</Pill>
                </div>
              </section>
            ) : null}

            {workspace === 'ecommerce' ? (
              <section className={css.ecommerceWorkspace} data-ecommerce-workspace="">
                <div className={css.ecommerceSection}>
                  <header className={css.ecommerceCardHead}>
                    <h3>{tt('ecommerce.productRefTitle')}<small className={css.ecommerceSectionHint}>{tt('ecommerce.productRefHint')}</small></h3>
                    <span className={css.ecommerceCardCount}>{ecommerceAssets.filter(asset => asset.role !== 'style').length}/{MAX_ECOMMERCE_ASSETS}</span>
                  </header>
                  {ecommerceAssets.some(asset => asset.role !== 'style') ? (
                    <div className={css.ecommerceAssets}>
                      {ecommerceAssets.filter(asset => asset.role !== 'style').map(asset => (
                        <div key={asset.id} className={css.ecommerceAsset} data-ecommerce-asset="">
                          <img src={asset.dataUrl} alt={asset.name} />
                          <select
                            value={asset.role}
                            data-ecommerce-asset-role=""
                            aria-label={tt('ecommerce.refSelect')}
                            onChange={event => setEcommerceAssets(previous => previous.map(item => item.id === asset.id ? { ...item, role: event.target.value as EcommerceAssetRole } : item))}
                          >
                            {ECOMMERCE_ASSET_ROLES.filter(role => role !== 'style').map(role => (
                              <option key={role} value={role}>{tt(`ecommerce.role.${role}` as never)}</option>
                            ))}
                          </select>
                          <button type="button" aria-label={tt('edit.remove')} onClick={() => { setEcommerceAssets(previous => previous.filter(item => item.id !== asset.id)) }}>×</button>
                        </div>
                      ))}
                      {ecommerceAssets.filter(asset => asset.role !== 'style').length < MAX_ECOMMERCE_ASSETS ? (
                        <button
                          type="button"
                          className={css.ecommerceAssetAdd}
                          data-ecommerce-upload=""
                          title={tt('ecommerce.uploadRef')}
                          onClick={() => { ecommerceUploadRoleRef.current = 'product'; ecommerceFileInput.current?.click() }}
                          onDragOver={(event) => { event.preventDefault() }}
                          onDrop={(event) => {
                            event.preventDefault()
                            acceptEcommerceFiles(event.dataTransfer.files ?? undefined, 'product')
                          }}
                        >
                          <span aria-hidden="true">＋</span>
                          <small>{tt('ecommerce.uploadShort')}</small>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={css.ecommerceUploadHero}
                      data-ecommerce-upload=""
                      onClick={() => { ecommerceUploadRoleRef.current = 'product'; ecommerceFileInput.current?.click() }}
                      onDragOver={(event) => { event.preventDefault() }}
                      onDrop={(event) => {
                        event.preventDefault()
                        acceptEcommerceFiles(event.dataTransfer.files ?? undefined, 'product')
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 10V3.5"/><path d="M5.5 5.5L8 3l2.5 2.5"/><path d="M3 9.5V12a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 12V9.5"/></svg>
                      <span>{tt('ecommerce.uploadRef')}</span>
                      <small>{tt('edit.uploadHint')}</small>
                    </button>
                  )}
                </div>
                <div className={css.ecommerceSection}>
                  <header className={css.ecommerceCardHead}>
                    <h3>{tt('ecommerce.styleRefTitle')}<small className={css.ecommerceSectionHint}>({tt('ecommerce.styleRefBadge')})</small></h3>
                    <span className={css.ecommerceCardCount}>{ecommerceAssets.some(asset => asset.role === 'style') ? 1 : 0}/1</span>
                  </header>
                  <p className={css.ecommerceCardHint}>{tt('ecommerce.styleRefHint')}</p>
                  {ecommerceAssets.some(asset => asset.role === 'style') ? (
                    <div className={css.ecommerceAssets}>
                      {ecommerceAssets.filter(asset => asset.role === 'style').map(asset => (
                        <div key={asset.id} className={css.ecommerceAsset} data-ecommerce-asset="">
                          <img src={asset.dataUrl} alt={asset.name} />
                          <button type="button" aria-label={tt('edit.remove')} onClick={() => { setEcommerceAssets(previous => previous.filter(item => item.id !== asset.id)) }}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={css.ecommerceAssetAdd}
                      data-ecommerce-upload=""
                      title={tt('ecommerce.styleRefUpload')}
                      onClick={() => { ecommerceUploadRoleRef.current = 'style'; ecommerceFileInput.current?.click() }}
                      onDragOver={(event) => { event.preventDefault() }}
                      onDrop={(event) => {
                        event.preventDefault()
                        acceptEcommerceFiles(event.dataTransfer.files ?? undefined, 'style')
                      }}
                    >
                      <span aria-hidden="true">＋</span>
                      <small>{tt('ecommerce.styleRefUpload')}</small>
                    </button>
                  )}
                </div>
                <div className={css.ecommerceSection}>
                  <label className={css.ecommerceField}>
                    <span className={css.ecommerceFieldLabel}>{tt('ecommerce.productName')}</span>
                    <input value={ecommerce.productName} placeholder={tt('ecommerce.productName')} onChange={event => setEcommerce(previous => ({ ...previous, productName: event.target.value }))} />
                  </label>
                </div>
                <div className={css.ecommerceSection}>
                  <header className={css.ecommerceCardHead}>
                    <h3>{tt('ecommerce.refInfoTitle')}<small className={css.ecommerceSectionHint}>({tt('ecommerce.optional')})</small></h3>
                    <button
                      type="button"
                      className={css.ecommerceAiButton}
                      disabled={ecommerceEnhancing}
                      title={tt('ecommerce.aiWriteHint')}
                      onClick={() => { void ecommerceEnhanceInfo() }}
                    >
                      <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.4 3.6L13 6.5l-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"/></svg>
                      {ecommerceEnhancing ? tt('ecommerce.aiWriting') : tt('ecommerce.aiWrite')}
                    </button>
                  </header>
                  <textarea value={ecommerce.promptInfo} placeholder={tt('ecommerce.promptInfoPlaceholder')} onChange={event => setEcommerce(previous => ({ ...previous, promptInfo: event.target.value }))} />
                </div>
                <div className={css.ecommerceSection}>
                  <h3>{tt('ecommerce.params')}</h3>
                  <div className={css.ecommerceParamGrid}>
                    <label className={css.ecommerceField}>
                      <span className={css.ecommerceFieldLabel}>{tt('ecommerce.platformLabel')}</span>
                      <select value={ecommerce.platform} onChange={event => setEcommerce(previous => ({ ...previous, platform: event.target.value }))}><option>通用</option><option>淘宝 / 京东</option><option>Amazon</option></select>
                    </label>
                    <label className={css.ecommerceField}>
                      <span className={css.ecommerceFieldLabel}>{tt('ecommerce.languageLabel')}</span>
                      <select aria-label={tt('ecommerce.languageLabel')} value={ecommerce.language} onChange={event => setEcommerce(previous => ({ ...previous, language: event.target.value }))}>
                        {ECOMMERCE_COPY_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{value === 'custom' ? tt('ecommerce.customLanguageOption') : label}</option>)}
                      </select>
                      {ecommerce.language === 'custom' ? (
                        <input
                          value={ecommerce.customLanguage ?? ''}
                          maxLength={40}
                          placeholder={tt('ecommerce.customLanguagePlaceholder')}
                          aria-label={tt('ecommerce.customLanguageLabel')}
                          onChange={event => setEcommerce(previous => ({ ...previous, customLanguage: event.target.value }))}
                        />
                      ) : null}
                    </label>
                    <label className={css.ecommerceField}>
                      <span className={css.ecommerceFieldLabel}>{tt('ecommerce.categoryLabel')}</span>
                      <select value={ecommerce.category} onChange={event => setEcommerce(previous => ({ ...previous, category: event.target.value }))}><option>通用商品</option><option>食品饮料</option><option>美妆个护</option><option>服装配饰</option><option>家居用品</option><option>3C 数码</option></select>
                    </label>
                    <label className={css.ecommerceField}>
                      <span className={css.ecommerceFieldLabel}>{tt('ecommerce.ratioLabel')}</span>
                      <select value={ecommerce.size} onChange={event => setEcommerce(previous => ({ ...previous, size: event.target.value }))}>{SIZES.filter(size => size !== 'auto').map(size => <option key={size}>{size}</option>)}</select>
                    </label>
                  </div>
                </div>
                <div className={css.ecommerceSection}>
                  <h3>{tt('ecommerce.setStructure')}<small className={css.ecommerceSectionHint}>{tt('ecommerce.multiSelect')}</small></h3>
                  <div className={css.ecommerceStructureGrid}>
                    {ecommerce.slots.map(slot => (
                      <button
                        key={slot.key}
                        type="button"
                        className={css.ecommerceSlotCard}
                        data-active={slot.enabled ? '' : undefined}
                        title={`${slot.label}：${slot.description}`}
                        onClick={() => setEcommerce(previous => ({ ...previous, slots: previous.slots.map(item => item.key === slot.key ? { ...item, enabled: !item.enabled } : item) }))}
                      >
                        {slot.label}
                        {slot.enabled ? (
                          <span
                            className={css.ecommerceSlotCount}
                            title={tt('ecommerce.countHint')}
                            onClick={event => {
                              event.stopPropagation()
                              setEcommerce(previous => ({ ...previous, slots: previous.slots.map(item => item.key === slot.key ? { ...item, count: item.count >= 4 ? 1 : item.count + 1 } : item) }))
                            }}
                          >
                            {slot.count}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {ecommerceSlots.length > 0 ? (
                    <>
                      <button type="button" className={css.ecommerceAdvancedToggle} aria-expanded={ecommerceRefOpen} aria-controls="dsh-ecommerce-reference-settings" onClick={() => { setEcommerceRefOpen(open => !open) }}>
                        <span>{tt('ecommerce.refSettings')}</span>
                        <span className={css.ecommerceAdvancedChevron} aria-hidden="true">{ecommerceRefOpen ? '⌃' : '⌄'}</span>
                      </button>
                      {ecommerceRefOpen ? (
                        <div id="dsh-ecommerce-reference-settings" className={css.ecommerceAdvancedBody}>
                          {ecommerceSlots.map(slot => (
                            <label key={slot.key} className={css.ecommerceRefRow}>
                              <span>{slot.label}</span>
                              <select value={slot.refRole ?? 'product'} data-ecommerce-ref-select="" aria-label={`${tt('ecommerce.refSelect')} · ${slot.label}`} onChange={event => setEcommerce(previous => ({ ...previous, slots: previous.slots.map(item => item.key === slot.key ? { ...item, refRole: event.target.value as EcommerceRefRole } : item) }))}>
                                <option value="none">{tt('ecommerce.refNone')}</option>
                                {ECOMMERCE_ASSET_ROLES.map(role => <option key={role} value={role}>{tt(`ecommerce.role.${role}` as never)}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className={css.ecommerceSection}>
                  <h3>{tt('ecommerce.generation')}</h3>
                  <select value={modeModels.includes(model) ? model : automaticModel} aria-label={tt('model.label')} onChange={event => setModel(event.target.value)}><option value="" disabled>{tt('model.label')}</option>{modeModels.map(option => <option key={option} value={option}>{option}</option>)}</select>
                  <div className={css.optionRow}>{QUALITIES.map(option => <Pill key={option} active={quality === option} onClick={() => { setQuality(option) }} className={css.optionPill}>{tt(`quality.${option}` as const)}</Pill>)}</div>
                </div>
                <input
                  ref={ecommerceFileInput}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className={css.hiddenFile}
                  onChange={(event) => {
                    acceptEcommerceFiles(event.target.files ?? undefined, ecommerceUploadRoleRef.current)
                    event.target.value = ''
                  }}
                />
              </section>
            ) : null}

            {isGeneration && tab === 'edit' ? (
              <section className={css.card}>
                {refImage === null
                  ? (
                    <button
                      type="button"
                      className={css.uploadBox}
                      onClick={() => { fileInput.current?.click() }}
                      onDragOver={(event) => { event.preventDefault() }}
                      onDrop={(event) => {
                        event.preventDefault()
                        acceptFiles(Array.from(event.dataTransfer.files ?? []))
                      }}
                    >
                      <span className={css.uploadIcon}>
                        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 10.5V3"/><path d="M5 5.5l3-3 3 3"/><path d="M2.5 9v3.5h11V9"/></svg>
                      </span>
                      <span>{tt('edit.upload')}</span>
                      <span className={css.uploadHint}>{tt('edit.uploadHint')}</span>
                    </button>
                  )
                  : (
                    <div className={css.reference}>
                      <div className={css.referenceGrid}>
                        {[refImage, ...additionalRefImages].map((image, index) => (
                          <figure key={`${image.name}-${index}`} className={css.referenceItem}>
                            <img className={css.referenceImage} src={image.dataUrl} alt={image.name} />
                            <figcaption>{index === 0 ? '主参考图' : `参考图 ${index + 1}`}</figcaption>
                          </figure>
                        ))}
                      </div>
                      <div className={css.referenceActions}>
                        <Button variant="outline" size="sm" onClick={() => { fileInput.current?.click() }}>
                          {tt('edit.change')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={clearReferenceImages}>
                          {tt('edit.remove')}
                        </Button>
                      </div>
                    </div>
                  )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className={css.hiddenFile}
                  onChange={(event) => {
                    acceptFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
              </section>
            ) : null}

                {/* prompt (normal workspace only — ecommerce has its own form) */}
                {isGeneration ? (<>
                <section className={css.card}>
              <textarea
                className={css.prompt}
                value={prompt}
                placeholder={tt('prompt.placeholder')}
                onChange={(event) => { setPrompt(event.target.value) }}
              />
              <div className={css.promptFooter}>
                <button
                  type="button"
                  className={css.templatesButton}
                  title={tt('templates.title')}
                  onClick={() => { setLibraryOpen(true) }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h7"/></svg>
                  {tt('templates.open')}
                </button>
                <button
                  type="button"
                  className={css.enhanceButton}
                  disabled={prompt.trim() === '' || enhancing}
                  title={tt('prompt.enhanceHint')}
                  onClick={() => { void enhanceCurrentPrompt() }}
                >
                  {enhancing ? tt('prompt.enhancing') : tt('prompt.enhance')}
                </button>
                <span
                  className={css.promptCount}
                  data-over={promptOverLimit ? '' : undefined}
                  title={promptOverLimit ? tt('prompt.overLimit', { limit: promptLimit ?? 0 }) : undefined}
                >
                  {promptLimit === null
                    ? tt('prompt.count', { count: prompt.length })
                    : tt('prompt.countLimit', { count: prompt.length, limit: promptLimit })}
                </span>
              </div>
            </section>

            {/* parameters */}
            <section className={css.card}>
              <div className={css.paramGroup}>
                <span className={css.paramLabel}>{tt('params.size')}</span>
                <div className={css.optionGrid}>
                  {SIZES.map(option => (
                    <Pill
                      key={option}
                      active={size === option}
                      onClick={() => { setSize(option) }}
                      className={css.optionPill}
                    >
                      {tt(SIZE_KEYS[option] ?? 'size.auto')}
                    </Pill>
                  ))}
                </div>
              </div>
              <div className={css.paramGroup}>
                <span className={css.paramLabel}>{tt('params.quality')}</span>
                <div className={css.optionRow}>
                  {QUALITIES.map(option => (
                    <Pill
                      key={option}
                      active={quality === option}
                      onClick={() => { setQuality(option) }}
                      className={css.optionPill}
                    >
                      {tt(`quality.${option}` as const)}
                    </Pill>
                  ))}
                </div>
              </div>
              <div className={css.paramGroup}>
                <span className={css.paramLabel}>{tt('params.count')}</span>
                <div className={css.optionRow}>
                  {[1, 2, 3, 4].map(option => (
                    <Pill
                      key={option}
                      active={count === option}
                      onClick={() => { setCount(option) }}
                      className={css.optionPill}
                    >
                      {tt(`count.${option === 1 ? 'one' : option === 2 ? 'two' : option === 3 ? 'three' : 'four'}` as const)}
                    </Pill>
                  ))}
                </div>
              </div>
              <div className={css.paramGroup}>
                <span className={css.paramLabel}>{tt('params.detail')}</span>
                <div className={css.optionRow}>
                  {DETAILS.map(option => (
                    <Pill
                      key={option === '' ? 'auto' : option}
                      active={detail === option}
                      onClick={() => { setDetail(option) }}
                      className={css.optionPill}
                    >
                      {tt(option === '' ? 'detail.auto' : option === 'standard' ? 'detail.standard' : 'detail.high')}
                    </Pill>
                  ))}
                </div>
                <span className={css.paramHint}>{tt('detail.hint')}</span>
              </div>
            </section>
            </>) : null}
          </div>

          {/* footer: model + generate — a fixed sibling of the scroll area, so
              it never overlaps the cards scrolling above it. */}
            <section className={css.footer}>
            {workspace === 'ecommerce' ? (
              <div className={css.ecommerceFooterBody}>
                {ecommercePreview ? (
                  <>
                    <div className={css.ecommercePlanMini}>
                      <strong>{tt('ecommerce.planTitle', { count: ecommerceTotal })}</strong>
                      <div className={css.ecommercePlanList}>
                        {ecommerceSlots.map(slot => <div key={slot.key}><span>{slot.label}</span><span>×{slot.count}</span></div>)}
                      </div>
                      <div className={css.ecommercePlanNote}>{tt('ecommerce.anchorNote')}</div>
                      {ecommerceAssets.length === 0 ? <div className={css.ecommercePlanWarn}>{tt('ecommerce.noAssetWarn')}</div> : null}
                    </div>
                    <Button variant="primary" size="md" className={css.ecommercePrimaryAction} disabled={ecommerceGenerateDisabled} onClick={() => { void handleEcommerceGenerate() }}>{ecommerceGenerating ? tt('generating') : tt('ecommerce.confirm')}</Button>
                    <button type="button" className={css.ecommercePlanBack} onClick={() => { setEcommercePreview(false) }}>{tt('gallery.tagsCancel')}</button>
                  </>
                ) : (
                  <>
                    <span className={css.ecommerceFooterHint}>{ecommerceTotal > 0 ? tt('ecommerce.footerReady', { count: ecommerceTotal }) : tt('ecommerce.footerEmpty')}</span>
                    <Button variant="primary" size="md" className={css.ecommercePrimaryAction} disabled={ecommerce.productName.trim() === '' || ecommerceTotal === 0} onClick={() => setEcommercePreview(true)}>{tt('ecommerce.preview')}</Button>
                  </>
                )}
              </div>
            ) : null}
            {isGeneration ? <label className={css.modelWrap}>
              <span className={css.modelLabel}>Provider</span>
              <select
                value={providerId}
                aria-label="Image Provider"
                disabled={submitting}
                onChange={event => {
                  setProviderId(event.target.value)
                  setModel('')
                  setCompareModels([])
                }}
              >
                <option value="cqai">CQAI（默认）</option>
                {customChannels.map(channel => (
                  <option key={channel.id} value={channel.id}>{channel.name || channel.id}</option>
                ))}
              </select>
              {providerId === 'cqai' && cqaiProvider.state !== 'signed-in'
                ? <small>{cqaiProvider.message ?? (cqaiProvider.state === 'reauth-required' ? '登录已失效，请重新登录 CQAI Club' : '请先登录 CQAI Club')}</small>
                : null}
              {providerId === 'cqai' && cqaiProvider.state === 'signed-in' && cqaiModels.length > 1 && cqaiProvider.defaultModel === undefined && model === ''
                ? <small>请选择本次使用的图像模型</small>
                : null}
            </label> : null}
            {isGeneration ? <label className={css.modelWrap}>
              <span className={css.modelLabel}>{tt('model.label')}</span>
              <span ref={modelMenuRef} className={css.modelMenu} data-open={modelOpen ? 'true' : 'false'}>
                <button
                  type="button"
                  className={css.modelSelect}
                  disabled={submitting}
                  aria-haspopup="listbox"
                  aria-expanded={modelOpen}
                  onClick={() => { setModelOpen(open => !open) }}
                >
                  <span>{activeModel || tt('model.noEditModels')}</span>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 10.5L4 6h8z"/></svg>
                </button>
                {modelOpen ? (
                  <div className={css.modelMenuList} role="listbox" aria-label={tt('model.label')}>
                    {modeModels.map(option => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={activeModel === option}
                        className={css.modelMenuItem}
                        data-selected={activeModel === option ? '' : undefined}
                        onClick={() => { setModel(option); setModelOpen(false) }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
              </span>
            </label> : null}
            {isGeneration ? <div className={css.compareControl}>
              <label className={css.compareToggle}>
                <input type="checkbox" checked={compareEnabled} onChange={event => { setCompareEnabled(event.target.checked) }} />
                <span>{tt('compare.enable')}</span>
              </label>
              {compareEnabled ? (
                <div className={css.compareModelChoices} role="group" aria-label={tt('compare.models')}>
                  {modeModels.map(option => (
                    <label key={option}>
                      <input type="checkbox" checked={compareModels.includes(option)} onChange={() => { setCompareModels(previous => previous.includes(option) ? previous.filter(value => value !== option) : [...previous, option]) }} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div> : null}
            {isGeneration ? <Button
              variant="primary"
              size="md"
              className={css.generateButton}
              disabled={generateDisabled}
              onClick={() => { void handleGenerate() }}
            >
              {generating ? (
                <span className={css.generateInner}>
                  <span className={css.spinner} />
                  {tt('generating')}
                </span>
              ) : tt('generate')}
              </Button> : null}
            </section>
          </aside>

          {workspace === 'canvas' ? (
            <CanvasWorkspace
              api={api}
              imageModels={imageModels}
              defaultChannelId={defaultChannelId}
              requireExplicitImageModel={providerId === 'cqai'
                && cqaiProvider.defaultModel === undefined
                && imageModels.length > 1}
              connected={connected}
              history={history}
              gallery={gallery}
              tasks={tasks}
              importRequest={canvasImportRequest}
              onImportRequestHandled={() => { setCanvasImportRequest(undefined) }}
              onOpenSettings={() => { openSettingsGuide('generation') }}
            />
          ) : null}

          {/* ------------------------------------------------------- canvas */}
          <section className={css.canvas} data-gallery={isGallery ? 'true' : undefined}>
          {isGeneration ? normalStreamPanel : null}
          {isGallery ? (
            <div className={css.galleryWorkspace}>
              <header className={css.galleryToolbar}>
                <div>
                  <h3 className={css.galleryHeading}>{tt('gallery.all')}</h3>
                  <span className={css.galleryCount}>{tt('gallery.count', { count: filteredGallery.length })}</span>
                </div>
                <div className={css.galleryToolbarActions}>
                  <input className={css.gallerySearch} value={galleryQuery} onChange={event => { setGalleryQuery(event.target.value) }} placeholder={tt('gallery.search')} aria-label={tt('gallery.search')} />
                  <button type="button" className={css.gallerySelectMode} disabled={galleryAdding} title={tt('gallery.uploadHint')} onClick={() => galleryUploadRef.current?.click()}>{galleryAdding ? '…' : tt('gallery.upload')}</button>
                  <input
                    ref={galleryUploadRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={event => {
                      const files = [...(event.target.files ?? [])]
                      event.target.value = ''
                      if (files.length > 0) void uploadGalleryFiles(files)
                    }}
                  />
                  <button type="button" className={css.gallerySelectMode} data-active={gallerySelecting ? '' : undefined} aria-pressed={gallerySelecting} onClick={() => { setGallerySelecting(previous => !previous) }}>
                    {gallerySelecting ? tt('gallery.selectionDone') : tt('gallery.select')}
                  </button>
                  <div className={css.galleryViewToggle} role="group" aria-label={tt('gallery.viewMode')}>
                    <button type="button" data-active={galleryView === 'masonry' ? '' : undefined} onClick={() => { setGalleryView('masonry') }} title={tt('gallery.masonry')}>
                      <span aria-hidden="true">▦</span> {tt('gallery.masonry')}
                    </button>
                    <button type="button" data-active={galleryView === 'grid' ? '' : undefined} onClick={() => { setGalleryView('grid') }} title={tt('gallery.grid')}>
                      <span aria-hidden="true">▤</span> {tt('gallery.grid')}
                    </button>
                  </div>
                  <select className={css.gallerySort} value={gallerySort} onChange={event => { setGallerySort(event.target.value as 'newest' | 'oldest') }} aria-label={tt('gallery.sort')}>
                    <option value="newest">{tt('gallery.newest')}</option>
                    <option value="oldest">{tt('gallery.oldest')}</option>
                  </select>
                  <button type="button" className={css.galleryClear} data-gallery-open-folder="" title={tt('gallery.openFolderHint')} onClick={() => { void api.openDataFolder() }}>{tt('gallery.openFolder')}</button>
                  {gallery.length > 0 ? <button type="button" className={css.galleryClear} data-gallery-clear="" onClick={() => { void clearGalleryAll() }}>{tt('gallery.clear')}</button> : null}
                </div>
              </header>
              {selectedGalleryIds.size > 0 ? (
                <section className={css.gallerySelectionBar} aria-label={tt('gallery.selected', { count: selectedGalleryIds.size })}>
                  <strong>{tt('gallery.selected', { count: selectedGalleryIds.size })}</strong>
                  <input className={css.galleryTagInput} value={galleryTagInput} onChange={event => { setGalleryTagInput(event.target.value) }} placeholder={tt('gallery.tagsPlaceholder')} aria-label={tt('gallery.tagsPlaceholder')} />
                  <button type="button" className={css.galleryBulkButton} disabled={galleryTagInput.trim() === ''} onClick={() => { void applyGalleryTags() }}>{tt('gallery.tagsApply')}</button>
                  <button type="button" className={css.galleryBulkButton} onClick={downloadGalleryImages}>{tt('gallery.downloadSelected')}</button>
                  <button type="button" className={css.galleryBulkButton} onClick={exportGalleryJson}>{tt('gallery.exportJson')}</button>
                  <button type="button" className={css.gallerySelectionClear} onClick={clearGallerySelection}>{tt('gallery.selectionClear')}</button>
                </section>
              ) : null}
              {filteredGallery.length === 0 ? (
                <div className={css.historyEmpty}>{tt('gallery.empty')}</div>
              ) : (
                <div className={css.galleryMasonry} data-view={galleryView}>
                  {filteredGallery.map(entry => {
                    const image = entry.images[0]
                    if (image === undefined) return null
                    return (
                      <article key={entry.id} className={css.galleryCard} data-selected={selectedGalleryIds.has(entry.id) ? '' : undefined}>
                        <label className={css.gallerySelect} title={tt('gallery.select')}>
                          <input type="checkbox" checked={selectedGalleryIds.has(entry.id)} onChange={() => { setGallerySelecting(true); toggleGallerySelection(entry.id) }} />
                        </label>
                        <button type="button" className={css.galleryImageButton} data-selecting={gallerySelecting ? '' : undefined} onClick={() => { if (gallerySelecting) toggleGallerySelection(entry.id); else void viewGalleryEntry(entry) }} title={gallerySelecting ? tt('gallery.select') : tt('preview.open')}>
                          <img className={css.galleryImage} src={image.url} alt={entry.prompt} />
                          <span className={css.galleryBadge}>{entry.mode === 'edit' ? tt('mode.edit') : tt('mode.text')}</span>
                        </button>
                        <div className={css.galleryCardActions}>
                          <button
                            type="button"
                            className={css.galleryCardAction}
                            data-gallery-add-conversation=""
                            disabled={conversationBusy}
                            title={tt('conversation.addHint')}
                            onClick={(event) => { event.stopPropagation(); void addGalleryEntryToConversation(entry) }}
                          >
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10v7H3z"/><path d="M5.5 2.5h5M8 6v4M6 8h4"/></svg>
                            {galleryConversationAddingId === entry.id || addingToConversation === `gallery:${entry.id}` ? tt('conversation.adding') : tt('conversation.add')}
                          </button>
                          <button
                            type="button"
                            className={css.galleryCardAction}
                            data-gallery-add-canvas=""
                            title={tt('canvas.addToCanvas')}
                            onClick={(event) => { event.stopPropagation(); addEntryToCanvas('gallery', entry.id, 0) }}
                          >
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M5 8h6M8 5v6" /></svg>
                            {tt('canvas.addToCanvas')}
                          </button>
                        </div>
                        <div className={css.galleryCardFooter}>
                          <span className={css.galleryAvatar}>{entry.model.toLowerCase().startsWith('nanobanana') ? 'N' : entry.model.toLowerCase().startsWith('seedream') ? 'S' : entry.model.startsWith('grok') ? 'G' : 'D'}</span>
                          <span className={css.galleryCardInfo}>
                            <strong>{entry.prompt || tt('gallery.untitled')}</strong>
                            <small>{entry.model} · {normalizeSize(entry.size)} · {formatTime(entry.createdAt)}</small>
                            <span className={css.galleryTags}>
                              {(entry.tags ?? []).map(tag => <button key={tag} type="button" onClick={() => { setGalleryTagFilter(tag) }}>{tag}</button>)}
                              <button type="button" className={css.galleryTagEdit} onClick={() => { startEditingGalleryTags(entry) }} title={tt('gallery.editTags')}>{tt('gallery.tagsEditShort')}</button>
                            </span>
                          </span>
                          <button type="button" className={css.galleryRemove} onClick={() => { void deleteGalleryEntry(entry.id) }} title={tt('gallery.delete')}>×</button>
                        </div>
                        {editingGalleryTagsId === entry.id ? (
                          <form className={css.galleryTagEditor} onSubmit={event => { event.preventDefault(); void saveGalleryTags(entry.id) }}>
                            <input value={galleryTagEditInput} onChange={event => { setGalleryTagEditInput(event.target.value) }} placeholder={tt('gallery.tagsPlaceholder')} aria-label={tt('gallery.tagsPlaceholder')} autoFocus />
                            <button type="submit">{tt('gallery.tagsSave')}</button>
                            <button type="button" onClick={() => { setEditingGalleryTagsId(null); setGalleryTagEditInput('') }}>{tt('gallery.tagsCancel')}</button>
                          </form>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}
          {workspace === 'ecommerce' && ecommercePreview ? (
            <div className={css.ecommercePromptPreview} data-ecommerce-preview="">
              <header className={css.ecommerceResultsHeader}>
                <div>
                  <h3>{tt('ecommerce.previewBoardTitle')}</h3>
                  <span>{tt('ecommerce.previewBoardHint')}</span>
                </div>
                <div className={css.ecommerceResultsActions}>
                  <button type="button" className={css.galleryBulkButton} onClick={() => { setEcommercePreview(false) }}>{tt('gallery.tagsCancel')}</button>
                </div>
              </header>
              <div className={css.ecommercePromptList}>
                {ecommerceSlots.filter(slot => slot.enabled).flatMap(slot => Array.from({ length: slot.count }, (_, index) => {
                  const key = `${slot.key}-${index + 1}`
                  const override = ecommerce.promptOverrides?.[key] ?? ''
                  const edited = override.trim() !== ''
                  return (
                    <div key={key} className={css.ecommercePromptCard}>
                      <header>
                        <span className={css.ecommercePromptBadge}>{slot.label}{slot.count > 1 ? ` · 第 ${index + 1} 张` : ''}</span>
                        {edited ? (
                          <button
                            type="button"
                            className={css.galleryBulkButton}
                            onClick={() => setEcommerce(previous => {
                              const overrides = { ...previous.promptOverrides }
                              delete overrides[key]
                              return { ...previous, promptOverrides: overrides }
                            })}
                          >
                            {tt('ecommerce.promptReset')}
                          </button>
                        ) : (
                          <span className={css.ecommercePromptAuto}>{tt('ecommerce.promptAutoHint')}</span>
                        )}
                      </header>
                      <textarea
                        value={edited ? override : ecommerceSlotPrompt(ecommerce, slot, index)}
                        onChange={event => setEcommerce(previous => ({ ...previous, promptOverrides: { ...previous.promptOverrides, [key]: event.target.value } }))}
                        rows={5}
                      />
                    </div>
                  )
                }))}
              </div>
            </div>
          ) : workspace === 'ecommerce' ? (
            <div className={css.ecommerceResults} data-ecommerce-results="">
              <header className={css.ecommerceResultsHeader}>
                <div>
                  <h3>{tt('ecommerce.results.title')}</h3>
                  {ecommerceRestored !== null && ecommerceRestored.projectId === ecommerceProjectId && ecommerceRestored.projectName !== '' ? (
                    <span>{ecommerceRestored.projectName}</span>
                  ) : null}
                  {ecommerceMergedItems.length > 0 ? (
                    <span>
                      {tt('ecommerce.results.progress', { done: ecommerceDoneCount, total: ecommerceMergedItems.length })}
                      {ecommerceFailedCount > 0 ? ` · ${tt('ecommerce.results.failed', { count: ecommerceFailedCount })}` : ''}
                    </span>
                  ) : null}
                  {ecommerceAnchor !== null ? <span data-ecommerce-anchor="">{tt('ecommerce.anchorPending')}</span> : null}
                </div>
                <div className={css.ecommerceResultsActions}>
                  {ecommerceMergedItems.length > 0 ? <button type="button" className={css.galleryBulkButton} data-ecommerce-export="" onClick={exportEcommerceManifest}>{tt('ecommerce.results.export')}</button> : null}
                  <button type="button" className={css.galleryBulkButton} data-ecommerce-new="" onClick={newEcommerceProduct}>{tt('ecommerce.results.newProduct')}</button>
                </div>
              </header>
              {ecommerceMergedItems.length === 0 ? (
                <div className={css.ecommerceResultsEmpty}>{tt('ecommerce.results.empty')}</div>
              ) : (
                <div className={css.ecommerceGroups} data-split={ecommerceMainGroup !== null ? 'true' : undefined}>
                  {ecommerceMainGroup !== null ? renderEcommerceGroup(ecommerceMainGroup, true) : null}
                  <div className={css.ecommerceGroupsSide}>
                    {ecommerceSideGroups.map(group => renderEcommerceGroup(group))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {!isGallery && !isGeneration && tasks.length > 0 ? (
            <section className={css.taskTray} data-open={taskTrayOpen ? 'true' : 'false'} aria-label={tt('tasks.title')}>
              <header className={css.taskTrayHeader}>
                <button type="button" className={css.taskTrayToggle} aria-expanded={taskTrayOpen} onClick={() => { setTaskTrayOpen(open => !open) }}>
                  <span>{tt('tasks.title')}</span>
                  <span className={css.taskTrayCount}>{activeTasks.length}</span>
                  <span className={css.taskTrayChevron} aria-hidden="true">{taskTrayOpen ? '⌃' : '⌄'}</span>
                </button>
                {taskTrayOpen ? <button type="button" className={css.taskTrayClose} aria-label={tt('preview.close')} onClick={() => { setTaskTrayOpen(false) }}>×</button> : null}
              </header>
              <div className={css.taskRows}>
                {tasks.slice(0, 5).map(task => (
                  <div key={task.id} className={css.taskRow} data-status={task.status}>
                    <span className={css.taskStatus}>{tt(`tasks.${task.status}` as never)}</span>
                    <span className={css.taskPrompt}>{task.request.prompt}</span>
                    {(task.status === 'queued' || task.status === 'running') ? <button type="button" onClick={() => { void api.taskCancel(task.id) }}>{tt('tasks.cancel')}</button> : null}
                    {task.status === 'failed' || task.status === 'cancelled' ? <button type="button" onClick={() => { void api.taskRetry(task.id) }}>{tt('tasks.retry')}</button> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {!isGeneration && error !== null ? (
            <div className={css.canvasError} role="alert">{tt('canvas.error', { error })}</div>
          ) : null}
          </section>
        </div>

      </div>

      {/* ------------------------------------------------ template library */}
      {libraryOpen ? (
        <TemplateLibrary
          api={api}
          onClose={() => { setLibraryOpen(false) }}
          onUse={(text) => {
            openTab('text')
            setPrompt(text)
            setError(null)
            setLibraryOpen(false)
          }}
        />
      ) : null}

      {configGuide !== null ? (
        <div className={css.configGuide} role="dialog" aria-modal="true" aria-label={tt(`config.${configGuide}Title` as never)}>
          <div className={css.configGuideBody}>
            <strong>{tt(`config.${configGuide}Title` as never)}</strong>
            <span>{tt(`config.${configGuide}Hint` as never)}</span>
            <button type="button" onClick={() => { setConfigGuide(null) }}>{tt('preview.close')}</button>
          </div>
        </div>
      ) : null}

      {comparisonFullscreen && comparison !== null ? createPortal(
        <div className={css.comparisonFullscreen} role="dialog" aria-modal="true" aria-label={tt('compare.title')} onClick={() => { setComparisonFullscreen(false) }}>
          <button type="button" className={css.lightboxClose} aria-label={tt('preview.close')} onClick={() => { setComparisonFullscreen(false) }}>×</button>
          <div className={css.comparisonFullscreenGrid} onClick={event => { event.stopPropagation() }}>
            {comparisonResults.map(task => (
              <figure key={task.id}><figcaption>{task.request.model}</figcaption>{task.result!.images.map((image, index) => <img key={index} src={srcOf(image)} alt={task.request.model} />)}</figure>
            ))}
          </div>
        </div>, document.body) : null}

      {/* -------------------------------------------------- preview overlay */}
      {preview !== null && previewImage !== null
        ? createPortal(
          <div
            className={css.lightbox}
            role="dialog"
            aria-modal="true"
            aria-label={tt('preview.title')}
            onClick={closePreview}
          >
            <button type="button" className={css.lightboxClose} aria-label={tt('preview.close')} title={tt('preview.close')} onClick={closePreview}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
            {preview.images.length > 1 ? (
              <>
                <button type="button" className={css.lightboxNav} data-dir="prev" aria-label={tt('preview.prev')} onClick={(event) => { event.stopPropagation(); stepPreview(-1) }}>
                  <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3l-5 5 5 5"/></svg>
                </button>
                <button type="button" className={css.lightboxNav} data-dir="next" aria-label={tt('preview.next')} onClick={(event) => { event.stopPropagation(); stepPreview(1) }}>
                  <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>
                </button>
              </>
            ) : null}
            <figure className={css.lightboxFigure} onClick={(event) => { event.stopPropagation() }}>
              <div
                ref={previewStage}
                className={css.lightboxStage}
                onWheel={(event) => {
                  event.preventDefault()
                  setPreviewScale(current => clampPreviewScale(current + (event.deltaY < 0 ? PREVIEW_SCALE_STEP : -PREVIEW_SCALE_STEP)))
                }}
              >
                <div
                  className={css.lightboxScaleFrame}
                  style={{ width: `${previewFrameScale * 100}%`, height: `${previewFrameScale * 100}%` }}
                >
                  <img
                    className={css.lightboxImage}
                    style={{ width: `${previewImageScale * 100}%`, height: `${previewImageScale * 100}%` }}
                    src={srcOf(previewImage)}
                    alt={previewImage.revisedPrompt ?? tt('preview.title')}
                  />
                </div>
              </div>
              <div className={css.lightboxTools} role="group" aria-label={tt('preview.zoomControls')}>
                <button type="button" className={css.lightboxTool} aria-label={tt('preview.zoomOut')} title={tt('preview.zoomOut')} onClick={() => { setPreviewScale(current => clampPreviewScale(current - PREVIEW_SCALE_STEP)) }}>
                  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M4.8 7h4.4M13 13l-2.8-2.8"/></svg>
                </button>
                <button type="button" className={css.lightboxZoomLevel} aria-label={tt('preview.zoomReset')} title={tt('preview.zoomReset')} onClick={() => { setPreviewScale(1) }}>
                  {tt('preview.zoomLevel', { percent: Math.round(previewScale * 100) })}
                </button>
                <button type="button" className={css.lightboxTool} aria-label={tt('preview.zoomIn')} title={tt('preview.zoomIn')} onClick={() => { setPreviewScale(current => clampPreviewScale(current + PREVIEW_SCALE_STEP)) }}>
                  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M7 4.8v4.4M4.8 7h4.4M13 13l-2.8-2.8"/></svg>
                </button>
              </div>
              {previewImage.revisedPrompt !== undefined ? (
                <div className={css.lightboxCaptionRow}>
                  <figcaption className={css.lightboxCaption} title={previewImage.revisedPrompt}>
                    {tt('revisedPrompt', { prompt: previewImage.revisedPrompt })}
                  </figcaption>
                  <button type="button" className={css.lightboxCopy} aria-label={tt(promptCopied ? 'preview.copied' : 'preview.copyPrompt')} title={tt(promptCopied ? 'preview.copied' : 'preview.copyPrompt')} onClick={() => { void copyPreviewPrompt(previewImage.revisedPrompt!) }}>
                    {promptCopied ? (
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l3 3 7-7"/></svg>
                    ) : (
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="5" width="7" height="8" rx="1"/><path d="M3 10V3.8c0-.44.36-.8.8-.8H9"/></svg>
                    )}
                    <span>{tt(promptCopied ? 'preview.copied' : 'preview.copyPrompt')}</span>
                  </button>
                </div>
              ) : null}
              <div className={css.lightboxMeta}>
                <span className={css.lightboxIndex}>{tt('preview.index', { index: preview.index + 1, total: preview.images.length })}</span>
                <span className={css.lightboxActions}>
                  <button type="button" className={css.lightboxEdit} disabled={conversationBusy} title={tt('conversation.addHint')} onClick={() => { void addImageToConversation(previewImage, preview.index) }}>
                    {addingToConversation === preview.index ? tt('conversation.adding') : tt('conversation.add')}
                  </button>
                  <button type="button" className={css.lightboxEdit} disabled={galleryAdding} onClick={() => { void addToGallery(previewImage) }}>
                    {tt('gallery.add')}
                  </button>
                  <button type="button" className={css.lightboxEdit} onClick={addPreviewToEdit}>
                    {tt('preview.addToEdit')}
                  </button>
                  <a
                    className={css.lightboxDownload}
                    href={srcOf(previewImage)}
                    download={`dsh-image-${preview.index + 1}.${extensionOf(previewImage.mime)}`}
                  >
                    {tt('download')}
                  </a>
                </span>
              </div>
            </figure>
          </div>,
          document.body,
        )
        : null}

      {/* ------------------------------------------------- gallery toast */}
      {galleryMessage !== null ? (
        <div className={css.galleryToast} role="status">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 5.8v4.4M5.8 8h4.4"/></svg>
          {galleryMessage}
        </div>
      ) : null}
      {conversationMessage !== null ? (
        <div className={css.conversationToast} role="status">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10v7H3z"/><path d="M5.5 2.5h5M8 6v4M6 8h4"/></svg>
          {conversationMessage}
        </div>
      ) : null}
    </div>
  )
}

/** File extension for a MIME type (download filenames). */
function extensionOf(mime: string): string {
  switch (mime.split(';')[0]!.trim()) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}
