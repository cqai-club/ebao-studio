#!/usr/bin/env node
/**
 * Verify that one CQAI plugin package is publishable, that its packed tarball
 * carries every runtime entry the manifest promises, and that the Community
 * Market would accept the published manifest.
 *
 * `dsh-community-market` resolves npm `latest` and requires a stable exact
 * version plus a safe `dsh.bundle.patch` (see
 * `dsh-community-market/src/install/service.ts`). This gate mirrors that
 * contract so a broken build, an unbuilt `lib/`, or a missing `files` entry
 * fails here instead of in the Market.
 *
 * Tarball mode (local or CI, after a build):
 *   (cd cqai-dsh-plugins/<plugin> && npm pack --dry-run --json > pack.json)
 *   node scripts/verify-plugin-publish.mjs \
 *     --plugin-dir cqai-dsh-plugins/<plugin> \
 *     --pack-json pack.json \
 *     [--expected-version 0.1.0]
 *
 * Registry mode (after publishing):
 *   npm view <name>@<version> --json > manifest.json
 *   node scripts/verify-plugin-publish.mjs \
 *     --registry-manifest manifest.json [--expected-version 0.1.0]
 *
 * Exits non-zero when any check fails. Uses no network and spawns no process.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const STABLE_EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

/** Mirrors `BLOCKED_PRODUCT_PACKAGES` in the Market install service. */
const BLOCKED_PRODUCT_PACKAGES = new Set([
  'dsh-plugin-desktop',
  'dsh-plugin-desktop-beta',
  'dsh-desktop-next',
  'dsh-community-market',
])

/** Normalize a manifest target or tarball path to `dir/file` form. */
function normalizeTarget(value) {
  return value.replace(/^\.\//u, '').replaceAll('\\', '/')
}

/** Mirrors `safeBundlePatch` in the Market install service. */
function safeBundlePatch(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) return false
  const path = value.startsWith('./') ? value.slice(2) : value
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'))
}

function usage(message) {
  process.stderr.write(`verify-plugin-publish: ${message}\n`)
  process.stderr.write('usage: node scripts/verify-plugin-publish.mjs (--plugin-dir <dir> --pack-json <file> | --registry-manifest <file>) [--expected-version <v>]\n')
  process.exit(2)
}

function parseArgs(argv) {
  const args = { pluginDir: undefined, packJson: undefined, registryManifest: undefined, expectedVersion: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) usage(`${flag} requires a value`)
    index += 1
    if (flag === '--plugin-dir') args.pluginDir = value
    else if (flag === '--pack-json') args.packJson = value
    else if (flag === '--registry-manifest') args.registryManifest = value
    else if (flag === '--expected-version') args.expectedVersion = value
    else usage(`unknown flag ${flag}`)
  }
  return args
}

/**
 * Read a JSON document that may be surrounded by manager noise.
 *
 * `npm pack --json` still forwards lifecycle-script output (our `prepack`
 * runs the bundler) to the same stream, so the captured file can carry build
 * lines before the JSON payload. Try every `[`/`{` boundary and accept the
 * first slice that parses into a pack-shaped document; bundler log lines such
 * as `[pkg/host] entry: ...` fail to parse and are skipped.
 */
function readJson(path, label) {
  const absolute = isAbsolute(path) ? path : resolve(path)
  if (!existsSync(absolute)) usage(`${label} not found: ${path}`)
  const text = readFileSync(absolute, 'utf8').replace(/^\uFEFF/u, '')
  const boundaries = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '[' || char === '{') boundaries.push(index)
  }
  for (const start of boundaries) {
    let parsed
    try {
      parsed = JSON.parse(text.slice(start))
    } catch {
      continue
    }
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed
    if (candidate !== null && typeof candidate === 'object'
      && typeof candidate.name === 'string' && typeof candidate.version === 'string') {
      return parsed
    }
  }
  usage(`${label} contains no pack manifest JSON: ${path}`)
}

/** Collect every runtime entry the manifest promises (never `types` conditions). */
function collectRuntimeEntries(manifest) {
  const entries = new Set()
  const visit = (node, key) => {
    if (typeof node === 'string') {
      if (key !== 'types') entries.add(normalizeTarget(node))
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, key)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [childKey, child] of Object.entries(node)) visit(child, childKey)
  }
  if (typeof manifest.main === 'string') entries.add(normalizeTarget(manifest.main))
  if (manifest.exports !== undefined) visit(manifest.exports, 'exports')
  return entries
}

const args = parseArgs(process.argv.slice(2))
const registryMode = args.registryManifest !== undefined

