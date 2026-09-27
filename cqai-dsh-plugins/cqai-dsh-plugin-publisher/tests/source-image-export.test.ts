import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { exportSourceImage } from '../src/source-image-export.ts'
import { readSourceImage, registerSourceDocument } from '../src/source-documents.ts'

const roots: string[] = []
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function fixture() {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'ebao-export-image-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const markdownPath = join(workspace, 'article.md')
  writeFileSync(markdownPath, '# 原文\n')
  return { root, workspace, markdownPath }
}

function verified(data: Buffer, mediaType: ImageAttachmentRef['mediaType'] = 'image/png') {
  const digest = createHash('sha256').update(data).digest('hex')
  return {
    ref: {
      attachmentId: `sha256:${digest}` as ImageAttachmentRef['attachmentId'],
      mediaType, bytes: data.length, width: 2, height: 2,
    } satisfies ImageAttachmentRef,
    data,
  }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('export a verified attachment beside the original Markdown', () => {
  it('writes a content-addressed relative image once and keeps the MD unchanged', () => {
    const { workspace, markdownPath } = fixture()
    const image = verified(png)
    const expected = `images/${image.ref.attachmentId.slice('sha256:'.length)}.png`
    expect(exportSourceImage(markdownPath, image, workspace)).toBe(expected)
    expect(readFileSync(join(workspace, expected))).toEqual(png)
    expect(readFileSync(markdownPath, 'utf8')).toBe('# 原文\n')
    expect(exportSourceImage('article.md', image, workspace)).toBe(expected)
    expect(readFileSync(join(workspace, expected))).toEqual(png)
    expect(statSync(join(workspace, 'images')).isDirectory()).toBe(true)

    const jpegImage = verified(jpeg, 'image/jpeg')
    expect(exportSourceImage(markdownPath, jpegImage, workspace)).toMatch(/^images\/[0-9a-f]{64}\.jpg$/u)
  })

  it('refuses a forged attachment reference or mismatched image format', () => {
    const { workspace, markdownPath } = fixture()
    const valid = verified(png)
    expect(() => exportSourceImage(markdownPath, { ...valid, ref: { ...valid.ref, bytes: png.length + 1 } }, workspace))
      .toThrow('字节与引用不一致')
    expect(() => exportSourceImage(markdownPath, { ...valid, ref: {
      ...valid.ref, attachmentId: `sha256:${'0'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    } }, workspace)).toThrow('字节与引用不一致')
    expect(() => exportSourceImage(markdownPath, verified(png, 'image/jpeg'), workspace)).toThrow('仅支持真实')
    expect(() => exportSourceImage(markdownPath, verified(Buffer.from('GIF89a'), 'image/gif'), workspace)).toThrow('仅支持真实')
    expect(existsSync(join(workspace, 'images'))).toBe(false)
  })

  it('rejects missing, symlinked, and outside-workspace Markdown files', () => {
    const { root, workspace, markdownPath } = fixture()
    expect(() => exportSourceImage('missing.md', verified(png), workspace)).toThrow('Markdown 文件不存在')
    const linked = join(workspace, 'linked.md')
    symlinkSync(markdownPath, linked)
    expect(() => exportSourceImage(linked, verified(png), workspace)).toThrow('符号链接')
    const outside = join(root, 'outside.md')
    writeFileSync(outside, '# outside')
    expect(() => exportSourceImage(outside, verified(png), workspace)).toThrow('超出当前 Agent 工作目录')
    expect(existsSync(join(workspace, 'images'))).toBe(false)
  })

  it('allows a symlinked parent alias only when its real target remains in the workspace', () => {
    const { root, workspace } = fixture()
    const alias = join(root, 'alias')
    symlinkSync(workspace, alias, 'dir')
    expect(exportSourceImage(join(alias, 'article.md'), verified(png), workspace)).toMatch(/^images\/[^/]+\.png$/u)
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'other.md'), '# outside')
    const escaped = join(workspace, 'escaped')
    symlinkSync(outside, escaped, 'dir')
    expect(() => exportSourceImage(join(escaped, 'other.md'), verified(png), workspace))
      .toThrow('超出当前 Agent 工作目录')
  })

  it('never follows a symlink images directory or overwrites different target bytes', () => {
    const { root, workspace, markdownPath } = fixture()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(workspace, 'images'), 'dir')
    expect(() => exportSourceImage(markdownPath, verified(png), workspace)).toThrow('images 目录必须是普通目录')
    expect(readFileSync(markdownPath, 'utf8')).toBe('# 原文\n')
    rmSync(join(workspace, 'images'))

    mkdirSync(join(workspace, 'images'))
    const image = verified(png)
    const destination = join(workspace, 'images', `${image.ref.attachmentId.slice('sha256:'.length)}.png`)
    writeFileSync(destination, Buffer.from('different bytes'))
    expect(() => exportSourceImage(markdownPath, image, workspace)).toThrow('字节不同，未覆盖')
    expect(readFileSync(destination, 'utf8')).toBe('different bytes')
  })

  it('produces a Markdown path that SourceDocument can resolve without a session image event', () => {
    const { root, workspace, markdownPath } = fixture()
    const imagePath = exportSourceImage(markdownPath, verified(png), workspace)
    writeFileSync(markdownPath, `# 原文\n\n![配图](${imagePath})`)
    const env = { DSH_HOME: join(root, 'dsh-home') }
    const snapshot = registerSourceDocument('export-session', markdownPath, env, { allowedRoot: workspace })
    expect(snapshot.images).toHaveLength(1)
    expect(snapshot.body).toContain(`![配图](source-image://${snapshot.images[0]!.id})`)
    expect(readSourceImage(snapshot.id, snapshot.images[0]!.id, env).data).toEqual(png)
  })
})
