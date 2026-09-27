/** Verify the unsigned Windows x64 portable ZIP archive. */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { assertPortableExecutableBuffer } from './verify-win-installer.ts'
import { WINDOWS_PUBLISHER_EXECUTABLE } from './publisher-helper.ts'

export interface WindowsPortableVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

function defaultOptions(): WindowsPortableVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return { desktopRoot, version: readVersion(desktopRoot) }
}

/** Verify the exact versioned portable archive and its application entry. */
export function verifyWindowsPortable(
  options: WindowsPortableVerificationOptions = defaultOptions(),
): string {
  const portablePath = join(
    options.desktopRoot,
    'dist',
    `eBao-Studio-${options.version}-x64-Portable.zip`,
  )
  const stat = statSync(portablePath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Windows portable archive is not a non-empty regular file: ${portablePath}`)
  }
  const archive = new AdmZip(portablePath)
  const entries = archive.getEntries().filter(entry => !entry.isDirectory)
  const executable = entries.find(entry => entry.entryName.replaceAll('\\', '/') === '易宝工坊.exe')
  if (executable === undefined) {
    throw new Error(`Windows portable archive is missing 易宝工坊.exe: ${portablePath}`)
  }
  if (!entries.some(entry => entry.entryName.replaceAll('\\', '/') === 'resources/app.asar')) {
    throw new Error(`Windows portable archive is missing resources/app.asar: ${portablePath}`)
  }
  assertPortableExecutableBuffer(
    executable.getData(),
    'Windows portable application',
    `${portablePath}:易宝工坊.exe`,
  )
  const publisherRoot = 'resources/publisher/'
  const workerEntryName = `${publisherRoot}${WINDOWS_PUBLISHER_EXECUTABLE}`
  const worker = entries.find(entry => entry.entryName.replaceAll('\\', '/') === workerEntryName)
  if (worker === undefined) {
    throw new Error(`Windows portable archive is missing ${workerEntryName}: ${portablePath}`)
  }
  assertPortableExecutableBuffer(worker.getData(), 'Windows portable Publisher Worker', `${portablePath}:${workerEntryName}`)
  for (const entryName of [
    `${publisherRoot}resources/app.asar`,
    `${publisherRoot}LICENSE`,
    `${publisherRoot}SOURCE.json`,
  ]) {
    const entry = entries.find(candidate => candidate.entryName.replaceAll('\\', '/') === entryName)
    if (entry === undefined || entry.header.size === 0) {
      throw new Error(`Windows portable archive is missing ${entryName}: ${portablePath}`)
    }
  }
  return portablePath
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Windows portable verification passed: ${verifyWindowsPortable()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
