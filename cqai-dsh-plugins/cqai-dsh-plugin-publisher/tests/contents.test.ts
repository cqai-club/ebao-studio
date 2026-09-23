import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addAsset, contentsRoot, createContent, deleteContent, duplicateContent,
  listContents, readAsset, readContent, removeAsset, resolveContent, saveContent,
} from '../src/contents.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ebao-contents-'))
  roots.push(root)
  return { DSH_HOME: root }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

describe('publisher local content library', () => {
  it('keeps independent, restart-readable video drafts with editable source and metadata', () => {
    const env = fixture()
    const first = createContent('video', env)
    const second = createContent('video', env)
    const saved = saveContent(first.id, {
      revision: first.revision, title: '第一条视频', body: '', summary: '',
      description: '视频简介', shortTitle: '短标题', tags: ['AI'], creativeStatement: 'none',
      videoSource: { kind: 'work', workId: '11111111-1111-4111-8111-111111111111' },
    }, env)
    expect(saved.videoSource).toEqual({ kind: 'work', workId: '11111111-1111-4111-8111-111111111111' })
    expect(readContent(first.id, env)).toMatchObject({ title: '第一条视频', description: '视频简介', shortTitle: '短标题' })
    expect(readContent(second.id, env).videoSource).toBeUndefined()
    expect(readContent(second.id, env).revision).toBe(1)
    const copy = duplicateContent(first.id, env)
    expect(copy.id).not.toBe(first.id)
    expect(copy.videoSource).toEqual(saved.videoSource)
    expect(listContents(env).filter(item => item.contentType === 'video')).toHaveLength(3)
    expect(() => addAsset(first.id, 'cover.png', png, env)).toThrow('不支持图片素材')
    expect(() => saveContent(first.id, {
      ...saved, revision: saved.revision, videoSource: { kind: 'local',
        localVideoId: '22222222-2222-4222-8222-222222222222', fileName: '../evil.mp4', bytes: 12 },
    }, env)).toThrow('视频草稿字段无效')
    expect(() => saveContent(first.id, {
      ...saved, revision: saved.revision, body: '文章正文',
    }, env)).toThrow('视频草稿字段无效')
    deleteContent(first.id, env)
    expect(readContent(copy.id, env).videoSource).toEqual(saved.videoSource)
  })

  it('persists independent revisions and copies assets into a duplicate draft', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const saved = saveContent(draft.id, {
      revision: draft.revision, title: 'Markdown 文章', body: '# 标题\n内容',
      summary: '摘要', tags: ['AI'], creativeStatement: 'ai_generated',
      platformFields: { juejin: { category: '前端' } },
    }, env)
    expect(saved.revision).toBe(2)
    expect(readContent(draft.id, env).body).toBe('# 标题\n内容')
    expect(() => saveContent(draft.id, { ...saved, revision: 1 }, env)).toThrow('重新加载')
    const withAsset = addAsset(draft.id, '封面.png', png, env)
    expect(withAsset.coverAssetId).toBe(withAsset.assets[0]!.id)
    expect(readAsset(draft.id, withAsset.assets[0]!.id, env).data).toEqual(png)
    const secondAsset = addAsset(draft.id, '第二张.png', png, env)
    const reordered = saveContent(draft.id, {
      revision: secondAsset.revision, title: secondAsset.title, body: secondAsset.body,
      summary: secondAsset.summary, tags: secondAsset.tags, creativeStatement: secondAsset.creativeStatement,
      coverAssetId: secondAsset.coverAssetId, platformFields: secondAsset.platformFields,
      assetOrder: [secondAsset.assets[1]!.id, secondAsset.assets[0]!.id],
    }, env)
    expect(reordered.assets.map(asset => asset.id)).toEqual([secondAsset.assets[1]!.id, secondAsset.assets[0]!.id])
    const replacedCover = removeAsset(draft.id, withAsset.assets[0]!.id, env)
    expect(replacedCover.coverAssetId).toBe(secondAsset.assets[1]!.id)
    const copy = duplicateContent(draft.id, env)
    expect(copy.id).not.toBe(draft.id)
    expect(copy.assets).toEqual(replacedCover.assets)
    deleteContent(draft.id, env)
    expect(readAsset(copy.id, copy.assets[0]!.id, env).data).toEqual(png)
    expect(listContents(env)).toHaveLength(1)
    expect(resolveContent(copy.id, copy.revision, env).directory).toContain(copy.id)
    expect(() => resolveContent(copy.id, copy.revision + 1, env)).toThrow('已更新')
  })

  it('rejects malformed assets, escaping symlinks and invalid order', () => {
    const env = fixture()
    const draft = createContent('image-note', env)
    expect(() => addAsset(draft.id, 'bad.gif', Buffer.from('GIF89a'), env)).toThrow('仅支持')
    const withAsset = addAsset(draft.id, 'ok.png', png, env)
    expect(() => saveContent(draft.id, {
      revision: withAsset.revision, title: '笔记', body: '内容', summary: '',
      tags: [], creativeStatement: 'none', assetOrder: [],
    }, env)).toThrow('素材顺序')
    const asset = withAsset.assets[0]!
    const file = join(contentsRoot(env), draft.id, 'assets', asset.id)
    rmSync(file)
    const outside = join(env.DSH_HOME, 'outside.png')
    writeFileSync(outside, png)
    symlinkSync(outside, file)
    expect(() => readAsset(draft.id, asset.id, env)).toThrow('素材路径')
    expect(() => resolveContent('../outside', 1, env)).toThrow('草稿 ID')
    rmSync(file)
    expect(existsSync(outside)).toBe(true)
    writeFileSync(file, png)
    const withoutAsset = removeAsset(draft.id, asset.id, env)
    expect(withoutAsset.assets).toEqual([])
  })
})
