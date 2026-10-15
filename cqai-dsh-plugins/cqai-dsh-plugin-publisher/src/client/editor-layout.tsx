import { useEffect, useRef, type ReactNode } from 'react'

/** Keep fields mounted when folded so unsaved values, uploads and focus targets survive. */
export function EditorSection({ title, hint, children, className = '', defaultOpen = false }: {
  title: string; hint?: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean
}) {
  return <details className={`pub-card pub-editor-section ${className}`} open={defaultOpen || undefined}>
    <summary><span className="pub-editor-section-title">{title}</span>{hint && <span className="pub-editor-section-hint">{hint}</span>}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <div className="pub-editor-section-body">{children}</div>
  </details>
}

/** A small native disclosure with ordinary tab stops, rather than a custom ARIA menu. */
export function EditorMoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ref.current?.open) return
      event.preventDefault()
      ref.current.open = false
      ref.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  return <details ref={ref} className="pub-editor-more">
    <summary aria-label="更多操作" className="pub-editor-more-trigger">更多<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <div className="pub-editor-more-panel" role="group" aria-label="草稿操作" onClick={event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!button || button.disabled || !ref.current) return
      ref.current.open = false
      ref.current.querySelector('summary')?.focus()
    }}>{children}</div>
  </details>
}

export const editorLayoutCss = `
.pub-grid.pub-editor-grid { grid-template-columns: minmax(0, 1fr) minmax(240px, 292px); align-items: start; gap: 20px; }
.pub-editor-main, .pub-editor-sidebar { min-width: 0; }
.pub-editor-main > .pub-card { padding: 22px 24px; }
.pub-editor-main > .pub-editor-preview { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.pub textarea.pub-input.pub-editor { min-height: clamp(360px, calc(100dvh - 310px), 720px) !important; }
.pub-editor-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
.pub-editor-heading h2 { margin: 0; }
.pub-editor-version-picker { display: flex; align-items: center; gap: 8px; color: var(--pub-secondary-text); font-size: 12px; }
.pub-editor-version-picker select { max-width: 210px; padding: 5px 8px; border: 1px solid var(--pub-border); border-radius: 7px; background: var(--pub-surface); color: var(--pub-text); font: inherit; }
.pub-editor-sidebar .pub-article-theme-control { grid-template-columns: minmax(0, 1fr); }
.pub-editor-sidebar .pub-version-tabs { flex-wrap: wrap; overflow: visible; }
.pub-grid.pub-video-editor-main { width: 100%; max-width: none; }
.pub-card .pub-video-source-picker { margin: 12px 0 0; border-radius: 8px; }
.pub-video-source-picker .pub-editor-section-body > h3:first-child { margin-top: 0; }
.pub-editor-sidebar .pub-source-card { border-radius: 12px; margin-bottom: 12px; }
.pub-card.pub-editor-section { padding: 0; margin-bottom: 12px; border-radius: 12px; }
.pub-editor-section > summary { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 14px 16px; list-style: none; cursor: pointer; border-radius: inherit; }
.pub-editor-section > summary::-webkit-details-marker, .pub-editor-more > summary::-webkit-details-marker { display: none; }
.pub-editor-section > summary:hover { background: var(--pub-soft); }
.pub-editor-section-title { flex: 0 0 auto; font-size: 13px; font-weight: 600; }
.pub-editor-section-hint { flex: 1; min-width: 0; color: var(--pub-tertiary-text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.pub-editor-section > summary > svg { flex: none; margin-left: auto; color: var(--pub-tertiary-text); transition: transform .15s; }
.pub-editor-section[open] > summary > svg { transform: rotate(180deg); }
.pub-editor-section[open] > summary { border-bottom: 1px solid var(--pub-border); border-radius: 12px 12px 0 0; }
.pub-editor-section-body { padding: 16px; min-width: 0; }
.pub-editor-section-body > .pub-card { padding: 0; margin: 0; border: 0; border-radius: 0; }
.pub-editor-section-body > .pub-card > h2 { display: none; }
.pub-editor-section-body .pub-field:last-child { margin-bottom: 0; }
.pub-editor-section-body .pub-actions:first-child { margin-top: 0; }
.pub-editor-section-body .pub-version-tabs { gap: 6px; }
.pub-editor-help { margin-top: 12px; color: var(--pub-secondary-text); font-size: 12px; }
.pub-editor-help > summary { cursor: pointer; }
.pub-editor-help > p { margin-bottom: 0; }
.pub-editor-more { position: relative; }
.pub-editor-more-trigger { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 11px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); font: inherit; font-size: 12px; list-style: none; cursor: pointer; }
.pub-editor-more-trigger:hover, .pub-editor-more[open] > summary { background: var(--pub-soft); }
.pub-editor-more-panel { position: absolute; z-index: 15; top: calc(100% + 6px); right: 0; display: flex; flex-direction: column; gap: 4px; width: max-content; min-width: 170px; max-width: min(280px, calc(100vw - 48px)); padding: 6px; border: 1px solid var(--pub-border); border-radius: 10px; background: var(--pub-surface); box-shadow: 0 8px 24px #00000012; }
.pub-editor-more-panel > button { justify-content: flex-start; text-align: left; width: 100%; border-color: transparent; }
.pub-editor-section > summary:focus-visible, .pub-editor-more > summary:focus-visible, .pub-editor-help > summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
@container (max-width: 980px) {
  .pub-grid.pub-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .pub-editor-main > .pub-card { padding: 18px; }
  .pub textarea.pub-input.pub-editor { min-height: clamp(300px, calc(100dvh - 540px), 440px) !important; }
  .pub-editor-sidebar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .pub-editor-sidebar > .pub-card { margin-bottom: 0; }
  .pub-editor-sidebar > details[open] { grid-column: 1 / -1; }
}
@container (max-width: 560px) { .pub-editor-sidebar { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .pub-editor-section > summary > svg { transition: none; } }
`
