import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { addAsset, contentsRoot, createContent, deleteContent, duplicateContent, listContents, readAsset, readContent, saveContent } from '../src/contents.ts'
import {
  discardEmptyProjectWorkspace, ensureProjectWorkspace, readProjectSettings, saveProjectSettings,
} from '../src/project-workspace.ts'
import { openPublicationFromSource } from '../src/publication-preparation.ts'
import type { PublisherContentType } from '../src/protocol.ts'
import { exportSourceImage } from '../src/source-image-export.ts'
import { readSourceImage, registerSourceDocument } from '../src/source-documents.ts'

const directories: string[] = []
function fixture(): { DSH_HOME: string } {
  const root = mkdtempSync(join(tmpdir(), 'ebao-project-workspace-'))
  directories.push(root)
  return { DSH_HOME: realpathSync(root) }
}
function customRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ebao-custom-projects-'))
  directories.push(root)
  return realpathSync(root)
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

const labels: Record<PublisherContentType, string> = { article: '文章', 'image-note': '图文', video: '视频' }
function expectReadablePath(path: string, root: string, type: PublisherContentType, title = ''): void {
  expect(dirname(path)).toBe(join(root, type))
  const name = basename(path)
  expect(name).toMatch(new RegExp(`^${labels[type]}-${title ? `${title}-` : ''}\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{8}(?:-\\d+)?$`, 'u'))
  expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(180)
  expect(existsSync(path)).toBe(true)
}
function bindingPath(contentId: string, env: NodeJS.ProcessEnv): string {
  return join(contentsRoot(env), contentId, 'project-workspace.json')
}

