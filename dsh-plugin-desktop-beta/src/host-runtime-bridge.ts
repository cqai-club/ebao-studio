/** Native capability adapters; frontend HTTP and WebSocket connections are unchanged. */
import type {
  DesktopNotificationAction,
  DesktopRuntime,
  DesktopShellSpec,
  DesktopTrayItem,
  DesktopTrayItemRegistration,
  DesktopUpdateAdapter,
} from './runtime.ts'
import { HostRpc } from './host-rpc.ts'
import { isPublisherWorkerMethod } from './publisher-runtime.ts'

export type RuntimeSnapshot = Pick<DesktopRuntime, 'platform' | 'windowsBuild' | 'locale' | 'loginCompletionUrl'> & {
  updates: Omit<DesktopUpdateAdapter, 'request' | 'confirmDownload' | 'showManualCheckResult' | 'downloadAndInstall' | 'registerNotificationAction' | 'notify'>
  publisher: ReturnType<DesktopRuntime['publisher']['status']>
}
export function runtimeSnapshot(runtime: DesktopRuntime): RuntimeSnapshot {
  const { isPackaged, canDownload, currentVersion, releaseChannel, statePath, installationId } = runtime.updates
  return {
    platform: runtime.platform, windowsBuild: runtime.windowsBuild, locale: runtime.locale,
    ...(runtime.loginCompletionUrl === undefined ? {} : { loginCompletionUrl: runtime.loginCompletionUrl }),
    updates: { isPackaged, canDownload, currentVersion, statePath,
      ...(releaseChannel ? { releaseChannel } : {}), ...(installationId ? { installationId } : {}) },
    publisher: runtime.publisher?.status() ?? {
      supported: false,
      running: false,
      reason: 'publisher-not-supported',
      message: '多平台发布能力未注册',
    },
  }
}

