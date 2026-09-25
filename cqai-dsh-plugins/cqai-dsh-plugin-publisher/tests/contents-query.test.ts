import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAsset, contentsRoot, createContent, queryContents } from '../src/contents.ts'
import type { PublisherContent, PublisherContentType } from '../src/protocol.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ebao-contents-query-'))
  roots.push(root)
  return { DSH_HOME: root }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function draft(
  env: NodeJS.ProcessEnv, contentType: PublisherContentType,
  fields: Partial<PublisherContent> = {},
): PublisherContent {
  const created = createContent(contentType, env)
  const file = join(contentsRoot(env), created.id, 'manifest.json')
  const content = { ...JSON.parse(readFileSync(file, 'utf8')) as PublisherContent, ...fields }
  writeFileSync(file, JSON.stringify(content))
  return content
}

describe('paginated publisher draft cards', () => {
  it('uses updated time and ID as a stable descending keyset without duplicate cards', () => {
    const env = fixture()
    const sameTime = '2026-09-25T08:00:00.000Z'
    const articleIds = Array.from({ length: 44 }, (_, index) => draft(env, 'article', {
      title: `Article ${index}`, summary: `Summary ${index}`, body: `Private full body ${index}`,
      updatedAt: sameTime,
    }).id)
    const newest = draft(env, 'article', { title: 'Newest', updatedAt: '2026-09-26T08:00:00.000Z' })
    const oldest = draft(env, 'article', { title: 'Oldest', updatedAt: '2026-09-24T08:00:00.000Z' })
    draft(env, 'video', { title: 'Other category' })
    const first = queryContents({ contentType: 'article', query: '' }, env)
    const second = queryContents({ contentType: 'article', query: '', cursor: first.nextCursor! }, env)
    const third = queryContents({ contentType: 'article', query: '', cursor: second.nextCursor! }, env)
    const ids = [...first.items, ...second.items, ...third.items].map(card => card.id)
    expect([first.items.length, second.items.length, third.items.length]).toEqual([20, 20, 6])
    expect(ids).toEqual([newest.id, ...articleIds.sort((left, right) => right.localeCompare(left)), oldest.id])
    expect(new Set(ids).size).toBe(46)
    expect(third.nextCursor).toBeNull()
    expect(first.items[0]).not.toHaveProperty('body')
    expect(first.items[0]).not.toHaveProperty('assets')
    expect(first.items.find(card => card.title.startsWith('Article'))?.excerpt).toMatch(/^Summary /u)
  })

  it('searches the intended fields and picks a cover or video source for card previews', () => {
    const env = fixture()
    const article = draft(env, 'article', { title: '微信稿', summary: '摘要 NEEDLE', body: '正文' })
    const articleBodyOnly = draft(env, 'article', { title: '其他', summary: '', body: 'NEEDLE 正文' })
    const note = draft(env, 'image-note', { title: '笔记', body: '图文 NEEDLE\n说明', summary: 'unused' })
    const video = draft(env, 'video', {
      title: '视频稿', description: '视频 NEEDLE 简介',
      videoSource: { kind: 'work', workId: '11111111-1111-4111-8111-111111111111' },
    })
    const withAsset = addAsset(article.id, '封面.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), env)
    expect(queryContents({ contentType: 'article', query: 'needle' }, env).items).toMatchObject([
      { id: article.id, coverAssetId: withAsset.assets[0]!.id, excerpt: '摘要 NEEDLE' },
    ])
    expect(queryContents({ contentType: 'article', query: '正文' }, env).items).toEqual([])
    expect(queryContents({ contentType: 'article', query: '微信' }, env).items.map(item => item.id)).toEqual([article.id])
    expect(queryContents({ contentType: 'image-note', query: 'needle' }, env).items).toMatchObject([
      { id: note.id, excerpt: '图文 NEEDLE 说明' },
    ])
    expect(queryContents({ contentType: 'video', query: 'needle' }, env).items).toMatchObject([
      { id: video.id, videoSource: video.videoSource, excerpt: '视频 NEEDLE 简介' },
    ])
    expect(articleBodyOnly.id).not.toBe(article.id)
  })

  it('rejects malformed or cross-query cursors and invalid input', () => {
    const env = fixture()
    for (let index = 0; index < 21; index += 1) draft(env, 'article', { title: `Match ${index}` })
    const cursor = queryContents({ contentType: 'article', query: 'match' }, env).nextCursor!
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u)
    expect(() => queryContents({ contentType: 'article', query: 'other', cursor }, env)).toThrow('草稿查询游标无效')
    expect(() => queryContents({ contentType: 'video', query: 'match', cursor }, env)).toThrow('草稿查询游标无效')
    expect(() => queryContents({ contentType: 'article', query: 'match', cursor: 'not-a-cursor' }, env)).toThrow('草稿查询游标无效')
    expect(() => queryContents({ contentType: 'article', query: 'match', cursor: '' }, env)).toThrow('草稿查询游标无效')
    expect(() => queryContents({ contentType: 'article', query: 'x'.repeat(201) }, env)).toThrow('搜索关键词无效')
    expect(() => queryContents({ contentType: 'other' as never, query: '' }, env)).toThrow('内容类型无效')
  })
})
