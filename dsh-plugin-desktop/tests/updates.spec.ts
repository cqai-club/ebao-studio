import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionRequestRejection,
  ConnectionTrustRequest,
} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopNotification,
  DesktopRuntime,
  DesktopTrayItem,
} from '../src/runtime.ts'
import {
  DESKTOP_RELEASE_CHANNEL_HEADER,
  type UpdateCheckResult,
} from '../src/update-checker.ts'
import { DESKTOP_UPDATE_CHECK_PATH } from '../src/desktop-settings-contract.ts'
import { DESKTOP_UPDATE_STATUS_PATH, type DesktopUpdateStatus } from '../src/desktop-update-status.ts'
import { apply, Config, inject, type Config as UpdateConfig } from '../src/updates.ts'

const testConfig: UpdateConfig = {
  enabled: true,
  initialDelayMs: 10,
  intervalMs: 1000,
  requestTimeoutMs: 1000,
}

function versionResponse(version: unknown): Response {
  return Response.json({ version })
}

interface Harness {
  readonly statePath: string
  readonly tray: DesktopTrayItem
  readonly trays: readonly DesktopTrayItem[]
  readonly notifications: DesktopNotification[]
  readonly warnings: unknown[][]
  readonly confirmDownload: ReturnType<typeof vi.fn>
  readonly showManualCheckResult: ReturnType<typeof vi.fn>
  readonly downloadAndInstall: ReturnType<typeof vi.fn>
  readonly registerNotificationAction: ReturnType<typeof vi.fn>
  readonly notificationActionRelease: ReturnType<typeof vi.fn>
  clickUpdateNotification(): Promise<void>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly registrationDispose: ReturnType<typeof vi.fn>
  readonly requestRejection: ReturnType<typeof vi.fn<(
    request: ConnectionTrustRequest,
  ) => ConnectionRequestRejection>>
  readonly route: WebRoute
  readonly statusRoute: WebRoute
  readonly routeDisposers: readonly ReturnType<typeof vi.fn>[]
  dispose(): Promise<void>
}

