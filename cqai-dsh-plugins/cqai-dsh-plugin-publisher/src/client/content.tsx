import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ARTICLE_THEMES, ARTICLE_THEME_LABELS, CREATIVE_STATEMENTS, MAX_TAGS, PLATFORM_LABELS, TITLE_MAX,
  type CreateSubmissionResult, type Platform, type PublisherAccount,
  type PublisherCapability, type PublisherContent, type PublisherPlatformCapability,
  type PublisherPlatformVariant, projectContentForPlatform, resolveArticleTheme,
} from '../protocol.ts'
import { contentModeAvailable, selectedContentAccounts } from '../content-targets.ts'
import {
  api, capabilityMessage, ConfirmDialog, errorMessage, PlatformAccountSelect, PublisherModal, STATEMENT_LABELS, uploadAsset,
  type PublisherConfirmation,
} from './shared.tsx'
import { articleSubmissionWarnings, contentSubmissionError } from '../submission-validation.ts'
import { accountPlatformOrder } from './account-platform-order.ts'
import { usePublisherTips } from './tips.tsx'
import { articleUploadFile } from './article-image.ts'
import { AssetPreviewImage, PublisherContentPreview, contentAssetUrl } from './content-preview.tsx'
import { ProjectDirectoryInfo } from './project-directory-info.tsx'

type EditorType = 'article' | 'image-note'
type Mode = 'publish' | 'draft'
type ContentView = 'master' | Platform
type VariantField = keyof PublisherPlatformVariant
const FIELD_LABELS: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }

