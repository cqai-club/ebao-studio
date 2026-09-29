import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { registerPluginManagementRoutes, type DesktopPlugins } from '../src/plugin-management-routes.js'

const PREFIX = '/api/cqai-plugin-management'
type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

const bundles: Array<{
  bundleId: string
  packageName: string
  status: 'active' | 'disabled'
  mutable: boolean
  uninstallable: boolean
}> = [
  { bundleId: 'bundle-activities', packageName: '@cqaiclub/dsh-plugin-activities', status: 'active', mutable: true, uninstallable: true },
  { bundleId: 'bundle-imagegen', packageName: 'cqai-dsh-plugin-imagegen', status: 'active', mutable: true, uninstallable: false },
  { bundleId: 'bundle-video', packageName: 'cqai-dsh-plugin-video', status: 'disabled', mutable: true, uninstallable: false },
  { bundleId: 'bundle-theme', packageName: 'cqai-dsh-plugin-cqai-club-theme', status: 'active', mutable: true, uninstallable: false },
  { bundleId: 'bundle-protected', packageName: '@cqaiclub/dsn-account', status: 'active', mutable: false, uninstallable: false },
  { bundleId: 'bundle-external', packageName: 'third-party-plugin', status: 'active', mutable: true, uninstallable: true },
]

function fixture() {
  const current = [...bundles]
  const previewDisable = vi.fn((bundleId: string) => ({
    previewId: `disable_${'a'.repeat(43)}`,
    packageName: current.find(bundle => bundle.bundleId === bundleId)?.packageName ?? '',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }))
  const previewEnable = vi.fn((bundleId: string) => ({
    previewId: `enable_${'b'.repeat(43)}`,
    packageName: current.find(bundle => bundle.bundleId === bundleId)?.packageName ?? '',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }))
  const executeDisable = vi.fn(async (_previewId: string) => ({ action: 'disable', packageName: 'cqai-dsh-plugin-imagegen' }))
  const executeEnable = vi.fn(async (_previewId: string) => ({ action: 'enable', packageName: 'cqai-dsh-plugin-video' }))
  const plugins: DesktopPlugins = {
    list: () => current,
    loadedPackageNames: () => [
      '@cqaiclub/dsh-plugin-activities', 'cqai-dsh-plugin-imagegen', 'cqai-dsh-plugin-publisher',
      'cqai-dsh-plugin-cqai-club-theme', '@cqaiclub/dsn-account', 'third-party-plugin',
    ],
    previewDisable,
    executeDisable,
    previewEnable,
    executeEnable,
  }
  return { current, plugins, previewDisable, previewEnable, executeDisable, executeEnable }
}