async function createHarness(options: {
  readonly packaged?: boolean
  readonly canDownload?: boolean
  readonly config?: UpdateConfig
  readonly request?: DesktopRuntime['updates']['request']
  readonly releaseChannel?: 'stable' | 'beta'
  readonly currentVersion?: string
  readonly confirmDownload?: (version: string, channel?: 'stable' | 'beta') => Promise<boolean>
  readonly showManualCheckResult?: (result: UpdateCheckResult | null) => Promise<void>
  readonly downloadAndInstall?: (version: string, signal: AbortSignal, channel?: 'stable' | 'beta') => Promise<void>
  readonly notify?: (notification: DesktopNotification) => void
  readonly locale?: DesktopRuntime['locale']
  readonly state?: string
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updates-'))
  const statePath = join(root, 'private', 'state.json')
  if (options.state !== undefined) {
    await mkdir(join(root, 'private'), { recursive: true })
    await writeFile(statePath, options.state, { mode: 0o600 })
  }
  const notifications: DesktopNotification[] = []
  const warnings: unknown[][] = []
  const refresh = vi.fn()
  const registrationDispose = vi.fn()
  const confirmDownload = vi.fn(options.confirmDownload ?? (async () => false))
  const showManualCheckResult = vi.fn(options.showManualCheckResult ?? (async () => {}))
  const downloadAndInstall = vi.fn(options.downloadAndInstall ?? (async () => {}))
  const notificationActionRelease = vi.fn()
  let notificationAction: (() => void | Promise<void>) | undefined
  const registerNotificationAction = vi.fn((_action: 'open-update', handler: () => void | Promise<void>) => {
    notificationAction = handler
    return notificationActionRelease
  })
  const requestRejection = vi.fn<(
    request: ConnectionTrustRequest,
  ) => ConnectionRequestRejection>(() => undefined)
  let tray: DesktopTrayItem | undefined
  const trays: DesktopTrayItem[] = []
  const routes = new Map<string, WebRoute>()
  const routeDisposers: ReturnType<typeof vi.fn>[] = []
  let disposer: (() => void | Promise<void>) | undefined
  const runtime = {
    locale: options.locale ?? 'en',
    updates: {
      isPackaged: options.packaged ?? true,
      currentVersion: options.currentVersion ?? '2.0.0',
      ...(options.releaseChannel === undefined ? {} : { releaseChannel: options.releaseChannel }),
      statePath,
      canDownload: options.canDownload ?? true,
      request: options.request ?? (async () => versionResponse('2.0.0')),
      confirmDownload,
      showManualCheckResult,
      downloadAndInstall,
      registerNotificationAction,
      notify: options.notify ?? ((notification: DesktopNotification) => { notifications.push(notification) }),
    },
    registerTrayItem: (item: DesktopTrayItem) => {
      tray ??= item
      trays.push(item)
      return { refresh, dispose: registrationDispose }
    },
  } as unknown as DesktopRuntime
  const ctx = {
    desktopRuntime: runtime,
    webServer: {
      port: 43120,
      register: (registered: WebRoute) => {
        routes.set(registered.path, registered)
        const unregister = vi.fn()
        routeDisposers.push(unregister)
        return unregister
      },
    },
    connection: { requestRejection },
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    effect: (register: () => (() => void | Promise<void>)) => {
      disposer = register()
      return disposer
    },
  } as unknown as Context

  apply(ctx, options.config ?? testConfig)
  if (tray === undefined) throw new Error('Update tray item was not registered.')
  const route = routes.get(DESKTOP_UPDATE_CHECK_PATH)
  const statusRoute = routes.get(DESKTOP_UPDATE_STATUS_PATH)
  if (route === undefined || statusRoute === undefined) throw new Error('Update routes were not registered.')
  return {
    statePath,
    tray,
    trays,
    notifications,
    warnings,
    confirmDownload,
    showManualCheckResult,
    downloadAndInstall,
    registerNotificationAction,
    notificationActionRelease,
    clickUpdateNotification: async () => { await notificationAction?.() },
    refresh,
    registrationDispose,
    requestRejection,
    route,
    statusRoute,
    routeDisposers,
    dispose: async () => { await disposer?.() },
  }
}

function statusRequest(headers: IncomingMessage['headers'] = {}): IncomingMessage {
  return {
    method: 'GET',
    headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage
}

async function readStatus(harness: Harness): Promise<DesktopUpdateStatus> {
  let body = ''
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => { body = value ?? '' }),
  } as unknown as ServerResponse
  await harness.statusRoute.handler(statusRequest(), res)
  expect(res.statusCode).toBe(200)
  return JSON.parse(body) as DesktopUpdateStatus
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop update Host plugin', () => {
  it.each([true, false])('reads a supported=%s idle snapshot without polling or prompting', async canDownload => {
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ packaged: false, canDownload, request })

    expect(harness.statusRoute.path).toBe('/api/desktop/updates/status')
    for (let read = 0; read < 3; read++) {
      expect(await readStatus(harness)).toEqual({
        supported: canDownload, currentVersion: '2.0.0', availableVersion: null, checking: false, downloading: false,
      })
    }
    expect(request).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    await harness.dispose()
  })

  it('reflects an in-flight check without starting another version request', async () => {
    let finishCheck!: (response: Response) => void
    const request = vi.fn(() => new Promise<Response>(resolve => { finishCheck = resolve }))
    const harness = await createHarness({ packaged: false, request })
    const checking = harness.tray.invoke()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })

    expect(await readStatus(harness)).toEqual({
      supported: true, currentVersion: '2.0.0', availableVersion: null, checking: true, downloading: false,
    })
    expect(request).toHaveBeenCalledOnce()
    finishCheck(versionResponse('2.0.0'))
    await checking
    expect((await readStatus(harness)).checking).toBe(false)
    await harness.dispose()
  })

  it.each(['complete', 'failed'] as const)('keeps an available update after confirmation cancellation and a %s download', async outcome => {
    let finishDownload!: () => void
    let failDownload!: (cause: Error) => void
    const download = new Promise<void>((resolve, reject) => { finishDownload = resolve; failDownload = reject })
    const confirmDownload = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ packaged: false, request, confirmDownload, downloadAndInstall: async () => download })

    await harness.tray.invoke()
    expect(await readStatus(harness)).toEqual({
      supported: true, currentVersion: '2.0.0', availableVersion: '2.1.0', checking: false, downloading: false,
    })
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    const accepted = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndInstall).toHaveBeenCalledOnce() })
    expect(await readStatus(harness)).toEqual({
      supported: true, currentVersion: '2.0.0', availableVersion: '2.1.0', checking: false, downloading: true,
    })
    expect(request).toHaveBeenCalledTimes(2)
    if (outcome === 'complete') finishDownload()
    else failDownload(new Error('private download error /private/state'))
    await accepted

    expect(await readStatus(harness)).toEqual({
      supported: true, currentVersion: '2.0.0', availableVersion: '2.1.0', checking: false, downloading: false,
    })
    expect(request).toHaveBeenCalledTimes(2)
    await harness.dispose()
  })

  it.each([401, 403] as const)('applies Connection %i rejection before reading update status', async rejection => {
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ packaged: false, request })
    harness.requestRejection.mockReturnValue(rejection)
    const req = statusRequest()
    const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse

    await harness.statusRoute.handler(req, res)

    expect(harness.requestRejection).toHaveBeenCalledWith(req)
    expect(res.writeHead).toHaveBeenCalledWith(rejection)
    expect(res.end).toHaveBeenCalledWith(rejection === 401 ? 'unauthorized' : 'forbidden')
    expect(request).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    await harness.dispose()
  })

  it('releases both routes and hides stale availability immediately when the generation is disposed', async () => {
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ packaged: false, request })
    await harness.tray.invoke()
    expect((await readStatus(harness)).availableVersion).toBe('2.1.0')

    await harness.dispose()
    await harness.dispose()

    expect(harness.routeDisposers).toHaveLength(2)
    for (const unregister of harness.routeDisposers) expect(unregister).toHaveBeenCalledOnce()
    expect(await readStatus(harness)).toEqual({
      supported: false, currentVersion: '2.0.0', availableVersion: null, checking: false, downloading: false,
    })
    await harness.tray.invoke()
    expect(request).toHaveBeenCalledOnce()
  })

  it('checks Beta automatically and installs an older stable release only through the explicit action', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const channel = new Headers(init.headers).get(DESKTOP_RELEASE_CHANNEL_HEADER)
      return Response.json(channel === 'beta'
        ? { version: '2.0.6-beta.1', channel: 'beta' }
        : { version: '2.0.4', channel: 'stable' })
    })
    const harness = await createHarness({
      releaseChannel: 'beta',
      currentVersion: '2.0.6-beta.1',
      request,
      confirmDownload: async () => true,
    })

    expect(harness.trays).toHaveLength(2)
    await harness.tray.invoke()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()

    await harness.trays[1]!.invoke()
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.0.4', 'stable')
    expect(harness.downloadAndInstall).toHaveBeenCalledWith(
      '2.0.4',
      expect.any(AbortSignal),
      'stable',
    )
    const channels = request.mock.calls.map(([, init]) => new Headers(init.headers).get(DESKTOP_RELEASE_CHANNEL_HEADER))
    expect(channels).toContain('beta')
    expect(channels).toContain('stable')
    await harness.dispose()
  })

  it('exposes the packaged 60-second and six-hour background policy', () => {
    expect(inject).toEqual(['desktopRuntime', 'webServer', 'connection'])
    expect(Config({} as UpdateConfig)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
    expect(() => Config({ intervalMs: 0 } as UpdateConfig)).toThrow()
    expect(() => Config({ requestTimeoutMs: 0 } as UpdateConfig)).toThrow()
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
  ] as const)('applies the Connection %i rejection before the interactive update route', async (
    status,
    body,
  ) => {
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ packaged: false, request })
    harness.requestRejection.mockReturnValue(status)
    const req = { headers: {} } as IncomingMessage
    const writeHead = vi.fn()
    const end = vi.fn()
    const res = { writeHead, end } as unknown as ServerResponse

    await harness.route.handler(req, res)

    expect(harness.requestRejection).toHaveBeenCalledWith(req)
    expect(writeHead).toHaveBeenCalledWith(status)
    expect(end).toHaveBeenCalledWith(body)
    expect(request).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    await harness.dispose()
  })

  it('passes an authenticated interactive update request to the existing route handler', async () => {
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ packaged: false, request })
    const req = {
      method: 'POST',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
      async * [Symbol.asyncIterator]() { yield Buffer.from('{}') },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await harness.route.handler(req, res)

    expect(harness.requestRejection).toHaveBeenCalledWith(req)
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ accepted: true })
    await harness.dispose()
  })

  it('renders the update tray command in the active native locale', async () => {
    const harness = await createHarness({ packaged: false, locale: 'zh' })

    expect(harness.tray.label()).toBe('检查更新…')

    await harness.dispose()
  })

  it.each([
    { packaged: false, enabled: true },
    { packaged: true, enabled: false },
  ])('reports a manual up-to-date result while automatic polling is disabled: %#', async ({ packaged, enabled }) => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({
      packaged,
      request,
      config: { ...testConfig, enabled },
    })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    expect(request).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Check for Updates…')
    await harness.tray.invoke()
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('announces a background update once without opening a confirmation dialog', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ request })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => {
      expect(harness.notifications).toEqual([{
        title: 'e宝工坊 Update Available',
        body: 'Version 2.1.0 is ready to download. Click this notification to review the update.',
        action: 'open-update',
      }])
    })
    expect(harness.registerNotificationAction).toHaveBeenCalledWith('open-update', expect.any(Function))
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })
    if (process.platform !== 'win32') {
      expect((await stat(harness.statePath)).mode & 0o777).toBe(0o600)
    }

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.notifications).toHaveLength(1)
    expect(harness.warnings).toEqual([])
  })

  it('clicking the background update notification reuses confirmation and recheck', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({
      request,
      confirmDownload: async () => true,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.notifications).toHaveLength(1) })
    await harness.clickUpdateNotification()

    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0')
    expect(harness.downloadAndInstall).toHaveBeenCalledWith('2.1.0', expect.any(AbortSignal))
  })

  it('coalesces repeated notification clicks into one confirmation and download', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const pendingDownload = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndInstall: async () => pendingDownload,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.notifications).toHaveLength(1) })
    const firstClick = harness.clickUpdateNotification()
    const secondClick = harness.clickUpdateNotification()
    await vi.waitFor(() => {
      expect(harness.confirmDownload).toHaveBeenCalledOnce()
      expect(harness.downloadAndInstall).toHaveBeenCalledOnce()
    })

    resolveDownload()
    await Promise.all([firstClick, secondClick])
  })

  it('does not download when the notification confirmation is cancelled', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => false,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.notifications).toHaveLength(1) })
    await harness.clickUpdateNotification()

    expect(harness.confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('downloads and opens only after confirmation', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndInstall: async () => download,
    })

    const pending = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndInstall).toHaveBeenCalledOnce() })
    const [version, signal] = harness.downloadAndInstall.mock.calls[0] as [string, AbortSignal]
    expect(version).toBe('2.1.0')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(harness.tray.label()).toBe('Downloading e宝工坊 2.1.0…')
    expect(harness.notifications).toEqual([])

    resolveDownload()
    await pending
    await vi.waitFor(() => { expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available') })
    expect(harness.notifications).toEqual([])
    expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available')
  })

  it('rechecks a digest-bearing manifest before invoking the native updater', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    const harness = await createHarness({
      packaged: false,
      request: async () => {
        requestCount += 1
        return Response.json({ version: '2.1.0', sha256: { windows: 'c'.repeat(64), mac: 'd'.repeat(64) } })
      },
      confirmDownload: async () => true,
    })

    const pending = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndInstall).toHaveBeenCalledOnce() })
    expect(requestCount).toBe(2)
    expect(harness.downloadAndInstall).toHaveBeenCalledWith('2.1.0', expect.any(AbortSignal))
    await pending
  })

  it('treats a manual available-version selection as a fresh confirmation', async () => {
    const confirmDownload = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload,
    })

    await harness.tray.invoke()
    expect(confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available')

    await harness.tray.invoke()
    expect(confirmDownload).toHaveBeenCalledTimes(2)
    expect(harness.downloadAndInstall).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
  })

  it('rechecks the version after confirmation and skips a rotated download', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(versionResponse('2.1.0'))
      .mockResolvedValueOnce(versionResponse('2.2.0'))
    const harness = await createHarness({
      packaged: false,
      request,
      confirmDownload: async () => true,
    })

    await harness.tray.invoke()

    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0')
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e宝工坊 2.2.0 Available')
  })

  it.each([
    ['up-to-date', async () => versionResponse('2.0.0')],
    ['failed', async () => new Response('unavailable', { status: 503 })],
  ] as const)('keeps an automatic %s result silent', async (_case, request) => {
    vi.useFakeTimers()
    const requestSpy = vi.fn(request)
    const harness = await createHarness({ request: requestSpy })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(requestSpy).toHaveBeenCalledOnce() })

    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
  })

  it.each([
    ['same version', async () => versionResponse('2.0.0'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '2.0.0',
    }],
    ['older version', async () => versionResponse('1.9.9'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '1.9.9',
    }],
    ['invalid version', async () => versionResponse('v2.1.0'), null],
    ['service unavailable', async () => new Response('unavailable', { status: 503 }), null],
    ['network failure', async () => { throw new TypeError('offline') }, null],
  ] as const)('reports a manual %s result without prompting or downloading', async (_case, request, expected) => {
    const harness = await createHarness({ packaged: false, request })

    await harness.tray.invoke()

    expect(harness.showManualCheckResult).toHaveBeenCalledWith(expected)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('silently resets invalid legacy state before announcing the available version', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      state: JSON.stringify({
        version: 1,
        checkedVersion: '2.0.0',
        etag: '"legacy"',
        lastNotifiedVersion: '2.1.0',
        availableRelease: {
          tagName: 'v2.1.0',
          version: '2.1.0',
          htmlUrl: 'https://example.test/legacy',
        },
      }),
    })

    expect(harness.tray.label()).toBe('Check for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.notifications).toHaveLength(1) })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })
    expect(harness.warnings).toEqual([])
  })

  it('migrates v2 prompt history without repeating the same background announcement', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      state: JSON.stringify({ version: 2, lastPromptedVersion: '2.1.0' }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })

    expect(harness.notifications).toEqual([])
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available')
  })

  it('does not prompt on a platform without a fixed download entry', async () => {
    const harness = await createHarness({
      packaged: false,
      canDownload: false,
      request: async () => versionResponse('2.1.0'),
    })

    await harness.tray.invoke()

    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'update-available',
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(harness.downloadAndInstall).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('shares one pending download and silently restores availability after failure', async () => {
    let rejectDownload!: (cause: Error) => void
    const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndInstall: async () => download,
    })

    const first = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndInstall).toHaveBeenCalledOnce() })
    const second = harness.tray.invoke()
    expect(harness.downloadAndInstall).toHaveBeenCalledOnce()
    rejectDownload(new Error('offline'))
    await Promise.all([first, second])

    expect(harness.downloadAndInstall).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('e宝工坊 2.1.0 Available')
  })

  it('aborts checks and downloads and removes the tray item on effect disposal', async () => {
    let checkSignal: AbortSignal | undefined
    const checking = await createHarness({
      packaged: false,
      request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        checkSignal = init.signal as AbortSignal
        checkSignal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingCheck = checking.tray.invoke()
    await vi.waitFor(() => { expect(checkSignal).toBeDefined() })
    await checking.dispose()
    expect(await readStatus(checking)).toEqual({ supported: false, currentVersion: '2.0.0', availableVersion: null, checking: false, downloading: false })
    await pendingCheck
    expect(checkSignal?.aborted).toBe(true)
    expect(checking.registrationDispose).toHaveBeenCalledOnce()
    expect(checking.notifications).toEqual([])

    let downloadSignal: AbortSignal | undefined
    const downloading = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndInstall: async (_version, signal) => new Promise<void>((_resolve, reject) => {
        downloadSignal = signal
        signal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingDownload = downloading.tray.invoke()
    await vi.waitFor(() => { expect(downloadSignal).toBeDefined() })
    await downloading.dispose()
    expect(await readStatus(downloading)).toEqual({ supported: false, currentVersion: '2.0.0', availableVersion: null, checking: false, downloading: false })
    await pendingDownload
    expect(downloadSignal?.aborted).toBe(true)
    expect(downloading.registrationDispose).toHaveBeenCalledOnce()
    expect(downloading.notifications).toEqual([])
    expect(downloading.warnings).toEqual([])
  })

  it('releases one update generation once and does not restart background polling', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ request })

    await harness.dispose()
    await harness.dispose()
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs + testConfig.intervalMs)

    expect(request).not.toHaveBeenCalled()
    expect(harness.registrationDispose).toHaveBeenCalledOnce()
    expect(harness.notificationActionRelease).not.toHaveBeenCalled()
  })

  it('releases a registered notification action with the update generation', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({ request: async () => versionResponse('2.1.0') })
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.registerNotificationAction).toHaveBeenCalledOnce() })

    await harness.dispose()

    expect(harness.notificationActionRelease).toHaveBeenCalledOnce()
  })

  it('does not wait for an open manual result dialog during disposal', async () => {
    let closeDialog!: () => void
    const dialog = new Promise<void>(resolve => { closeDialog = resolve })
    const harness = await createHarness({
      packaged: false,
      showManualCheckResult: async () => dialog,
    })
    const pending = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.showManualCheckResult).toHaveBeenCalledOnce() })

    await harness.dispose()
    expect(harness.registrationDispose).toHaveBeenCalledOnce()

    closeDialog()
    await pending
  })

  it('reports a timed-out shared manual request and restores the idle tray label', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'))
      }, { once: true })
    }))
    const harness = await createHarness({ packaged: false, request })

    const first = harness.tray.invoke()
    const second = harness.tray.invoke()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    expect(harness.tray.label()).toBe('Checking for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.requestTimeoutMs)
    await Promise.all([first, second])

    expect(signals[0]?.aborted).toBe(true)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith(null)
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })
})
