/** One pending or currently selected article/image-note in the publisher panel. */
export interface PublisherHandoff {
  contentId: string
  contentType: 'article' | 'image-note'
}

const STORAGE_KEY = 'cqai-publisher-handoff'
const EVENT_NAME = 'cqai-publisher-handoff'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
let pendingHandoff: PublisherHandoff | undefined

function valid(value: unknown): value is PublisherHandoff {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PublisherHandoff>
  return typeof candidate.contentId === 'string' && UUID.test(candidate.contentId)
    && (candidate.contentType === 'article' || candidate.contentType === 'image-note')
}

/** Session storage also covers a handoff sent before the publisher panel mounts and page reloads. */
export function readPublisherHandoff(): PublisherHandoff | undefined {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    if (!value) return pendingHandoff
    try {
      const parsed: unknown = JSON.parse(value)
      if (valid(parsed)) { pendingHandoff = parsed; return parsed }
    } catch { /* Remove malformed stored data below. */ }
    window.sessionStorage.removeItem(STORAGE_KEY)
    pendingHandoff = undefined
  } catch { /* Storage may be unavailable in a restricted browser context. */ }
  return pendingHandoff
}

/** Update the remembered selection without restarting a panel handoff. */
export function rememberPublisherHandoff(input: PublisherHandoff): void {
  if (!valid(input)) throw new Error('发布草稿 ID 或类型无效')
  pendingHandoff = input
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(input)) }
  catch { /* The live event still allows navigation when storage is unavailable. */ }
}

export function clearPublisherHandoff(): void {
  pendingHandoff = undefined
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* optional state */ }
}

/** Save first so a panel mounted by the following layout navigation reads the exact draft. */
export function requestPublisherHandoff(input: PublisherHandoff): void {
  rememberPublisherHandoff(input)
  window.dispatchEvent(new CustomEvent<PublisherHandoff>(EVENT_NAME, { detail: input }))
}

export function subscribePublisherHandoff(listener: (input: PublisherHandoff) => void): () => void {
  const onHandoff = (event: Event) => {
    const input = (event as CustomEvent<unknown>).detail
    if (valid(input)) listener(input)
  }
  window.addEventListener(EVENT_NAME, onHandoff)
  return () => window.removeEventListener(EVENT_NAME, onHandoff)
}
