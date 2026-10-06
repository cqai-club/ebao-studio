import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'

/** Exact basename shape written by the history and gallery stores. */
export function isStoredImageFile(file: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/.test(file)
}

const MAX_CACHE_ENTRIES = 512
const MAX_CONCURRENT_READS = 3
const cache = new Map<string, { version: string; sha256: string }>()
let activeReads = 0
const pendingReads: Array<() => void> = []

function versionOf(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

async function withReadSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeReads >= MAX_CONCURRENT_READS) await new Promise<void>(resolve => pendingReads.push(resolve))
  else activeReads++
  try { return await operation() } finally {
    const next = pendingReads.shift()
    if (next === undefined) activeReads--
    else next()
  }
}

function cachedHash(filePath: string, version: string): string | undefined {
  const found = cache.get(filePath)
  if (found?.version !== version) {
    cache.delete(filePath)
    return undefined
  }
  cache.delete(filePath)
  cache.set(filePath, found)
  return found.sha256
}

/** Read-only byte hash: streamed, bounded, and invalidated by file replacement
 * or edits. Never follows image symlinks, creates directories, or writes an index. */
export async function readStoredImageHash(directory: string, file: string): Promise<string | undefined> {
  if (!isStoredImageFile(file)) return undefined
  const filePath = path.join(directory, file)
  try {
    const initial = await lstat(filePath, { bigint: true })
    if (!initial.isFile()) { cache.delete(filePath); return undefined }
    const existing = cachedHash(filePath, versionOf(initial))
    if (existing !== undefined) return existing
    return await withReadSlot(async () => {
      // A request may have waited behind another hash of the same file.
      const before = await lstat(filePath, { bigint: true })
      if (!before.isFile()) { cache.delete(filePath); return undefined }
      const version = versionOf(before)
      const existing = cachedHash(filePath, version)
      if (existing !== undefined) return existing
      const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const opened = await handle.stat({ bigint: true })
        if (!opened.isFile() || versionOf(opened) !== version) return undefined
        const hash = createHash('sha256')
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
        const [after, current] = await Promise.all([handle.stat({ bigint: true }), lstat(filePath, { bigint: true })])
        if (!current.isFile() || versionOf(after) !== version || versionOf(current) !== version) return undefined
        const sha256 = hash.digest('hex')
        cache.set(filePath, { version, sha256 })
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
        return sha256
      } finally { await handle.close() }
    })
  } catch {
    // Missing/unreadable files leave their metadata visible to the caller.
    cache.delete(filePath)
    return undefined
  }
}
