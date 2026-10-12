/** Deterministic package selection between the Desktop installation and one Profile. */

import { findPackageJSON } from 'node:module'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compare, valid } from 'semver'

const BIN_NAME = 'dsh-plugin-desktop'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_VERSION_LENGTH = 128
const EJIANBAO_ROOT = 'cqai-dsh-plugin-ejianbao'
const EJIANBAO_ENGINE_PACKAGES: ReadonlySet<string> = new Set([
  'cqai-dsh-plugin-video', 'cqai-dsh-plugin-short-video', 'cqai-dsh-plugin-talkcraft',
])
const RETIRED_EJIANBAO_PACKAGES: ReadonlySet<string> = new Set([EJIANBAO_ROOT, ...EJIANBAO_ENGINE_PACKAGES])

export type PackageOverlaySource = 'install' | 'profile'

export interface PackageOverlayCandidate {
  readonly packageName: string
  readonly packageDir: string
  readonly manifestPath: string
  readonly version?: string
  readonly source: PackageOverlaySource
  /** Declaring package anchor for a dependency carried inside an admitted bundle. */
  readonly resolutionAnchorUrl?: string
  readonly bundlePackageName?: string
}

export interface PackageOverlaySelection {
  readonly packageName: string
  readonly selected: PackageOverlayCandidate
  readonly install?: PackageOverlayCandidate
  readonly profile?: PackageOverlayCandidate
}

export interface PackageOverlayOptions {
  /** File URL inside the exact Desktop installation dependency graph. */
  readonly installPackageUrl: string
  /** File URL for the active Profile package.json. */
  readonly profilePackageUrl: string
  /** Only bundle layers admitted to this live generation may expose nested packages. */
  readonly profileBundleNames?: readonly string[]
}

export class PackageOverlayNotFoundError extends Error {
  constructor(packageName: string) {
    super(`${BIN_NAME}: cannot resolve package ${JSON.stringify(packageName)} from the Desktop installation or active Profile`)
    this.name = 'PackageOverlayNotFoundError'
  }
}

function missingPackage(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ERR_MODULE_NOT_FOUND'
}

/**
 * A resolved manifest path is not proof that the manifest exists. `findPackageJSON`
 * answers from the package layout, so a package directory left half written by an
 * interrupted install resolves to a `package.json` path that is absent. Treat that
 * candidate as missing so the overlay can fall back to the other side and otherwise
 * name the package it cannot resolve, instead of surfacing a bare `ENOENT`.
 */
function missingManifest(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function readCandidate(
  packageName: string,
  packageUrl: string,
  source: PackageOverlaySource,
  profileModulesBoundary?: string,
): PackageOverlayCandidate | undefined {
  let manifestPath: string | undefined
  try {
    manifestPath = findPackageJSON(packageName, packageUrl)
  } catch (cause) {
    if (missingPackage(cause)) return undefined
    throw cause
  }
  if (manifestPath === undefined) return undefined
  if (source === 'profile') {
    // Only the active Profile owns overrides. Node's ancestor walk can find
    // projections left by older Desktop installs in profiles/node_modules.
    const modules = profileModulesBoundary ?? join(dirname(fileURLToPath(packageUrl)), 'node_modules')
    const offset = relative(modules, manifestPath)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return undefined
  }
  let size: number
  try {
    size = statSync(manifestPath).size
  } catch (cause) {
    if (missingManifest(cause)) return undefined
    throw cause
  }
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${BIN_NAME}: ${source} package manifest is too large for ${packageName}`)
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  } catch (cause) {
    if (missingManifest(cause)) return undefined
    throw new Error(
      `${BIN_NAME}: cannot read ${source} package manifest for ${packageName}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)
    || (manifest as { name?: unknown }).name !== packageName) {
    throw new Error(`${BIN_NAME}: ${source} package identity is invalid for ${packageName}`)
  }
  const version = (manifest as { version?: unknown }).version
  const comparableVersion = typeof version === 'string' && version.length > 0
    && version.length <= MAX_VERSION_LENGTH && valid(version) !== null
    ? version
    : undefined
  return {
    packageName,
    packageDir: dirname(manifestPath),
    manifestPath,
    source,
    ...(comparableVersion === undefined ? {} : { version: comparableVersion }),
  }
}

