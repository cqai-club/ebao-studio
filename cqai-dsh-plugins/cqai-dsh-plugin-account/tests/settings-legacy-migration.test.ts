import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CATEGORY_SETTINGS_MIGRATION_MARKER, migrateLegacyCategoryDefaultModels } from '../src/settings-legacy-migration.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cqai-category-settings-'))
  homes.push(dir)
  return dir
}

function settings() {
  const current: Record<string, string> = { image: 'new-image' }
  const mutate = vi.fn(async (_entry: string, ops: Array<{ path: readonly string[]; value: string }>) => {
    for (const op of ops) current[op.path[1]!] = op.value
  })
  const seam = {
    describe: () => [{ ns: 'cqaiclub-dsn-account', revision: 7, user: { categoryDefaultModels: current } }],
    mutate,
  } as unknown as Pick<SettingsForms, 'describe' | 'mutate'>
  return { seam, mutate, current }
}

describe('rc.2 category default model import', () => {
  it('preserves new overrides and imports missing old categories only once', async () => {
    const dir = await home()
    await writeFile(path.join(dir, 'settings.yaml.imported'), [
      'cqaiclub-category-default-models:',
      '  image: old-image',
      '  text-multimodal: old-chat',
      '  video: old-video',
      '  unknown: ignored',
    ].join('\n'))
    const { seam, mutate, current } = settings()

    await expect(migrateLegacyCategoryDefaultModels(dir, seam)).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith('cqaiclub-dsn-account', [
      { op: 'set', path: ['categoryDefaultModels', 'text-multimodal'], value: 'old-chat' },
      { op: 'set', path: ['categoryDefaultModels', 'video'], value: 'old-video' },
    ], 7)
    expect(current.image).toBe('new-image')
    const marker = await readFile(path.join(dir, CATEGORY_SETTINGS_MIGRATION_MARKER), 'utf8')
    expect(marker).not.toContain('old-chat')

    delete current.video
    await expect(migrateLegacyCategoryDefaultModels(dir, seam)).resolves.toBe(false)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('reads the original file and retries after a failed write', async () => {
    const dir = await home()
    await writeFile(path.join(dir, 'settings.yaml'), 'cqaiclub-category-default-models:\n  audio: old-audio\n')
    const { seam, mutate } = settings()
    mutate.mockRejectedValueOnce(new Error('settings write failed'))

    await expect(migrateLegacyCategoryDefaultModels(dir, seam)).rejects.toThrow('settings write failed')
    await expect(readFile(path.join(dir, CATEGORY_SETTINGS_MIGRATION_MARKER), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(migrateLegacyCategoryDefaultModels(dir, seam)).resolves.toBe(true)
    expect(mutate).toHaveBeenLastCalledWith('cqaiclub-dsn-account', [
      { op: 'set', path: ['categoryDefaultModels', 'audio'], value: 'old-audio' },
    ], 7)
  })
})
