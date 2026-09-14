import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IMAGE_DATA_MIGRATION_MARKER,
  IMAGE_DATA_SCHEMA_VERSION,
  migrateImageData,
} from '../src/data-migration.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cqai-imagegen-migration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('migrateImageData', () => {
  it('backs up metadata byte-for-byte and writes the version marker last', async () => {
    const root = await temporaryRoot()
    const originals = new Map<string, string>([
      ['index.json', '{"entries":[{"id":"old"}]}'],
      ['gallery/index.json', '{\n  "entries": []\n}'],
      ['canvas/index.json', '{"pages":["page-1"]}'],
      ['canvas/pages/page-1.json', '{"id":"page-1","nodes":[]}'],
      ['templates/favorites.json', '[{"key":"vibeui:1"}]'],
    ])
    for (const [relative, contents] of originals) {
      const file = path.join(root, relative)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, contents)
    }
    await fs.mkdir(path.join(root, 'images'), { recursive: true })
    await fs.writeFile(path.join(root, 'images', 'large.png'), Buffer.alloc(32, 7))

    const result = await migrateImageData(root, { now: new Date('2026-09-13T00:00:00.000Z') })
    expect(result.migrated).toBe(true)
    expect(result.version).toBe(IMAGE_DATA_SCHEMA_VERSION)
    expect(result.metadataFiles).toEqual([...originals.keys()].sort())
    expect(result.backupDir).toBeDefined()
    for (const [relative, contents] of originals) {
      expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(contents)
      expect(await fs.readFile(path.join(result.backupDir!, relative), 'utf8')).toBe(contents)
    }
    await expect(fs.access(path.join(result.backupDir!, 'images', 'large.png'))).rejects.toThrow()
    const marker = JSON.parse(await fs.readFile(path.join(root, IMAGE_DATA_MIGRATION_MARKER), 'utf8')) as Record<string, unknown>
    expect(marker).toMatchObject({
      owner: 'cqai-dsh-plugin-imagegen',
      version: IMAGE_DATA_SCHEMA_VERSION,
      source: 'dsh-imagegen-v1.5.12',
    })

    const second = await migrateImageData(root)
    expect(second).toEqual({ migrated: false, version: IMAGE_DATA_SCHEMA_VERSION, metadataFiles: [] })
  })

  it('changes nothing when any legacy metadata file is invalid', async () => {
    const root = await temporaryRoot()
    await fs.writeFile(path.join(root, 'index.json'), '{broken')
    await expect(migrateImageData(root)).rejects.toThrow('cannot migrate invalid imagegen metadata: index.json')
    expect(await fs.readFile(path.join(root, 'index.json'), 'utf8')).toBe('{broken')
    await expect(fs.access(path.join(root, IMAGE_DATA_MIGRATION_MARKER))).rejects.toThrow()
    await expect(fs.access(path.join(root, 'migration-backups'))).rejects.toThrow()
  })

  it('refuses to write a data tree created by a newer plugin schema', async () => {
    const root = await temporaryRoot()
    const marker = {
      owner: 'cqai-dsh-plugin-imagegen',
      version: IMAGE_DATA_SCHEMA_VERSION + 1,
      migratedAt: '2026-09-13T00:00:00.000Z',
      source: 'dsh-imagegen-v1.5.12',
    }
    await fs.writeFile(path.join(root, IMAGE_DATA_MIGRATION_MARKER), JSON.stringify(marker))
    await expect(migrateImageData(root)).rejects.toThrow('newer than supported')
    expect(JSON.parse(await fs.readFile(path.join(root, IMAGE_DATA_MIGRATION_MARKER), 'utf8'))).toEqual(marker)
  })
})
