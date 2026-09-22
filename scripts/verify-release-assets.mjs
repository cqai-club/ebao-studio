#!/usr/bin/env node
/** Verify stable release artifacts, SHA256SUMS, and Electron Updater metadata. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_RELEASE_CHECKSUM_BYTES = 16 * 1024
export const MAX_UPDATER_METADATA_BYTES = 64 * 1024

function usage() {
  return 'Usage: node scripts/verify-release-assets.mjs --directory <dir> --version <MAJOR.MINOR.PATCH>'
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument !== '--directory' && argument !== '--version') throw new Error(usage())
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(usage())
    values.set(argument.slice(2), value)
    index += 1
  }
  const directory = values.get('directory')
  const version = values.get('version')
  if (directory === undefined || version === undefined || values.size !== 2) throw new Error(usage())
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)) {
    throw new Error(`Release version is not canonical SemVer: ${version}`)
  }
  return { directory: resolve(directory), version }
}

export function expectedReleaseAssets(version) {
  return [
    `eBao-Studio-${version}-universal.dmg`,
    `eBao-Studio-${version}-universal.zip`,
    `eBao-Studio-${version}-x64-Setup.exe`,
    `eBao-Studio-${version}-x64-Portable.zip`,
  ]
}

export function expectedUpdaterMetadata(version) {
  const macZip = `eBao-Studio-${version}-universal.zip`
  const macDmg = `eBao-Studio-${version}-universal.dmg`
  return [
    {
      filename: 'latest.yml',
      asset: `eBao-Studio-${version}-x64-Setup.exe`,
      files: [`eBao-Studio-${version}-x64-Setup.exe`],
    },
    {
      filename: 'latest-mac.yml',
      asset: macZip,
      // Electron Builder includes the manual DMG alongside the ZIP updater
      // payload in macOS metadata. The legacy path remains the ZIP.
      files: [macZip, macDmg],
    },
  ]
}

async function requireRegularFile(path, label) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${path}`)
  return stat
}

function decodeText(buffer, path, label, limit) {
  if (buffer.byteLength === 0) throw new Error(`${label} is empty: ${path}`)
  if (buffer.byteLength > limit) throw new Error(`${label} exceeds ${String(limit)} bytes: ${path}`)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch (cause) {
    throw new Error(`${label} is not valid UTF-8: ${path}`, { cause })
  }
  if (text.charCodeAt(0) === 0xfeff) throw new Error(`${label} must not contain a BOM: ${path}`)
  return text
}

function decodeChecksumManifest(buffer, path) {
  const text = decodeText(buffer, path, 'SHA256SUMS', MAX_RELEASE_CHECKSUM_BYTES)
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function parseChecksumManifest(lines, assets) {
  const expected = new Set(assets)
  const entries = new Map()
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const match = /^([0-9a-f]{64})  ([^\u0000-\u001f\u007f]+)$/u.exec(line)
    if (match === null) throw new Error(`SHA256SUMS has an invalid line: ${JSON.stringify(rawLine)}`)
    const filename = match[2]
    if (!expected.has(filename) || entries.has(filename) || filename.trim() !== filename
      || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`SHA256SUMS has an unexpected or duplicate filename: ${filename}`)
    }
    entries.set(filename, match[1])
  }
  if (entries.size !== assets.length || assets.some(asset => !entries.has(asset))) {
    throw new Error(`SHA256SUMS must contain exactly these assets: ${assets.join(', ')}`)
  }
  return entries
}

async function hashFile(path, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex')
}

function requireSingleMatch(lines, expression, label, metadataPath) {
  const matches = lines.map(line => expression.exec(line)).filter(match => match !== null)
  if (matches.length !== 1) throw new Error(`${metadataPath} must contain exactly one ${label}`)
  return matches[0]
}

function validateSha512(value, metadataPath) {
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(value) || Buffer.from(value, 'base64').byteLength !== 64) {
    throw new Error(`${metadataPath} has an invalid SHA-512 value`)
  }
  return value
}

/**
 * Parse exactly the limited Electron Builder YAML structure that this release uses.
 * A permissive YAML parser would allow aliases, custom tags, and unrelated files;
 * this verifier accepts one version and one complete artifact entry only.
 */
