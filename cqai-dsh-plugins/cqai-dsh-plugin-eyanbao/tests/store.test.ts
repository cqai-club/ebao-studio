import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listProjects,
  readProject,
  removeProject,
  replaceProject,
  saveProject,
} from '../src/store.ts'
import { project } from './fixtures.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('research project store', () => {
  it('atomically saves, lists, updates, and removes one project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eyanbao-store-'))
    roots.push(root)
    const item = project()
    await saveProject(item, { root })
    expect(await readProject(item.id, { root })).toMatchObject({ id: item.id, title: item.title })
    expect(await listProjects({ root })).toEqual([
      expect.objectContaining({ id: item.id, kind: 'research', sourceCount: 1 }),
    ])
    const updated = await replaceProject(item.id, current => ({ ...current, title: '更新后的标题' }), { root })
    expect(updated.title).toBe('更新后的标题')
    expect(JSON.parse(await readFile(join(root, item.id, 'project.json'), 'utf8'))).toMatchObject({ title: '更新后的标题' })
    await removeProject(item.id, { root })
    expect(await readProject(item.id, { root })).toBeUndefined()
  })

  it('rejects unsafe project ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eyanbao-store-safe-'))
    roots.push(root)
    await expect(readProject('../escape', { root })).rejects.toThrow('项目 ID')
  })
})
