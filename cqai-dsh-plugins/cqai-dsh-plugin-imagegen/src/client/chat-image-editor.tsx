/** Editable native message images, composed through the official image slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MessageImageLoader, MessageImageSource, MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconLoadingOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ImageEditorDialog } from './ImageEditorDialog.tsx'
import type { ImageGenApi } from './api.ts'
import { tt } from './helpers.ts'
import type { ImageGenScope } from './settings-scope.ts'
import css from './chat-image-editor.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Official Chat image owner currency, also used by native attachment presentation. */
    'conversation.message.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
    /** The trajectory target supplies the same references and authorized loader. */
    'conversation.trajectory.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
    /** Tool's public image seat uses the same reference/loader/align owner fields. */
    'tool.call.images': { kind: 'single'; scope: 'session'; owner: Pick<MessageImagesOwnerProps, 'images' | 'loadImage' | 'align'> }
  }
}

export interface ChatImageEditorServices {
  api: ImageGenApi
  scope: ImageGenScope
}

interface ChatImageLabels {
  image: string
  open: string
  openNamed(label: string): string
  loading: string
  failed: string
  preview: string
  close: string
}

function resolveLabels(t: TranslateNS<'conversation'>): ChatImageLabels {
  return {
    image: t('image.label'), open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'), failed: t('image.loadFailed'),
    preview: t('image.preview'), close: t('image.closePreview'),
  }
}

/** Preserve the native lone-image geometry, including the crop anchor and no upscaling. */
export function chatImageSingleFit(width: number, height: number): { width: number; height: number; objectPosition: string } {
  const natural = width / height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, width / box.width, height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** A body portal with one focus scope; it unmounts before the editor opens. */
export function ChatImagePreview({ src, name, labels, editDisabled, focusEdit, editLabel, controls, onEdit, onClose }: {
  src: string; name: string; labels: Pick<ChatImageLabels, 'preview' | 'close'>; editDisabled: boolean; focusEdit: boolean
  editLabel?: string; controls?: ReactNode
  onEdit(): void; onClose(): void
}): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  const editRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = focusEdit && !editDisabled ? editRef.current : closeRef.current
    target?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current(); return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(controlsRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (controls.length === 0) return
      event.preventDefault()
      const current = controls.indexOf(document.activeElement as HTMLButtonElement)
      const next = current < 0 ? 0 : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      controls[next]?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (opener?.isConnected) opener.focus()
    }
  // Focus and restore belong to the preview's mounted lifetime, not URL hydration.
  }, [])
  return createPortal(<div className={css.backdrop} role="dialog" aria-modal="true" aria-label={labels.preview}>
    <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
    <img className={css.previewImage} src={src} alt={name} />
    <div ref={controlsRef} className={css.previewControls} role="toolbar" aria-label={labels.preview}
      style={controls === undefined ? undefined : { flexWrap: 'wrap', maxWidth: 'calc(100vw - 40px)', justifyContent: 'flex-end', alignItems: 'center' }}>
      {controls}
      <button ref={editRef} type="button" disabled={editDisabled} aria-busy={editDisabled || undefined} onClick={onEdit}>{editLabel ?? tt('preview.editImage')}</button>
      <button ref={closeRef} type="button" aria-label={labels.close} onClick={onClose}>×</button>
    </div>
  </div>, document.body)
}