if (registryMode) {
  if (args.pluginDir !== undefined || args.packJson !== undefined) {
    usage('--registry-manifest cannot be combined with --plugin-dir or --pack-json')
  }
} else if (args.pluginDir === undefined || args.packJson === undefined) {
  usage('tarball mode requires both --plugin-dir and --pack-json')
}

const results = []
const record = (ok, label, detail = '') => { results.push({ ok, label, detail }) }

const pluginDir = args.pluginDir === undefined ? undefined : resolve(args.pluginDir)
const manifest = registryMode
  ? readJson(args.registryManifest, '--registry-manifest')
  : readJson(join(pluginDir, 'package.json'), 'package.json')

// --- Community Market contract -------------------------------------------------

record(PACKAGE_NAME_PATTERN.test(manifest.name ?? ''), 'package name is a valid npm package name', String(manifest.name))
record(!BLOCKED_PRODUCT_PACKAGES.has(manifest.name), 'package is not a blocked Desktop product package')
record(STABLE_EXACT_VERSION.test(manifest.version ?? ''), 'version is a stable exact semver', String(manifest.version))

if (args.expectedVersion !== undefined) {
  record(manifest.version === args.expectedVersion, 'version matches the requested release version', `expected ${args.expectedVersion}`)
}

const patch = manifest.dsh?.bundle?.patch
record(safeBundlePatch(patch), 'dsh.bundle.patch is a safe relative path', String(patch))

// --- Tarball-only checks -------------------------------------------------------

if (!registryMode) {
  const packRaw = readJson(args.packJson, '--pack-json')
  const packEntry = Array.isArray(packRaw) ? packRaw[0] : packRaw
  const packedFiles = new Set(
    (packEntry?.files ?? []).map(file => normalizeTarget(typeof file === 'string' ? file : file.path)),
  )

  record(packEntry?.name === manifest.name, 'packed tarball carries the same package name', String(packEntry?.name))
  record(packEntry?.version === manifest.version, 'packed tarball carries the same version', String(packEntry?.version))
  record(manifest.private !== true, 'package is not marked private')
  record(Array.isArray(manifest.files) && manifest.files.length > 0, 'manifest declares a files allowlist')
  record(manifest.publishConfig?.access === 'public', 'publishConfig.access is public', String(manifest.publishConfig?.access))

  if (safeBundlePatch(patch)) {
    const patchFile = normalizeTarget(patch)
    record(existsSync(join(pluginDir, patchFile)), 'declared bundle patch exists on disk', patchFile)
    record(packedFiles.has(patchFile), 'declared bundle patch ships in the tarball', patchFile)
  }

  for (const entry of collectRuntimeEntries(manifest)) {
    record(packedFiles.has(entry), `runtime entry ships in the tarball: ${entry}`)
  }

  if (typeof manifest.types === 'string') {
    const typesEntry = normalizeTarget(manifest.types)
    record(packedFiles.has(typesEntry), `declared types ship in the tarball: ${typesEntry}`)
  }

  record([...packedFiles].some(file => /^LICENSE(?:\.[^/]*)?$/u.test(file)), 'tarball includes a LICENSE file')
  record([...packedFiles].some(file => /^README(?:\.[^/]*)?$/u.test(file)), 'tarball includes a README file')
  record(packedFiles.size > 0, 'tarball is not empty', `${String(packedFiles.size)} files`)
}

// --- Registry-only checks ------------------------------------------------------

if (registryMode) {
  record(typeof manifest.dist?.tarball === 'string' && manifest.dist.tarball.length > 0, 'registry manifest exposes a tarball URL')
}

// --- Report --------------------------------------------------------------------

for (const result of results) {
  const suffix = result.detail.length > 0 ? `  (${result.detail})` : ''
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${suffix}\n`)
}

const failures = results.filter(result => !result.ok)
process.stdout.write(`\n${manifest.name ?? '<unnamed>'}@${manifest.version ?? '<no version>'} — ${String(results.length - failures.length)}/${String(results.length)} checks passed\n`)

if (failures.length > 0) {
  process.stdout.write(registryMode
    ? 'PUBLISH VERIFICATION: REJECTED (the Community Market would refuse this package)\n'
    : 'PUBLISH VERIFICATION: REJECTED\n')
  process.exit(1)
}

process.stdout.write(registryMode
  ? 'PUBLISH VERIFICATION: PUBLISHED MANIFEST ACCEPTED\n'
  : 'PUBLISH VERIFICATION: READY TO PUBLISH\n')
