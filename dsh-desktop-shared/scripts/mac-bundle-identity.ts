/** Verify localized macOS bundle names independently of their stable filename. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

export interface MacBundleNames {
  readonly name: string
  readonly displayName: string
}

export interface MacBundleIdentityOptions {
  /** Physical app filename, retained for updater compatibility. */
  readonly productName: string
  /** Expected visible bundle name; independent of the updater-compatible filename. */
  readonly displayName?: string
  /** Read both bundle names from Info.plist or a localized InfoPlist.strings. */
  readonly readBundleNames?: (plistPath: string) => MacBundleNames
}

/** Read the names without executing the packaged application. */
export function readMacBundleNames(plistPath: string): MacBundleNames {
  const read = (key: string): string => {
    const result = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath], {
      encoding: 'utf8',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`cannot read ${key} from ${plistPath}: ${result.stderr.trim()}`)
    }
    return result.stdout.trim()
  }
  return { name: read('CFBundleName'), displayName: read('CFBundleDisplayName') }
}

/** Verify the Finder-compatible base name and the visible names in each locale. */
export function verifyMacBundleIdentity(infoPlistPath: string, options: MacBundleIdentityOptions): void {
  if (options.displayName === undefined) return
  if (options.readBundleNames === undefined) throw new Error('macOS bundle name verification requires a reader')
  const names = options.readBundleNames(infoPlistPath)
  // Finder applies localized display names only when the raw display name
  // matches the physical bundle filename, which must remain stable for ShipIt.
  if (names.name !== options.displayName || names.displayName !== options.productName) {
    throw new Error(`packaged application must declare CFBundleName ${options.displayName} and CFBundleDisplayName ${options.productName}: ${infoPlistPath}`)
  }
  for (const locale of ['en', 'zh_CN']) {
    const localizedPath = join(dirname(infoPlistPath), 'Resources', `${locale}.lproj`, 'InfoPlist.strings')
    const localizedNames = options.readBundleNames(localizedPath)
    if (localizedNames.name !== options.displayName || localizedNames.displayName !== options.displayName) {
      throw new Error(`packaged application must localize CFBundleName and CFBundleDisplayName as ${options.displayName}: ${localizedPath}`)
    }
  }
}
