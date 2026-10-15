/** Edit Agent Markdown images through the public preview extension seam. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownImagePreviewProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { ChatImagePreview, type ChatImageEditorServices } from './chat-image-editor.tsx'
import { ImageEditorDialog } from './ImageEditorDialog.tsx'

/** The original Markdown props remain owned by its renderer throughout editing. */
export function MarkdownImageEditor({ src, alt, destination, labels, onClose, editor }: MarkdownImagePreviewProps & {
  editor: ChatImageEditorServices
}): React.JSX.Element {
  const [view, setView] = useState<'preview' | 'editor'>('preview')
  const [edited, setEdited] = useState<{ src: string; name: string } | null>(null)
  const [version, setVersion] = useState<'original' | 'edited'>('original')
  const [focusEdit, setFocusEdit] = useState(false)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const close = useRef(onClose)
  close.current = onClose
  const closePreview = useCallback(() => { close.current() }, [])
  // The controller survives preview/editor switches, so the final close always
  // returns focus to the Markdown thumbnail rather than an unmounted toolbar.
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus() }, [])
  const original = { src, name: alt || destination.split(/[?#]/u)[0].split('/').at(-1) || '图片' }
  const selected = version === 'edited' && edited !== null ? edited : original
  if (view === 'editor') return <ImageEditorDialog
    source={{ previewUrl: selected.src, name: selected.name }} api={editor.api} scope={editor.scope}
    onClose={() => { setFocusEdit(true); setView('preview') }}
    onComplete={result => {
      setEdited({ src: `data:${result.image.mime};base64,${result.image.b64}`, name: '编辑后的新版图片' })
      setVersion('edited')
    }}
  />
  return <ChatImagePreview
    src={selected.src} name={selected.name} labels={{ preview: labels.dialog, close: labels.close }}
    focusEdit={focusEdit} editDisabled={false}
    editLabel={version === 'edited' ? '继续编辑图片' : undefined}
    controls={edited === null ? undefined : <>
      <span role="status" style={{ color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-input-major)', padding: '6px 12px', borderRadius: 18 }}>编辑结果已另存到 e图库</span>
      <button type="button" onClick={() => { setVersion(version === 'edited' ? 'original' : 'edited') }}>
        {version === 'edited' ? '查看原图' : '查看新版'}
      </button>
    </>}
    onEdit={() => { setView('editor') }} onClose={closePreview}
  />
}

/** Old platform bundles can boot normally while retaining their own lightbox. */
export function registerMarkdownImageEditor(ctx: ClientContext, editor: ChatImageEditorServices): () => void {
  // The compat extension is optional for external/older runtime compositions.
  // Namespace access keeps a missing export from making ModuleLoader boot fail.
  const register = (primitives as typeof primitives & {
    registerMarkdownImagePreview?: (renderer: ComponentType<MarkdownImagePreviewProps>) => () => void
  }).registerMarkdownImagePreview
  if (typeof register !== 'function') return () => {}
  const Preview = (props: MarkdownImagePreviewProps): React.JSX.Element => <MarkdownImageEditor
    key={`${props.destination}:${props.src}`} {...props} editor={editor}
  />
  return ctx.effect(() => register(Preview), 'dsh-imagegen: Markdown image editing')
}
