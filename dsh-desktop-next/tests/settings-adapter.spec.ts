import { expect, it, vi } from 'vitest'
import { NextSettingsAdapter, projectSettings } from '../src/client/settings-adapter.ts'
import { DEFAULT_PREFERENCES, type DesktopBridge, type DesktopBrowserLinks, type DesktopCommand, type DesktopState } from '../src/desktop-contract.ts'
import type { NextUpdateState } from '../src/update-state.ts'

function fixture() {
  const state: DesktopState = {
    selected: 'desktop', profiles: ['desktop', 'work', 'broken'], unavailableProfiles: ['broken'],
    features: { market: true, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
    phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: 'darwin', version: '0.1.0',
    trayAvailable: true, notificationsAvailable: true, browserUrl: null, lan: null, checkpoint: null, logs: '',
  }
  const commands: DesktopCommand[] = []
  const links: DesktopBrowserLinks = { localUrl: null, lanUrls: [] }
  let fail = false
  const bridge: DesktopBridge = {
    state: async () => structuredClone(state),
    browserLinks: async () => structuredClone(links),
    command: async command => {
      commands.push(command)
      if (fail) { fail = false; throw new Error('Fixture save failure') }
      if (command.type === 'preferences') state.preferences = command.preferences
      if (command.type === 'switch') state.selected = command.name
    },
  }
  return { state, links, commands, bridge, rejectNext: () => { fail = true }, adapter: new NextSettingsAdapter(bridge) }
}

it('reads fresh native update status without checking or downloading updates', async () => {
  const { adapter, state, commands, bridge } = fixture()
  const browserLinks = vi.spyOn(bridge, 'browserLinks')
  expect(await adapter.api.readUpdateStatus()).toEqual({
    supported: false, currentVersion: '0.1.0', availableVersion: null, checking: false, downloading: false,
  })
  state.version = '2.0.14-next'
  state.updates = { phase: 'available', version: '2.0.15-next', installable: true }
  expect(await adapter.api.readUpdateStatus()).toEqual({
    supported: true, currentVersion: '2.0.14-next', availableVersion: '2.0.15-next', checking: false, downloading: false,
  })
  expect(adapter.getSnapshot()?.updates).toEqual(state.updates)
  expect(commands).toEqual([])
  expect(browserLinks).not.toHaveBeenCalled()
})

it.each<{ update: NextUpdateState; available: boolean; checking?: boolean; downloading?: boolean }>([
  { update: { phase: 'idle', installable: true }, available: false },
  { update: { phase: 'current', installable: true }, available: false },
  { update: { phase: 'checking', installable: true }, available: false, checking: true },
  { update: { phase: 'available', installable: true }, available: true },
  { update: { phase: 'downloading', installable: true }, available: true, downloading: true },
  { update: { phase: 'preparing', installable: true }, available: true, downloading: true },
  { update: { phase: 'ready', installable: true }, available: true },
  { update: { phase: 'installing', installable: true }, available: true, downloading: true },
  { update: { phase: 'error', error: 'service', installable: true }, available: false },
  { update: { phase: 'error', error: 'prepare', installable: true }, available: true },
  { update: { phase: 'available', installable: false }, available: true },
])('projects $update.phase/$update.error without exposing a stale or inactive version', async ({ update, available, checking = false, downloading = false }) => {
  const { adapter, state, commands } = fixture()
  state.updates = { version: '2.0.15-next', ...update }
  expect(await adapter.api.readUpdateStatus()).toEqual({
    supported: update.installable, currentVersion: state.version,
    availableVersion: available ? '2.0.15-next' : null, checking, downloading,
  })
  expect(commands).toEqual([])
})

it('shares stable subscription snapshots and serializes independent preference writes', async () => {
  const { adapter, state } = fixture()
  await adapter.refresh()
  const original = adapter.desktopSettings.getSnapshot()
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot()).toBe(original)
  await Promise.all([
    adapter.notificationSettings.set('enabled', false),
    adapter.savePreferences({ closeToTray: false, port: 12345 }),
  ])
  expect(state.preferences).toMatchObject({ notifications: false, closeToTray: false, port: 12345 })
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(false)
  expect(adapter.desktopSettings.getSnapshot().value?.port).toBe(12345)
})

it('restores persisted state after rejected or cancelled writes and accepts later changes', async () => {
  const { adapter, rejectNext, bridge, state } = fixture()
  await adapter.refresh()
  rejectNext()
  await expect(adapter.notificationSettings.set('enabled', false)).rejects.toThrow('Fixture save failure')
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(true)
  await adapter.desktopSettings.set('openBrowser', true)
  expect(state.preferences.browserAccess).toBe(true)
  // Native confirmation cancellation resolves without applying the requested value.
  bridge.command = async () => {}
  await adapter.desktopSettings.set('openBrowser', false)
  expect(adapter.desktopSettings.getSnapshot().value?.openBrowser).toBe(true)
  await expect(adapter.desktopSettings.set('__proto__', true)).rejects.toThrow('Unsupported')
})

it('maps only supported features and available Profiles to the shared settings API', async () => {
  const { adapter, state, commands } = fixture()
  const view = await adapter.api.read()
  expect(view.profiles.find(item => item.name === 'broken')?.selectable).toBe(false)
  expect(view.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
  await expect(adapter.api.selectMarket('dsh-market')).rejects.toThrow('Plugins page')
  expect(commands).toEqual([])
  state.safeMode = true
  expect(adapter.api.selectAa).toBeUndefined()
  expect(projectSettings(state).market.effective).toBe('disabled')
  await adapter.api.selectProfile('work')
  const switched = await adapter.api.read()
  expect(switched.current).toBe('work')
  expect(switched.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
})

it('renders full login links and opens or copies the exact selected address', async () => {
  const { state, links, adapter, commands } = fixture()
  state.browserUrl = 'http://127.0.0.1:1234/'
  state.lan = { state: 'ready', actualPort: 5678, addresses: ['192.168.1.20', '10.0.0.20'], caFingerprint: 'fixture', errorCode: null }
  links.localUrl = state.browserUrl + '?token=browser-login'
  links.lanUrls = state.lan.addresses.map(address => `https://${address}:5678/?token=browser-login`)
  expect((await adapter.api.read()).web).toMatchObject({
    localUrl: links.localUrl, lanUrls: links.lanUrls,
    lanCaUrls: state.lan.addresses.map(address => `https://${address}:5678/.well-known/dsh-desktop-ca.crt`),
  })
  for (const url of [links.localUrl, ...links.lanUrls]) {
    await adapter.api.openBrowser!(url)
    await adapter.api.copyBrowser!(url)
  }
  expect(commands).toEqual([links.localUrl, ...links.lanUrls].flatMap(url => [{ type: 'open-browser-url', url }, { type: 'copy-browser-url', url }]))
  expect(adapter.getSnapshot()?.browserUrl).not.toContain('token=')
})