function ChatImage({ image, loadImage, variant, labels, editor }: {
  image: MessageImageSource; loadImage: MessageImageLoader; variant: 'single' | 'tile' | 'thumbnail'
  labels: ChatImageLabels; editor: ChatImageEditorServices
}): React.JSX.Element {
  const attachment: ImageAttachmentRef | undefined = 'attachment' in image ? image.attachment : undefined
  const preview = 'preview' in image ? image.preview : undefined
  const [loaded, setLoaded] = useState<string | undefined>(() => attachment === undefined ? undefined : loadImage.peek?.(attachment))
  const [loading, setLoading] = useState(attachment !== undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<'closed' | 'preview' | 'editor'>('closed')
  const [version, setVersion] = useState<'original' | 'edited'>('original')
  const [focusEdit, setFocusEdit] = useState(false)
  const [edited, setEdited] = useState<{ src: string; name: string } | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const name = ('attachment' in image ? image.label : undefined) ?? preview?.name ?? attachment?.name ?? labels.image
  const src = preview?.url ?? loaded
  const selected = version === 'edited' ? edited : src === undefined ? null : { src, name }
  const dimensions = attachment ?? (preview?.width !== undefined && preview.height !== undefined ? preview : undefined)
  const fit = useMemo(() => variant === 'single'
    ? dimensions === undefined ? { width: 240, height: 240, objectPosition: 'center' } : chatImageSingleFit(dimensions.width!, dimensions.height!)
    : undefined, [dimensions, variant])
  useEffect(() => {
    if (attachment === undefined) return
    let live = true
    setLoading(true); setFailed(false); setLoaded(loadImage.peek?.(attachment))
    // Read the exact admitted reference. URLs and their revocation stay loader-owned.
    void loadImage(attachment).then(url => {
      if (!live) return
      setLoaded(url); setLoading(false)
    }).catch(() => {
      if (!live) return
      setFailed(true); setLoading(false)
    })
    return () => { live = false }
  }, [attachment, loadImage, attempt])
  useEffect(() => {
    if (view !== 'closed' || opener.current === null) return
    const target = opener.current.isConnected ? opener.current : retryRef.current
    target?.focus()
  }, [view])
  const closePreview = useCallback(() => { setView('closed') }, [])
  const openPreview = (target: 'original' | 'edited', button: HTMLButtonElement): void => {
    opener.current = button
    setVersion(target); setFocusEdit(false); setView('preview')
  }
  const busyThumbnail = variant === 'thumbnail' && src === undefined
  return <div className={css.item}>
    {failed ? <button ref={retryRef} type="button" className={css.error} data-variant={variant} title={labels.failed} aria-label={labels.failed}
      onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>{variant === 'thumbnail'
        ? <span aria-hidden="true"><IconRefreshOutlineRegular /></span> : labels.failed}</button> : <button
      type="button" className={css.frame} data-variant={variant}
      style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
      title={busyThumbnail ? labels.loading : labels.open} aria-label={busyThumbnail ? labels.loading : labels.openNamed(name)}
      aria-busy={busyThumbnail || undefined} onClick={event => { if (src !== undefined) openPreview('original', event.currentTarget) }}
    >{src === undefined ? <span className={css.loading} aria-hidden={busyThumbnail || undefined}>{busyThumbnail ? <IconLoadingOutlineRegular className={css.spinner} /> : labels.loading}</span>
      : <img key={`${src}:${attempt}`} src={src} alt={name} loading="lazy" decoding="async" style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}</button>}
    {edited !== null ? <div className={css.newVersion}>
      <p className={css.saved} role="status">编辑结果已另存到 e图库</p>
      <button type="button" className={css.frame} data-variant="tile" title={labels.open} aria-label={labels.openNamed(edited.name)} onClick={event => { openPreview('edited', event.currentTarget) }}>
        <img src={edited.src} alt={edited.name} loading="lazy" decoding="async" />
      </button>
    </div> : null}
    {view === 'preview' && selected !== null ? <ChatImagePreview
      src={selected.src} name={selected.name} labels={labels} focusEdit={focusEdit}
      editDisabled={version === 'original' && (loading || failed)}
      onClose={closePreview} onEdit={() => { setView('editor') }}
    /> : null}
    {view === 'editor' && selected !== null ? <ImageEditorDialog
      source={{ previewUrl: selected.src, name: selected.name }} api={editor.api} scope={editor.scope}
      onClose={() => { setFocusEdit(true); setView('preview') }}
      onComplete={result => {
        setEdited({ src: `data:${result.image.mime};base64,${result.image.b64}`, name: '编辑后的新版图片' })
        setVersion('edited')
      }}
    /> : null}
  </div>
}

interface ChatImageSlotProps extends MessageImagesOwnerProps {
  sessionId: string
  t: TranslateNS<'conversation'>
}

/** Register without touching the upstream attachment implementation or URL cache. */
export function registerChatImageEditors(ctx: ClientContext, editor: ChatImageEditorServices): () => void {
  const Images = (props: ChatImageSlotProps): React.JSX.Element | null => {
    const labels = resolveLabels(props.t)
    if (props.images.length === 0) return null
    const variant = props.thumbnail ? 'thumbnail' : props.compact || props.images.length > 1 ? 'tile' : 'single'
    return <div key={props.sessionId} className={css.gallery} data-align={props.align}>
      {props.images.map((image, index) => <ChatImage
        key={`${'attachment' in image ? image.attachment.attachmentId : image.preview.url}:${index}`}
        image={image} loadImage={props.loadImage} variant={variant} labels={labels} editor={editor}
      />)}
    </div>
  }
  const disposers = (['conversation.message.images', 'conversation.trajectory.images', 'tool.call.images'] as const).map(name =>
    ctx.slots.inject(name, () => ctx.slots.register({
      name, priority: -1, locale: 'conversation', inject: (sessionId: string) => ({ sessionId }),
    }, Images)))
  return () => { for (const dispose of disposers) dispose() }
}
