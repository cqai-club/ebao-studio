/** Retire the former product-carried E剪宝 without deleting user media or configuration. */

import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readProfileManifest, writeProfileManifest, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { findOverlayPackage, type PackageOverlayCandidate } from './package-overlay.ts'

export const EJIANBAO_PACKAGE_NAME = 'cqai-dsh-plugin-ejianbao'
export const EJIANBAO_BUNDLE_NAMES: ReadonlySet<string> = new Set([
  EJIANBAO_PACKAGE_NAME,
  'cqai-dsh-plugin-video',
  'cqai-dsh-plugin-short-video',
  'cqai-dsh-plugin-talkcraft',
])
const ROW_IDS = new Set(['cqai-ejianbao', 'cqai-video', 'cqai-short-video', 'cqai-talkcraft'])
const MIGRATION_KEY = 'ejianbaoExternalPluginV1'
const DISABLE_STATE_KEY = 'ejianbaoExternalPluginDisableStateV1'
const LEGACY_DISABLED_KEY = 'ejianbaoLegacyDisabledBundles'
const MAX_MANIFEST_BYTES = 1024 * 1024

/** Old entry overrides remain on disk and become effective again after an explicit reinstall. */
export function isEjianbaoEntry(entry: { readonly id?: unknown, readonly name?: unknown }): boolean {
  return (typeof entry.id === 'string' && ROW_IDS.has(entry.id))
    || (typeof entry.name === 'string' && [...EJIANBAO_BUNDLE_NAMES].some(name =>
      entry.name === name || (entry.name as string).startsWith(`${name}/`)))
}

/** Inspect only a declared active-Profile install, without importing any plugin code. */
export function externalEjianbaoPackage(profileDir: string, manifest?: ProfileManifest): string | undefined {
  const profileManifest = manifest ?? readProfileManifest(EJIANBAO_PACKAGE_NAME, profileDir)
  const dependency = profileManifest.dependencies?.[EJIANBAO_PACKAGE_NAME]
  if (typeof dependency !== 'string' || dependency.length === 0) return
  const packageDir = join(profileDir, 'node_modules', EJIANBAO_PACKAGE_NAME)
  const path = join(packageDir, 'package.json')
  try {
    if (!statSync(path).isFile() || statSync(path).size > MAX_MANIFEST_BYTES) return
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as { name?: unknown, dsh?: { ejianbao?: { distribution?: unknown, version?: unknown } } }
    if (record.name === EJIANBAO_PACKAGE_NAME
      && record.dsh?.ejianbao?.distribution === 'external'
      && record.dsh.ejianbao.version === 1) return packageDir
  } catch {
    // Interrupted or old installs cannot grant admission; the normal bundle reader diagnoses selected packages.
  }
}

