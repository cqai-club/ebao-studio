import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const opened = vi.hoisted(() => [] as string[])
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    openSync: ((path: string, ...rest: Parameters<typeof actual.openSync> extends [unknown, ...infer Tail] ? Tail : never) => {
      opened.push(String(path))
      return actual.openSync(path, ...rest)
    }) as typeof actual.openSync,
  }
})

import { readSourceDocument, readSourceImage, registerSourceDocument } from '../src/source-documents.ts'

const roots: string[] = []
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

afterEach(() => {
  opened.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('source file identity cache', () => {
  it('skips unchanged image reads, reads only a requested image, and refreshes changed bytes', () => {
    const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'ebao-source-cache-'))
    roots.push(root)
    const env = { DSH_HOME: join(root, 'dsh-home') }
    const markdownPath = join(root, 'source.md')
    const firstPath = join(root, 'first.png')
    const secondPath = join(root, 'second.png')
    writeFileSync(firstPath, png)
    writeFileSync(secondPath, Buffer.concat([png, Buffer.from([4])]))
    writeFileSync(markdownPath, '![一](first.png)\n\n![二](second.png)')
    const first = registerSourceDocument('cache-session', markdownPath, env)

    opened.length = 0
    expect(readSourceDocument(first.id, env)).toEqual(first)
    expect(readSourceDocument(first.id, env)).toEqual(first)
    expect(opened).not.toContain(markdownPath)
    expect(opened).not.toContain(firstPath)
    expect(opened).not.toContain(secondPath)

    opened.length = 0
    expect(readSourceImage(first.id, first.images[0]!.id, env).data).toEqual(png)
    expect(opened).toContain(firstPath)
    expect(opened).not.toContain(secondPath)

    opened.length = 0
    const changedSecond = Buffer.concat([png, Buffer.from([5])])
    writeFileSync(secondPath, changedSecond)
    const second = readSourceDocument(first.id, env)
    expect(second.revision).not.toBe(first.revision)
    expect(opened).not.toContain(firstPath)
    expect(opened).toContain(secondPath)

    opened.length = 0
    const changedFirst = Buffer.concat([png, Buffer.from([6])])
    writeFileSync(firstPath, changedFirst)
    expect(readSourceImage(first.id, first.images[0]!.id, env).data).toEqual(changedFirst)
    expect(opened).toContain(firstPath)
    expect(opened).not.toContain(secondPath)
    const third = readSourceDocument(first.id, env)
    expect(third.revision).not.toBe(second.revision)

    opened.length = 0
    writeFileSync(markdownPath, '![一](first.png)\n\n![二](second.png)\n\n正文更新')
    expect(readSourceImage(first.id, first.images[0]!.id, env).data).toEqual(changedFirst)
    expect(opened).toContain(markdownPath)
    expect(opened).toContain(firstPath)
    expect(opened).not.toContain(secondPath)
  })
})
