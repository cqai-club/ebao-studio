import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installEbaoRuntime, isEbaoExternalDestination, isEbaoNativeRequest } from '../src/ebao-runtime-bridge.ts'
import type { DesktopPublisherRuntime } from '../../dsh-desktop-shared/src/publisher-runtime.ts'

const restore: (() => void)[] = []
afterEach(() => { while (restore.length) restore.pop()!(); vi.restoreAllMocks() })

function nativeHost(install = installEbaoRuntime) {
  const sent: { type: string; requestId: number; method?: string; args?: unknown[] }[] = []
  for (const [key, value] of Object.entries({ connected: true, send: (message: typeof sent[number], callback?: (error?: Error) => void) => { sent.push(message); callback?.(); return true } })) {
    const previous = Object.getOwnPropertyDescriptor(process, key)
    Object.defineProperty(process, key, { configurable: true, writable: true, value })
    restore.push(() => { if (previous) Object.defineProperty(process, key, previous); else Reflect.deleteProperty(process, key) })
  }
  let runtime!: { publisher: DesktopPublisherRuntime; openExternal(target: string): Promise<void> }
  let dispose!: () => void
  install({ provide: (_name: string, value: typeof runtime) => { runtime = value }, effect: (effect: () => () => void) => { dispose = effect() } } as unknown as Context)
  restore.push(() => dispose())
  return { sent, runtime, dispose }
}

describe('e宝 native capability boundary', () => {
  it('rejects arbitrary worker methods, oversized envelopes and cyclic params', () => {
    const request = { type: 'ebao-native', requestId: 1, method: 'publisher.request', args: ['accounts.list', {}] }
    expect(isEbaoNativeRequest(request)).toBe(true)
    expect(isEbaoNativeRequest({ ...request, args: ['system.execute', {}] })).toBe(false)
    expect(isEbaoNativeRequest({ ...request, args: ['accounts.list', { value: 'x'.repeat(1024 * 1024) }] })).toBe(false)
    const params: Record<string, unknown> = {}; params.self = params
    expect(isEbaoNativeRequest({ ...request, args: ['accounts.list', params] })).toBe(false)
  })
  it('limits account browser destinations to HTTPS and loopback HTTP', () => {
    for (const value of ['https://cqaiclub.asia/login', 'http://127.0.0.1:1234/callback', 'http://[::1]:1234/callback']) expect(isEbaoExternalDestination(value)).toBe(true)
    for (const value of ['file:///tmp/script', 'javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'http://127.0.0.1.example.com']) expect(isEbaoExternalDestination(value)).toBe(false)
  })
  it('updates side-effect-free status after a successful native operation', async () => {
    const host = nativeHost()
    const request = host.runtime.publisher.request('accounts.list')
    const outgoing = host.sent[0]!
    process.emit('message', { type: 'ebao-native-result', requestId: outgoing.requestId, value: [{ id: 'fixture' }], publisher: { supported: true, running: true } }, undefined)
    await expect(request).resolves.toEqual([{ id: 'fixture' }])
    expect(host.runtime.publisher.status()).toEqual({ supported: true, running: true })
  })
  it('cancels native work when a caller aborts and rejects pending work on disposal', async () => {
    const host = nativeHost()
    const signal = new AbortController()
    const operation = host.runtime.publisher.request('submissions.create', {}, signal.signal)
    const firstId = host.sent[0]!.requestId
    const aborted = expect(operation).rejects.toThrow('cancel upload')
    signal.abort(new Error('cancel upload'))
    await aborted
    expect(host.sent).toContainEqual({ type: 'ebao-native-cancel', requestId: firstId })
    const pending = host.runtime.publisher.selectLocalVideo()
    const secondId = host.sent.find(message => message.method === 'publisher.selectLocalVideo')!.requestId
    const disposed = expect(pending).rejects.toThrow('disposed')
    host.dispose()
    await disposed
    expect(host.sent).toContainEqual({ type: 'ebao-native-cancel', requestId: secondId })
    await expect(host.runtime.publisher.request('accounts.list')).rejects.toThrow('unavailable')
  })
  it('keeps request identities unique across disposal and module reload, ignoring late old results', async () => {
    const old = nativeHost()
    const abandoned = old.runtime.publisher.request('submissions.create', {})
    const oldId = old.sent[0]!.requestId
    const disposed = expect(abandoned).rejects.toThrow('disposed')
    old.dispose()
    await disposed
    vi.resetModules()
    const reloaded = await import('../src/ebao-runtime-bridge.ts')
    const fresh = nativeHost(reloaded.installEbaoRuntime)
    const current = fresh.runtime.publisher.request('accounts.list')
    const currentId = fresh.sent[0]!.requestId
    expect(currentId).toBeGreaterThan(oldId)
    const before = fresh.runtime.publisher.status()
    let settled = false
    void current.then(() => { settled = true })
    process.emit('message', { type: 'ebao-native-result', requestId: oldId, value: 'stale', publisher: { supported: false, running: false } }, undefined)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(fresh.runtime.publisher.status()).toEqual(before)
    process.emit('message', { type: 'ebao-native-result', requestId: currentId, value: ['fresh'], publisher: { supported: true, running: true } }, undefined)
    await expect(current).resolves.toEqual(['fresh'])
    expect(fresh.runtime.publisher.status()).toEqual({ supported: true, running: true })
  })

})
