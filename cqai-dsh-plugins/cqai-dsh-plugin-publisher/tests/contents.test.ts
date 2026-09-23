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
    expect(readAsset(draft.id, withAsset.assets[0]!.id, env).data).toEqual(png)
    const copy = duplicateContent(draft.id, env)
    expect(copy.id).not.toBe(draft.id)
    expect(copy.assets).toEqual(withAsset.assets)
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
