import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { MemoryMarketStateStore } from '../src/catalog/state-store.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'
import type { MarketInstallationView } from '../src/api-types.js'
import { MarketInstallError } from '../src/install/service.js'
import type { MarketInstallService } from '../src/install/service.js'

type Handler = (req: any, res: any) => Promise<void>
const removable = { kind: 'profile', packageName: 'dsh-plugin-test', version: '1.0.0', installed: true, enabled: true, toggleable: true, removable: true, updatable: true } as const
const shipped = { ...removable, packageName: 'cqai-dsh-plugin-imagegen', removable: false, updatable: false } as const

function fixture() {
  const handlers = new Map<string, Handler>()
  let bundles: readonly MarketInstallationView[] = [removable, shipped]
  const listInstallations = vi.fn(async () => bundles)
  const checkUpdate = vi.fn(async () => ({ status: 'available', installed: '1.0.0', version: '1.1.0' }))
  const previewUpdatePackage = vi.fn(async (packageName: string) => ({
    intent: 'preview_once', action: 'update', packageName, profileName: 'desktop',
    fromVersion: '1.0.0', version: '1.1.0', displayName: packageName, expiresAt: '2099-01-01T00:00:00Z',
  }))
  const executePreview = vi.fn(async () => ({ action: 'update', packageName: removable.packageName, version: '1.1.0', fromVersion: '1.0.0', outcome: 'updated', application: 'applied' }))
  const service = { listInstallations, checkUpdate, previewUpdatePackage, executePreview } as unknown as MarketInstallService
  const dispose = registerMarketRoutes({
    webServer: { port: 43120, register: (route: { path: string; handler: Handler }) => {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    } },
  } as never, new MemoryMarketStateStore(), { get: () => service }, undefined)

  async function request(path: string, options: { method?: string; body?: unknown; remoteAddress?: string; origin?: string } = {}) {
    const req = Object.assign(new EventEmitter(), {
      method: options.method ?? 'GET', url: path,
      headers: { host: '127.0.0.1:43120', origin: options.origin ?? 'http://127.0.0.1:43120', 'sec-fetch-site': 'same-origin' },
      socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' }, destroy: vi.fn(),
    })
    let body = ''
    const res = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false, statusCode: 0,
      setHeader: vi.fn(), removeHeader: vi.fn(),
      end: (value?: string) => { body = value ?? ''; res.writableEnded = true },
    })
    const pending = handlers.get(path.split('?')[0]!)!(req, res)
    if (options.body !== undefined) queueMicrotask(() => {
      req.emit('data', JSON.stringify(options.body)); req.emit('end')
    })
    await pending
    return { status: res.statusCode, body: body === '' ? undefined : JSON.parse(body) }
  }
  return { checkUpdate, listInstallations, previewUpdatePackage, executePreview, request, dispose, setBundles: (value: readonly MarketInstallationView[]) => { bundles = value } }
}

describe('market update authority and preview routes', () => {
  it('derives update targets from official updatable community bundles and accepts a force check', async () => {
    const test = fixture()
    try {
      expect(await test.request(`${marketRoutes.updates}?force=1`)).toMatchObject({ status: 200, body: { updates: [{ latestVersion: '1.1.0' }] } })
      expect(test.checkUpdate).toHaveBeenCalledExactlyOnceWith(removable.packageName, expect.any(AbortSignal))
      await test.request(marketRoutes.updates)
      expect(test.checkUpdate).toHaveBeenCalledTimes(2)
    } finally { test.dispose() }
  })

  it('rejects injected package targets, duplicate force values and nonlocal checks', async () => {
    const test = fixture()
    try {
      for (const query of ['?packageName=other', '?force=0', '?force=1&force=1']) {
        expect(await test.request(marketRoutes.updates + query)).toMatchObject({ status: 400, body: { code: 'invalid-request' } })
      }
      expect(await test.request(marketRoutes.updates, { remoteAddress: '192.0.2.1' })).toMatchObject({ status: 405 })
      expect(await test.request(marketRoutes.updates, { method: 'POST' })).toMatchObject({ status: 405 })
      expect(test.checkUpdate).not.toHaveBeenCalled()
    } finally { test.dispose() }
  })

  it('asks the official manager to preview a package identity and returns both reviewed versions', async () => {
    const test = fixture()
    try {
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', packageName: removable.packageName } })).toMatchObject({
        status: 200, body: { action: 'update', fromVersion: '1.0.0', version: '1.1.0', previewId: 'preview_once' },
      })
      expect(test.previewUpdatePackage).toHaveBeenCalledExactlyOnceWith(removable.packageName, expect.any(AbortSignal))
    } finally { test.dispose() }
  })

  it('cannot choose the version or registry from the renderer and enforces local origin', async () => {
    const test = fixture()
    try {
      for (const extra of [{ version: '9.0.0' }, { registry: 'https://other.example' }]) {
        expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', packageName: removable.packageName, ...extra } })).toMatchObject({ status: 400 })
      }
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', origin: 'https://evil.example', body: { action: 'update', packageName: removable.packageName } })).toMatchObject({ status: 405 })
      expect(test.previewUpdatePackage).not.toHaveBeenCalled()
    } finally { test.dispose() }
  })

  it('propagates a manager refusal instead of accepting a stale package', async () => {
    const test = fixture()
    test.previewUpdatePackage.mockRejectedValue(new MarketInstallError('not-available', 'No longer updatable'))
    try {
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', packageName: removable.packageName } })).toMatchObject({ status: 404 })
    } finally { test.dispose() }
  })

  it('executes only a preview token and returns the official application result for a completed update', async () => {
    const test = fixture()
    try {
      expect(await test.request(marketRoutes.operationExecute, { method: 'POST', body: { previewId: 'preview_once' } })).toMatchObject({ status: 200, body: { action: 'update', fromVersion: '1.0.0', outcome: 'updated', application: 'applied' } })
      expect(test.executePreview).toHaveBeenCalledExactlyOnceWith('preview_once', expect.any(AbortSignal))
      expect(await test.request(marketRoutes.operationExecute, { method: 'POST', body: { previewId: 'preview_once', version: '8.0.0' } })).toMatchObject({ status: 400 })
    } finally { test.dispose() }
  })
})