/** Extract an npm package root from one Loader bare specifier. */
export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.length === 0 || specifier.startsWith('.') || specifier.startsWith('/')
    || specifier.startsWith('#') || URL.canParse(specifier)) return undefined
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    if (parts.length < 2 || parts[0]?.length === 0 || parts[1]?.length === 0) return undefined
    return `${parts[0]}/${parts[1]}`
  }
  return parts[0]?.length === 0 ? undefined : parts[0]
}

/** Array identity denotes a generation; a new admitted list invalidates the physical graph. */
interface BundleDependencyIndex {
  readonly packages: ReadonlyMap<string, PackageOverlayCandidate>
  readonly conflicts: ReadonlySet<string>
}
const bundleDependencyIndexes = new WeakMap<readonly string[], Map<string, BundleDependencyIndex>>()

function indexedBundleCandidate(packageName: string, index: BundleDependencyIndex): PackageOverlayCandidate | undefined {
  if (index.conflicts.has(packageName)) throw new Error(`${BIN_NAME}: admitted bundles provide conflicting package ${packageName}`)
  return index.packages.get(packageName)
}

/** Follow only declared dependencies inside the physical tree of admitted bundles. */
function bundledProfileCandidate(
  packageName: string,
  options: PackageOverlayOptions,
  onlyBundleName?: string,
): PackageOverlayCandidate | undefined {
  const bundleNames = options.profileBundleNames
  if (bundleNames === undefined || bundleNames.length === 0) return
  const graphKey = `${options.profilePackageUrl}\n${onlyBundleName ?? ''}`
  const existing = bundleDependencyIndexes.get(bundleNames)?.get(graphKey)
  if (existing !== undefined) return indexedBundleCandidate(packageName, existing)
  const candidates = new Map<string, PackageOverlayCandidate>()
  const conflicts = new Set<string>()
  for (const bundleName of bundleNames) {
    if (onlyBundleName !== undefined && bundleName !== onlyBundleName) continue
    if (packageNameFromSpecifier(bundleName) !== bundleName) continue
    const bundle = readCandidate(bundleName, options.profilePackageUrl, 'profile')
    if (bundle === undefined) continue
    const boundary = join(bundle.packageDir, 'node_modules')
    const pending = [bundle]
    const seen = new Set<string>()
    for (let index = 0; index < pending.length; index += 1) {
      const parent = pending[index]!
      const identity = realpathSync(parent.manifestPath)
      if (seen.has(identity)) continue
      seen.add(identity)
      if (seen.size > 1024) throw new Error(`${BIN_NAME}: bundle dependency graph is too large for ${bundleName}`)
      const manifest = JSON.parse(readFileSync(parent.manifestPath, 'utf8')) as {
        dependencies?: Record<string, unknown>
        optionalDependencies?: Record<string, unknown>
        bundledDependencies?: unknown
        bundleDependencies?: unknown
      }
      const names = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ])
      const bundled = manifest.bundledDependencies ?? manifest.bundleDependencies
      if (Array.isArray(bundled)) {
        for (const name of bundled) if (typeof name === 'string') names.add(name)
      }
      const anchor = pathToFileURL(parent.manifestPath).href
      for (const name of names) {
        if (packageNameFromSpecifier(name) !== name) continue
        const dependency = readCandidate(name, anchor, 'profile', boundary)
        if (dependency === undefined) continue
        pending.push(dependency)
        const candidate = { ...dependency, resolutionAnchorUrl: anchor, bundlePackageName: bundleName }
        const previous = candidates.get(name)
        if (previous !== undefined && realpathSync(previous.manifestPath) !== realpathSync(candidate.manifestPath)) {
          conflicts.add(name)
        }
        candidates.set(name, candidate)
      }
    }
  }
  let profiles = bundleDependencyIndexes.get(bundleNames)
  if (profiles === undefined) {
    profiles = new Map()
    bundleDependencyIndexes.set(bundleNames, profiles)
  }
  const index = { packages: candidates, conflicts }
  profiles.set(graphKey, index)
  return indexedBundleCandidate(packageName, index)
}