describe('publisher project workspaces', () => {
  it('creates independent directories for every type and binds old drafts to their first selected root', () => {
    const env = fixture()
    const initial = readProjectSettings(env)
    expect(initial).toEqual({ defaultRoot: join(env.DSH_HOME, 'publisher', 'projects'), isCustom: false })
    const article = createContent('article', env)
    const image = createContent('image-note', env)
    const video = createContent('video', env)
    const paths = new Map<string, string>()
    for (const draft of [article, image, video]) {
      const opened = ensureProjectWorkspace(draft.id, env)
      expect(opened.contentId).toBe(draft.id)
      expectReadablePath(opened.path, initial.defaultRoot, draft.contentType)
      expect(JSON.parse(readFileSync(bindingPath(draft.id, env), 'utf8'))).toEqual({
        version: 2, root: initial.defaultRoot, name: basename(opened.path),
      })
      paths.set(draft.id, opened.path)
    }
    expect(new Set(paths.values()).size).toBe(3)

    const alternate = customRoot()
    expect(saveProjectSettings(alternate, env)).toEqual({ defaultRoot: alternate, isCustom: true })
    expect(readProjectSettings(env)).toEqual({ defaultRoot: alternate, isCustom: true })
    expect(ensureProjectWorkspace(article.id, env).path).toBe(paths.get(article.id))
    const newer = createContent('article', env)
    const newerPath = ensureProjectWorkspace(newer.id, env).path
    expectReadablePath(newerPath, alternate, 'article')
    expect(saveProjectSettings(initial.defaultRoot, env)).toEqual(initial)
    expect(readProjectSettings(env)).toEqual(initial)
    expect(ensureProjectWorkspace(newer.id, env).path).toBe(newerPath)
  })

  it('lazily creates a project for a preexisting draft without changing the draft revision', () => {
    const env = fixture()
    const draft = createContent('image-note', env)
    const original = ensureProjectWorkspace(draft.id, env).path
    rmSync(original, { recursive: true })
    rmSync(join(contentsRoot(env), draft.id, 'project-workspace.json'))
    const alternate = customRoot()
    saveProjectSettings(alternate, env)
    const opened = ensureProjectWorkspace(draft.id, env)
    expectReadablePath(opened.path, alternate, 'image-note')
    expect(existsSync(opened.path)).toBe(true)
    expect(readContent(draft.id, env).revision).toBe(draft.revision)
  })

  it('keeps a bound path stable and reports an offline custom root clearly', () => {
    const env = fixture()
    const alternate = customRoot()
    const selected = saveProjectSettings(join(alternate, '..', alternate.split('/').at(-1)!), env)
    expect(selected.defaultRoot).toBe(alternate)
    const draft = createContent('article', env)
    rmSync(alternate, { recursive: true })
    expect(() => ensureProjectWorkspace(draft.id, env)).toThrow('项目根目录不存在')
    expect(readProjectSettings(env).defaultRoot).toBe(alternate)
  })

  it('keeps project files after draft deletion and makes a named empty project for a duplicate', () => {
    const env = fixture()
    const draft = createContent('article', env, '重庆春日游')
    const source = ensureProjectWorkspace(draft.id, env).path
    writeFileSync(join(source, '用户资料.md'), '保留')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    addAsset(draft.id, '封面.png', png, env)
    const copy = duplicateContent(draft.id, env)
    const target = ensureProjectWorkspace(copy.id, env).path
    expect(target).not.toBe(source)
    expectReadablePath(target, readProjectSettings(env).defaultRoot, 'article', '重庆春日游（副本）')
    expect(copy.title).toBe('重庆春日游（副本）')
    expect(readdirSync(target)).toEqual([])
    deleteContent(draft.id, env)
    expect(readFileSync(join(source, '用户资料.md'), 'utf8')).toBe('保留')
    expect(existsSync(target)).toBe(true)
  })

  it.each(['春', 'a'])('duplicates a long %s title without splitting an emoji before naming its project', character => {
    const env = fixture()
    const draft = createContent('article', env, `${character.repeat(115)}😀`)
    if (character === 'a') expect(basename(ensureProjectWorkspace(draft.id, env).path)).toContain('😀')
    const copy = duplicateContent(draft.id, env)
    expect(copy.title).toBe(`${character.repeat(115)}（副本）`)
    expect(copy.title).not.toMatch(/[\uD800-\uDFFF]/u)
    const path = ensureProjectWorkspace(copy.id, env).path
    expect(Buffer.byteLength(basename(path), 'utf8')).toBeLessThanOrEqual(180)
    expect(basename(path)).not.toContain('�')
    expect(readdirSync(path)).toEqual([])
  })

  it('names a new project with the desktop local calendar date across UTC midnight', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T17:30:00.000Z'))
    try {
      const env = fixture()
      const draft = createContent('article', env, '夜间任务')
      const created = new Date(draft.createdAt)
      const date = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`
      expect(date).not.toBe(draft.createdAt.slice(0, 10))
      expect(basename(ensureProjectWorkspace(draft.id, env).path)).toMatch(new RegExp(`^文章-夜间任务-${date}-[0-9a-f]{8}$`, 'u'))
    } finally {
      vi.useRealTimers()
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('isolates repeated Chinese task names and keeps a binding after title and root changes', () => {
    const env = fixture()
    const root = readProjectSettings(env).defaultRoot
    const first = createContent('article', env, '重庆春日游')
    const second = createContent('article', env, '重庆春日游')
    const firstPath = ensureProjectWorkspace(first.id, env).path
    const secondPath = ensureProjectWorkspace(second.id, env).path
    expectReadablePath(firstPath, root, 'article', '重庆春日游')
    expectReadablePath(secondPath, root, 'article', '重庆春日游')
    expect(secondPath).not.toBe(firstPath)
    writeFileSync(join(firstPath, '旅行计划.md'), '# 第一份计划')
    writeFileSync(join(secondPath, '旅行计划.md'), '# 第二份计划')
    const binding = readFileSync(bindingPath(first.id, env), 'utf8')

    const edited = saveContent(first.id, {
      revision: first.revision, title: '后来修改的标题', body: '', summary: '', tags: [], creativeStatement: 'none',
    }, env)
    saveProjectSettings(customRoot(), env)
    expect(ensureProjectWorkspace(edited.id, env).path).toBe(firstPath)
    expect(readFileSync(bindingPath(first.id, env), 'utf8')).toBe(binding)
    expect(readFileSync(join(firstPath, '旅行计划.md'), 'utf8')).toBe('# 第一份计划')
    expect(readFileSync(join(secondPath, '旅行计划.md'), 'utf8')).toBe('# 第二份计划')
  })

  it.each(['../../重庆\\春日:游*?<>\"|', 'CON', 'AUX.', 'LPT1 ', '长'.repeat(120), '😀'.repeat(60)])(
    'creates a portable bounded directory from task title %s', title => {
      const env = fixture()
      const root = readProjectSettings(env).defaultRoot
      const draft = createContent('article', env, title)
      const path = ensureProjectWorkspace(draft.id, env).path
      const name = basename(path)
      expect(dirname(path)).toBe(join(root, 'article'))
      expect(name).toMatch(/^文章-.+-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/u)
      expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f\u007f]/u)
      expect(name).not.toMatch(/[ .]$/u)
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(180)
      expect(name).not.toContain('�')
      writeFileSync(join(path, '中文资料.txt'), '可读写')
      expect(readFileSync(join(path, '中文资料.txt'), 'utf8')).toBe('可读写')
    },
  )

  it.each(['..', '../其他任务', '其他\\任务', '文章:非法目录', 'CON', 'COM1.txt', '长'.repeat(61)])(
    'rejects an unsafe persisted v2 basename %s', name => {
      const env = fixture()
      const draft = createContent('article', env)
      writeFileSync(bindingPath(draft.id, env), JSON.stringify({ version: 2, root: readProjectSettings(env).defaultRoot, name }))
      expect(() => ensureProjectWorkspace(draft.id, env)).toThrow('草稿项目目录关联无效')
    },
  )

  it('preserves an existing UUID directory when an old draft has no binding', () => {
    const env = fixture()
    const draft = createContent('image-note', env, '历史图文')
    const root = readProjectSettings(env).defaultRoot
    rmSync(ensureProjectWorkspace(draft.id, env).path, { recursive: true })
    rmSync(bindingPath(draft.id, env))
    const legacy = join(root, 'image-note', draft.id)
    mkdirSync(legacy)
    writeFileSync(join(legacy, '旧任务资料.md'), '# 历史文件')
    const manifest = readContent(draft.id, env)
    expect(ensureProjectWorkspace(draft.id, env)).toEqual({ contentId: draft.id, path: legacy })
    expect(readFileSync(join(legacy, '旧任务资料.md'), 'utf8')).toBe('# 历史文件')
    expect(readContent(draft.id, env)).toEqual(manifest)
    expect(JSON.parse(readFileSync(bindingPath(draft.id, env), 'utf8'))).toEqual({ version: 2, root, name: draft.id })
  })

  it('allocates a new directory when an unbound readable candidate already contains unrelated files', () => {
    const env = fixture()
    const draft = createContent('article', env, '重复任务')
    const occupied = ensureProjectWorkspace(draft.id, env).path
    writeFileSync(join(occupied, '其他用户的资料.md'), '不能覆盖')
    rmSync(bindingPath(draft.id, env))
    const opened = ensureProjectWorkspace(draft.id, env).path
    expect(opened).not.toBe(occupied)
    expectReadablePath(opened, readProjectSettings(env).defaultRoot, 'article', '重复任务')
    expect(readdirSync(opened)).toEqual([])
    expect(readFileSync(join(occupied, '其他用户的资料.md'), 'utf8')).toBe('不能覆盖')
    expect(ensureProjectWorkspace(draft.id, env).path).toBe(opened)
  })

  it('exports and registers images from a Chinese project path and reopens its publication preparation', () => {
    const env = fixture()
    const draft = createContent('article', env, '重庆春日游')
    const workspace = ensureProjectWorkspace(draft.id, env).path
    const materials = join(workspace, '中文素材')
    mkdirSync(materials)
    const markdownPath = join(materials, '重庆游记.md')
    writeFileSync(markdownPath, '# 重庆春日游\n\n沿江散步')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const digest = createHash('sha256').update(png).digest('hex')
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${digest}` as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: png.length, width: 2, height: 2,
    }
    const relativeImage = exportSourceImage(markdownPath, { ref, data: png }, workspace)
    writeFileSync(markdownPath, `# 重庆春日游\n\n沿江散步\n\n![春日配图](${relativeImage})`)
    const original = readFileSync(markdownPath, 'utf8')
    const source = registerSourceDocument('chinese-project-session', markdownPath, env, { allowedRoot: workspace })
    expect(source.title).toBe('重庆春日游')
    expect(source.images).toHaveLength(1)
    expect(readSourceImage(source.id, source.images[0]!.id, env).data).toEqual(png)

    const prepared = openPublicationFromSource(source.id, source.revision, 'article', env)
    expectReadablePath(ensureProjectWorkspace(prepared.id, env).path, readProjectSettings(env).defaultRoot, 'article', '重庆春日游')
    expect(prepared.assets).toHaveLength(1)
    expect(readAsset(prepared.id, prepared.assets[0]!.id, env).data).toEqual(png)
    expect(prepared.body).toContain(`![春日配图](ebao-asset://${prepared.assets[0]!.id})`)
    expect(openPublicationFromSource(source.id, source.revision, 'article', env)).toEqual(prepared)
    expect(readFileSync(markdownPath, 'utf8')).toBe(original)
    expect(readFileSync(join(materials, relativeImage))).toEqual(png)
  })

  it('removes only an empty project directory during an aborted operation', () => {
    const env = fixture()
    const emptyDraft = createContent('article', env)
    const emptyPath = ensureProjectWorkspace(emptyDraft.id, env).path
    discardEmptyProjectWorkspace(emptyDraft.id, env)
    expect(existsSync(emptyPath)).toBe(false)

    const occupiedDraft = createContent('article', env)
    const occupiedPath = ensureProjectWorkspace(occupiedDraft.id, env).path
    writeFileSync(join(occupiedPath, '用户资料.md'), '保留')
    discardEmptyProjectWorkspace(occupiedDraft.id, env)
    expect(readFileSync(join(occupiedPath, '用户资料.md'), 'utf8')).toBe('保留')
  })

  it('rejects unsafe roots and symbolic links, and rolls back an aborted draft', () => {
    const env = fixture()
    const draft = createContent('article', env)
    expect(() => saveProjectSettings('relative/path', env)).toThrow('绝对目录')
    expect(() => saveProjectSettings(join(env.DSH_HOME, 'missing'), env)).toThrow('不存在')
    expect(() => saveProjectSettings(contentsRoot(env), env)).toThrow('内部草稿')
    const nested = join(contentsRoot(env), draft.id, 'nested')
    mkdirSync(nested)
    expect(() => saveProjectSettings(nested, env)).toThrow('内部草稿')

    const root = customRoot()
    saveProjectSettings(root, env)
    symlinkSync(contentsRoot(env), join(root, 'video'))
    const before = listContents(env).length
    expect(() => createContent('video', env)).toThrow('项目目录无效')
    expect(listContents(env)).toHaveLength(before)
    const target = ensureProjectWorkspace(draft.id, env).path
    rmSync(target, { recursive: true })
    symlinkSync(contentsRoot(env), target)
    expect(() => ensureProjectWorkspace(draft.id, env)).toThrow('项目目录无效')

    rmSync(target)
    mkdirSync(target)
    const binding = join(contentsRoot(env), draft.id, 'project-workspace.json')
    rmSync(binding)
    symlinkSync(join(contentsRoot(env), draft.id, 'manifest.json'), binding)
    expect(() => ensureProjectWorkspace(draft.id, env)).toThrow('草稿项目目录关联无效')
  })

  it('rejects a default projects directory redirected into internal draft storage', () => {
    const env = fixture()
    mkdirSync(contentsRoot(env), { recursive: true })
    symlinkSync(contentsRoot(env), join(env.DSH_HOME, 'publisher', 'projects'))
    expect(() => createContent('article', env)).toThrow('默认项目目录无效')
    expect(listContents(env)).toEqual([])
  })

  it('rolls back a failed duplicate without copying or deleting user project files', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const withAsset = addAsset(draft.id, '封面.png', png, env)
    const project = ensureProjectWorkspace(draft.id, env).path
    writeFileSync(join(project, 'notes.txt'), 'important')
    rmSync(join(contentsRoot(env), draft.id, 'assets', withAsset.assets[0]!.id))
    expect(() => duplicateContent(draft.id, env)).toThrow()
    expect(listContents(env)).toHaveLength(1)
    expect(readdirSync(join(env.DSH_HOME, 'publisher', 'projects', 'article'))).toEqual([basename(project)])
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('important')
  })

  it('serves settings and per-draft project paths through protected routes', async () => {
    const env = fixture()
    const custom = customRoot()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = env.DSH_HOME
    const ctx = new Context()
    try {
      let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
        handler = route.handler
        return () => { handler = undefined }
      } } as never)
      ctx.provide('desktopRuntime', { publisher: {} } as never)
      await ctx.plugin(plugin)
      const request = async (method: 'GET' | 'POST', action: string, body: unknown = {}, headers: Record<string, string> = {}) => {
        const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []) as IncomingMessage
        Object.assign(req, {
          method, url: `/api/cqai-publisher/${action}`,
          headers: { host: '127.0.0.1:43120', ...headers }, socket: { remoteAddress: '127.0.0.1' },
        })
        let status = 0
        let payload = ''
        const res = { headersSent: false, destroyed: false,
          writeHead: (code: number) => { status = code }, end: (value: string) => { payload = value },
        } as unknown as ServerResponse
        if (!handler) throw new Error('Publisher route was not registered')
        await handler(req, res)
        return { status, body: JSON.parse(payload) as Record<string, unknown> }
      }
      expect((await request('GET', 'project-settings')).body).toEqual(readProjectSettings())
      expect((await request('POST', 'project-settings', { defaultRoot: custom })).status).toBe(403)
      expect((await request('POST', 'project-settings', { defaultRoot: custom },
        { 'x-ejianbao': '1', origin: 'https://evil.example' })).status).toBe(403)
      expect((await request('POST', 'project-settings', { defaultRoot: custom },
        { 'x-ejianbao': '1' })).body).toEqual({ defaultRoot: custom, isCustom: true })
      const draft = createContent('video')
      expect((await request('POST', 'project-workspace', {}, { 'x-ejianbao': '1' })).status).toBe(400)
      const workspace = ensureProjectWorkspace(draft.id)
      expectReadablePath(workspace.path, custom, 'video')
      expect(await request('POST', 'project-workspace', { contentId: draft.id }, { 'x-ejianbao': '1' }))
        .toEqual({ status: 200, body: workspace })
      deleteContent(draft.id)
      expect((await request('POST', 'project-workspace', { contentId: draft.id },
        { 'x-ejianbao': '1' })).status).toBe(400)
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