/** Keep functions in their owning process and send snapshots plus opaque callback IDs. */
export function createHostRuntime(rpc: HostRpc, snapshot: RuntimeSnapshot): DesktopRuntime {
  let sequence = 0
  let locale = snapshot.locale
  const calls = new Set<Promise<unknown>>()
  const setup: Promise<unknown>[] = []
  let booting = true
  const trayPublishers = new Map<string, () => void>()
  const trackSetup = (task: Promise<unknown>) => { if (booting) setup.push(task) }
  const shellSpecs = new Map<string, DesktopShellSpec>()
  const send = <T = void>(method: string, args: unknown[] = [], signal?: AbortSignal): Promise<T> => {
    const interactive = ['update:confirmDownload', 'update:showManualCheckResult', 'update:downloadAndInstall',
      'native:pickDirectory', 'native:exportDiagnostics', 'publisher:selectLocalVideo'].includes(method)
    const task = rpc.call<T>(method, args, signal, interactive ? 0 : undefined)
    calls.add(task)
    // Report fire-and-forget failures without creating an unhandled rejection.
    void task.then(() => calls.delete(task), error => { calls.delete(task); process.stderr.write(`${String(error)}\n`) })
    return task
  }
  const callbacks = (handlers: Record<string, (...args: any[]) => unknown>) => {
    const id = `callback:${++sequence}`
    const releases = Object.entries(handlers).map(([name, handler]) => rpc.handle(`${id}:${name}`, args => handler(...args)))
    return { id, release: () => releases.forEach(dispose => dispose()) }
  }
  const runtime: DesktopRuntime = {
    platform: snapshot.platform, windowsBuild: snapshot.windowsBuild,
    ...(snapshot.loginCompletionUrl === undefined ? {} : { loginCompletionUrl: snapshot.loginCompletionUrl }),
    get locale() { return locale },
    updates: {
      ...snapshot.updates,
      request: async (url, init) => {
        const { signal, ...options } = init
        const response = await send<{ body: string; status: number; headers: [string, string][] }>('update:request',
          [url, { ...options, headers: [...new Headers(init.headers).entries()] }], signal ?? undefined)
        return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: response.headers })
      },
      confirmDownload: (version, channel) => send('update:confirmDownload', [version, channel]),
      showManualCheckResult: result => send('update:showManualCheckResult', [result]),
      downloadAndInstall: (version, signal, channel) => send('update:downloadAndInstall', [version, channel], signal),
      registerNotificationAction: (action, handler) => {
        const callback = callbacks({ invoke: handler })
        let active = true
        trackSetup(send('update:registerNotificationAction', [action, callback.id]))
        return () => {
          if (!active) return
          active = false
          void send('update:disposeNotificationAction', [action, callback.id]).then(
            () => { callback.release() },
            () => { callback.release() },
          )
        }
      },
      notify: notification => { void send('update:notify', [notification]) },
    },
    publisher: {
      status: () => snapshot.publisher,
      selectLocalVideo: () => send('publisher:selectLocalVideo'),
      readLocalVideoChunk: (id, offset, length, signal) => send('publisher:readLocalVideoChunk', [id, offset, length], signal),
      request: (method, params, signal) => send('publisher:request', [method, params ?? {}], signal),
    },
    schedule(spec) {
      const callback = callbacks({ quit: spec.requestQuit, mode: spec.requestModeChange,
        ...(spec.readRemoteControl ? { remoteRead: spec.readRemoteControl } : {}),
        ...(spec.enableRemoteControl ? { remoteEnable: spec.enableRemoteControl } : {}),
      })
      const { readLocalePreference, readThemeSource, requestQuit: _quit, requestModeChange: _mode, readRemoteControl: _remoteRead, enableRemoteControl: _remoteEnable, ...data } = spec
      shellSpecs.set(callback.id, spec)
      trackSetup(send('shell:schedule', [callback.id, data, readLocalePreference(), readThemeSource(), Boolean(spec.readRemoteControl && spec.enableRemoteControl)]))
      return async () => { try { await send('shell:dispose', [callback.id]) } finally { shellSpecs.delete(callback.id); callback.release() } }
    },
    // The parent mounts only after Host boot and this barrier finish.
    async mountScheduled() {
      await Promise.all(setup)
      setup.length = 0
      booting = false
      for (const [id, spec] of shellSpecs) {
        await send('shell:preferences', [id, spec.readLocalePreference(), spec.readThemeSource()])
      }
    },
    registerTrayItem(item) {
      const id = `tray:${++sequence}`
      let releases: (() => void)[] = []
      const publish = () => {
        for (const release of releases) release()
        releases = []
        const project = (entry: DesktopTrayItem | NonNullable<ReturnType<NonNullable<DesktopTrayItem['submenu']>>>[number], index: number) => {
          const method = `${id}:${index}`
          releases.push(rpc.handle(method, () => entry.invoke()))
          return { label: entry.label(), enabled: entry.enabled?.() ?? true,
            checked: 'checked' in entry ? entry.checked?.() ?? false : false, type: 'type' in entry ? entry.type : undefined, method }
        }
        trackSetup(send('tray:set', [id, { ...project(item, -1), group: item.group, order: item.order, id: item.id,
          submenu: item.submenu?.().map((entry, index) => project(entry, index)) }]))
      }
      trayPublishers.set(id, publish)
      publish()
      return { refresh: publish, dispose() { trayPublishers.delete(id); releases.forEach(release => release()); void send('tray:dispose', [id]) } }
    },
    show() { void send('native:show') },
    openExternal: target => send('native:openExternal', [target]),
    notifyAttention(value) { void send('native:notifyAttention', [value]) },
    openTerminal() { void send('native:openTerminal') },
    reloadRenderer() { void send('native:reloadRenderer') },
    toggleDeveloperTools() { void send('native:toggleDeveloperTools') },
    exportDiagnostics: () => send('native:exportDiagnostics'),
    pickDirectory: () => send('native:pickDirectory'),
    validateDirectory: path => send('native:validateDirectory', [path]),
    reportRendererBoot: report => { void send('native:reportRendererBoot', [report]) },
    setLocalePreference(preference) { locale = preference ?? snapshot.locale; trayPublishers.forEach(publish => publish()); void send('native:setLocalePreference', [preference]) },
    setThemeSource(source) { void send('native:setThemeSource', [source]) },
    requestRestart: () => send('native:requestRestart'),
    requestRecoveryRestart: () => send('native:requestRecoveryRestart'),
    prepareToQuit() { void send('native:prepareToQuit') },
    openProfileCreateWindow(options) {
      const callback = callbacks({
        submit: async name => { await options.onSubmit(name); callback.release() },
        cancel: () => { options.onCancel?.(); callback.release() },
      })
      void send('native:openProfileCreateWindow', [callback.id])
    },
  }
  return runtime
}