async function startServer(plugins: DesktopPlugins) {
  const routes = new Map<string, RouteHandler>()
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch(error => {
      res.statusCode = 500
      res.end(error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  const ctx = {
    webServer: {
      port,
      register: (route: { readonly path: string; readonly handler: RouteHandler }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  } as unknown as Context
  const dispose = registerPluginManagementRoutes(ctx, plugins)
  const baseUrl = `http://127.0.0.1:${port}`
  return {
    baseUrl,
    close: async () => {
      dispose()
      await new Promise<void>((resolve, reject) => {
        server.close(error => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}

async function post(baseUrl: string, path: string, value: unknown, origin = baseUrl): Promise<Response> {
  return await fetch(`${baseUrl}${PREFIX}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
}

describe('CQAI plugin management Host routes', () => {
  it('lists only shipped product bundles and their loaded package names', async () => {
    const harness = await startServer(fixture().plugins)
    try {
      const response = await fetch(`${harness.baseUrl}${PREFIX}/bundles`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        bundles: [bundles[1], bundles[2], bundles[3]],
        loadedPackageNames: ['cqai-dsh-plugin-imagegen', 'cqai-dsh-plugin-publisher', 'cqai-dsh-plugin-cqai-club-theme'],
      })
    } finally {
      await harness.close()
    }
  })

  it('previews and executes a product disable or enable once', async () => {
    const service = fixture()
    const harness = await startServer(service.plugins)
    try {
      const disable = await post(harness.baseUrl, '/preview', { action: 'disable', bundleId: 'bundle-imagegen' })
      expect(disable.status).toBe(200)
      const disablePreview = await disable.json() as { previewId: string }
      expect(service.previewDisable).toHaveBeenCalledOnce()
      expect(service.previewDisable).toHaveBeenCalledWith('bundle-imagegen')

      const executed = await post(harness.baseUrl, '/execute', { action: 'disable', previewId: disablePreview.previewId })
      expect(executed.status).toBe(200)
      expect(await executed.json()).toEqual({ action: 'disable', packageName: 'cqai-dsh-plugin-imagegen' })
      expect(service.executeDisable).toHaveBeenCalledOnce()
      expect(service.executeDisable).toHaveBeenCalledWith(disablePreview.previewId)

      const replay = await post(harness.baseUrl, '/execute', { action: 'disable', previewId: disablePreview.previewId })
      expect(replay.status).toBe(400)
      expect(service.executeDisable).toHaveBeenCalledOnce()

      const enable = await post(harness.baseUrl, '/preview', { action: 'enable', bundleId: 'bundle-video' })
      expect(enable.status).toBe(200)
      const enablePreview = await enable.json() as { previewId: string }
      expect(service.previewEnable).toHaveBeenCalledOnce()
      expect(service.previewEnable).toHaveBeenCalledWith('bundle-video')
      const enabled = await post(harness.baseUrl, '/execute', { action: 'enable', previewId: enablePreview.previewId })
      expect(enabled.status).toBe(200)
      expect(service.executeEnable).toHaveBeenCalledOnce()
      expect(service.executeEnable).toHaveBeenCalledWith(enablePreview.previewId)
    } finally {
      await harness.close()
    }
  })

  it('rejects protected, third-party, unknown, and removable targets before preview', async () => {
    const service = fixture()
    service.current.push({
      bundleId: 'bundle-removable-product',
      packageName: 'cqai-dsh-plugin-short-video',
      status: 'active',
      mutable: true,
      uninstallable: true,
    })
    const harness = await startServer(service.plugins)
    try {
      for (const bundleId of ['bundle-protected', 'bundle-external', 'missing', 'bundle-removable-product']) {
        const response = await post(harness.baseUrl, '/preview', { action: 'disable', bundleId })
        expect(response.status).toBe(400)
      }
      expect(service.previewDisable).not.toHaveBeenCalled()
    } finally {
      await harness.close()
    }
  })

  it('rejects unissued and mismatched preview tokens without executing them', async () => {
    const service = fixture()
    const harness = await startServer(service.plugins)
    try {
      const foreign = await post(harness.baseUrl, '/execute', { action: 'disable', previewId: 'foreign-token' })
      expect(foreign.status).toBe(400)

      const preview = await post(harness.baseUrl, '/preview', { action: 'disable', bundleId: 'bundle-imagegen' })
      const { previewId } = await preview.json() as { previewId: string }
      const wrongAction = await post(harness.baseUrl, '/execute', { action: 'enable', previewId })
      expect(wrongAction.status).toBe(400)
      expect(service.executeDisable).not.toHaveBeenCalled()
      expect(service.executeEnable).not.toHaveBeenCalled()
    } finally {
      await harness.close()
    }
  })

  it('rechecks the product target before executing a previously valid preview', async () => {
    const service = fixture()
    const harness = await startServer(service.plugins)
    try {
      const preview = await post(harness.baseUrl, '/preview', { action: 'disable', bundleId: 'bundle-imagegen' })
      const { previewId } = await preview.json() as { previewId: string }
      service.current.splice(service.current.findIndex(bundle => bundle.bundleId === 'bundle-imagegen'), 1)
      const response = await post(harness.baseUrl, '/execute', { action: 'disable', previewId })
      expect(response.status).toBe(400)
      expect(service.executeDisable).not.toHaveBeenCalled()
    } finally {
      await harness.close()
    }
  })

  it('rejects cross-origin POSTs before calling the Desktop plugin service', async () => {
    const service = fixture()
    const harness = await startServer(service.plugins)
    try {
      const preview = await post(harness.baseUrl, '/preview', { action: 'disable', bundleId: 'bundle-imagegen' }, 'https://attacker.example')
      expect(preview.status).toBe(405)
      const execute = await post(harness.baseUrl, '/execute', { action: 'disable', previewId: 'foreign-token' }, 'https://attacker.example')
      expect(execute.status).toBe(405)
      expect(service.previewDisable).not.toHaveBeenCalled()
      expect(service.executeDisable).not.toHaveBeenCalled()
    } finally {
      await harness.close()
    }
  })
})
