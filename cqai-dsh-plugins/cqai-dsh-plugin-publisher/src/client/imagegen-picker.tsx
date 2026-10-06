import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorMessage, PublisherModal } from './shared.tsx'
import { listImagegenImages, type ImagegenImage, type ImagegenScope } from './imagegen-library.ts'
import { imagegenPickerCss } from './imagegen-picker-style.ts'

const SOURCES: { value: ImagegenScope; label: string }[] = [
  { value: 'all', label: '全部生图' },
  { value: 'normal', label: '普通生图' }, { value: 'canvas', label: '画布生图' },
  { value: 'ecommerce', label: '电商套图' }, { value: 'gallery', label: '素材库' },
]
export interface ImagegenImportResult { importedIds: string[]; error?: string }

export function ImagegenPicker({ remaining, onCancel, onImport }: {
  remaining: number
  onCancel(): void
  onImport(images: ImagegenImage[], signal: AbortSignal): Promise<ImagegenImportResult>
}) {
  const id = useId()
  const [source, setSource] = useState<ImagegenScope>('all')
  const [query, setQuery] = useState('')
  const [images, setImages] = useState<ImagegenImage[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [attempts, setAttempts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [retry, setRetry] = useState(0)
  const [visibleLimit, setVisibleLimit] = useState(60)
  const alive = useRef(false)
  const importingRef = useRef(false)
  const listController = useRef<AbortController>()
  const importController = useRef<AbortController>()
  const capacity = Math.max(0, Math.min(20, remaining))
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; importController.current?.abort() }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    listController.current = controller
    setLoading(true); setLoadError(''); setImages([]); setSelected([]); setFailed({}); setAttempts({}); setQuery(''); setImportError(''); setVisibleLimit(60)
    void listImagegenImages(source, controller.signal).then(rows => {
      if (!controller.signal.aborted) setImages(rows)
    }).catch(cause => {
      if (!controller.signal.aborted) setLoadError(errorMessage(cause))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [source, retry])

  const close = () => {
    if (importingRef.current) return
    listController.current?.abort()
    onCancel()
  }
  const toggle = (imageId: string, checked: boolean) => {
    if (importingRef.current || failed[imageId]) return
    setSelected(current => checked ? current.includes(imageId) || current.length >= capacity ? current : [...current, imageId]
      : current.filter(value => value !== imageId))
    setImportError('')
  }
  const importSelected = async () => {
    if (importingRef.current || selected.length === 0 || selected.length > capacity) return
    const chosen = selected.map(imageId => images.find(image => image.id === imageId)).filter((image): image is ImagegenImage => !!image && !failed[image.id])
    if (chosen.length !== selected.length) return
    importingRef.current = true
    setImporting(true); setImportError('')
    const controller = new AbortController()
    importController.current = controller
    try {
      const result = await onImport(chosen, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      const imported = new Set(result.importedIds)
      setSelected(current => current.filter(imageId => !imported.has(imageId)))
      if (result.error) setImportError(`${imported.size ? `已导入 ${imported.size} 张图片，剩余 ${chosen.length - imported.size} 张未导入：` : '导入失败：'}${result.error}`)
      else if (imported.size === chosen.length) onCancel()
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setImportError(`导入失败：${errorMessage(cause)}`)
    } finally {
      importingRef.current = false
      if (alive.current) setImporting(false)
    }
  }
  const search = query.trim().toLocaleLowerCase()
  const visible = images.filter(image => !search || `${image.prompt}\n${image.name}\n${image.searchText ?? ''}`.toLocaleLowerCase().includes(search))

  return <PublisherModal open title="从 e图宝选择" description="将已生成图片复制到当前图文草稿，按选择顺序添加。" closeLabel="关闭图片选择"
    className="pub-imagegen-picker" contentClassName="pub-imagegen-picker-content" onClose={close} footer={<>
      <Button type="button" size="sm" variant="outline" disabled={importing} onClick={close}>取消</Button>
      <Button type="button" size="sm" variant="primary" disabled={importing || loading || selected.length === 0 || selected.length > capacity}
        onClick={() => void importSelected()}>{importing ? '正在导入…' : `导入选中图片（${selected.length}）`}</Button>
    </>}>
    <style data-plugin="cqai-dsh-plugin-publisher" data-plugin-css="cqai-dsh-plugin-publisher/imagegen-picker">{imagegenPickerCss}</style>
    <div className="pub-imagegen-picker-body" aria-busy={loading || importing}>
      <div className="pub-imagegen-picker-tools">
        <label htmlFor={`${id}-source`}>图片来源<select id={`${id}-source`} disabled={importing} value={source} data-pub-initial-focus
          onChange={event => { if (event.target.value !== source) { listController.current?.abort(); setSource(event.target.value as ImagegenScope) } }}>{SOURCES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label htmlFor={`${id}-search`}>搜索图片<input id={`${id}-search`} type="search" placeholder="搜索提示词或文件名" value={query} disabled={importing}
          onChange={event => { setQuery(event.target.value); setVisibleLimit(60) }}/></label>
      </div>
      <p className="pub-imagegen-picker-count" role="status" aria-live="polite">已选 {selected.length} 张 · 当前草稿还能添加 {capacity} 张{selected.length >= capacity ? ' · 已达到可选数量' : ''}</p>
      {importing && <p role="status">正在逐张导入并保存，请稍候…</p>}
      {importError && <p className="pub-imagegen-picker-error" role="alert">{importError}</p>}
      {loading ? <div className="pub-imagegen-picker-status" role="status">正在加载图片…</div>
        : loadError ? <div className="pub-imagegen-picker-status"><p role="alert">图片加载失败：{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>重新加载</Button></div>
          : images.length === 0 ? <div className="pub-imagegen-picker-status">此来源暂无可选图片，请先在 e图宝生成或添加图片。</div>
            : visible.length === 0 ? <div className="pub-imagegen-picker-status">没有匹配的图片，请修改搜索内容。</div>
              : <div className="pub-imagegen-picker-grid" aria-label="可选图片">{visible.slice(0, visibleLimit).map(image => {
                const order = selected.indexOf(image.id)
                return <div className="pub-imagegen-picker-card" key={image.id} data-selected={order >= 0}>
                  <label className="pub-imagegen-picker-choice">
                    <div className="pub-imagegen-picker-thumb" data-failed={!!failed[image.id]}>
                      <img key={attempts[image.id] ?? 0} src={image.url} alt="" loading="lazy" decoding="async"
                        onLoad={() => setFailed(current => ({ ...current, [image.id]: false }))}
                        onError={() => { setFailed(current => ({ ...current, [image.id]: true })); setSelected(current => current.filter(value => value !== image.id)) }}/>
                      {order >= 0 && <span className="pub-imagegen-picker-order" aria-label={`第 ${order + 1} 张`}>{order + 1}</span>}
                    </div>
                    <span className="pub-imagegen-picker-caption"><input type="checkbox" checked={order >= 0} disabled={importing || !!failed[image.id] || order < 0 && selected.length >= capacity}
                      aria-label={`选择${image.name}`} onChange={event => toggle(image.id, event.target.checked)}/>
                      <span className="pub-imagegen-picker-name">{image.name}<small>{image.label}</small></span></span>
                  </label>
                  {failed[image.id] && <div className="pub-imagegen-picker-retry"><Button type="button" size="sm" variant="outline" disabled={importing}
                    onClick={() => setAttempts(current => ({ ...current, [image.id]: (current[image.id] ?? 0) + 1 }))}>重试图片</Button></div>}
                </div>
              })}</div>}
      {!loading && !loadError && visible.length > visibleLimit && <Button type="button" size="sm" variant="outline" disabled={importing}
        onClick={() => setVisibleLimit(value => value + 60)}>显示更多图片（已显示 {visibleLimit}/{visible.length}）</Button>}
    </div>
  </PublisherModal>
}
