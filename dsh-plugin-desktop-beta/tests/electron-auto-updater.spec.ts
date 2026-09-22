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
    checkForUpdates: vi.fn(async () => ({
      ...updateCheck('2.1.0'),
    })),
    downloadUpdate: vi.fn(async () => ['/private/cache/eBao-Studio-2.1.0.zip']),
    quitAndInstall: vi.fn(),
    ...overrides,
  }
}

describe('Electron Desktop updater bridge', () => {
  it('requires an explicit download, no quit-time installation, full artifacts, and prerelease release discovery', () => {
    const value = updater()

    configureElectronAutoUpdater(value)

    expect(value).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowPrerelease: true,
      allowDowngrade: false,
      disableDifferentialDownload: true,
      disableWebInstaller: true,
    })
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

    const mismatched = updater({ checkForUpdates: vi.fn(async () => ({
      ...updateCheck('2.2.0'),
    })) })
    await expect(downloadElectronDesktopUpdate(mismatched, '2.1.0', new AbortController().signal))
      .rejects.toThrow('does not match confirmed 2.1.0')
    expect(mismatched.downloadUpdate).not.toHaveBeenCalled()
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