export function ContentEditor({ contentType, active, selectedContentId, intendedPlatforms, handoffGeneration, agentOpen, onToggleAgent, onSelectedContentChange, onBack }: {
  contentType: EditorType
  active: boolean
  selectedContentId?: string
  intendedPlatforms?: readonly Platform[]
  handoffGeneration?: number
  agentOpen?: boolean
  onToggleAgent?: (content: PublisherContent) => Promise<void>
  onSelectedContentChange?: (id?: string) => void
  onBack(): void
}) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [draft, setDraft] = useState<PublisherContent>()
  const draftRef = useRef<PublisherContent>()
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dirtyRef = useRef(false)
  const saveTask = useRef<Promise<void>>()
  const [editVersion, setEditVersion] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [capabilities, setCapabilities] = useState<PublisherPlatformCapability[]>([])
  const [accountsPending, setAccountsPending] = useState(true)
  const [capabilitiesPending, setCapabilitiesPending] = useState(true)
  const [accountsError, setAccountsError] = useState('')
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [mode, setMode] = useState<Mode>('draft')
  const [preview, setPreview] = useState(false)
  const [contentView, setContentView] = useState<ContentView>('master')
  const contentViewRef = useRef<ContentView>('master')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [confirm, setConfirm] = useState<PublisherConfirmation & { revision: number }>()
  const [deleteDraftId, setDeleteDraftId] = useState<string>()
  const [saveError, setSaveError] = useState('')
  const [handoffError, setHandoffError] = useState('')
  const [handoffRetry, setHandoffRetry] = useState(0)
  const [draggedAssetId, setDraggedAssetId] = useState<string>()
  const [runtimeCapability, setRuntimeCapability] = useState<PublisherCapability>()

  useEffect(() => { setConfirm(undefined); setPublishOpen(false) }, [selectedContentId, active])
  const intendedPlatformsKey = intendedPlatforms?.join(',')
  useEffect(() => { setSelection({}) }, [selectedContentId, intendedPlatformsKey])
  useEffect(() => {
    setHandoffError('')
    if (selectedContentId) {
      setPreview(false)
      contentViewRef.current = 'master'
      setContentView('master')
      setTagsInput(draftRef.current?.tags.join(' ') ?? '')
    }
  }, [selectedContentId])

  const setServerDraft = (value: PublisherContent | undefined) => {
    draftRef.current = value
    dirtyRef.current = false
    setSaveError('')
    setHandoffError('')
    setDraft(value)
    const view = contentViewRef.current
    setTagsInput(value ? (view === 'master' ? value : projectContentForPlatform(value, view)).tags.join(' ') : '')
  }
  useEffect(() => {
    // Finish a local image/draft operation before replacing its result with a handoff.
    if (!active || busy || !selectedContentId) return
    let live = true
    const selectedAtStart = draftRef.current?.id
    void (async () => {
      if (selectedContentId !== selectedAtStart && (dirtyRef.current || saveTask.current)) await flush()
      else if (saveTask.current) {
        try { await flush() }
        catch {
          // A same-draft refresh must not discard local edits after a failed save.
          return
        }
      }
      if (!live) return
      const requested = await api<PublisherContent>(`content/${selectedContentId}`)
      if (!live || busyRef.current || (draftRef.current?.id !== selectedAtStart && draftRef.current?.id !== requested.id)) return
      if (requested.contentType !== contentType) throw new Error('指定草稿内容类型不匹配')
      const current = draftRef.current
      if (current?.id !== requested.id || (!dirtyRef.current && !saveTask.current && requested.revision > current.revision)) setServerDraft(requested)
      else setHandoffError('')
    })().catch(cause => {
      if (!live) return
      const message = errorMessage(cause)
      setHandoffError(`无法打开指定草稿：${message}`)
      showError(message)
    })
    return () => { live = false }
  }, [contentType, active, selectedContentId, busy, handoffRetry, handoffGeneration])
  useEffect(() => {
    if (!active || !agentOpen || !selectedContentId || contentType !== 'article') return
    let live = true
    let reading = false
    const refresh = async () => {
      if (reading || busyRef.current) return
      reading = true
      try {
        // Agent tools save on the Host. Refresh the visible editor after they
        // finish, without allowing an older local autosave to replace it.
        if (saveTask.current) {
          try { await saveTask.current } catch { /* A newer Agent revision may replace local edits. */ }
        }
        const latest = await api<PublisherContent>(`content/${selectedContentId}`)
        if (!live || busyRef.current || latest.contentType !== 'article') return
        const current = draftRef.current
        if (current?.id === latest.id && latest.revision > current.revision) {
          if (dirtyRef.current || saveTask.current) {
            // Keep local edits visible until the user explicitly reloads them.
            setSaveError('草稿已在其他页面更新，请重新加载后再保存')
          } else setServerDraft(latest)
        }
      } catch { /* Ordinary editor requests still surface read failures. */ }
      finally { reading = false }
    }
    const timer = setInterval(() => { void refresh() }, 1200)
    return () => { live = false; clearInterval(timer) }
  }, [active, agentOpen, selectedContentId, contentType])
  useEffect(() => {
    if (!active) return
    let live = true
    setAccountsPending(true)
    setCapabilitiesPending(true)
    void api<PublisherCapability>('capability').then(value => {
      if (live) setRuntimeCapability(value)
    }).catch(cause => { if (live) showError(errorMessage(cause)) })
    void api<PublisherAccount[]>('accounts').then(rows => {
      if (live) { setAccounts(rows); setAccountsError(''); setAccountsPending(false) }
    }).catch(cause => {
      if (live) { setAccounts([]); setAccountsError(errorMessage(cause)); setAccountsPending(false) }
    })
    void api<PublisherPlatformCapability[]>('platform-capabilities').then(rows => {
      if (live) { setCapabilities(rows); setCapabilitiesError(''); setCapabilitiesPending(false) }
    }).catch(cause => {
      if (live) { setCapabilities([]); setCapabilitiesError(errorMessage(cause)); setCapabilitiesPending(false) }
    })
    return () => { live = false }
  }, [active])

  const update = (patch: Partial<PublisherContent>) => {
    if (!draftRef.current) return
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
    setEditVersion(version => version + 1)
  }

  const effectiveContent = (content: PublisherContent): PublisherContent =>
    contentView === 'master' ? content : projectContentForPlatform(content, contentView)

  const updateVariant = (patch: PublisherPlatformVariant) => {
    const current = draftRef.current
    if (!current || contentView === 'master') return
    update({ platformVariants: {
      ...current.platformVariants,
      [contentView]: { ...current.platformVariants?.[contentView], ...patch },
    } })
  }

  const updateTextField = (field: 'title' | 'body' | 'summary', value: string) => {
    if (contentView === 'master') update({ [field]: value })
    else updateVariant({ [field]: value })
  }

  const resetVariantField = (field: VariantField) => {
    const current = draftRef.current
    if (!current || contentView === 'master') return
    const next = { ...current.platformVariants?.[contentView] }
    delete next[field]
    const variants = { ...current.platformVariants }
    if (Object.keys(next).length) variants[contentView] = next
    else delete variants[contentView]
    update({ platformVariants: variants })
    if (field === 'tags') setTagsInput(current.tags.join(' '))
  }

  const resetPlatformVariant = () => {
    const current = draftRef.current
    if (!current || contentView === 'master') return
    const variants = { ...current.platformVariants }
    delete variants[contentView]
    update({ platformVariants: variants })
    setTagsInput(current.tags.join(' '))
  }

  const selectContentView = (view: ContentView) => {
    const current = draftRef.current
    contentViewRef.current = view
    setContentView(view)
    setTagsInput(current ? (view === 'master' ? current : projectContentForPlatform(current, view)).tags.join(' ') : '')
  }

  const togglePlatformAsset = (assetId: string, included: boolean) => {
    const current = draftRef.current
    if (!current || contentView === 'master') return
    const selected = effectiveContent(current)
    const order = selected.assets.map(asset => asset.id)
    const nextOrder = included ? [...order, assetId] : order.filter(id => id !== assetId)
    const patch: PublisherPlatformVariant = { assetOrder: nextOrder }
    if (!included && selected.coverAssetId === assetId) patch.coverAssetId = nextOrder[0] ?? null
    if (included && current.contentType === 'article'
      && (!selected.coverAssetId || !selected.assets.some(asset => asset.id === selected.coverAssetId))) patch.coverAssetId = assetId
    updateVariant(patch)
  }

  const flush = async (): Promise<PublisherContent | undefined> => {
    if (saveTask.current) await saveTask.current
    const current = draftRef.current
    if (!current || !dirtyRef.current) return current
    dirtyRef.current = false
    const task = (async () => {
      try {
        const saved = await api<PublisherContent>('content-save', {
          id: current.id, revision: current.revision, title: current.title, body: current.body,
          summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
          articleTheme: current.articleTheme,
          coverAssetId: current.coverAssetId, assetOrder: current.assets.map(asset => asset.id),
          platformFields: current.platformFields, platformVariants: current.platformVariants,
        })
        if (draftRef.current?.id === current.id) {
          const latest = draftRef.current
          const merged = { ...latest, revision: saved.revision, updatedAt: saved.updatedAt }
          draftRef.current = merged
          setDraft(merged)
        }
        setSaveError('')
      } catch (cause) {
        dirtyRef.current = true
        setSaveError(errorMessage(cause))
        throw cause
      }
    })()
    saveTask.current = task
    try { await task } finally { if (saveTask.current === task) saveTask.current = undefined }
    if (dirtyRef.current) return flush()
    return draftRef.current
  }

  useEffect(() => {
    if (editVersion === 0) return
    const timer = setTimeout(() => { void flush().catch(cause => showError(errorMessage(cause))) }, 800)
    return () => clearTimeout(timer)
  }, [editVersion])
  useEffect(() => () => {
    // A main-panel switch unmounts the editor; do not abandon the debounce window.
    if (dirtyRef.current) void flush().catch(() => { /* The server keeps its previous revision on failure. */ })
  }, [])

  const act = async (task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); clearTip()
    try { await task() } catch (cause) { showError(errorMessage(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const back = () => void act(async () => {
    await flush()
    onBack()
  })
  const duplicate = () => void act(async () => {
    const current = await flush()
    if (!current) return
    const copy = await api<PublisherContent>('content-copy', { id: current.id })
    setServerDraft(copy)
    onSelectedContentChange?.(copy.id)
  })
  const remove = () => {
    const id = draftRef.current?.id
    if (id) setDeleteDraftId(id)
  }
  const confirmRemove = () => {
    const id = deleteDraftId
    if (!id) return
    void act(async () => {
      // Explicit deletion discards unsaved edits, even when a previous autosave failed.
      try { if (saveTask.current) await saveTask.current } catch { /* discard failed save */ }
      const wasDirty = dirtyRef.current
      dirtyRef.current = false
      try { await api('content-delete', { id }) }
      catch (cause) { dirtyRef.current = wasDirty; throw cause }
      setDeleteDraftId(undefined)
      setServerDraft(undefined)
      onBack()
    })
  }
  const importText = (file: File | undefined) => void act(async () => {
    if (!file) return
    if (!/\.(md|txt)$/iu.test(file.name) || file.size > 2 * 1024 * 1024) throw new Error('只支持 2MB 以内的 .md/.txt 文件')
    const text = await file.text()
    const current = draftRef.current
    if (!current) throw new Error('请先打开草稿')
    update({ body: text, title: current.title || file.name.replace(/\.(md|txt)$/iu, '').slice(0, TITLE_MAX) })
    showSuccess('已导入编辑器，草稿会自动保存。')
  })
  const addImages = (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    if (!selected.length) return
    void act(async () => {
      for (const file of selected) {
        if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('单张图片必须大于 0 且不超过 20MB')
        if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPEG、PNG、WebP 图片')
      }
      let current = await flush()
      const limit = 20
      if (!current) throw new Error('请先打开草稿')
      if (current.assets.length + selected.length > limit) throw new Error(`当前最多支持 ${limit} 张图片`)
      let uploaded = 0
      try {
        for (const file of selected) {
          current = await uploadAsset(current.id, contentType === 'article' ? await articleUploadFile(file) : file)
          setServerDraft(current)
          uploaded += 1
        }
      } catch (cause) {
        if (uploaded > 0) throw new Error(`已保存前 ${uploaded} 张图片，其余上传失败：${errorMessage(cause)}`)
        throw cause
      }
    })
  }
  const removeImage = (assetId: string) => void act(async () => {
    const current = await flush()
    if (!current) return
    setServerDraft(await api<PublisherContent>('content-asset-delete', { id: current.id, assetId }))
  })
  const insertImage = (assetId: string, name: string) => {
    const current = draftRef.current
    if (!current || contentType !== 'article') return
    const visible = effectiveContent(current)
    const textarea = bodyInputRef.current
    const start = textarea?.selectionStart ?? visible.body.length
    const end = textarea?.selectionEnd ?? start
    const label = name.replace(/[\[\]\\\r\n]/gu, ' ').trim().slice(0, 80) || '图片'
    const marker = `![${label}](ebao-asset://${assetId})`
    const before = visible.body.slice(0, start)
    const after = visible.body.slice(end)
    const insertion = `${before && !before.endsWith('\n') ? '\n' : ''}${marker}${after && !after.startsWith('\n') ? '\n' : ''}`
    const cursor = before.length + insertion.length
    setPreview(false)
    updateTextField('body', before + insertion + after)
    requestAnimationFrame(() => {
      bodyInputRef.current?.focus()
      bodyInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  const moveAsset = (assetId: string, target: number) => void act(async () => {
    const current = await flush()
    if (!current) return
    const order = effectiveContent(current).assets.map(asset => asset.id)
    const index = order.indexOf(assetId)
    if (index < 0 || target < 0 || target >= order.length || index === target) return
    order.splice(index, 1)
    order.splice(target, 0, assetId)
    if (contentView !== 'master') {
      updateVariant({ assetOrder: order })
      return
    }
    setServerDraft(await api<PublisherContent>('content-save', {
      id: current.id, revision: current.revision, title: current.title, body: current.body,
      summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
      articleTheme: current.articleTheme,
      coverAssetId: current.coverAssetId, assetOrder: order, platformFields: current.platformFields,
      platformVariants: current.platformVariants,
    }))
  })
  const reorder = (assetId: string, delta: number) => {
    const index = draftRef.current ? effectiveContent(draftRef.current).assets.findIndex(asset => asset.id === assetId) : -1
    if (index >= 0) moveAsset(assetId, index + delta)
  }

  const reloadAfterConflict = () => void act(async () => {
    const id = draftRef.current?.id
    if (!id) return
    try { if (saveTask.current) await saveTask.current } catch { /* User chose to discard the failed local version. */ }
    const latest = await api<PublisherContent>(`content/${id}`)
    if (latest.contentType !== contentType) throw new Error('草稿内容类型不匹配')
    setServerDraft(latest)
    if (selectedContentId && latest.id !== selectedContentId) setHandoffRetry(value => value + 1)
    showSuccess('已加载最新草稿。')
  })

  const accountPlatforms = accountPlatformOrder(contentType, intendedPlatforms)
  const requestedPlatforms = intendedPlatforms?.filter(platform => accountPlatforms.includes(platform)) ?? []
  const selectedAccounts = selectedContentAccounts(contentType, accounts, selection)
  const missingRequestedPlatforms = requestedPlatforms.filter(platform =>
    !selectedAccounts.some(account => account.platform === platform))
  const visibleDraft = draft && effectiveContent(draft)
  const selectedVariant = contentView === 'master' ? undefined : draft?.platformVariants?.[contentView]
  const selectedAssetIds = new Set(visibleDraft?.assets.map(asset => asset.id) ?? [])
  const assetsForEditor = contentView === 'master' ? draft?.assets ?? []
    : [...(visibleDraft?.assets ?? []), ...(draft?.assets ?? []).filter(asset => !selectedAssetIds.has(asset.id))]
  const hasOverride = (field: VariantField) => selectedVariant !== undefined && Object.prototype.hasOwnProperty.call(selectedVariant, field)
  const articleWarnings = draft && !capabilitiesPending && !capabilitiesError
    ? articleSubmissionWarnings(draft, selectedAccounts, capabilities) : []
  const submissionMode = contentType === 'article' && articleWarnings.length > 0 ? 'draft' : mode
  const unavailableTargets = selectedAccounts.filter(account =>
    !contentModeAvailable(account.platform, contentType, submissionMode, capabilities))
  const exactMismatch = Boolean(selectedContentId && draft?.id !== selectedContentId)
  const editorLocked = busy || exactMismatch || Boolean(handoffError)
  const submitReady = runtimeCapability?.supported === true && !accountsPending && !capabilitiesPending
    && selectedAccounts.length > 0 && missingRequestedPlatforms.length === 0
    && unavailableTargets.length === 0 && !exactMismatch && !handoffError
  const titleLimit = contentView === 'master' ? TITLE_MAX
    : capabilities.find(item => item.platform === contentView)?.maxTitleLength?.[contentType] ?? TITLE_MAX
  const assetLimit = contentView === 'master' ? 20
    : capabilities.find(item => item.platform === contentView)?.maxAssets?.[contentType] ?? 20
  const enteredTags = [...new Set(tagsInput.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))]
  const skippedArticleTagTargets = contentType === 'article' && visibleDraft?.tags.length
    ? selectedAccounts.filter(account => account.platform === 'wxmp' || account.platform === 'tt' || account.platform === 'bjh') : []
  const validationError = draft && selectedAccounts.length > 0 && !capabilitiesPending && !capabilitiesError
    ? contentSubmissionError(draft, selectedAccounts, capabilities, submissionMode) : undefined
  const requestConfirm = () => void act(async () => {
    const current = await flush()
    if (!current) throw new Error('请先创建草稿')
    if ((selectedContentId && current.id !== selectedContentId) || handoffError) throw new Error('指定草稿尚未打开，请先确认当前草稿')
    if (missingRequestedPlatforms.length > 0) {
      throw new Error(`请先为本次目标平台选择账号：${missingRequestedPlatforms.map(platform => PLATFORM_LABELS[platform]).join('、')}`)
    }
    const warnings = articleSubmissionWarnings(current, selectedAccounts, capabilities)
    const confirmedMode = contentType === 'article' && warnings.length > 0 ? 'draft' : mode
    const error = contentSubmissionError(current, selectedAccounts, capabilities, confirmedMode)
    if (error) throw new Error(error)
    if (confirmedMode !== mode) setMode(confirmedMode)
    const displayTitle = current.title.trim() || projectContentForPlatform(current, selectedAccounts[0]!.platform).title
    setPublishOpen(false)
    setConfirm({ contentId: current.id, revision: current.revision, title: displayTitle, mode: confirmedMode, accounts: selectedAccounts, warnings,
      targetTitles: Object.fromEntries(selectedAccounts.map(account => [account.id, projectContentForPlatform(current, account.platform).title])),
    })
  })
  const submit = () => void act(async () => {
    if (!confirm) return
    const current = await flush()
    if (!current || current.id !== confirm.contentId || (selectedContentId && current.id !== selectedContentId)) {
      setConfirm(undefined)
      throw new Error('草稿已切换，请重新检查后提交')
    }
    if (handoffError) {
      setConfirm(undefined)
      throw new Error('无法确认最新草稿，请重新加载后提交')
    }
    if (current.revision !== confirm.revision) {
      setConfirm(undefined)
      throw new Error('草稿已更新，请重新检查后提交')
    }
    const accepted = await api<CreateSubmissionResult>('submissions', {
      contentType, contentId: current.id, revision: current.revision,
      mode: confirm.mode, accountIds: confirm.accounts.map(account => account.id),
    })
    setConfirm(undefined)
    showSuccess(accepted.submission.mode === 'draft' && ((confirm.warnings?.length ?? 0) > 0 || accepted.submission.requestedMode === 'publish')
      ? '内容已按平台要求调整并转存草稿，请到平台后台核对。'
      : '已提交，请稍后到平台后台确认。')
  })

  const mediaCard = draft && visibleDraft ? (
    <div className="pub-card"><h2>{contentView === 'master' ? contentType === 'article' ? '封面图片' : '图片素材与排序' : `${PLATFORM_LABELS[contentView]} · 封面和图片顺序`}</h2>
      <Button size="sm" variant={contentType === 'image-note' && draft.assets.length === 0 ? 'primary' : 'outline'} disabled={busy} onClick={() => imageInputRef.current?.click()}>添加图片</Button>
      <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={event => { addImages(event.target.files); event.target.value = '' }}/>
      <p className={visibleDraft!.assets.length > assetLimit ? 'pub-warn' : 'pub-muted'}>{visibleDraft!.assets.length}/{assetLimit} 张 · 仅支持 JPEG / PNG / WebP，每张不超过 20MB。{contentType === 'image-note' ? '可拖动排序，也可使用 ↑ ↓ 按钮。' : ''}</p>
      {contentView !== 'master' && <p className="pub-muted">图片素材由主稿统一管理。勾选此平台要使用的图片，再调整顺序和封面；新上传的素材不会自动加入已单独选图的平台版本。</p>}
      {contentType === 'article' && <p className="pub-muted">WebP 文章图片上传时自动转为 JPEG，可作为微信公众号封面；透明区域会变成白色。头条、百家号素材可插入正文，也可单独设为封面；掘金、B站专栏暂只支持单张封面。导入 Markdown 时不会读取相对路径图片，请先上传素材再插入。</p>}
      {contentType === 'article' && contentView !== 'master' && <label className="pub-no-cover"><input type="radio" name={`cover-${draft.id}-${contentView}`} checked={!visibleDraft!.coverAssetId} onChange={() => updateVariant({ coverAssetId: null })}/>此平台不使用封面</label>}
      <div className="pub-assets">{assetsForEditor.map((asset, index) => <div className={`pub-asset${draggedAssetId === asset.id ? ' pub-asset-dragging' : ''}`} key={asset.id}
        draggable={contentType === 'image-note' && selectedAssetIds.has(asset.id) && !editorLocked}
        onDragStart={event => { if (contentType === 'image-note' && selectedAssetIds.has(asset.id) && !editorLocked) { event.dataTransfer.effectAllowed = 'move'; setDraggedAssetId(asset.id) } }}
        onDragOver={event => { if (contentType === 'image-note' && selectedAssetIds.has(asset.id) && !editorLocked && draggedAssetId) event.preventDefault() }}
        onDrop={event => { event.preventDefault(); if (!editorLocked && selectedAssetIds.has(asset.id) && draggedAssetId && draggedAssetId !== asset.id) moveAsset(draggedAssetId, index); setDraggedAssetId(undefined) }}
        onDragEnd={() => setDraggedAssetId(undefined)}>
        <AssetPreviewImage src={contentAssetUrl(draft.id, asset.id)} alt={asset.name} thumbnail/><small>{selectedAssetIds.has(asset.id) ? String(index + 1).padStart(2, '0') : '—'} · {asset.name}</small>
        {contentView !== 'master' && <label><input type="checkbox" aria-label={`${asset.name}用于${PLATFORM_LABELS[contentView]}`} checked={selectedAssetIds.has(asset.id)} onChange={event => togglePlatformAsset(asset.id, event.target.checked)}/>用于此平台</label>}
        {contentType === 'article' && <label><input type="radio" name={`cover-${draft.id}-${contentView}`} aria-label={`${asset.name}设为封面`} disabled={!selectedAssetIds.has(asset.id)} checked={visibleDraft!.coverAssetId === asset.id} onChange={() => contentView === 'master' ? update({ coverAssetId: asset.id }) : updateVariant({ coverAssetId: asset.id })}/>封面</label>}
        <div className="pub-actions">{contentType === 'article' && <Button variant="outline" size="sm" disabled={busy || !selectedAssetIds.has(asset.id)} onClick={() => insertImage(asset.id, asset.name)}>插入正文</Button>}<Button variant="outline" size="sm" aria-label="上移图片" disabled={!selectedAssetIds.has(asset.id) || index === 0 || busy} onClick={() => reorder(asset.id, -1)}>↑</Button><Button variant="outline" size="sm" aria-label="下移图片" disabled={!selectedAssetIds.has(asset.id) || index === visibleDraft!.assets.length - 1 || busy} onClick={() => reorder(asset.id, 1)}>↓</Button><Button variant="outline" size="sm" className="pub-danger-action" disabled={busy} onClick={() => removeImage(asset.id)}>删除</Button></div>
      </div>)}</div>
      {contentView !== 'master' && hasOverride('coverAssetId') && <Button variant="outline" size="sm" onClick={() => resetVariantField('coverAssetId')}>封面恢复主稿</Button>}
      {contentView !== 'master' && hasOverride('assetOrder') && <Button variant="outline" size="sm" onClick={() => resetVariantField('assetOrder')}>图片顺序恢复主稿</Button>}
    </div>
  ) : null

  return <div onBlurCapture={() => { if (dirtyRef.current) void flush().catch(cause => showError(errorMessage(cause))) }}>
    {runtimeCapability && !runtimeCapability.supported && <div className="pub-error">{capabilityMessage(runtimeCapability)}。本地草稿仍可编辑。</div>}
    <div className="pub-editor-bar">
      <Button size="sm" variant="outline" className="pub-editor-back" disabled={busy} onClick={back}>返回{contentType === 'article' ? '文章' : '图文'}列表</Button>
      <span className="pub-editor-status" role="status" aria-live="polite">{saveError ? '自动保存失败，请重试' : exactMismatch ? '正在打开草稿…' : dirtyRef.current || saveTask.current ? '自动保存中…' : '已保存'}</span>
      <div className="pub-editor-actions">
        <div className="pub-editor-view-switch" role="group" aria-label="内容视图">
          <button type="button" aria-pressed={!preview} disabled={editorLocked || !draft} onClick={() => setPreview(false)}>编辑</button>
          <button type="button" aria-pressed={preview} disabled={editorLocked || !draft} onClick={() => setPreview(true)}>预览</button>
        </div>
        {contentType === 'article' && onToggleAgent && <Button size="sm" variant="outline" aria-expanded={Boolean(agentOpen)} aria-controls="pub-agent-drawer" disabled={editorLocked || !draft} onClick={() => void act(async () => {
          const current = await flush()
          if (!current) throw new Error('请先打开文章草稿')
          selectContentView('master')
          setPreview(false)
          await onToggleAgent(current)
        })}>Agent 辅助编辑</Button>}
        <Button size="sm" variant="outline" disabled={editorLocked || !draft} onClick={duplicate}>复制</Button>
        <Button size="sm" variant="outline" className="pub-danger-action" disabled={editorLocked || !draft} onClick={remove}>删除</Button>
        <Button size="sm" variant="primary" disabled={editorLocked || !draft} onClick={() => setPublishOpen(true)}>发布</Button>
      </div>
    </div>
    {handoffError && <div className="pub-error" role="status">{handoffError}
      <div className="pub-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setHandoffError(''); setHandoffRetry(value => value + 1) }}>重试读取草稿</Button></div>
    </div>}
    {saveError.includes('已在其他页面更新') && <div className="pub-error" role="status">
      草稿已在其他页面更新。请重新加载后继续编辑；当前未保存的修改会丢失。
      <div className="pub-actions"><Button size="sm" variant="outline" disabled={busy} onClick={reloadAfterConflict}>重新加载草稿</Button></div>
    </div>}
    {exactMismatch ? <div className="pub-empty" role="status">
      {handoffError ? '指定草稿未能打开。可以返回列表，或恢复先前正在编辑的内容。' : '正在打开指定草稿…'}
      {handoffError && draft && <div className="pub-actions"><Button size="sm" variant="outline" onClick={() => onSelectedContentChange?.(draft.id)}>返回先前草稿</Button></div>}
    </div> : !draft ? <div className="pub-empty">正在打开草稿…</div> : <fieldset disabled={editorLocked} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}><div className="pub-grid">
      {!preview && contentType === 'image-note' && <div style={{ gridColumn: '1 / -1' }}>{mediaCard}</div>}
      <div>
        {preview ? <div className="pub-card"><PublisherContentPreview content={visibleDraft!} platform={contentView === 'master' ? undefined : contentView}/>
          {contentType === 'article' && visibleDraft!.summary && contentView !== 'blbl' && contentView !== 'wxmp' && contentView !== 'tt' && <p className="pub-preview-summary"><strong>独立摘要字段：</strong>{visibleDraft!.summary}</p>}
          <p className="pub-muted">{contentView === 'wxmp' ? '公众号正文按所选主题预览；封面和摘要是独立字段。平台后台的最终呈现请以实际草稿为准。'
            : contentView === 'master' ? '主稿展示阅读排版；公众号会采用所选主题，其他平台的实际样式仍需在后台草稿核对。'
              : contentView === 'tt' && contentType === 'article' ? '头条文章不录入独立摘要；这里展示标题、正文和图片，平台后台的最终呈现仍需核对。'
              : contentView === 'ks' && contentType === 'image-note' ? '快手图文没有独立标题字段，适配器会把标题放在作品描述首段；草稿状态仍需在快手后台核对。'
              : '这里展示当前平台版本的内容结构和图片顺序；实际样式由平台编辑器决定，请在后台草稿核对。'}</p></div> : <>
        <div className="pub-card"><h2>{contentType === 'article' ? '文章内容' : '图文内容'}</h2>
          <div className="pub-field"><label htmlFor={`pub-${contentType}-title`}>标题 <span className={visibleDraft!.title.length > titleLimit ? 'pub-warn' : 'pub-muted'}>（{visibleDraft!.title.length}/{titleLimit} 字）</span>{hasOverride('title') && ' · 此平台已单独修改'}</label><Input className="pub-text-input" id={`pub-${contentType}-title`} maxLength={TITLE_MAX} value={visibleDraft!.title} onChange={event => updateTextField('title', event.target.value)}/>{hasOverride('title') && <Button variant="outline" size="sm" onClick={() => resetVariantField('title')}>标题恢复主稿</Button>}</div>
          {contentType === 'image-note' && contentView === 'ks' && <p className="pub-muted">快手图文没有独立标题框，标题将放入正文第一段。</p>}
          {contentType === 'article' && <div className="pub-actions" style={{ marginBottom: 12 }}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => importInputRef.current?.click()}>导入 .md/.txt 到主稿</Button>
            <input ref={importInputRef} type="file" accept=".md,.txt,text/markdown,text/plain" style={{ display: 'none' }} onChange={event => { importText(event.target.files?.[0]); event.target.value = '' }}/>
          </div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-body`}>{contentType === 'article' ? '正文' : '正文 / 话题'}{hasOverride('body') && ' · 此平台已单独修改'}</label>
            <textarea ref={bodyInputRef} className={`pub-input ${contentType === 'article' ? 'pub-editor' : ''}`} id={`pub-${contentType}-body`} value={visibleDraft!.body} onChange={event => updateTextField('body', event.target.value)}/>
            {hasOverride('body') && <Button variant="outline" size="sm" onClick={() => resetVariantField('body')}>正文恢复主稿</Button>}
          </div>
          {contentType === 'article' && contentView === 'tt' && <p className="pub-muted">头条文章不录入独立摘要，提交时会自动跳过；主稿摘要仍可供其他平台使用。</p>}
          {contentType === 'article' && contentView !== 'tt' && <div className="pub-field"><label htmlFor="pub-article-summary">摘要{hasOverride('summary') && ' · 此平台已单独修改'}</label><textarea className="pub-input" id="pub-article-summary" maxLength={2000} value={visibleDraft!.summary} onChange={event => updateTextField('summary', event.target.value)}/>{hasOverride('summary') && <Button variant="outline" size="sm" onClick={() => resetVariantField('summary')}>摘要恢复主稿</Button>}</div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-tags`}>标签（{visibleDraft!.tags.length}/{MAX_TAGS} 个，用空格或逗号分隔）{hasOverride('tags') && ' · 此平台已单独修改'}</label><Input className="pub-text-input" id={`pub-${contentType}-tags`} value={tagsInput} onChange={event => { setTagsInput(event.target.value); const tags = [...new Set(event.target.value.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS); if (contentView === 'master') update({ tags }); else updateVariant({ tags }) }}/>{hasOverride('tags') && <Button variant="outline" size="sm" onClick={() => resetVariantField('tags')}>标签恢复主稿</Button>}</div>
          {visibleDraft!.tags.length > 0 && skippedArticleTagTargets.length > 0 && <p className="pub-muted">{skippedArticleTagTargets.map(account => PLATFORM_LABELS[account.platform]).join('、')}文章暂不写入标签；草稿标签仍保留供其他平台使用。</p>}
          {enteredTags.length > MAX_TAGS && <p className="pub-warn">超过 {MAX_TAGS} 个标签，超出的标签不会保存。</p>}
          {contentView === 'master' ? <div className="pub-field"><label htmlFor={`pub-${contentType}-statement`}>AI 内容声明（所有平台共用）</label><select className="pub-input" id={`pub-${contentType}-statement`} value={draft.creativeStatement} onChange={event => update({ creativeStatement: event.target.value as PublisherContent['creativeStatement'] })}>{CREATIVE_STATEMENTS.map(value => <option key={value} value={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
            : <p className="pub-muted">AI 内容声明由主稿统一设置：{STATEMENT_LABELS[draft.creativeStatement]}。</p>}
        </div>
        {contentType === 'article' && mediaCard}
        </>}
      </div>
      <div>
        <div className="pub-card pub-version-card">
          <div className="pub-version-tabs" role="group" aria-label="内容版本">
            <button type="button" className="pub-version-tab" aria-pressed={contentView === 'master'} onClick={() => selectContentView('master')}>主稿</button>
            {accountPlatforms.map(platform => <button type="button" className="pub-version-tab" aria-pressed={contentView === platform} key={platform} disabled={agentOpen} title={agentOpen ? '先关闭 Agent 对话，再切换平台版本' : undefined} onClick={() => selectContentView(platform)}>
              {PLATFORM_LABELS[platform]}{draft.platformVariants?.[platform] ? ' · 已单独修改' : ''}
            </button>)}
          </div>
          <p className="pub-muted">{contentView === 'master' ? '这里编辑的是本地发布主稿；从 Agent 原始 MD 生成的内容不会回写原文件。平台版本默认继承主稿；对某个平台单独修改后，该字段将保留自己的内容。'
            : `${PLATFORM_LABELS[contentView]}版本：未单独修改的字段会跟随主稿更新。请在提交前切到每个目标平台检查。`}</p>
          {contentType === 'article' && (contentView === 'master' || contentView === 'wxmp') && <div className="pub-article-theme-control">
            <label htmlFor={`pub-article-theme-${draft.id}`}>公众号排版主题</label>
            <select className="pub-input" id={`pub-article-theme-${draft.id}`} value={resolveArticleTheme(draft)} onChange={event => update({ articleTheme: event.target.value as PublisherContent['articleTheme'] })}>
              {ARTICLE_THEMES.map(theme => <option key={theme} value={theme}>{ARTICLE_THEME_LABELS[theme]}</option>)}
            </select>
            <p className="pub-muted">主稿预览可比较排版；所选主题用于公众号正文，文颜灵感主题是适配版本，最终以公众号草稿为准。其他平台按各自编辑器处理。</p>
          </div>}
          {contentView !== 'master' && selectedVariant && <Button variant="outline" size="sm" onClick={resetPlatformVariant}>此平台全部恢复主稿</Button>}
        </div>
        <ProjectDirectoryInfo key={draft.id} contentId={draft.id}/>
      </div>
    </div></fieldset>}
    {publishOpen && draft && <PublisherModal open title="发布设置" closeLabel="关闭发布设置" className="pub-modal pub-publish-modal" contentClassName="pub-modal-content"
      onClose={() => { if (!busyRef.current) setPublishOpen(false) }}
      footer={<>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPublishOpen(false)}>取消</Button>
        <Button size="sm" variant="primary" disabled={busy || !submitReady} onClick={requestConfirm}>检查并提交</Button>
      </>}>
      <fieldset disabled={editorLocked} className="pub-publish-fields">
        <h3>选择平台账号</h3>
        {requestedPlatforms.length > 0 && <p className="pub-muted" role="status">本次目标平台：{requestedPlatforms.map(platform => PLATFORM_LABELS[platform]).join('、')}。请逐一选择账号；也可手动添加下方其他平台。如需减少目标，请在对话中重新准备预览。</p>}
        {accountPlatforms.map(platform => <div key={platform}>
          {requestedPlatforms.includes(platform) && <p className="pub-muted">本次目标 · {selectedAccounts.some(account => account.platform === platform) ? '账号已选择' : '待选择账号'}</p>}
          <PlatformAccountSelect idPrefix={contentType} platform={platform} accounts={accounts} value={selection[platform] ?? ''} initialFocus={platform === accountPlatforms[0]} onChange={id => setSelection(current => ({ ...current, [platform]: id || undefined }))}/>
          {!capabilitiesPending && !capabilitiesError && !contentModeAvailable(platform, contentType, submissionMode, capabilities) && <p className="pub-muted">当前发布引擎尚未开放{PLATFORM_LABELS[platform]}{submissionMode === 'publish' ? '立即发布' : '转存草稿'}能力；可继续准备本地草稿。</p>}
        </div>)}
        {accountsPending && <p className="pub-muted">正在加载平台账号…</p>}
        {accountsError ? <p className="pub-warn" role="status">账号加载失败：{accountsError}</p>
          : !accountsPending && !accounts.some(account => accountPlatforms.some(platform => platform === account.platform)) && <p className="pub-muted">还没有适用于当前内容类型的账号，请先到“平台账号管理”添加并登录。</p>}
        {capabilitiesPending && <p className="pub-muted">正在检查平台提交能力…</p>}
        {capabilitiesError && <p className="pub-warn" role="status">平台能力加载失败：{capabilitiesError}</p>}
        {selectedAccounts.map(account => {
          const fields = capabilities.find(item => item.platform === account.platform)?.requiredFields[contentType] ?? []
          return fields.map(field => <div className="pub-field" key={`${account.platform}:${field}`}>
            <label htmlFor={`pub-field-${account.platform}-${field}`}>{PLATFORM_LABELS[account.platform]} · {FIELD_LABELS[field] || field}</label>
            <Input className="pub-text-input" id={`pub-field-${account.platform}-${field}`} value={draft.platformFields[account.platform]?.[field] ?? ''} onChange={event => update({ platformFields: { ...draft.platformFields, [account.platform]: { ...draft.platformFields[account.platform], [field]: event.target.value } } })}/>
          </div>)
        })}
        {!capabilitiesPending && !capabilitiesError && selectedAccounts.map(account => {
          const error = contentSubmissionError(draft, [account], capabilities, submissionMode)
          const warnings = articleSubmissionWarnings(draft, [account], capabilities)
          return <div key={`validation-${account.id}`}>
            {error && <p className="pub-warn" role="status">{PLATFORM_LABELS[account.platform]}：{error}</p>}
            {warnings.map(warning => <p className="pub-warn" role="status" key={warning}>{warning}</p>)}
          </div>
        })}
        <h3>提交方式</h3>
        <div className="pub-mode">
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label>
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label>
        </div>
        {missingRequestedPlatforms.length > 0 && <p className="pub-warn" role="status">本次目标尚未选账号：{missingRequestedPlatforms.map(platform => PLATFORM_LABELS[platform]).join('、')}。选择全部目标账号后才能提交。</p>}
        {!capabilitiesPending && !capabilitiesError && unavailableTargets.length > 0 ? <p className="pub-warn" role="status">当前发布引擎尚未开放所选平台的提交方式；本地草稿仍会保存。若刚更新 Helper，请完全退出并重启应用后重试。</p>
          : validationError && <p className="pub-warn" role="status">提交前请处理：{validationError}</p>}
        {articleWarnings.length > 0 && <p className="pub-muted">以上调整只影响提交给平台的文章副本，原始 MD 和本地编辑稿保留；本次将转存平台草稿供核对。</p>}
        <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。文章/图文适配仍需实际平台验证，建议先转存草稿并到对应账号后台核对。</p>
      </fieldset>
    </PublisherModal>}
    {confirm && <ConfirmDialog contentType={contentType} title={confirm.title} mode={confirm.mode} accounts={confirm.accounts} targetTitles={confirm.targetTitles} warnings={confirm.warnings} busy={busy} onCancel={() => { setConfirm(undefined); setPublishOpen(true) }} onConfirm={submit}/>}
    <PublisherModal open={deleteDraftId !== undefined} title="删除本地草稿" closeLabel="关闭删除草稿确认" description="删除这份本地草稿？已经提交的内容快照不受影响。" className="pub-modal" onClose={() => { if (!busyRef.current) setDeleteDraftId(undefined) }} footer={<><Button size="sm" variant="outline" data-pub-initial-focus disabled={busy} onClick={() => { if (!busyRef.current) setDeleteDraftId(undefined) }}>取消</Button><Button size="sm" variant="outline" className="pub-danger-action" disabled={busy} onClick={confirmRemove}>{busy ? '正在删除…' : '删除草稿'}</Button></>}/>
  </div>
}