/** Installation-owned SDKs retain their existing identity when a bundle carries a copy. */
function installationDeclaresPackage(packageName: string, options: PackageOverlayOptions): boolean {
  const manifestPath = join(dirname(fileURLToPath(options.installPackageUrl)), 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, unknown>, optionalDependencies?: Record<string, unknown>
  }
  return Object.hasOwn(manifest.dependencies ?? {}, packageName)
    || Object.hasOwn(manifest.optionalDependencies ?? {}, packageName)
}

/** Find one package root using the Desktop/Profile overlay rule. */
export function findOverlayPackage(
  packageName: string,
  options: PackageOverlayOptions,
): PackageOverlaySelection | undefined {
  if (packageNameFromSpecifier(packageName) !== packageName) {
    throw new Error(`${BIN_NAME}: package overlay requires one exact npm package name`)
  }
  // A live generation must admit the separately installed suite before any old
  // direct payload can load. Preparation's migration lookup omits this list.
  if (options.profileBundleNames !== undefined && RETIRED_EJIANBAO_PACKAGES.has(packageName)
    && !options.profileBundleNames.includes(EJIANBAO_ROOT)) return
  // The suite's three engines form one release unit. Preserved old standalone
  // engine installations must never replace its matching bundled implementation.
  if (options.profileBundleNames !== undefined && EJIANBAO_ENGINE_PACKAGES.has(packageName)) {
    const profile = bundledProfileCandidate(packageName, options, EJIANBAO_ROOT)
    return profile === undefined ? undefined : { packageName, selected: profile, profile }
  }
  const install = readCandidate(packageName, options.installPackageUrl, 'install')
  let profile: PackageOverlayCandidate | undefined
  try {
    profile = readCandidate(packageName, options.profilePackageUrl, 'profile')
  } catch (cause) {
    // A valid Desktop package is the stable fallback when a stale Profile copy
    // has unreadable identity/version metadata. Invalid Desktop metadata still
    // fails before this branch and is never hidden by the Profile.
    if (install === undefined) throw cause
    return { packageName, selected: install, install }
  }
  // Admitted external bundle roots must also beat undeclared ancestor leftovers.
  // Only packages declared by Desktop participate in its SemVer overlay policy.
  if (profile !== undefined && install !== undefined
    && options.profileBundleNames?.includes(packageName)
    && !installationDeclaresPackage(packageName, options)) {
    return { packageName, selected: profile, install, profile }
  }
  if (profile === undefined && options.profileBundleNames !== undefined
    && (install === undefined || !installationDeclaresPackage(packageName, options))) {
    const bundled = bundledProfileCandidate(packageName, options)
    if (bundled !== undefined) {
      return { packageName, selected: bundled, profile: bundled, ...(install === undefined ? {} : { install }) }
    }
  }
  if (install === undefined && profile === undefined) return
  const selected = install === undefined
    ? profile!
    : profile === undefined
      ? install
      // Equal SemVer precedence, including build-only differences, keeps the
      // Desktop copy as the deterministic tie-break. A missing or non-SemVer
      // version on either side is not comparable and also keeps Desktop.
      : profile.version !== undefined && install.version !== undefined
        && compare(profile.version, install.version) > 0 ? profile : install
  return {
    packageName,
    selected,
    ...(install === undefined ? {} : { install }),
    ...(profile === undefined ? {} : { profile }),
  }
}

/** Resolve one package root, failing when neither overlay side provides it. */
export function resolveOverlayPackage(
  packageName: string,
  options: PackageOverlayOptions,
): PackageOverlaySelection {
  const selection = findOverlayPackage(packageName, options)
  if (selection === undefined) throw new PackageOverlayNotFoundError(packageName)
  return selection
}
