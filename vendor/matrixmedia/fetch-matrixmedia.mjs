/**
 * Snapshot the MatrixMedia release runtime into `vendor/matrixmedia/<version>/`.
 *
 * MatrixMedia publishes a Windows **NSIS installer** only — there is no portable
 * zip for Windows, and its `lib/` is not on npm. This script therefore downloads
 * the pinned release asset, verifies the GitHub-reported SHA-256, expands the
 * installer silently into a staging directory, and records a per-file manifest.
 *
 * Usage:
 *   node vendor/matrixmedia/fetch-matrixmedia.mjs            # refresh the pinned release
 *   node vendor/matrixmedia/fetch-matrixmedia.mjs --check    # re-hash the committed tree
 *
 * A local proxy is only ever needed for the download step, and only because this
 * workstation reaches GitHub through one. Export `MATRIXMEDIA_PROXY` (or
 * `HTTPS_PROXY` / `ALL_PROXY`) with an `http://`, `https://` or `socks5://` URL.
 * Nothing here is a product feature: the shipped desktop app connects directly.
 *
 * Set `MATRIXMEDIA_ASSET` to an already-downloaded installer to skip the network.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RELEASE = {
  repository: 'https://github.com/hanliang97/MatrixMedia.git',
  tag: 'v0.11.3',
  version: '0.11.3',
  asset: 'MatrixMedia-0.11.3-win-x64.exe',
  bytes: 71_587_366,
  sha256: '461e958d7965af662a6c8381e3d4d8816bb511f17af3ef1a9a44921dd275d072',
}
const OUT = resolve(ROOT, `vendor/matrixmedia/${RELEASE.version}`)
const TREE = join(OUT, 'matrixmedia-win-x64')
/** NSIS leaves a per-machine uninstaller behind; the portable tree never uses it. */
const DROPPED_ENTRIES = ['Uninstall matrixmedia.exe']
const require = createRequire(import.meta.url)

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/** Walk a tree into sorted `{path, bytes, sha256}` rows. */
function inventory(root) {
  const rows = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`)
      else rows.push({ path: `${prefix}${entry.name}`, ...fileRow(path) })
    }
  }
  walk(root, '')
  return rows
}

function fileRow(path) {
  const buffer = readFileSync(path)
  return { bytes: buffer.length, sha256: sha256(buffer) }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Copy a staged install tree entry by entry, dropping nothing but `DROPPED_ENTRIES`. */
function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true })
      copyTree(source, target)
    } else {
      writeFileSync(target, readFileSync(source))
    }
  }
}

/** Resolve undici out of whichever workspace install provides it. */
async function loadUndici() {
  for (const candidate of [
    'undici',
    join(ROOT, 'dsh-plugin-desktop/node_modules/undici/package.json'),
    join(ROOT, 'dsh-community-market/node_modules/undici/package.json'),
  ]) {
    try {
      const resolved = candidate.includes('/') ? pathToFileURL(candidate).href : candidate
      return await import(require.resolve(resolved))
    } catch {
      // Try the next install root.
    }
  }
  throw new Error('undici is unavailable; run `corepack yarn install` first')
}

/** Build a dispatcher for the configured proxy, or `undefined` for a direct fetch. */
async function proxyDispatcher() {
  const url = process.env.MATRIXMEDIA_PROXY || process.env.ALL_PROXY || process.env.HTTPS_PROXY
  if (!url) return undefined
  const undici = await loadUndici()
  const scheme = new URL(url).protocol
  if (scheme === 'socks:' || scheme === 'socks5:' || scheme === 'socks5h:') {
    return new undici.Socks5ProxyAgent(url)
  }
  if (scheme !== 'http:' && scheme !== 'https:') throw new Error(`unsupported proxy scheme: ${scheme}`)
  return new undici.ProxyAgent(url)
}

async function download(target) {
  const prebuilt = process.env.MATRIXMEDIA_ASSET
  if (prebuilt) {
    if (!existsSync(prebuilt)) throw new Error(`MATRIXMEDIA_ASSET not found: ${prebuilt}`)
    writeFileSync(target, readFileSync(prebuilt))
    return 'local asset'
  }
  const dispatcher = await proxyDispatcher()
  const url = `https://github.com/hanliang97/MatrixMedia/releases/download/${RELEASE.tag}/${RELEASE.asset}`
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000), ...(dispatcher ? { dispatcher } : {}) })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} ${url}`)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  await dispatcher?.close()
  return url
}

/** NSIS understands `/S` (silent) and must receive `/D=` last and unquoted. */
function expand(installer, staging) {
  const result = spawnSync(installer, ['/S', `/D=${staging}`], { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  const exe = join(staging, 'matrixmedia.exe')
  if (!existsSync(exe)) throw new Error(`NSIS silent expand produced no matrixmedia.exe (exit ${result.status})`)
}

function refresh() {
  const target = join(OUT, RELEASE.asset)
  mkdirSync(OUT, { recursive: true })
  return download(target).then(source => {
    const bytes = statSync(target).size
    if (bytes !== RELEASE.bytes) throw new Error(`asset size mismatch: expected ${RELEASE.bytes}, got ${bytes}`)
    const digest = sha256(readFileSync(target))
    if (digest !== RELEASE.sha256) throw new Error(`asset sha256 mismatch: expected ${RELEASE.sha256}, got ${digest}`)

    const staging = mkdtempSync(join(tmpdir(), 'matrixmedia-'))
    try {
      expand(target, staging)
      for (const name of DROPPED_ENTRIES) rmSync(join(staging, name), { force: true })
      rmSync(TREE, { recursive: true, force: true })
      mkdirSync(TREE, { recursive: true })
      copyTree(staging, TREE)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }

    const entries = inventory(TREE)
    const manifest = {
      formatVersion: 1,
      repository: RELEASE.repository,
      tag: RELEASE.tag,
      version: RELEASE.version,
      platform: 'win32',
      arch: 'x64',
      entries,
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    }
    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const provenance = {
      ...readJson(join(OUT, 'provenance.json')),
      repository: RELEASE.repository,
      tag: RELEASE.tag,
      assetName: RELEASE.asset,
      assetBytes: bytes,
      assetSha256: digest,
      installArgs: ['/S', '/D=<absolute staging directory>'],
      expandedAt: new Date().toISOString(),
      sourceChanges: [],
    }
    writeFileSync(join(OUT, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
    console.log(`MATRIXMEDIA_VENDOR_READY ${TREE} (${manifest.files} files, ${manifest.bytes} bytes) from ${source}`)
  })
}

function check() {
  const manifest = readJson(join(OUT, 'manifest.json'))
  const actual = inventory(TREE)
  const expected = manifest.entries
  if (actual.length !== expected.length) {
    throw new Error(`entry count mismatch: manifest ${expected.length}, tree ${actual.length}`)
  }
  for (const [index, entry] of expected.entries()) {
    const seen = actual[index]
    if (seen.path !== entry.path) throw new Error(`entry mismatch at ${index}: manifest ${entry.path}, tree ${seen.path}`)
    if (seen.bytes !== entry.bytes || seen.sha256 !== entry.sha256) throw new Error(`content mismatch: ${entry.path}`)
  }
  const provenance = readJson(join(OUT, 'provenance.json'))
  if (provenance.assetSha256 !== RELEASE.sha256 || provenance.tag !== RELEASE.tag) {
    throw new Error('provenance does not match the pinned release')
  }
  console.log(`MATRIXMEDIA_VENDOR_VERIFIED ${RELEASE.tag} (${actual.length} files)`)
}

try {
  if (process.argv.includes('--check')) check()
  else await refresh()
} catch (error) {
  console.error(`MatrixMedia vendor snapshot failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