/** Remove only legacy links proved to point at this installation's product package. */
function retireProductLink(profileDir: string, packageName: string, dependency: string | undefined, installAnchor: string): boolean {
  const installationDirectory = dirname(installAnchor)
  const packageParent = dirname(installationDirectory)
  const ownedTargets = new Set([
    join(installationDirectory, 'node_modules', packageName),
    // app-boot's earlier link backend reserved and already sweeps this tree.
    join(profileDir, '.dsh-module-fallback', 'node_modules', packageName),
  ])
  if (basename(packageParent) === 'node_modules') ownedTargets.add(join(packageParent, packageName))
  let candidate: PackageOverlayCandidate | undefined
  try {
    candidate = findOverlayPackage(packageName, {
      installPackageUrl: pathToFileURL(installAnchor).href,
      profilePackageUrl: pathToFileURL(join(profileDir, 'package.json')).href,
    })?.install
  } catch {
    // A missing retired payload still has a known installation-owned path below.
  }
  if (candidate !== undefined) ownedTargets.add(realpathSync(candidate.packageDir))
  const ownedPath = (path: string): boolean => {
    if (ownedTargets.has(resolve(path))) return true
    try { return ownedTargets.has(realpathSync(path)) } catch { return false }
  }
  const modulePath = join(profileDir, 'node_modules', packageName)
  if (lstatSync(modulePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    try {
      if (ownedPath(resolve(dirname(modulePath), readlinkSync(modulePath)))) rmSync(modulePath, { force: true })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
  if (dependency === undefined || !dependency.startsWith('link:')) return false
  return ownedPath(resolve(profileDir, dependency.slice('link:'.length)))
}

/** One Profile gets this retirement once; subsequent package-manager installs are never deselected again. */
export function migrateEjianbaoProfile(profileDir: string, installAnchor: string): boolean {
  if (!existsSync(join(profileDir, 'package.json'))) return false
  const manifest = readProfileManifest(EJIANBAO_PACKAGE_NAME, profileDir)
  const dsh = manifest.dsh as (NonNullable<ProfileManifest['dsh']> & { desktopMigrations?: Record<string, unknown> }) | undefined
  if (dsh?.desktopMigrations?.[MIGRATION_KEY] === true) return false
  const rawBundles = manifest.dsh?.profile?.bundles
  if (rawBundles !== undefined && (!Array.isArray(rawBundles) || rawBundles.some(name => typeof name !== 'string'))) {
    throw new Error('E剪宝 migration: dsh.profile.bundles must be an array of package names')
  }
  const externalPackage = externalEjianbaoPackage(profileDir, manifest)
  const bundles = (rawBundles ?? []).filter(name =>
    !EJIANBAO_BUNDLE_NAMES.has(name) || (name === EJIANBAO_PACKAGE_NAME && externalPackage !== undefined))
  const dependencies = { ...manifest.dependencies }
  for (const name of EJIANBAO_BUNDLE_NAMES) {
    if (name === EJIANBAO_PACKAGE_NAME && externalPackage !== undefined) continue
    if (retireProductLink(profileDir, name, dependencies[name], installAnchor)) delete dependencies[name]
  }
  writeProfileManifest(profileDir, {
    ...manifest,
    ...(manifest.dependencies === undefined ? {} : { dependencies }),
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles },
      desktopMigrations: {
        ...dsh?.desktopMigrations,
        [MIGRATION_KEY]: true,
        [LEGACY_DISABLED_KEY]: [...EJIANBAO_BUNDLE_NAMES].filter(name =>
          name !== EJIANBAO_PACKAGE_NAME || externalPackage === undefined),
      },
    },
  } as ProfileManifest)
  return true
}

/** The launcher clears only the former preset's private disable markers, once and under its state-file lock. */
export function pendingEjianbaoDisabledBundles(profileDir: string): readonly string[] | undefined {
  const manifest = readProfileManifest(EJIANBAO_PACKAGE_NAME, profileDir)
  const migrations = (manifest.dsh as { desktopMigrations?: Record<string, unknown> } | undefined)?.desktopMigrations
  if (migrations?.[MIGRATION_KEY] !== true || migrations[DISABLE_STATE_KEY] === true) return
  const names = migrations[LEGACY_DISABLED_KEY]
  return Array.isArray(names) ? names.filter((name): name is string =>
    typeof name === 'string' && EJIANBAO_BUNDLE_NAMES.has(name)) : [...EJIANBAO_BUNDLE_NAMES]
}

/** Commit cleanup only after the private-state write succeeds, so an interrupted upgrade retries safely. */
export function completeEjianbaoDisabledBundleMigration(profileDir: string): void {
  const manifest = readProfileManifest(EJIANBAO_PACKAGE_NAME, profileDir)
  const migrations = (manifest.dsh as { desktopMigrations?: Record<string, unknown> } | undefined)?.desktopMigrations
  writeProfileManifest(profileDir, {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      desktopMigrations: { ...migrations, [DISABLE_STATE_KEY]: true },
    },
  } as ProfileManifest)
}