function parseUpdaterMetadata(buffer, path, version, asset, allowedAssets) {
  const text = decodeText(buffer, path, 'updater metadata', MAX_UPDATER_METADATA_BYTES)
  if (text.includes('\r')) throw new Error(`${path} must use LF line endings`)
  const lines = text.split('\n').filter(line => line.length > 0)
  const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const escapedVersion = version.replaceAll('.', '\\.')
  requireSingleMatch(lines, new RegExp(`^version: ${escapedVersion}$`, 'u'), 'version field', path)
  const filesIndex = lines.findIndex(line => line === 'files:')
  if (filesIndex < 0 || lines.filter(line => line === 'files:').length !== 1) {
    throw new Error(`${path} must contain exactly one files field`)
  }

  const fileEntries = new Map()
  for (let index = filesIndex + 1; index < lines.length; index += 1) {
    const url = /^  - url: ([^\s]+)$/u.exec(lines[index])
    if (url === null) continue
    const filename = url[1]
    const sha512 = /^    sha512: ([A-Za-z0-9+/=]+)$/u.exec(lines[index + 1] ?? '')
    const size = /^    size: ([1-9][0-9]*)$/u.exec(lines[index + 2] ?? '')
    if (sha512 === null || size === null || fileEntries.has(filename)) {
      throw new Error(`${path} has an invalid or duplicate file entry for ${filename}`)
    }
    const parsedSize = Number(size[1])
    if (!Number.isSafeInteger(parsedSize)) throw new Error(`${path} has an unsafe artifact size`)
    fileEntries.set(filename, { sha512: validateSha512(sha512[1], path), size: parsedSize })
    index += 2
  }
  if (fileEntries.size !== allowedAssets.length
    || allowedAssets.some(filename => !fileEntries.has(filename))) {
    throw new Error(`${path} must contain exactly these artifact URLs: ${allowedAssets.join(', ')}`)
  }
  const selected = fileEntries.get(asset)
  if (selected === undefined) throw new Error(`${path} is missing updater artifact: ${asset}`)
  requireSingleMatch(lines, new RegExp(`^path: ${escapedAsset}$`, 'u'), 'legacy path field', path)
  const legacySha512 = validateSha512(
    requireSingleMatch(lines, /^sha512: ([A-Za-z0-9+/=]+)$/u, 'legacy SHA-512', path)[1],
    path,
  )
  if (legacySha512 !== selected.sha512) throw new Error(`${path} has inconsistent SHA-512 fields`)
  return selected
}

export async function verifyReleaseAssets(directory, version) {
  const root = resolve(directory)
  const assets = expectedReleaseAssets(version)
  const metadata = expectedUpdaterMetadata(version)
  const names = new Set([...assets, ...metadata.map(entry => entry.filename), 'SHA256SUMS'])
  const entries = await readdir(root, { withFileTypes: true })
  const actualNames = entries.map(entry => entry.name).sort()
  const expectedNames = [...names].sort()
  if (actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error(`Unexpected release asset set. Expected: ${expectedNames.join(', ')}; found: ${actualNames.join(', ')}`)
  }

  for (const asset of assets) await requireRegularFile(resolve(root, asset), asset)
  const checksumPath = resolve(root, 'SHA256SUMS')
  await requireRegularFile(checksumPath, 'SHA256SUMS')
  const entriesByName = parseChecksumManifest(decodeChecksumManifest(await readFile(checksumPath), checksumPath), assets)
  for (const asset of assets) {
    const actual = await hashFile(resolve(root, asset), 'sha256')
    const expected = entriesByName.get(asset)
    if (actual !== expected) throw new Error(`SHA-256 mismatch for ${asset}: expected ${expected}, got ${actual}`)
  }

  for (const entry of metadata) {
    const metadataPath = resolve(root, entry.filename)
    await requireRegularFile(metadataPath, entry.filename)
    const parsed = parseUpdaterMetadata(await readFile(metadataPath), metadataPath, version, entry.asset, entry.files)
    const assetPath = resolve(root, entry.asset)
    const size = (await requireRegularFile(assetPath, entry.asset)).size
    if (size !== parsed.size) throw new Error(`${entry.filename} size does not match ${entry.asset}`)
    const actual = await hashFile(assetPath, 'sha512')
    if (actual !== parsed.sha512) throw new Error(`${entry.filename} SHA-512 does not match ${entry.asset}`)
  }
  return { assets, checksumPath, metadata: metadata.map(entry => entry.filename) }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { directory, version } = parseArguments(process.argv.slice(2))
    await verifyReleaseAssets(directory, version)
    process.stdout.write(`verify-release-assets: v${version} contains verified installers and Electron Updater metadata\n`)
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
