import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  addAsset, contentsRoot, createContent, discardContent, duplicateContent, listContents, patchContent, queryContents,
  readAsset, readContent, readStoredContent,
} from '../src/contents.ts'
import {
  isCurrentPublisherSession, readAgentDraftSession, readPublisherSessionOwnership,
  reserveAgentDraftSession, retireAgentDraftSession, writeAgentDraftSession,
} from '../src/agent-draft-session.ts'
import {
  hasContentTrashIntent, isContentLifecyclePending, restoreContent, shouldRetireArchivedPublisherSession,
  trashContent, type ContentLifecycleAdapter,
} from '../src/content-lifecycle.ts'
import { ensureAgentWorkspace } from '../src/agent-workspace.ts'
import { ensureProjectWorkspace, saveProjectSettings } from '../src/project-workspace.ts'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-workflow-'))
  homes.push(home)
  return { DSH_HOME: home }
}
function adapter(): ContentLifecycleAdapter & { archived: Set<string>; available: Set<string> } {
  const archived = new Set<string>()
  const available = new Set<string>()
  return { archived, available,
    isArchived: id => archived.has(id), isAvailable: id => available.has(id),
    archiveSession: vi.fn(id => { archived.add(id) }), restoreSession: vi.fn(id => { archived.delete(id) }) }
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('new publishing workflow storage', () => {
  it('hides untouched old manifests from both lists and keeps one cwd with separate content folders', () => {
    const env = fixture()
    const legacy = createContent('article', env)
    const file = join(contentsRoot(env), legacy.id, 'manifest.json')
    const old = { ...legacy }
    delete old.workflowVersion
    writeFileSync(file, JSON.stringify(old))
    const bytes = readFileSync(file)
    const first = createContent('article', env, '第一篇')
    const shared = ensureAgentWorkspace(first.id, env)
    const anotherRoot = fixture().DSH_HOME
    saveProjectSettings(anotherRoot, env)
    const second = createContent('image-note', env, '第二篇')
    expect(ensureAgentWorkspace(second.id, env)).toBe(shared)
    const firstFolder = ensureProjectWorkspace(first.id, env).path
    const secondFolder = ensureProjectWorkspace(second.id, env).path
    expect(firstFolder).not.toBe(secondFolder)
    expect(dirname(dirname(firstFolder))).toBe(shared)
    expect(dirname(dirname(secondFolder))).toBe(shared)
    expect(listContents(env).map(content => content.id).sort()).toEqual([first.id, second.id].sort())
    expect(queryContents({ contentType: 'article', query: '' }, env).items.map(item => item.id)).toEqual([first.id])
    expect(queryContents({ contentType: 'article', query: '', trash: true }, env).items).toEqual([])
    expect(readFileSync(file)).toEqual(bytes)
    expect(() => ensureAgentWorkspace(legacy.id, env)).toThrow('旧版内容')
  })

  it('reserves one durable session, records reverse ownership and keeps copied content independent', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const sessionId = reserveAgentDraftSession(draft.id, env)
    expect(reserveAgentDraftSession(draft.id, env)).toBe(sessionId)
    writeAgentDraftSession(draft.id, sessionId, env, { workspaceId: 'shared-workspace' })
    expect(readPublisherSessionOwnership(sessionId, env)).toEqual({ contentId: draft.id, sessionId,
      status: 'current', workspaceId: 'shared-workspace' })
    expect(isCurrentPublisherSession(sessionId, draft.id, env)).toBe(true)
    const copy = duplicateContent(draft.id, env)
    expect(readAgentDraftSession(copy.id, env)).toBeNull()
    expect(() => writeAgentDraftSession(copy.id, sessionId, env)).toThrow('其他内容')
    retireAgentDraftSession(sessionId, env)
    expect(readContent(draft.id, env).id).toBe(draft.id)
    expect(isCurrentPublisherSession(sessionId, undefined, env)).toBe(false)
    const newSessionId = reserveAgentDraftSession(draft.id, env)
    expect(newSessionId).not.toBe(sessionId)
    expect(() => writeAgentDraftSession(draft.id, sessionId, env)).toThrow('已解除关联')
    expect(readAgentDraftSession(draft.id, env)).toBe(newSessionId)
  })

  it('merges late changes by field and platform while ordering same-field saves', () => {
    const env = fixture()
    const draft = createContent('article', env)
    patchContent(draft.id, { revision: 1, patch: { title: '手动标题',
      platformVariants: { xhs: { title: '小红书标题', summary: '小红书摘要', coverAssetId: null }, dy: { title: '抖音标题' } },
      platformFields: { xhs: { location: '重庆', category: '旅行' } } } }, env)
    const agent = patchContent(draft.id, { revision: 1, patch: { body: 'Agent 正文',
      platformVariants: { xhs: { body: '小红书正文' } }, platformFields: { xhs: { location: '成都' } } } }, env)
    expect(agent.title).toBe('手动标题')
    expect(agent.platformVariants).toMatchObject({ xhs: { title: '小红书标题', summary: '小红书摘要', body: '小红书正文', coverAssetId: null },
      dy: { title: '抖音标题' } })
    expect(agent.platformFields.xhs).toEqual({ location: '成都', category: '旅行' })
    const last = patchContent(draft.id, { revision: 1, patch: { body: '最后保存正文',
      platformVariants: { xhs: { summary: null }, dy: null },
      unsetVariantFields: { xhs: ['coverAssetId'] }, platformFields: { xhs: { location: null } } } }, env)
    expect(last.body).toBe('最后保存正文')
    expect(last.platformVariants?.xhs).toEqual({ title: '小红书标题', body: '小红书正文' })
    expect(last.platformVariants?.dy).toBeUndefined()
    expect(last.platformFields.xhs).toEqual({ category: '旅行' })
    expect(() => patchContent(draft.id, { revision: last.revision + 1, patch: { title: '未来' } }, env)).toThrow('草稿版本')
    expect(() => patchContent(draft.id, { revision: 1, patch: { revision: 999 } as never }, env)).toThrow('修改字段')
  })

  it('retries uncertain archive/restore outcomes and blocks writes throughout recycling', async () => {
    const env = fixture()
    const draft = createContent('article', env)
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const asset = addAsset(draft.id, '封面.png', png, env).assets[0]!
    const sessionId = reserveAgentDraftSession(draft.id, env)
    const bridge = adapter()
    bridge.available.add(sessionId)
    bridge.archiveSession = vi.fn(id => { bridge.archived.add(id); throw new Error('unknown archive outcome') })
    bridge.beforeTrash = vi.fn(() => {
      expect(hasContentTrashIntent(draft.id, env)).toBe(true)
      expect(isCurrentPublisherSession(sessionId, undefined, env)).toBe(false)
      expect(() => patchContent(draft.id, { revision: 1, patch: { title: '迟到修改' } }, env)).toThrow('回收站')
    })
    await expect(trashContent(draft.id, bridge, env)).rejects.toThrow('unknown archive')
    expect(isContentLifecyclePending(draft.id, env)).toBe(true)
    expect(shouldRetireArchivedPublisherSession(sessionId, env)).toBe(false)
    const trashed = await trashContent(draft.id, bridge, env)
    expect(bridge.archiveSession).toHaveBeenCalledTimes(1)
    expect(listContents(env)).toEqual([])
    expect(queryContents({ contentType: 'article', query: '', trash: true }, env).items[0]?.trashedAt).toBe(trashed.trashedAt)
    expect(existsSync(join(contentsRoot(env), draft.id))).toBe(true)
    expect(() => readAsset(draft.id, asset.id, env)).toThrow('回收站')
    expect(readAsset(draft.id, asset.id, env, { includeTrash: true }).data).toEqual(png)
    bridge.restoreSession = vi.fn(id => { bridge.archived.delete(id); throw new Error('unknown restore outcome') })
    await expect(restoreContent(draft.id, bridge, env)).rejects.toThrow('unknown restore')
    const restored = await restoreContent(draft.id, bridge, env)
    expect(bridge.restoreSession).toHaveBeenCalledTimes(1)
    expect(restored.trashedAt).toBeUndefined()
    expect(isCurrentPublisherSession(sessionId, undefined, env)).toBe(true)
    expect(readAgentDraftSession(draft.id, env)).toBe(sessionId)
    expect(shouldRetireArchivedPublisherSession(sessionId, env)).toBe(true)
  })

  it('keeps newly added Agent assets when a stale editor reorders the images it knew', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const first = addAsset(draft.id, '第一张.png', png, env)
    const second = addAsset(draft.id, '第二张.png', png, env)
    const latest = addAsset(draft.id, 'Agent 新图片.png', png, env)
    const reordered = patchContent(draft.id, { revision: second.revision,
      patch: { assetOrder: [second.assets[1]!.id, first.assets[0]!.id] } }, env)
    expect(reordered.assets.map(asset => asset.id)).toEqual([
      second.assets[1]!.id, first.assets[0]!.id, latest.assets[2]!.id,
    ])
    expect(() => patchContent(draft.id, { revision: second.revision,
      patch: { assetOrder: [first.assets[0]!.id, first.assets[0]!.id] } }, env)).toThrow('素材顺序')
    expect(() => patchContent(draft.id, { revision: second.revision,
      patch: { assetOrder: ['invalid-id'] } }, env)).toThrow('素材顺序')
  })

  it('rolls back aborted creation without leaving recycle-bin entries and refuses associated content', () => {
    const env = fixture()
    const draft = createContent('article', env)
    discardContent(draft.id, env)
    expect(existsSync(join(contentsRoot(env), draft.id))).toBe(false)
    expect(listContents(env, true)).toEqual([])
    const owned = createContent('article', env)
    reserveAgentDraftSession(owned.id, env)
    expect(() => discardContent(owned.id, env)).toThrow('不能回滚')
    expect(readContent(owned.id, env).id).toBe(owned.id)
  })

  it('never resurrects already archived, missing or retired conversations', async () => {
    const env = fixture()
    const bridge = adapter()
    for (const state of ['archived', 'missing', 'retired'] as const) {
      const draft = createContent('article', env)
      const sessionId = reserveAgentDraftSession(draft.id, env)
      bridge.available.add(sessionId)
      if (state === 'archived') bridge.archived.add(sessionId)
      await trashContent(draft.id, bridge, env)
      if (state === 'missing') bridge.available.delete(sessionId)
      if (state === 'retired') retireAgentDraftSession(sessionId, env)
      await restoreContent(draft.id, bridge, env)
      expect(readContent(draft.id, env).id).toBe(draft.id)
      if (state !== 'archived') expect(readAgentDraftSession(draft.id, env)).toBeNull()
    }
    expect(bridge.restoreSession).not.toHaveBeenCalled()
  })

  it('does not archive a source conversation with only a legacy unowned association', async () => {
    const env = fixture()
    const draft = createContent('article', env)
    writeFileSync(join(contentsRoot(env), draft.id, 'agent-session.json'), JSON.stringify({ version: 1, sessionId: 'source-chat' }))
    const bridge = adapter()
    bridge.available.add('source-chat')
    await trashContent(draft.id, bridge, env)
    await restoreContent(draft.id, bridge, env)
    expect(bridge.archiveSession).not.toHaveBeenCalled()
    expect(bridge.restoreSession).not.toHaveBeenCalled()
    expect(isCurrentPublisherSession('source-chat', undefined, env)).toBe(false)
    expect(readStoredContent(draft.id, env).trashedAt).toBeUndefined()
    const owned = reserveAgentDraftSession(draft.id, env)
    expect(owned).not.toBe('source-chat')
    expect(readPublisherSessionOwnership('source-chat', env)).toBeNull()
  })
})
