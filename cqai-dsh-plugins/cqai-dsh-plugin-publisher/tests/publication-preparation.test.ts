import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { articleImageSources } from '../src/article-assets.ts'
import { listContents, readAsset, readContent, saveContent } from '../src/contents.ts'
import { openPublicationFromSource } from '../src/publication-preparation.ts'
import { projectContentForPlatform } from '../src/protocol.ts'
import { registerSourceDocument } from '../src/source-documents.ts'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(join(realpathSync.native(tmpdir()), 'ebao-preparation-'))
  homes.push(home)
  const directory = join(home, 'workspace')
  mkdirSync(join(directory, 'images'), { recursive: true })
  return { home, directory, env: { DSH_HOME: home } }
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function image(index: number): Buffer {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, index, 2, 3])
}

describe('publication preparation from an MD source', () => {
  it('imports six local images in Markdown order and reopens the same editable preparation', () => {
    const { directory, env } = fixture()
    const order = [6, 2, 4, 1, 5, 3]
    for (let index = 1; index <= 6; index += 1) {
      writeFileSync(join(directory, 'images', `${index}.png`), image(index))
    }
    const markdownPath = join(directory, 'article.md')
    writeFileSync(markdownPath, `# 六张图的文章\n\n正文\n\n${order.map(index => `![图 ${index}](images/${index}.png)`).join('\n\n')}`)
    const source = registerSourceDocument('six-images', markdownPath, env)
    const first = openPublicationFromSource(source.id, source.revision, 'article', env)
    expect(first.title).toBe('六张图的文章')
    expect(first.assets.map(asset => asset.name)).toEqual(order.map(index => `${index}.png`))
    expect(first.coverAssetId).toBe(first.assets[0]?.id)
    expect(first.body).not.toContain('source-image://')
    expect(articleImageSources(first.body)).toEqual(first.assets.map(asset => `ebao-asset://${asset.id}`))
    for (const [position, index] of order.entries()) {
      expect(first.body).toContain(`![图 ${index}](ebao-asset://${first.assets[position]!.id})`)
      expect(readAsset(first.id, first.assets[position]!.id, env).data).toEqual(image(index))
    }
    expect(openPublicationFromSource(source.id, source.revision, 'article', env)).toEqual(first)
    expect(listContents(env)).toHaveLength(1)

    const edited = saveContent(first.id, {
      revision: first.revision, title: '用户修改的标题', body: first.body,
      summary: '', tags: [], creativeStatement: 'none', coverAssetId: first.coverAssetId,
    }, env)
    expect(openPublicationFromSource(source.id, source.revision, 'article', env)).toEqual(edited)

    writeFileSync(markdownPath, `${readFileSync(markdownPath, 'utf8')}\n\n后续更新`)
    const revised = registerSourceDocument('six-images', markdownPath, env)
    expect(revised.revision).not.toBe(source.revision)
    expect(openPublicationFromSource(source.id, source.revision, 'article', env)).toEqual(edited)
    const second = openPublicationFromSource(revised.id, revised.revision, 'article', env)
    expect(second.id).not.toBe(first.id)
    expect(second.body).toContain('后续更新')
    expect(readContent(first.id, env).title).toBe('用户修改的标题')
    expect(listContents(env)).toHaveLength(2)
  })

  it('applies candidate platform edits and maps source image IDs into prepared assets', () => {
    const { directory, env } = fixture()
    writeFileSync(join(directory, 'images', 'one.png'), image(1))
    writeFileSync(join(directory, 'images', 'two.png'), image(2))
    const markdownPath = join(directory, 'note.md')
    writeFileSync(markdownPath, '# 原标题\n\n![甲](images/one.png)\n![乙](images/two.png)')
    const source = registerSourceDocument('platform-images', markdownPath, env)
    const [one, two] = source.images
    const prepared = openPublicationFromSource(source.id, source.revision, 'image-note', env, {
      id: '11111111-1111-4111-8111-111111111111', platforms: ['xhs'],
      title: '确认后的标题', body: `确认正文\n\n\`![示例](https://example.com/example.png)\`\n\n![乙](${two!.src})`,
      summary: '确认摘要', tags: ['旅行'],
      platformVariants: { xhs: {
        title: '小红书标题', body: `平台正文\n\n\`\`\`md\n![代码示例](photo.png)\n\`\`\`\n\n![甲](${one!.src})`,
      } },
    })
    const oneAsset = prepared.assets.find(asset => asset.name === 'one.png')!
    const twoAsset = prepared.assets.find(asset => asset.name === 'two.png')!
    expect(prepared.title).toBe('确认后的标题')
    expect(prepared.summary).toBe('确认摘要')
    expect(prepared.tags).toEqual(['旅行'])
    expect(prepared.body).toBe('确认正文\n\n`![示例](https://example.com/example.png)`\n\n')
    expect(prepared.body).not.toContain('ebao-asset://')
    expect(prepared.platformVariants?.xhs).toEqual({
      title: '小红书标题', body: '平台正文\n\n```md\n![代码示例](photo.png)\n```\n\n',
      coverAssetId: oneAsset.id,
      assetOrder: [oneAsset.id],
    })
    expect(projectContentForPlatform(prepared, 'xhs').assets.map(asset => asset.id)).toEqual([oneAsset.id])
    expect(prepared.assets.map(asset => asset.id)).toEqual([twoAsset.id, oneAsset.id])
    expect(prepared.platformVariants?.xhs?.body).not.toContain('ebao-asset://')
    const reopened = openPublicationFromSource(source.id, source.revision, 'image-note', env, {
      id: '11111111-1111-4111-8111-111111111111', platforms: ['xhs'], title: '不应覆盖',
    })
    expect(reopened).toEqual(prepared)
    const nextCandidate = openPublicationFromSource(source.id, source.revision, 'image-note', env, {
      id: '22222222-2222-4222-8222-222222222222', platforms: ['xhs'], title: '第二版预览',
      body: `第二版正文 ![甲](${one!.src})`,
    })
    expect(nextCandidate.id).not.toBe(prepared.id)
    expect(nextCandidate.title).toBe('第二版预览')
    expect(nextCandidate.body).toBe('第二版正文 ')
    expect(nextCandidate.body).not.toContain('ebao-asset://')
    expect(nextCandidate.assets.map(asset => asset.name)).toEqual(['one.png'])
    expect(nextCandidate.platformVariants?.xhs?.assetOrder).toEqual([nextCandidate.assets[0]!.id])
    expect(readContent(prepared.id, env)).toEqual(prepared)
    expect(openPublicationFromSource(source.id, source.revision, 'image-note', env, {
      id: '11111111-1111-4111-8111-111111111111', platforms: ['xhs'], title: '又一次点击',
    })).toEqual(prepared)
    expect(listContents(env)).toHaveLength(2)
  })

  it('rewrites angle-bracket image destinations in lists while preserving inline code examples', () => {
    const { directory, env } = fixture()
    writeFileSync(join(directory, 'images', '我的 图.png'), image(7))
    const markdownPath = join(directory, 'article.md')
    writeFileSync(markdownPath, '# 列表文章\n\n- ![插图](<images/我的 图.png> "说明")')
    const source = registerSourceDocument('angle-image', markdownPath, env)
    const ref = source.images[0]!.src
    const prepared = openPublicationFromSource(source.id, source.revision, 'article', env, {
      id: '33333333-3333-4333-8333-333333333333', platforms: ['juejin'],
      body: `示例：\`![不要改](${ref})\`\n\n- ![插图](<${ref}> "说明")`,
    })
    const assetRef = `ebao-asset://${prepared.assets[0]!.id}`
    expect(prepared.body).toContain(`\`![不要改](${ref})\``)
    expect(prepared.body).toContain(`- ![插图](<${assetRef}> "说明")`)
    expect(articleImageSources(prepared.body)).toEqual([assetRef])
    expect(prepared.platformVariants?.juejin?.assetOrder).toEqual([prepared.assets[0]!.id])
  })

  it('imports only candidate images and gives each target its effective image order and cover', () => {
    const { directory, env } = fixture()
    const webp = Buffer.from('RIFF1234WEBPxxxx', 'ascii')
    writeFileSync(join(directory, 'images', 'main.webp'), webp)
    writeFileSync(join(directory, 'images', 'wechat.png'), image(8))
    writeFileSync(join(directory, 'images', 'removed.png'), image(9))
    const markdownPath = join(directory, 'article.md')
    writeFileSync(markdownPath, '# 原稿\n\n![主图](images/main.webp)\n![微信图](images/wechat.png)\n![已删除](images/removed.png)')
    const source = registerSourceDocument('selected-images', markdownPath, env)
    const [main, wechat] = source.images
    const prepared = openPublicationFromSource(source.id, source.revision, 'article', env, {
      id: '55555555-5555-4555-8555-555555555555', platforms: ['juejin', 'wxmp', 'tt'],
      body: `主稿文案 ![主图](${main!.src})`,
      platformVariants: {
        wxmp: { body: `公众号文案 ![微信图](${wechat!.src})` },
        tt: { body: '头条纯文字版本' },
      },
    })
    expect(prepared.assets.map(asset => asset.name)).toEqual(['main.webp', 'wechat.png'])
    const [mainAsset, wechatAsset] = prepared.assets
    expect(prepared.coverAssetId).toBe(mainAsset!.id)
    expect(prepared.body).toContain(`ebao-asset://${mainAsset!.id}`)
    expect(prepared.platformVariants?.juejin).toMatchObject({
      assetOrder: [mainAsset!.id], coverAssetId: mainAsset!.id,
    })
    expect(prepared.platformVariants?.wxmp).toMatchObject({
      assetOrder: [wechatAsset!.id], coverAssetId: wechatAsset!.id,
      body: `公众号文案 ![微信图](ebao-asset://${wechatAsset!.id})`,
    })
    expect(prepared.platformVariants?.tt).toMatchObject({ assetOrder: [], coverAssetId: null, body: '头条纯文字版本' })
    expect(projectContentForPlatform(prepared, 'wxmp').assets.map(asset => asset.name)).toEqual(['wechat.png'])
    expect(projectContentForPlatform(prepared, 'wxmp').coverAssetId).toBe(wechatAsset!.id)
    expect(projectContentForPlatform(prepared, 'tt').assets).toEqual([])
    expect(projectContentForPlatform(prepared, 'tt').coverAssetId).toBeUndefined()
  })

  it('removes an incomplete preparation when a candidate fails validation', () => {
    const { directory, env } = fixture()
    writeFileSync(join(directory, 'images', 'one.png'), image(1))
    const markdownPath = join(directory, 'article.md')
    writeFileSync(markdownPath, '# 标题\n\n![图](images/one.png)')
    const source = registerSourceDocument('rollback', markdownPath, env)
    expect(() => openPublicationFromSource(source.id, source.revision, 'article', env, {
      id: '44444444-4444-4444-8444-444444444444', platforms: ['juejin'], title: '长'.repeat(121),
    }))
      .toThrow('草稿内容过大')
    expect(listContents(env)).toEqual([])
    const prepared = openPublicationFromSource(source.id, source.revision, 'article', env)
    expect(prepared.assets).toHaveLength(1)
    expect(listContents(env)).toHaveLength(1)
  })

  it('rejects more than 20 referenced images before creating a preparation', () => {
    const { directory, env } = fixture()
    const references: string[] = []
    for (let index = 1; index <= 21; index += 1) {
      writeFileSync(join(directory, 'images', `${index}.png`), image(index))
      references.push(`![图 ${index}](images/${index}.png)`)
    }
    const markdownPath = join(directory, 'too-many.md')
    writeFileSync(markdownPath, `# 图片合集\n\n${references.join('\n\n')}`)
    const source = registerSourceDocument('too-many-images', markdownPath, env)
    expect(() => openPublicationFromSource(source.id, source.revision, 'article', env)).toThrow('最多 20 张图片')
    expect(listContents(env)).toEqual([])
    const twenty = source.images.slice(0, 20).map(item => `![图](${item.src})`).join('\n')
    expect(() => openPublicationFromSource(source.id, source.revision, 'article', env, {
      id: '66666666-6666-4666-8666-666666666666', platforms: ['juejin'], body: twenty,
      platformVariants: { juejin: { body: `![追加图](${source.images[20]!.src})` } },
    })).toThrow('最多 20 张图片')
    expect(listContents(env)).toEqual([])
    const selected = openPublicationFromSource(source.id, source.revision, 'article', env, {
      id: '77777777-7777-4777-8777-777777777777', platforms: ['juejin'],
      body: `![选中图](${source.images[0]!.src})`,
    })
    expect(selected.assets).toHaveLength(1)
  })
})
