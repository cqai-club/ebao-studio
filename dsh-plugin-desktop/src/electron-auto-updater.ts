/** Safe, confirmation-driven bridge to Electron Builder's packaged updater. */

import { CancellationToken } from 'builder-util-runtime'
import type { UpdateCheckResult } from 'electron-updater'

/** Narrow runtime contract consumed by the Desktop update handoff. */
export interface ElectronAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableDifferentialDownload: boolean
  disableWebInstaller: boolean
  checkForUpdates(): Promise<UpdateCheckResult | null>
  downloadUpdate(cancellationToken?: CancellationToken): Promise<readonly string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

/**
 * Configure the updater for an explicit user-approved download and restart.
 *
 * Stable releases remain GitHub prereleases by publishing convention, so the
 * provider must inspect prerelease entries. The manifest check still requires
 * a strictly newer stable version and the secondary version equality check
 * below prevents this setting from accepting an unrelated release.
 */
export function configureElectronAutoUpdater(updater: ElectronAutoUpdater): void {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = true
  updater.allowPrerelease = true
  updater.allowDowngrade = false
  // A complete NSIS/ZIP artifact has both Electron Updater's SHA-512 metadata
  // check and a deterministic release asset. Avoid block-map and web-installer
  // fallbacks that would expand the trusted release asset surface.
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
}

/**
 * Download one manifest-approved release through Electron Updater.
 *
 * Electron Updater validates the published SHA-512 value from `latest*.yml`
 * before resolving. The caller's AbortSignal is bridged into its native
 * cancellation token so Host-generation disposal can stop an active transfer.
 */
export async function downloadElectronDesktopUpdate(
  updater: ElectronAutoUpdater,
  expectedVersion: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  signal.throwIfAborted()
  const check = await updater.checkForUpdates()
  signal.throwIfAborted()
  if (check === null || !check.isUpdateAvailable) {
    throw new Error('dsh-plugin-desktop: Electron Updater did not find the confirmed update')
  }
  if (check.updateInfo.version !== expectedVersion) {
    throw new Error(
      `dsh-plugin-desktop: Electron Updater version ${check.updateInfo.version} does not match confirmed ${expectedVersion}`,
    )
  }

  const cancellation = new CancellationToken()
  const abort = (): void => { cancellation.cancel() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const files = await updater.downloadUpdate(cancellation)
    signal.throwIfAborted()
    if (files.length === 0 || files.some(file => typeof file !== 'string' || file.length === 0)) {
      throw new Error('dsh-plugin-desktop: Electron Updater did not retain a downloaded update artifact')
    }
    return files
  } finally {
    signal.removeEventListener('abort', abort)
    cancellation.dispose()
  }
}
