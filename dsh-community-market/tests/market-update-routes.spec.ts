import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { MemoryMarketStateStore } from '../src/catalog/state-store.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'
import type { MarketDesktopPluginBundle } from '../src/host/routes.js'
import type { MarketInstallService } from '../src/install/service.js'

type Handler = (req: any, res: any) => Promise<void>
const removable = { bundleId: 'profile_plugin', packageName: 'dsh-plugin-test', status: 'active', mutable: true, uninstallable: true } as const
const shipped = { bundleId: 'shipped_plugin', packageName: 'cqai-dsh-plugin-imagegen', status: 'active', mutable: false, uninstallable: false } as const

function fixture() {
  const handlers = new Map<string, Handler>()
  let bundles: readonly MarketDesktopPluginBundle[] = [removable, shipped]
  const checkUpdates = vi.fn(async () => ({ checkedAt: '2026-10-14T00:00:00Z', updates: [{
    ...removable, currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true,
  }] }))
  const previewUpdatePackage = vi.fn(async (packageName: string) => ({
    intent: 'preview_once', action: 'update', packageName, profileName: 'desktop',
    currentVersion: '1.0.0', version: '1.1.0', displayName: packageName, expiresAt: '2099-01-01T00:00:00Z',
  }))
  const executePreview = vi.fn(async () => ({ action: 'update', packageName: removable.packageName, version: '1.1.0', restartToken: 'restart_once' }))
  const service = { checkUpdates, previewUpdatePackage, executePreview } as unknown as MarketInstallService
  const dispose = registerMarketRoutes({
    webServer: { port: 43120, register: (route: { path: string; handler: Handler }) => {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    } },
  } as never, new MemoryMarketStateStore(), { get: () => service }, undefined, {
    get: () => ({ list: () => bundles }),
  })

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
  return { checkUpdates, previewUpdatePackage, executePreview, request, dispose, setBundles: (value: readonly MarketDesktopPluginBundle[]) => { bundles = value } }
}

describe('market update authority and preview routes', () => {
  it('derives update targets from mutable removable bundles and accepts a force check', async () => {
    const test = fixture()
    try {
      expect(await test.request(`${marketRoutes.updates}?force=1`)).toMatchObject({ status: 200, body: { updates: [{ latestVersion: '1.1.0' }] } })
      expect(test.checkUpdates).toHaveBeenCalledWith([{ bundleId: removable.bundleId, packageName: removable.packageName }], expect.any(AbortSignal), true)
      await test.request(marketRoutes.updates)
      expect(test.checkUpdates).toHaveBeenLastCalledWith(expect.any(Array), expect.any(AbortSignal), false)
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
      expect(test.checkUpdates).not.toHaveBeenCalled()
    } finally { test.dispose() }
  })

  it('binds preview to an opaque inventory id and returns both reviewed versions', async () => {
    const test = fixture()
    try {
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', bundleId: removable.bundleId } })).toMatchObject({
        status: 200, body: { action: 'update', currentVersion: '1.0.0', version: '1.1.0', previewId: 'preview_once' },
      })
      expect(test.previewUpdatePackage).toHaveBeenCalledExactlyOnceWith(removable.packageName, expect.any(AbortSignal))
    } finally { test.dispose() }
  })

  it('rejects shipped or stale identities and cannot choose a version from the renderer', async () => {
    const test = fixture()
    try {
      for (const bundleId of [shipped.bundleId, 'old_generation']) {
        expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', bundleId } })).toMatchObject({ status: 404 })
      }
      for (const extra of [{ version: '9.0.0' }, { packageName: 'other' }]) {
        expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', bundleId: removable.bundleId, ...extra } })).toMatchObject({ status: 400 })
      }
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', origin: 'https://evil.example', body: { action: 'update', bundleId: removable.bundleId } })).toMatchObject({ status: 405 })
      expect(test.previewUpdatePackage).not.toHaveBeenCalled()
    } finally { test.dispose() }
  })

  it('rejects invalid inventory before checking or previewing any package', async () => {
    const test = fixture()
    try {
      test.setBundles([removable, removable])
      expect(await test.request(marketRoutes.updates)).toMatchObject({ status: 502 })
      expect(await test.request(marketRoutes.operationPreview, { method: 'POST', body: { action: 'update', bundleId: removable.bundleId } })).toMatchObject({ status: 502 })
      expect(test.checkUpdates).not.toHaveBeenCalled()
      expect(test.previewUpdatePackage).not.toHaveBeenCalled()
    } finally { test.dispose() }
  })

  it('executes only a preview token and returns the restart grant for a completed update', async () => {
    const test = fixture()
    try {
      expect(await test.request(marketRoutes.operationExecute, { method: 'POST', body: { previewId: 'preview_once' } })).toMatchObject({ status: 200, body: { action: 'update', restartToken: 'restart_once' } })
      expect(test.executePreview).toHaveBeenCalledExactlyOnceWith('preview_once', expect.any(AbortSignal))
      expect(await test.request(marketRoutes.operationExecute, { method: 'POST', body: { previewId: 'preview_once', version: '8.0.0' } })).toMatchObject({ status: 400 })
    } finally { test.dispose() }
  })
})
