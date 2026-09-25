import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react'
import type { PublisherAsset } from '../protocol.ts'

export function carouselIndex(scrollLeft: number, viewportWidth: number, count: number): number {
  if (count < 1 || viewportWidth <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / viewportWidth)))
}

/** Shared image-note preview for the conversation sidebar and Publisher review page. */
export function ImageNoteCarousel({ contentId, assets, renderImage }: {
  contentId: string
  assets: readonly PublisherAsset[]
  renderImage(asset: PublisherAsset): ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const boundedIndex = Math.min(activeIndex, Math.max(0, assets.length - 1))
  const activeIndexRef = useRef(boundedIndex)
  activeIndexRef.current = boundedIndex
  const assetIdentity = `${contentId}:${assets.map(asset => asset.id).join(',')}`

  useEffect(() => {
    setActiveIndex(0)
    if (viewportRef.current) viewportRef.current.scrollLeft = 0
  }, [assetIdentity])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      viewport.scrollLeft = activeIndexRef.current * viewport.clientWidth
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  if (assets.length === 0) return null

  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(assets.length - 1, index))
    const viewport = viewportRef.current
    if (viewport) viewport.scrollLeft = next * viewport.clientWidth
    setActiveIndex(next)
  }
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    setActiveIndex(carouselIndex(viewport.scrollLeft, viewport.clientWidth, assets.length))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    goTo(boundedIndex + (event.key === 'ArrowRight' ? 1 : -1))
  }

  return <div className="pub-image-note-carousel" role="region" aria-label="图文图片轮播" tabIndex={0} onKeyDown={onKeyDown}>
    <div className="pub-image-note-viewport" ref={viewportRef} onScroll={onScroll}>
      {assets.map((asset, index) => <div className="pub-image-note-slide" role="group" aria-label={`第 ${index + 1} 张，共 ${assets.length} 张`} aria-hidden={index !== boundedIndex} key={asset.id}>
        {renderImage(asset)}
      </div>)}
    </div>
    {assets.length > 1 && <>
      <button className="pub-image-note-nav pub-image-note-prev" type="button" aria-label="上一张图片" disabled={boundedIndex === 0} onClick={() => goTo(boundedIndex - 1)}>‹</button>
      <button className="pub-image-note-nav pub-image-note-next" type="button" aria-label="下一张图片" disabled={boundedIndex === assets.length - 1} onClick={() => goTo(boundedIndex + 1)}>›</button>
      <span className="pub-image-note-counter" aria-live="polite">{boundedIndex + 1} / {assets.length}</span>
    </>}
  </div>
}

export const imageNoteCarouselCss = `
.pub-image-note-carousel { position: relative; width: 100%; min-width: 0; margin-bottom: 18px; border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-module-platform, #f3f4f6); }
.pub-image-note-carousel:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-image-note-viewport { display: flex; width: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; overscroll-behavior-inline: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.pub-image-note-viewport::-webkit-scrollbar { display: none; }
.pub-image-note-slide { display: flex; align-items: center; justify-content: center; flex: 0 0 100%; min-width: 0; aspect-ratio: 3 / 4; max-height: 560px; scroll-snap-align: start; overflow: hidden; }
.pub-image-note-slide > img, .pub-image-note-slide > [role=img] { display: block; width: 100%; height: 100%; max-width: 100%; object-fit: contain; }
.pub-image-note-carousel .pub-image-note-nav { position: absolute; top: 50%; z-index: 1; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; transform: translateY(-50%); border: 0; border-radius: 50%; background: #0009; color: #fff; font-size: 26px; line-height: 1; cursor: pointer; }
.pub-image-note-carousel .pub-image-note-nav:disabled { opacity: .35; cursor: default; }
.pub-image-note-carousel .pub-image-note-prev { left: 8px; }
.pub-image-note-carousel .pub-image-note-next { right: 8px; }
.pub-image-note-counter { position: absolute; right: 10px; bottom: 10px; padding: 2px 9px; border-radius: 999px; background: #0009; color: #fff; font-size: 12px; line-height: 1.5; pointer-events: none; }
`
