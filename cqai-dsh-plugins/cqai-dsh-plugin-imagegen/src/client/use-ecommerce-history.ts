import { useCallback, useEffect, useRef, useState } from 'react'
import type { EcommerceRun, EcommerceRunSummary } from '../ecommerce-run-protocol.ts'
import type { ImageGenApi } from './api.ts'
import { errorMessage } from './helpers.ts'

/** Selection is a read operation. The host owns execution independently. */
export function useEcommerceHistory(api: ImageGenApi) {
  const [runs, setRuns] = useState<EcommerceRunSummary[]>([])
  const [run, setRun] = useState<EcommerceRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const selection = useRef({ id: null as string | null, epoch: 0 })
  const mounted = useRef(true)
  const listEpoch = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const epoch = ++listEpoch.current
    try {
      const next = await api.ecommerceList()
      if (!mounted.current || epoch !== listEpoch.current) return
      setRuns(next)
      setError(null)
    } catch (caught) {
      if (mounted.current && epoch === listEpoch.current) setError(errorMessage(caught))
    } finally {
      if (mounted.current && epoch === listEpoch.current) setLoading(false)
    }
  }, [api])

  const select = useCallback((next: EcommerceRun | null): void => {
    selection.current = { id: next?.id ?? null, epoch: selection.current.epoch + 1 }
    setRun(next)
    setOpeningId(null)
  }, [])
  const selectedId = useCallback(() => selection.current.id, [])

  // Parallel group retries and polling return whole-run snapshots. Updating
  // progress must preserve the selection and never replace a newer snapshot.
  const update = useCallback((next: EcommerceRun): void => {
    if (!mounted.current || selection.current.id !== next.id) return
    setRun(previous => previous?.id === next.id && next.updatedAt >= previous.updatedAt ? next : previous)
  }, [])

  const open = useCallback(async (id: string): Promise<EcommerceRun | null> => {
    const epoch = ++selection.current.epoch
    setOpeningId(id)
    try {
      const next = await api.ecommerceGet(id)
      if (!mounted.current || epoch !== selection.current.epoch) return null
      selection.current.id = id
      setRun(next)
      setError(null)
      return next
    } catch (caught) {
      if (mounted.current && epoch === selection.current.epoch) setError(errorMessage(caught))
      throw caught
    } finally {
      if (mounted.current && epoch === selection.current.epoch) setOpeningId(null)
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    let busy = false
    let disposed = false
    const poll = async (): Promise<void> => {
      if (busy) return
      busy = true
      let requested: { id: string; epoch: number } | undefined
      try {
        await refresh()
        const { id, epoch } = selection.current
        if (disposed || id === null) return
        requested = { id, epoch }
        const next = await api.ecommerceGet(id)
        if (disposed || epoch !== selection.current.epoch || id !== selection.current.id) return
        update(next)
      } catch (caught) {
        if (!disposed && requested?.epoch === selection.current.epoch && requested.id === selection.current.id) setError(errorMessage(caught))
      } finally { busy = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1500)
    return () => {
      disposed = true
      mounted.current = false
      ++selection.current.epoch
      ++listEpoch.current
      window.clearInterval(timer)
    }
  }, [api, refresh, update])

  return { runs, run, loading, error, openingId, open, select, selectedId, update, refresh, setRuns }
}
