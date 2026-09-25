import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { bindNativeRuntime, createHostRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime, DesktopShellSpec, DesktopTrayItem } from '../src/runtime.ts'

it('preserves the Web URL and authentication while projecting shell and tray callbacks', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  let shell!: DesktopShellSpec
  let tray!: DesktopTrayItem
  const disposeShell = vi.fn(async () => {})
  const disposeTray = vi.fn()
  const notificationActionRelease = vi.fn()
  let invokeNotificationAction!: () => void | Promise<void>
  const registerNotificationAction = vi.fn((_action: 'open-update', handler: () => void | Promise<void>) => {
    invokeNotificationAction = handler
    return notificationActionRelease
  })
  const native = {
    platform: 'win32', windowsBuild: 22631, locale: 'en',
    loginCompletionUrl: 'dsh-desktop-beta://oauth/complete',
    publisher: {
      status: () => ({ supported: true, running: false }),
      selectLocalVideo: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', fileName: '本地.mp4', title: '本地', bytes: 12 })),
      readLocalVideoChunk: vi.fn(async () => ({ ok: true, bytes: 12, dataBase64: 'dGVzdA==' })),
    },
    updates: { isPackaged: true, canDownload: true, currentVersion: '2.0.7-beta.1', statePath: '/tmp/update',
      request: vi.fn(async () => new Response('{"version":"2.0.8-beta.1"}', { headers: { 'x-test': 'yes' } })),
      registerNotificationAction,
    },
    schedule: (value: DesktopShellSpec) => { shell = value; return disposeShell },
    openExternal: vi.fn(async () => {}),
    registerTrayItem: (value: DesktopTrayItem) => { tray = value; return { refresh() {}, dispose: disposeTray } },
  } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    expect(runtime.loginCompletionUrl).toBe('dsh-desktop-beta://oauth/complete')
    expect(await runtime.publisher.selectLocalVideo()).toEqual({
      id: '44444444-4444-4444-8444-444444444444', fileName: '本地.mp4', title: '本地', bytes: 12,
    })
    expect(native.publisher.selectLocalVideo).toHaveBeenCalledOnce()
    expect(await runtime.publisher.readLocalVideoChunk('44444444-4444-4444-8444-444444444444', 4, 4)).toEqual({
      ok: true, bytes: 12, dataBase64: 'dGVzdA==',
    })
    expect(native.publisher.readLocalVideoChunk).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 4, 4, expect.any(AbortSignal))
    let language: 'zh' | undefined
    const mode = vi.fn(async () => {})
    const invoke = vi.fn(async () => {})
    const spec = { url: 'http://127.0.0.1:1234/?dsh-desktop-mode=advanced',
      authenticationUrl: 'http://127.0.0.1:1234/?token=fixture',
      rendererAccessHeader: { name: 'x-dsh-desktop-renderer', value: 'fixture' },
      readLocalePreference: () => language, readThemeSource: () => 'dark',
      requestQuit() {}, requestModeChange: mode,
    } as unknown as DesktopShellSpec
    spec.readRemoteControl = vi.fn(async () => false)
    spec.enableRemoteControl = vi.fn(async () => {})
    const stopShell = runtime.schedule(spec)
    runtime.registerTrayItem({ group: 'tools', order: 1, label: () => 'Plugin action', invoke,
      submenu: () => [{ label: () => 'Child', invoke }] })
    language = 'zh'
    await runtime.mountScheduled()
    expect(await shell.readRemoteControl?.()).toBe(false)
    await shell.enableRemoteControl?.()
    expect(spec.enableRemoteControl).toHaveBeenCalledTimes(1)
    expect(shell.url).toBe(spec.url)
    expect(shell.authenticationUrl).toBe(spec.authenticationUrl)
    expect(shell.rendererAccessHeader).toEqual(spec.rendererAccessHeader)
    expect(shell.readLocalePreference()).toBe('zh')
    await shell.requestModeChange('extended')
    expect(mode).toHaveBeenCalledWith('extended')
    expect(tray.label()).toBe('Plugin action')
    await tray.submenu?.()[0]?.invoke()
    expect(invoke).toHaveBeenCalledOnce()
    const response = await runtime.updates.request('https://example.invalid', { headers: { accept: 'application/json' } })
    expect(response.headers.get('x-test')).toBe('yes')
    expect(await response.json()).toEqual({ version: '2.0.8-beta.1' })
    const notificationHandler = vi.fn()
    const releaseNotificationAction = runtime.updates.registerNotificationAction('open-update', notificationHandler)
    await vi.waitFor(() => { expect(registerNotificationAction).toHaveBeenCalledOnce() })
    await invokeNotificationAction()
    expect(notificationHandler).toHaveBeenCalledOnce()
    releaseNotificationAction()
    await vi.waitFor(() => { expect(notificationActionRelease).toHaveBeenCalledOnce() })
    await runtime.openExternal('https://auth.example.test/authorize')
    expect(native.openExternal).toHaveBeenCalledWith('https://auth.example.test/authorize')
    await stopShell()
    expect(disposeShell).toHaveBeenCalledOnce()
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})
