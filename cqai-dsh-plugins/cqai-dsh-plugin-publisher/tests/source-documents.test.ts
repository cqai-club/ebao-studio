import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MarkdownIt from 'markdown-it'
import {
  readSessionSourceDocument, readSessionSourceDocumentPath, readSourceDocument, readSourceImage,
  registerSourceDocument,
} from '../src/source-documents.ts'

const roots: string[] = []
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function fixture(): { root: string; workspace: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'ebao-source-doc-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  return { root, workspace, env: { DSH_HOME: join(root, 'dsh-home') } }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('original Markdown source documents', () => {
  it('keeps the Agent-created MD in place and returns opaque inline image references', () => {
    const { root, workspace, env } = fixture()
    mkdirSync(join(workspace, 'images'))
    const relativeImage = join(workspace, 'images', '中文 图.png')
    const absoluteImage = join(root, '封面.jpg')
    writeFileSync(relativeImage, png)
    writeFileSync(absoluteImage, jpeg)
    const markdownPath = join(workspace, '文章.md')
    const original = `# 第一篇文章\n\n正文 ![图一](<images/中文 图.png> "保留标题")\n\n![封面](${absoluteImage})\n`
    writeFileSync(markdownPath, original)

    expect(readSessionSourceDocument('session-1', env)).toBeNull()
    expect(readSessionSourceDocumentPath('session-1', env)).toBeNull()
    const snapshot = registerSourceDocument('session-1', markdownPath, env)
    expect(readSessionSourceDocumentPath('session-1', env)).toBe(realpathSync.native(markdownPath))
    expect(readFileSync(markdownPath, 'utf8')).toBe(original)
    expect(snapshot).toMatchObject({
      sessionId: 'session-1', fileName: '文章.md', title: '第一篇文章',
      images: [
        { name: '中文 图.png', mime: 'image/png', bytes: png.length },
        { name: '封面.jpg', mime: 'image/jpeg', bytes: jpeg.length },
      ],
    })
    expect(snapshot.revision).toMatch(/^[0-9a-f]{64}$/u)
    expect(snapshot.body).not.toContain(workspace)
    expect(snapshot.body).not.toContain(root)
    expect(JSON.stringify(snapshot)).not.toContain(markdownPath)
    expect(JSON.stringify(snapshot)).not.toContain(absoluteImage)
    expect(snapshot.body).toContain(`![图一](<${snapshot.images[0]!.src}> "保留标题")`)
    expect(snapshot.images.every(image => image.src === `source-image://${image.id}`)).toBe(true)
    const imageTokens = new MarkdownIt().parse(snapshot.body, {}).flatMap(token => token.children ?? [])
      .filter(token => token.type === 'image')
    expect(imageTokens.map(token => token.attrGet('src'))).toEqual(snapshot.images.map(image => image.src))
    expect(readSourceImage(snapshot.id, snapshot.images[0]!.id, env)).toEqual({
      data: png, mime: 'image/png', name: '中文 图.png',
    })
    expect(readSourceImage(snapshot.id, snapshot.images[1]!.id, env).data).toEqual(jpeg)
    expect(readSourceDocument(snapshot.id, env)).toEqual(snapshot)
    expect(readSessionSourceDocument('session-1', env)).toEqual(snapshot)
    expect(existsSync(join(env.DSH_HOME!, 'publisher', 'contents'))).toBe(false)
  })

  it('changes revision when the original Markdown or image bytes change while keeping image IDs stable', () => {
    const { workspace, env } = fixture()
    const image = join(workspace, 'one.png')
    const markdownPath = join(workspace, 'source.md')
    writeFileSync(image, png)
    writeFileSync(markdownPath, '# 标题\n\n![图](one.png)')
    const first = registerSourceDocument('revision-session', markdownPath, env)
    writeFileSync(image, Buffer.concat([png, Buffer.from([4])]))
    const changedImage = readSourceDocument(first.id, env)
    expect(changedImage.revision).not.toBe(first.revision)
    expect(changedImage.images[0]!.id).toBe(first.images[0]!.id)
    expect(changedImage.images[0]!.bytes).toBe(png.length + 1)
    writeFileSync(markdownPath, '# 新标题\n\n![图](one.png)')
    const changedText = readSessionSourceDocument('revision-session', env)!
    expect(changedText.revision).not.toBe(changedImage.revision)
    expect(changedText.title).toBe('新标题')
    expect(changedText.images[0]!.id).toBe(first.images[0]!.id)
    expect(registerSourceDocument('revision-session', markdownPath, env)).toEqual(changedText)
  })

  it('accepts a balanced parenthesis in a local image path and ignores fenced image examples', () => {
    const { workspace, env } = fixture()
    mkdirSync(join(workspace, 'images'))
    writeFileSync(join(workspace, 'images', 'a(1).png'), png)
    const markdownPath = join(workspace, 'source.md')
    writeFileSync(markdownPath, '# 标题\n\n```md\n![示例](missing.png)\n<img src="missing.png">\n```\n\n![实图](images/a(1).png)\n')
    const snapshot = registerSourceDocument('parenthesis', markdownPath, env)
    expect(snapshot.images).toHaveLength(1)
    expect(snapshot.body).toContain('![示例](missing.png)')
    expect(snapshot.body).toContain('<img src="missing.png">')
    expect(snapshot.body).toContain(`![实图](${snapshot.images[0]!.src})`)
    expect(readSourceImage(snapshot.id, snapshot.images[0]!.id, env).data).toEqual(png)
  })

  it('rewrites images inside Markdown tables without touching code examples in adjacent cells', () => {
    const { workspace, env } = fixture()
    writeFileSync(join(workspace, 'table.png'), png)
    const markdownPath = join(workspace, 'table.md')
    writeFileSync(markdownPath, '| 示例 | 图片 |\n| --- | --- |\n| `![代码](absent.png)` | ![实图](table.png) |\n')
    const snapshot = registerSourceDocument('table-session', markdownPath, env)
    expect(snapshot.images).toHaveLength(1)
    expect(snapshot.body).toContain('`![代码](absent.png)`')
    expect(snapshot.body).toContain(`![实图](${snapshot.images[0]!.src})`)
  })

  it('treats a newly registered file path as a new source revision even with identical text', () => {
    const { workspace, env } = fixture()
    const firstPath = join(workspace, '第一篇.md')
    const secondPath = join(workspace, '第二篇.md')
    writeFileSync(firstPath, '相同正文')
    writeFileSync(secondPath, '相同正文')
    const first = registerSourceDocument('same-text', firstPath, env)
    const second = registerSourceDocument('same-text', secondPath, env)
    expect(second.title).toBe('第二篇')
    expect(second.revision).not.toBe(first.revision)
  })

  it('does not replace a valid registration when a new MD has a missing or unsupported image', () => {
    const { workspace, env } = fixture()
    const originalPath = join(workspace, 'original.md')
    writeFileSync(originalPath, '正文，没有图片')
    const original = registerSourceDocument('registration', originalPath, env)
    expect(original.title).toBe('original')
    expect(original.body).toBe('正文，没有图片')

    const missingPath = join(workspace, 'missing.md')
    writeFileSync(missingPath, '# 标题\n![图](absent.png)')
    expect(() => registerSourceDocument('registration', missingPath, env)).toThrow('absent.png')
    expect(readSessionSourceDocument('registration', env)).toEqual(original)

    const unsupportedPath = join(workspace, 'unsupported.md')
    writeFileSync(join(workspace, 'photo.gif'), Buffer.from('GIF89a'))
    writeFileSync(unsupportedPath, '![图](photo.gif)')
    expect(() => registerSourceDocument('registration', unsupportedPath, env)).toThrow('仅支持 JPEG、PNG、WebP')
    expect(readSessionSourceDocument('registration', env)).toEqual(original)
  })

  it('rejects symlink images and remote or non-inline image destinations', () => {
    const { workspace, env } = fixture()
    writeFileSync(join(workspace, 'real.png'), png)
    symlinkSync(join(workspace, 'real.png'), join(workspace, 'linked.png'))
    const file = join(workspace, 'images.md')
    writeFileSync(file, '![图](linked.png)')
    expect(() => registerSourceDocument('symlink', file, env)).toThrow('符号链接')
    writeFileSync(file, '![图](https://example.com/image.png)')
    expect(() => registerSourceDocument('remote', file, env)).toThrow('本地文件路径')
    writeFileSync(file, '![图][ref]\n\n[ref]: real.png')
    expect(() => registerSourceDocument('reference', file, env)).toThrow('普通内联写法')
    expect(readSessionSourceDocument('symlink', env)).toBeNull()
  })

  it('detects a deleted source file or image on later reads and never serves stale bytes', () => {
    const { workspace, env } = fixture()
    const markdownPath = join(workspace, 'source.md')
    const imagePath = join(workspace, 'image.png')
    writeFileSync(imagePath, png)
    writeFileSync(markdownPath, '![图](image.png)')
    const snapshot = registerSourceDocument('disappeared', markdownPath, env)
    rmSync(imagePath)
    expect(() => readSourceDocument(snapshot.id, env)).toThrow('image.png')
    expect(() => readSourceImage(snapshot.id, snapshot.images[0]!.id, env)).toThrow('image.png')
    writeFileSync(imagePath, png)
    rmSync(markdownPath)
    expect(() => readSessionSourceDocument('disappeared', env)).toThrow('Markdown 文件不存在')
  })

  it('persists the Agent workspace boundary for both the MD and its images', () => {
    const { root, workspace, env } = fixture()
    const outsideMarkdown = join(root, 'outside.md')
    const outsideImage = join(root, 'outside.png')
    writeFileSync(outsideMarkdown, '# 工作区外文档')
    writeFileSync(outsideImage, png)
    expect(() => registerSourceDocument('outside-source', outsideMarkdown, env, { allowedRoot: workspace }))
      .toThrow('超出当前 Agent 工作目录')

    const markdownPath = join(workspace, 'source.md')
    writeFileSync(markdownPath, `![外部图](${outsideImage})`)
    expect(() => registerSourceDocument('outside-image', markdownPath, env, { allowedRoot: workspace }))
      .toThrow('超出当前 Agent 工作目录')
    expect(readSessionSourceDocument('outside-image', env)).toBeNull()

    const imagePath = join(workspace, 'inside.png')
    writeFileSync(imagePath, png)
    writeFileSync(markdownPath, '![内部图](inside.png)')
    const accepted = registerSourceDocument('inside', markdownPath, env, { allowedRoot: workspace })
    expect(readSourceDocument(accepted.id, env)).toEqual(accepted)
    const alias = join(root, 'workspace-alias')
    symlinkSync(workspace, alias, 'dir')
    const throughAlias = registerSourceDocument('alias-parent', join(alias, 'source.md'), env, { allowedRoot: alias })
    expect(throughAlias.body).toContain('source-image://')
    expect(readSourceDocument(throughAlias.id, env)).toEqual(throughAlias)

    const outsideDir = join(root, 'outside-images')
    mkdirSync(outsideDir)
    writeFileSync(join(outsideDir, 'outside.png'), png)
    symlinkSync(outsideDir, join(workspace, 'linked-images'), 'dir')
    writeFileSync(markdownPath, '![越界图](linked-images/outside.png)')
    expect(() => readSourceDocument(accepted.id, env)).toThrow('超出当前 Agent 工作目录')
    writeFileSync(markdownPath, '![内部图](inside.png)')
    rmSync(imagePath)
    symlinkSync(outsideImage, imagePath)
    expect(() => readSourceDocument(accepted.id, env)).toThrow('超出当前 Agent 工作目录')
  })
})
