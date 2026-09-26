import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addAsset, contentsRoot, createContent, deleteContent, duplicateContent,
  listContents, readAsset, readContent, removeAsset, resolveContent, saveContent,
} from '../src/contents.ts'
import { projectContentForPlatform, resolveArticleTheme } from '../src/protocol.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ebao-contents-'))
  roots.push(root)
  return { DSH_HOME: root }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

describe('publisher local content library', () => {
  it('defaults new articles to the outer preview layout and preserves later theme choices', () => {
    const env = fixture()
    const article = createContent('article', env)
    expect(article.articleTheme).toBe('classic')
    expect(resolveArticleTheme(article)).toBe('classic')
    expect(createContent('image-note', env).articleTheme).toBeUndefined()
    expect(createContent('video', env).articleTheme).toBeUndefined()
    const editorial = saveContent(article.id, {
      revision: article.revision, title: '文章', body: '正文', summary: '', tags: [],
      creativeStatement: 'none', articleTheme: 'editorial',
    }, env)
    expect(readContent(article.id, env).articleTheme).toBe('editorial')
    expect(() => saveContent(article.id, { ...editorial, revision: article.revision, articleTheme: 'classic' }, env))
      .toThrow('重新加载')
    const edited = saveContent(article.id, { ...editorial, title: '更新标题' }, env)
    expect(edited.articleTheme).toBe('editorial')
    expect(duplicateContent(article.id, env).articleTheme).toBe('editorial')
    expect(() => saveContent(article.id, { ...edited, articleTheme: 'unsupported' as never }, env))
      .toThrow('文章排版主题无效')
    expect(readContent(article.id, env).revision).toBe(edited.revision)
  })

  it('persists each Wenyan-inspired article theme as a revisioned draft choice', () => {
    const env = fixture()
    let draft = createContent('article', env)
    for (const theme of ['orangeheart', 'lapis', 'purple'] as const) {
      draft = saveContent(draft.id, {
        revision: draft.revision, title: '主题文章', body: '正文', summary: '', tags: [],
        creativeStatement: 'none', articleTheme: theme,
      }, env)
      expect(readContent(draft.id, env).articleTheme).toBe(theme)
      expect(duplicateContent(draft.id, env).articleTheme).toBe(theme)
    }
  })

  it('treats old article manifests without a theme as classic and rejects themes on other content types', () => {
    const env = fixture()
    const article = createContent('article', env)
    const manifest = join(contentsRoot(env), article.id, 'manifest.json')
    const legacy = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    delete legacy.articleTheme
    writeFileSync(manifest, JSON.stringify(legacy))
    expect(resolveArticleTheme(readContent(article.id, env))).toBe('classic')
    const updated = saveContent(article.id, {
      revision: article.revision, title: '旧文章', body: '正文', summary: '', tags: [], creativeStatement: 'none',
    }, env)
    expect(updated.articleTheme).toBeUndefined()
    expect(resolveArticleTheme(duplicateContent(article.id, env))).toBe('classic')
    const imageNote = createContent('image-note', env)
    expect(() => saveContent(imageNote.id, {
      revision: imageNote.revision, title: '图文', body: '', summary: '', tags: [], creativeStatement: 'none',
      articleTheme: 'editorial',
    }, env)).toThrow('文章排版主题无效')
    const video = createContent('video', env)
    expect(() => saveContent(video.id, {
      revision: video.revision, title: '视频', body: '', summary: '', tags: [], creativeStatement: 'none',
      description: '', shortTitle: '', articleTheme: 'classic',
    }, env)).toThrow('文章排版主题无效')
    const invalid = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    invalid.articleTheme = 'unsupported'
    writeFileSync(manifest, JSON.stringify(invalid))
    expect(() => readContent(article.id, env)).toThrow('草稿数据无效')
  })

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
    expect(withAsset.assets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/u)
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

  it('preserves isolated platform versions through main edits, asset changes and duplication', () => {
    const env = fixture()
    const draft = createContent('article', env)
    const first = addAsset(draft.id, '第一张.png', png, env)
    const second = addAsset(draft.id, '第二张.png', png, env)
    const firstId = first.assets[0]!.id
    const secondId = second.assets[1]!.id
    const saved = saveContent(draft.id, {
      revision: second.revision, title: '主标题', body: '主正文', summary: '主摘要',
      tags: ['主标签'], creativeStatement: 'none', coverAssetId: firstId,
      platformVariants: {
        wxmp: {
          title: '微信标题', body: `微信正文 ![插图](ebao-asset://${secondId})`,
          summary: '', tags: ['微信'], coverAssetId: secondId,
          assetOrder: [secondId, firstId],
        },
        tt: { summary: '' },
        juejin: { body: '没有正文插图', coverAssetId: null, assetOrder: [] },
      },
    }, env)
    expect(projectContentForPlatform(saved, 'wxmp')).toMatchObject({
      title: '微信标题', summary: '', coverAssetId: secondId,
      assets: [{ id: secondId }, { id: firstId }],
    })
    expect(projectContentForPlatform(saved, 'tt')).toMatchObject({ title: '主标题', summary: '' })
    expect(projectContentForPlatform(saved, 'juejin').assets).toEqual([])
    expect(projectContentForPlatform(saved, 'juejin').coverAssetId).toBeUndefined()
    expect(saved.title).toBe('主标题')
    const changedMaster = saveContent(draft.id, {
      revision: saved.revision, title: '新版主标题', body: '新版主正文', summary: '新版主摘要',
      tags: ['主标签'], creativeStatement: 'none', coverAssetId: firstId,
    }, env)
    expect(changedMaster.platformVariants).toEqual(saved.platformVariants)
    expect(projectContentForPlatform(changedMaster, 'wxmp').title).toBe('微信标题')
    expect(projectContentForPlatform(changedMaster, 'tt').title).toBe('新版主标题')
    const third = addAsset(draft.id, '第三张.png', png, env)
    expect(third.platformVariants?.wxmp?.assetOrder).toEqual([secondId, firstId])
    expect(third.platformVariants?.juejin?.assetOrder).toEqual([])
    const removed = removeAsset(draft.id, secondId, env)
    expect(removed.platformVariants?.wxmp?.body).toBe('微信正文 ')
    expect(removed.platformVariants?.wxmp?.coverAssetId).toBeUndefined()
    expect(removed.platformVariants?.wxmp?.assetOrder).toEqual([firstId])
    expect(projectContentForPlatform(removed, 'wxmp').coverAssetId).toBe(firstId)
    const copy = duplicateContent(draft.id, env)
    expect(copy.platformVariants).toEqual(removed.platformVariants)
    expect(readContent(copy.id, env).platformVariants).toEqual(removed.platformVariants)
  })

  it('rejects malformed platform overrides without changing the current revision', () => {
    const env = fixture()
    const draft = createContent('image-note', env)
    const withAsset = addAsset(draft.id, '第一张.png', png, env)
    const common = {
      revision: withAsset.revision, title: '主标题', body: '主正文', summary: '', tags: [],
      creativeStatement: 'none' as const,
    }
    expect(() => saveContent(draft.id, {
      ...common, platformVariants: { xhs: { assetOrder: ['11111111-1111-4111-8111-111111111111'] } },
    }, env)).toThrow('平台版本素材顺序无效')
    expect(() => saveContent(draft.id, {
      ...common, platformVariants: { xhs: { assetOrder: [withAsset.assets[0]!.id, withAsset.assets[0]!.id] } },
    }, env)).toThrow('平台版本素材顺序无效')
    expect(() => saveContent(draft.id, {
      ...common, platformVariants: { xhs: { coverAssetId: '11111111-1111-4111-8111-111111111111' } },
    }, env)).toThrow('平台版本封面无效')
    expect(() => saveContent(draft.id, {
      ...common, platformVariants: { xhs: { unexpected: 'x' } } as never,
    }, env)).toThrow('平台版本字段无效')
    expect(readContent(draft.id, env).revision).toBe(withAsset.revision)
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
    writeFileSync(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 2, 3]))
    expect(() => resolveContent(draft.id, withAsset.revision, env)).toThrow('素材已改变')
    writeFileSync(file, png)
    const withoutAsset = removeAsset(draft.id, asset.id, env)
    expect(withoutAsset.assets).toEqual([])
  })
})
