import { describe, expect, it, vi } from 'vitest'
import type { UpdateCheckResult, UpdateInfo } from 'electron-updater'
import {
  configureElectronAutoUpdater,
  downloadElectronDesktopUpdate,
  type ElectronAutoUpdater,
} from '../src/electron-auto-updater.ts'

function updateCheck(version: string, isUpdateAvailable = true): UpdateCheckResult {
  const updateInfo = { version } as UpdateInfo
  return { isUpdateAvailable, updateInfo, versionInfo: updateInfo }
}

function updater(overrides: Partial<ElectronAutoUpdater> = {}): ElectronAutoUpdater {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: false,
    allowPrerelease: false,
    allowDowngrade: true,
    disableDifferentialDownload: false,
    disableWebInstaller: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      ...updateCheck('2.1.0'),
    })),
    downloadUpdate: vi.fn(async () => ['/private/cache/eBao-Studio-2.1.0.zip']),
    quitAndInstall: vi.fn(),
    ...overrides,
  }
}

describe('Electron Desktop updater bridge', () => {
  it('requires an explicit stable download, no quit-time installation, and full artifacts', () => {
    const value = updater()

    configureElectronAutoUpdater(value)

    expect(value).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowPrerelease: false,
      allowDowngrade: false,
      disableDifferentialDownload: true,
      disableWebInstaller: true,
    })
  })

  it('defaults to the confirmed GitHub tag before checking for updates', async () => {
    const value = updater()

    await downloadElectronDesktopUpdate(value, '2.1.0', new AbortController().signal)

    expect(value.setFeedURL).toHaveBeenCalledExactlyOnceWith({
      provider: 'generic',
      url: 'https://github.com/cqai-club/ebao-studio/releases/download/v2.1.0/',
      channel: 'latest',
      useMultipleRangeRequest: false,
    })
    expect(value.checkForUpdates).toHaveBeenCalledOnce()
    expect(vi.mocked(value.setFeedURL).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(value.checkForUpdates).mock.invocationCallOrder[0]!)
  })

  it('selects the GitCode tag when mainland routing explicitly chooses that source', async () => {
    const value = updater()

    await downloadElectronDesktopUpdate(value, '2.1.0', new AbortController().signal, 'gitcode')

    expect(value.setFeedURL).toHaveBeenCalledExactlyOnceWith({
      provider: 'generic',
      url: 'https://gitcode.com/g-dxw/ebao-studio/releases/download/v2.1.0/',
      channel: 'latest',
      useMultipleRangeRequest: false,
    })
    expect(value.checkForUpdates).toHaveBeenCalledOnce()
    expect(vi.mocked(value.setFeedURL).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(value.checkForUpdates).mock.invocationCallOrder[0]!)
  })

  it.each([
    '', 'v2.1.0', '2.1', '02.1.0', '2.1.0-beta.1', '2.1.0+build.1',
    ' 2.1.0', '2.1.0 ', '2.1.0/../../latest',
  ])('rejects unconfirmed or noncanonical stable version %j before network work', async version => {
    const value = updater()

    await expect(downloadElectronDesktopUpdate(value, version, new AbortController().signal))
      .rejects.toThrow('update version must be canonical stable SemVer')

    expect(value.setFeedURL).not.toHaveBeenCalled()
    expect(value.checkForUpdates).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
  })

  it('requires Electron Updater to agree with the manifest-confirmed version before downloading', async () => {
    const value = updater()

    await expect(downloadElectronDesktopUpdate(value, '2.1.0', new AbortController().signal))
      .resolves.toEqual(['/private/cache/eBao-Studio-2.1.0.zip'])
    expect(value.downloadUpdate).toHaveBeenCalledWith(expect.objectContaining({ cancelled: false }))

    const missing = updater({ checkForUpdates: vi.fn(async () => null) })
    await expect(downloadElectronDesktopUpdate(missing, '2.1.0', new AbortController().signal))
      .rejects.toThrow('did not find the confirmed update')
    expect(missing.downloadUpdate).not.toHaveBeenCalled()

    const unavailable = updater({ checkForUpdates: vi.fn(async () => updateCheck('2.1.0', false)) })
    await expect(downloadElectronDesktopUpdate(unavailable, '2.1.0', new AbortController().signal))
      .rejects.toThrow('did not find the confirmed update')
    expect(unavailable.downloadUpdate).not.toHaveBeenCalled()

    const mismatched = updater({ checkForUpdates: vi.fn(async () => ({
      ...updateCheck('2.2.0'),
    })) })
    await expect(downloadElectronDesktopUpdate(mismatched, '2.1.0', new AbortController().signal))
      .rejects.toThrow('does not match confirmed 2.1.0')
    expect(mismatched.downloadUpdate).not.toHaveBeenCalled()
  })

  it('does not contact a release provider after cancellation', async () => {
    const value = updater()
    const controller = new AbortController()
    controller.abort()

    await expect(downloadElectronDesktopUpdate(value, '2.1.0', controller.signal)).rejects.toThrow()

    expect(value.setFeedURL).not.toHaveBeenCalled()
    expect(value.checkForUpdates).not.toHaveBeenCalled()
    expect(value.downloadUpdate).not.toHaveBeenCalled()
  })

  it('bridges Host cancellation into Electron Updater downloads', async () => {
    let cancellation: { readonly cancelled: boolean, on(event: 'cancel', handler: () => void): unknown } | undefined
    const value = updater({
      downloadUpdate: vi.fn(async token => await new Promise<readonly string[]>((_resolve, reject) => {
        cancellation = token
        token?.on('cancel', () => reject(new Error('cancelled by lifecycle disposal')))
      })),
    })
    const controller = new AbortController()
    const pending = downloadElectronDesktopUpdate(value, '2.1.0', controller.signal)

    await vi.waitFor(() => { expect(cancellation).toBeDefined() })
    controller.abort()

    await expect(pending).rejects.toThrow('cancelled by lifecycle disposal')
    expect(cancellation?.cancelled).toBe(true)
  })
})
