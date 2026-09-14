/** Versioned, non-destructive adoption of the upstream dsh-imagegen data tree. */

import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'

export const IMAGE_DATA_SCHEMA_VERSION = 1
export const IMAGE_DATA_MIGRATION_MARKER = '.cqai-imagegen-data.json'
const BACKUP_DIR = 'migration-backups'

interface MigrationMarker {
  owner: 'cqai-dsh-plugin-imagegen'
  version: number
  migratedAt: string
  source: 'dsh-imagegen-v1.5.12'
  backup?: string
}

export interface ImageDataMigrationResult {
  migrated: boolean
  version: number
  backupDir?: string
  metadataFiles: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function jsonFilesBelow(root: string): Promise<string[]> {
  if (!await exists(root)) return []
  const out: string[] = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(target)
    }
  }
  await visit(root)
  return out
}

/** Only metadata is backed up; generated images and other large assets stay put. */
async function metadataFiles(root: string): Promise<string[]> {
  const candidates = [
    path.join(root, 'index.json'),
    path.join(root, 'gallery', 'index.json'),
    path.join(root, 'canvas', 'index.json'),
    path.join(root, 'templates', 'favorites.json'),
  ]
  candidates.push(...await jsonFilesBelow(path.join(root, 'canvas', 'pages')))
  candidates.push(...await jsonFilesBelow(path.join(root, 'templates')))
  const present: string[] = []
  for (const candidate of [...new Set(candidates)]) {
    if (await exists(candidate)) present.push(candidate)
  }
  return present.sort()
}

async function readMarker(file: string): Promise<MigrationMarker | undefined> {
  if (!await exists(file)) return undefined
  const raw = await fs.readFile(file, 'utf8')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error(`invalid imagegen data migration marker: ${file}`) }
  if (!isPlainObject(value) || value.owner !== 'cqai-dsh-plugin-imagegen'
    || !Number.isSafeInteger(value.version) || typeof value.migratedAt !== 'string') {
    throw new Error(`invalid imagegen data migration marker: ${file}`)
  }
  return value as unknown as MigrationMarker
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  const handle = await fs.open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

function backupName(now: Date): string {
  return `v0-to-v${IMAGE_DATA_SCHEMA_VERSION}-${now.toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
}

/**
 * Adopt an existing `~/.dsh/dsh-imagegen` tree without changing its file
 * formats.  Every JSON metadata file is parsed first, copied byte-for-byte to a
 * versioned backup, and only then is the new atomic ownership/version marker
 * written.  Originals are never deleted or rewritten.
 */
export async function migrateImageData(
  root: string,
  options: { now?: Date } = {},
): Promise<ImageDataMigrationResult> {
  const resolvedRoot = path.resolve(root)
  await fs.mkdir(resolvedRoot, { recursive: true, mode: 0o700 })
  const markerPath = path.join(resolvedRoot, IMAGE_DATA_MIGRATION_MARKER)
  const marker = await readMarker(markerPath)
  if (marker !== undefined) {
    if (marker.version > IMAGE_DATA_SCHEMA_VERSION) {
      throw new Error(`imagegen data schema v${marker.version} is newer than supported v${IMAGE_DATA_SCHEMA_VERSION}`)
    }
    if (marker.version === IMAGE_DATA_SCHEMA_VERSION) {
      return { migrated: false, version: marker.version, metadataFiles: [] }
    }
  }

  const files = await metadataFiles(resolvedRoot)
  const snapshots = new Map<string, Buffer>()
  // Validate the complete migration set before creating a backup directory or
  // marker.  One corrupt metadata file therefore leaves the tree untouched.
  for (const file of files) {
    const data = await fs.readFile(file)
    try { JSON.parse(data.toString('utf8')) } catch {
      throw new Error(`cannot migrate invalid imagegen metadata: ${path.relative(resolvedRoot, file)}`)
    }
    snapshots.set(file, data)
  }

  const now = options.now ?? new Date()
  let relativeBackup: string | undefined
  let backupDir: string | undefined
  if (files.length > 0) {
    relativeBackup = path.join(BACKUP_DIR, backupName(now))
    backupDir = path.join(resolvedRoot, relativeBackup)
    for (const [file, data] of snapshots) {
      const relative = path.relative(resolvedRoot, file)
      const destination = path.join(backupDir, relative)
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
      await fs.writeFile(destination, data, { flag: 'wx', mode: fsConstants.S_IRUSR | fsConstants.S_IWUSR })
    }
  }

  const nextMarker: MigrationMarker = {
    owner: 'cqai-dsh-plugin-imagegen',
    version: IMAGE_DATA_SCHEMA_VERSION,
    migratedAt: now.toISOString(),
    source: 'dsh-imagegen-v1.5.12',
    ...relativeBackup === undefined ? {} : { backup: relativeBackup },
  }
  await atomicJson(markerPath, nextMarker)
  return {
    migrated: true,
    version: IMAGE_DATA_SCHEMA_VERSION,
    ...backupDir === undefined ? {} : { backupDir },
    metadataFiles: files.map(file => path.relative(resolvedRoot, file)),
  }
}

const migrations = new Map<string, Promise<ImageDataMigrationResult>>()

/** De-duplicate startup requests from the route and Agent-tool effects. */
export function ensureImageDataMigration(root: string): Promise<ImageDataMigrationResult> {
  const key = path.resolve(root)
  let pending = migrations.get(key)
  if (pending === undefined) {
    pending = migrateImageData(key)
    migrations.set(key, pending)
    pending.catch(() => { if (migrations.get(key) === pending) migrations.delete(key) })
  }
  return pending
}
