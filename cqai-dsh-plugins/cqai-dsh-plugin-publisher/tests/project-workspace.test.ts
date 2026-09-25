import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { addAsset, contentsRoot, createContent, deleteContent, duplicateContent, listContents, readContent } from '../src/contents.ts'
import {
  discardEmptyProjectWorkspace, ensureProjectWorkspace, readProjectSettings, saveProjectSettings,
} from '../src/project-workspace.ts'

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

describe('publisher project workspaces', () => {
  it('creates independent directories for every type and binds old drafts to their first selected root', () => {
    const env = fixture()
    const initial = readProjectSettings(env)
    expect(initial).toEqual({ defaultRoot: join(env.DSH_HOME, 'publisher', 'projects'), isCustom: false })
    const article = createContent('article', env)
    const image = createContent('image-note', env)
    const video = createContent('video', env)
    for (const draft of [article, image, video]) {
      expect(ensureProjectWorkspace(draft.id, env)).toEqual({
        contentId: draft.id, path: join(initial.defaultRoot, draft.contentType, draft.id),
      })
    }

    const alternate = customRoot()
    expect(saveProjectSettings(alternate, env)).toEqual({ defaultRoot: alternate, isCustom: true })
    expect(readProjectSettings(env)).toEqual({ defaultRoot: alternate, isCustom: true })
    expect(ensureProjectWorkspace(article.id, env).path).toBe(join(initial.defaultRoot, 'article', article.id))
    const newer = createContent('article', env)
    expect(ensureProjectWorkspace(newer.id, env).path).toBe(join(alternate, 'article', newer.id))
    expect(saveProjectSettings(initial.defaultRoot, env)).toEqual(initial)
    expect(readProjectSettings(env)).toEqual(initial)
    expect(ensureProjectWorkspace(newer.id, env).path).toBe(join(alternate, 'article', newer.id))
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
    expect(opened.path).toBe(join(alternate, 'image-note', draft.id))
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

  it('keeps project files after draft deletion and makes an empty project for a duplicate', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const source = ensureProjectWorkspace(draft.id, env).path
    writeFileSync(join(source, '用户资料.md'), '保留')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    addAsset(draft.id, '封面.png', png, env)
    const copy = duplicateContent(draft.id, env)
    const target = ensureProjectWorkspace(copy.id, env).path
    expect(target).not.toBe(source)
    expect(readdirSync(target)).toEqual([])
    deleteContent(draft.id, env)
    expect(readFileSync(join(source, '用户资料.md'), 'utf8')).toBe('保留')
    expect(existsSync(target)).toBe(true)
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
    expect(readdirSync(join(env.DSH_HOME, 'publisher', 'projects', 'article'))).toEqual([draft.id])
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
      expect(await request('POST', 'project-workspace', { contentId: draft.id }, { 'x-ejianbao': '1' }))
        .toEqual({ status: 200, body: { contentId: draft.id, path: join(custom, 'video', draft.id) } })
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
