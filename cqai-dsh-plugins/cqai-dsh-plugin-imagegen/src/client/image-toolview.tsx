/** Inline renderer for image-generation tool-result attachments. */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandNode, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useMemo, useState } from 'react'
import { parseEditImageCommandResult } from '../edit-image-command-result.ts'
import { AGENT_IMAGE_API } from '../protocol.ts'
import { CHAT_IMAGE_EVENT } from './conversation-sync.ts'
import css from './image-toolview.module.css'

/** Owner props supplied by the host's keyed tool-call slot. */
export interface ImageToolViewOwnerProps {
  callId: string
  toolName: string
  block: ToolCallBlock
  cwd?: string
  home?: string
  openFile: (path: string) => void
  inspect?: () => void
}

/** Owner props supplied by the command-name keyed conversation slot. */
export interface ImageCommandViewOwnerProps {
  node: CommandNode
}

interface LoadedImage {
  ref: ImageAttachmentRef
  src: string
}

interface ImageToolViewProps extends ImageToolViewOwnerProps {
  sessionId: SessionId
}

export interface ImageEditCommandViewProps extends ImageCommandViewOwnerProps {
  sessionId: SessionId
  /** Test seam; production reads the same durable attachment route as Tool results. */
  loadImage?: (sessionId: SessionId, ref: ImageAttachmentRef) => Promise<string>
}

const NO_IMAGE_REFS: readonly ImageAttachmentRef[] = Object.freeze([])

function isSettled(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

function imageRefsOf(block: ToolCallBlock): ImageAttachmentRef[] {
  if (!isSettled(block)) return []
  return block.content
    .flatMap(content => content.type === 'image' ? [content.attachment] : [])
}

function textOf(block: ToolCallBlock): string {
  if (!isSettled(block)) return ''
  return block.content
    .filter(content => content.type === 'text')
    .map(content => content.text)
    .join('\n')
}

function resultInfo(block: ToolCallBlock): { status: string; message: string } {
  if (!isSettled(block)) return { status: 'running', message: '正在生成图片…' }
  const text = textOf(block)
  try {
    const parsed = JSON.parse(text) as { status?: unknown; message?: unknown }
    return {
      status: typeof parsed.status === 'string' ? parsed.status : block.isError ? 'failed' : 'completed',
      message: typeof parsed.message === 'string' ? parsed.message : '',
    }
  } catch {
    return { status: block.isError ? 'failed' : 'completed', message: text }
  }
}

function statusLabel(status: string): string {
  if (status === 'running' || status === 'queued') return '生成中'
  if (status === 'failed') return '生成失败'
  if (status === 'cancelled') return '已取消'
  return '图片结果'
}

function useAttachmentImages(
  sessionId: SessionId,
  refs: readonly ImageAttachmentRef[],
  load: (sessionId: SessionId, ref: ImageAttachmentRef) => Promise<string>,
): { images: LoadedImage[]; error: string | null } {
  const key = useMemo(() => refs.map(ref => String(ref.attachmentId)).join('|'), [refs])
  const [images, setImages] = useState<LoadedImage[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const urls: string[] = []
    const revoke = (): void => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.length = 0
    }

    setImages([])
    setError(null)
    if (refs.length === 0) return () => { /* no attachments to clean up */ }

    void Promise.all(refs.map(async ref => {
      const src = await load(sessionId, ref)
      urls.push(src)
      return { ref, src }
    }))
      .then(next => {
        if (!disposed) setImages(next)
      })
      .catch(errorValue => {
        revoke()
        if (!disposed) setError(errorValue instanceof Error ? errorValue.message : String(errorValue))
      })

    return () => {
      disposed = true
      revoke()
    }
  }, [key, load, refs, sessionId])

  return { images, error }
}

