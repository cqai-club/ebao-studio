/** Export one verified attachment beside an Agent-created Markdown file. */
import { createHash } from 'node:crypto'
import {
  existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, statSync, writeFileSync, closeSync, constants,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface VerifiedSourceImage {
  ref: ImageAttachmentRef
  data: Uint8Array
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function sourceMime(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function existingBytes(file: string): Buffer {
  let descriptor: number | undefined
  try {
    const entry = lstatSync(file)
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('目标图片不是普通文件或是符号链接')
    if (entry.size > MAX_IMAGE_BYTES) throw new Error('目标图片已存在但大小无效')
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error('目标图片在读取时发生变化')
    }
    const data = readFileSync(descriptor)
    if (data.length !== opened.size) throw new Error('目标图片在读取时发生变化')
    return data
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * The caller must first use AttachmentStore.readImage(exactRef), then pass its
 * returned ref and bytes. The path is always relative to the original MD file.
 */
export function exportSourceImage(
  markdownPath: string, image: VerifiedSourceImage, allowedRoot: string,
): string {
  if (typeof allowedRoot !== 'string' || !isAbsolute(allowedRoot)) throw new Error('Agent 工作目录无效')
  let root: string
  try { root = realpathSync.native(allowedRoot) }
  catch { throw new Error('Agent 工作目录不存在') }
  if (!statSync(root).isDirectory()) throw new Error('Agent 工作目录无效')
  if (typeof markdownPath !== 'string' || !markdownPath.toLowerCase().endsWith('.md')) {
    throw new Error('请选择现有 .md 文件')
  }
  const requested = resolve(root, markdownPath)
  let markdownFile: string
  try {
    const entry = lstatSync(requested)
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Markdown 文件必须是普通文件，不能是符号链接')
    markdownFile = realpathSync.native(requested)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Markdown 文件必须')) throw cause
    throw new Error('Markdown 文件不存在或无法读取')
  }
  if (!inside(root, markdownFile)) throw new Error('Markdown 文件超出当前 Agent 工作目录')

  const ref = image?.ref
  if (!ref || typeof ref.attachmentId !== 'string' || typeof ref.bytes !== 'number'
    || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > MAX_IMAGE_BYTES
    || typeof ref.mediaType !== 'string' || !(image.data instanceof Uint8Array)) {
    throw new Error('图片附件引用无效')
  }
  const data = Buffer.from(image.data)
  const digest = createHash('sha256').update(data).digest('hex')
  if (data.length !== ref.bytes || ref.attachmentId.toLowerCase() !== `sha256:${digest}`) {
    throw new Error('图片附件字节与引用不一致')
  }
  const mime = sourceMime(data)
  if (!mime || mime !== ref.mediaType) throw new Error('仅支持真实的 JPEG、PNG、WebP 图片')
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'
  const relativePath = `images/${digest}.${extension}`
  const imagesDir = join(dirname(markdownFile), 'images')
  if (!existsSync(imagesDir)) {
    try { mkdirSync(imagesDir, { mode: 0o700 }) }
    catch (cause) {
      if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'EEXIST') throw cause
    }
  }
  const directoryEntry = lstatSync(imagesDir)
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) throw new Error('images 目录必须是普通目录，不能是符号链接')
  const canonicalImagesDir = realpathSync.native(imagesDir)
  if (!inside(root, canonicalImagesDir) || canonicalImagesDir !== join(dirname(markdownFile), 'images')) {
    throw new Error('images 目录超出当前 Agent 工作目录')
  }
  const destination = join(canonicalImagesDir, `${digest}.${extension}`)
  try {
    writeFileSync(destination, data, { flag: 'wx', mode: 0o600 })
  } catch (cause) {
    if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'EEXIST') throw cause
    const existing = existingBytes(destination)
    if (!existing.equals(data)) throw new Error('同名图片已存在且字节不同，未覆盖')
  }
  return relativePath
}