/** Install only the declared native surface; never expose arbitrary Electron APIs. */
export function bindNativeRuntime(rpc: HostRpc, runtime: DesktopRuntime): () => Promise<void> {
  const trays = new Map<string, DesktopTrayItemRegistration>()
  const shells = new Map<string, () => Promise<void>>()
  const preferences = new Map<string, { locale: any; theme: any }>()
  const notificationActions = new Map<DesktopNotificationAction, { id: string; release: () => void }>()
  const releases: (() => void)[] = []
  const handle = (name: string, fn: (args: any[], signal: AbortSignal) => unknown) => { releases.push(rpc.handle(name, fn)) }
  const callback = (method: string, args: unknown[] = []) => rpc.call(method, args)
  const report = (promise: Promise<unknown>) => { void promise.catch(error => process.stderr.write(`${String(error)}\n`)) }
  for (const method of ['show', 'openExternal', 'notifyAttention', 'openTerminal', 'reloadRenderer', 'toggleDeveloperTools',
    'exportDiagnostics', 'pickDirectory', 'validateDirectory', 'reportRendererBoot', 'setLocalePreference',
    'setThemeSource', 'prepareToQuit'] as const) {
    handle(`native:${method}`, args => (runtime[method] as (...args: any[]) => unknown).apply(runtime, args))
  }
  // Acknowledge restart before teardown can close the channel used by this call.
  for (const method of ['requestRestart', 'requestRecoveryRestart'] as const) {
    handle(`native:${method}`, () => { setImmediate(() => report(runtime[method]())) })
  }
  handle('native:openProfileCreateWindow', ([id]) => runtime.openProfileCreateWindow({
    onSubmit: name => callback(`${id}:submit`, [name]), onCancel: () => report(callback(`${id}:cancel`)),
  }))
  handle('shell:schedule', ([id, data, locale, theme, remoteControl]) => {
    if (shells.has(id)) throw new Error('Duplicate Host shell')
    const state = { locale, theme }
    preferences.set(id, state)
    shells.set(id, runtime.schedule({ ...data,
      readLocalePreference: () => state.locale, readThemeSource: () => state.theme,
      requestQuit: code => report(callback(`${id}:quit`, [code])),
      requestModeChange: mode => callback(`${id}:mode`, [mode]),
      ...(remoteControl ? {
        readRemoteControl: () => callback(`${id}:remoteRead`),
        enableRemoteControl: () => callback(`${id}:remoteEnable`),
      } : {}),
    } as DesktopShellSpec))
  })
  handle('shell:preferences', ([id, locale, theme]) => {
    const state = preferences.get(id)
    if (!state) throw new Error('Host shell is unavailable')
    state.locale = locale; state.theme = theme
  })
  handle('shell:dispose', async ([id]) => { const dispose = shells.get(id); shells.delete(id); preferences.delete(id); await dispose?.() })
  handle('tray:set', ([id, data]) => {
    trays.get(id)?.dispose()
    const project = (entry: any) => ({ ...entry, label: () => entry.label, enabled: () => entry.enabled,
      checked: () => entry.checked, invoke: () => callback(entry.method) })
    trays.set(id, runtime.registerTrayItem({ ...project(data), submenu: data.submenu ? () => data.submenu.map(project) : undefined }))
  })
  handle('tray:dispose', ([id]) => { trays.get(id)?.dispose(); trays.delete(id) })
  handle('update:request', async ([url, init], signal) => {
    const response = await runtime.updates.request(url, { ...init, signal })
    return { body: await response.text(), status: response.status, headers: [...response.headers.entries()] }
  })
  handle('update:confirmDownload', ([version, channel]) => runtime.updates.confirmDownload(version, channel))
  handle('update:showManualCheckResult', ([result]) => runtime.updates.showManualCheckResult(result))
  handle('update:downloadAndInstall', ([version, channel], signal) => runtime.updates.downloadAndInstall(version, signal, channel))
  handle('update:registerNotificationAction', ([action, id]) => {
    if (action !== 'open-update' || typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid desktop notification action registration')
    }
    notificationActions.get(action)?.release()
    const release = runtime.updates.registerNotificationAction(action, () => callback(`${id}:invoke`))
    notificationActions.set(action, { id, release })
  })
  handle('update:disposeNotificationAction', ([action, id]) => {
    if (action !== 'open-update' || typeof id !== 'string') return
    const current = notificationActions.get(action)
    if (current?.id !== id) return
    current.release()
    notificationActions.delete(action)
  })
  handle('update:notify', ([value]) => runtime.updates.notify(value))
  handle('publisher:request', ([method, params], signal) => {
    if (!isPublisherWorkerMethod(method)) throw new Error('Invalid Publisher Worker method')
    if (runtime.publisher === undefined) throw new Error('Publisher Worker is unavailable')
    return runtime.publisher.request(method, params ?? {}, signal)
  })
  handle('publisher:selectLocalVideo', () => {
    if (runtime.publisher === undefined) throw new Error('Publisher Worker is unavailable')
    return runtime.publisher.selectLocalVideo()
  })
  handle('publisher:readLocalVideoChunk', ([id, offset, length], signal) => {
    if (runtime.publisher === undefined) throw new Error('Publisher runtime is unavailable')
    if (typeof id !== 'string' || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
      return { ok: false, code: 'invalid-video-selection', message: '本地视频预览请求无效，请重新选择文件' }
    }
    return runtime.publisher.readLocalVideoChunk(id, offset, length, signal)
  })
  return async () => {
    trays.forEach(tray => tray.dispose()); trays.clear()
    await Promise.all([...shells.values()].map(dispose => dispose())); shells.clear(); preferences.clear()
    notificationActions.forEach(action => action.release()); notificationActions.clear()
    releases.forEach(release => release())
  }
}