async function loadAgentImage(_sessionId: SessionId, ref: ImageAttachmentRef): Promise<string> {
  // These are presentation-only references, so Session.readAttachment() does
  // not authorize them as model-visible content. The loopback route validates
  // the complete durable reference before reading the shared attachment store.
  const query = new URLSearchParams({
    attachment_id: String(ref.attachmentId),
    media_type: ref.mediaType,
    bytes: String(ref.bytes),
    width: String(ref.width),
    height: String(ref.height),
  })
  const response = await fetch(`${AGENT_IMAGE_API}?${query.toString()}`)
  if (!response.ok) throw new Error(`无法读取图片附件（HTTP ${response.status}）。`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

/** Rich `/edit_image` command row backed by references persisted in command/done. */
export function ImageEditCommandView({
  node,
  sessionId,
  loadImage = loadAgentImage,
}: ImageEditCommandViewProps): React.JSX.Element {
  const parsed = useMemo(
    () => node.outcome?.kind === 'success' ? parseEditImageCommandResult(node.outcome.text) : undefined,
    [node.outcome],
  )
  const refs = parsed?.images ?? NO_IMAGE_REFS
  const { images, error } = useAttachmentImages(sessionId, refs, loadImage)
  const status = node.outcome === null ? 'running' : node.outcome.kind === 'error' ? 'failed' : 'completed'
  const message = node.outcome === null
    ? '正在编辑图片…'
    : parsed?.summary ?? node.outcome.text ?? (status === 'failed' ? '图片编辑失败。' : '图片编辑已完成。')

  useEffect(() => {
    if (images.length === 0) return
    document.dispatchEvent(new CustomEvent(CHAT_IMAGE_EVENT, {
      detail: { sessionId, refs: images.map(image => image.ref) },
    }))
  }, [images, sessionId])

  return <section className={css.root} data-state={status} data-command="edit_image">
    <header className={css.header}>
      <span className={css.icon} aria-hidden="true">▧</span>
      <strong>/{node.name ?? 'edit_image'}</strong>
      <span className={css.status}>{statusLabel(status)}</span>
    </header>
    {message !== '' && <p className={status === 'failed' ? css.error : css.message}>{message}</p>}
    {images.length > 0 && <div className={css.images}>
      {images.map(image => <a
        className={css.imageLink}
        href={image.src}
        key={String(image.ref.attachmentId)}
        rel="noreferrer"
        target="_blank"
        title="打开原图"
      >
        <img className={css.image} src={image.src} alt={image.ref.name ?? '编辑后的图片'} />
      </a>)}
    </div>}
    {refs.length > 0 && images.length === 0 && error === null && <p className={css.loading}>正在加载图片…</p>}
    {error !== null && <p className={css.error}>{error}</p>}
  </section>
}

/** Register inline image result views for Agent tools and `/edit_image`. */
export function registerImageToolviews(ctx: ClientContext): void {
  const ImageToolView = (props: ImageToolViewProps): React.JSX.Element => {
    const refs = useMemo(() => imageRefsOf(props.block), [props.block])
    const { status, message } = resultInfo(props.block)
    const { images, error } = useAttachmentImages(props.sessionId, refs, loadAgentImage)

    useEffect(() => {
      if (images.length === 0) return
      document.dispatchEvent(new CustomEvent(CHAT_IMAGE_EVENT, {
        detail: {
          sessionId: props.sessionId,
          refs: images.map(image => image.ref),
        },
      }))
    }, [images, props.sessionId])

    return <section className={css.root} data-state={status} data-tool={props.toolName}>
      <header className={css.header}>
        <span className={css.icon} aria-hidden="true">▧</span>
        <strong>{props.toolName}</strong>
        <span className={css.status}>{statusLabel(status)}</span>
      </header>
      {message !== '' && <p className={css.message}>{message}</p>}
      {images.length > 0 && <div className={css.images}>
        {images.map(image => <a
          className={css.imageLink}
          href={image.src}
          key={String(image.ref.attachmentId)}
          rel="noreferrer"
          target="_blank"
          title="打开原图"
        >
          <img className={css.image} src={image.src} alt={image.ref.name ?? '生成图片'} />
        </a>)}
      </div>}
      {refs.length > 0 && images.length === 0 && error === null && <p className={css.loading}>正在加载图片…</p>}
      {error !== null && <p className={css.error}>{error}</p>}
    </section>
  }

  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['generate_image', 'edit_image', 'get_image_generation_task']) {
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key,
        inject: (sessionId: string) => ({ sessionId: sessionId as SessionId }),
      }, ImageToolView)
    }
  })
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'edit_image',
    inject: (sessionId: string) => ({ sessionId: sessionId as SessionId }),
  }, ImageEditCommandView))
}
