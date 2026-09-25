import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export const DEFAULT_TIP_DURATION_MS = 3_000

type TipKind = 'success' | 'error'
interface Tip { id: number; kind: TipKind; message: string; durationMs: number }
interface TipsApi {
  showSuccess(message: string): void
  showError(message: string): void
  clearTip(): void
}

const TipsContext = createContext<TipsApi | null>(null)

export function scheduleTipDismiss(callback: () => void, durationMs = DEFAULT_TIP_DURATION_MS): () => void {
  const timer = setTimeout(callback, durationMs)
  return () => clearTimeout(timer)
}

export function PublisherTipsProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>()
  const sequence = useRef(0)
  const show = useCallback((kind: TipKind, message: string) => {
    setTip({ id: ++sequence.current, kind, message, durationMs: DEFAULT_TIP_DURATION_MS })
  }, [])
  const showSuccess = useCallback((message: string) => show('success', message), [show])
  const showError = useCallback((message: string) => show('error', message), [show])
  const clearTip = useCallback(() => setTip(undefined), [])
  const api = useMemo(() => ({ showSuccess, showError, clearTip }), [showSuccess, showError, clearTip])

  useEffect(() => {
    if (!tip) return
    return scheduleTipDismiss(() => setTip(current => current?.id === tip.id ? undefined : current), tip.durationMs)
  }, [tip])

  return <TipsContext.Provider value={api}>{children}{tip && <div key={tip.id} className={`pub-tip pub-tip-${tip.kind}`}
    role={tip.kind === 'error' ? 'alert' : 'status'} aria-live={tip.kind === 'error' ? 'assertive' : 'polite'}>
    {tip.message}
  </div>}</TipsContext.Provider>
}

export function usePublisherTips(): TipsApi {
  const value = useContext(TipsContext)
  if (!value) throw new Error('PublisherTipsProvider is required')
  return value
}
