import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listContents } from '../src/contents.ts'
import { preparePublicationCandidate, readPublicationCandidate, validPublicationCandidate } from '../src/publication-candidates.ts'
import { registerSourceDocument } from '../src/source-documents.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ebao-publish-candidate-'))
  roots.push(root)
  const env = { DSH_HOME: join(root, 'dsh') }
  const md = join(root, 'story.md')
  writeFileSync(join(root, 'picture.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))
  writeFileSync(md, '# 原稿标题\n\n正文 ![配图](picture.png)')
  const source = registerSourceDocument('session-1', md, env)
  return { root, env, md, source }
}

describe('transient publication preview candidates', () => {
  it('keeps source images as references and creates no publication content before a click', () => {
    const { env, source } = fixture()
    const candidate = preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['wxmp', 'juejin'],
      platformVariants: { wxmp: { title: '公众号标题', body: source.body } },
    }, env)
    expect(candidate.body).toContain('source-image://')
    expect(readPublicationCandidate('session-1')).toEqual(candidate)
    expect(validPublicationCandidate('session-1', candidate.id, env)).toEqual(candidate)
    expect(listContents(env)).toEqual([])
  })

  it('rejects unrelated images and invalidates the preview after the original MD changes', () => {
    const { env, md, source } = fixture()
    expect(() => preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['wxmp'],
      body: '![其它](https://example.com/a.png)',
    }, env)).toThrow('只能引用原始 MD')
    expect(() => preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'image-note', platforms: ['wxmp'],
    }, env)).toThrow('不支持此内容类型')
    const candidate = preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['wxmp'],
    }, env)
    writeFileSync(md, '# 更新标题\n\n新正文')
    expect(() => validPublicationCandidate('session-1', candidate.id, env)).toThrow('原稿已变化')
  })

  it('rejects a platform image-note version with no selected source image', () => {
    const { env, source } = fixture()
    expect(() => preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'image-note', platforms: ['xhs'],
      platformVariants: { xhs: { body: '只有文字' } },
    }, env)).toThrow('至少需要一张原稿图片')
  })

  it('rejects more images than a preparation can hold before offering Publish', () => {
    const { root, env, md } = fixture()
    const images: string[] = []
    for (let index = 0; index < 21; index += 1) {
      const name = `picture-${index}.png`
      writeFileSync(join(root, name), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, index]))
      images.push(`![图 ${index}](${name})`)
    }
    writeFileSync(md, `# 原稿标题\n\n${images.join('\n\n')}`)
    const source = registerSourceDocument('session-1', md, env)
    expect(source.images).toHaveLength(21)
    expect(() => preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'image-note', platforms: ['xhs'],
    }, env)).toThrow('最多支持 20 张图片')
  })

  it('checks only the WeChat article image selection for unsupported WebP', () => {
    const { root, env, md } = fixture()
    writeFileSync(join(root, 'picture.webp'), Buffer.from('RIFF0000WEBPxxxx'))
    writeFileSync(md, '# 原稿标题\n\n![PNG](picture.png)\n\n![WebP](picture.webp)')
    const source = registerSourceDocument('session-1', md, env)
    expect(() => preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['wxmp'],
    }, env)).toThrow('不支持 WebP')
    const pngOnlyBody = source.body.split('\n\n')[0]!
    const candidate = preparePublicationCandidate('session-1', {
      sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['wxmp'],
      platformVariants: { wxmp: { body: pngOnlyBody } },
    }, env)
    expect(candidate.platformVariants.wxmp?.body).toBe(pngOnlyBody)
  })
})
