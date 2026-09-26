import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateLegacyImageGenSettings, IMAGEGEN_SETTINGS_MIGRATION_MARKER } from '../src/settings-legacy-migration.ts'
import type { SettingsSeam } from '../src/routes.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cqai-imagegen-settings-'))
  homes.push(dir)
  return dir
}

function seam() {
  const user: Record<string, unknown> = { channels: [{ id: 'existing' }] }
  const mutate = vi.fn(async (_ns: unknown, ops: Array<{ path: string[]; value: unknown }>) => {
    for (const op of ops) user[op.path[0]!] = op.value
  })
  const settings = {
    describe: () => [{
      ns: 'cqai-imagegen', revision: 4, user,
      schema: { dict: { channels: {}, promptApiUrl: {}, promptApiKey: {} } },
    }],
    mutate,
  } as unknown as SettingsSeam
  return { settings, mutate, user }
}

describe('rc.2 imagegen settings import', () => {
  it('imports only missing fields from the renamed legacy section once', async () => {
    const dir = await home()
    await writeFile(path.join(dir, 'settings.yaml.imported'), [
      'dsh-imagegen:',
      '  channels:',
      '    - id: old-channel',
      '  promptApiUrl: https://legacy.example/v1',
      '  promptApiKey: sk-legacy',
      '  unknownField: ignored',
    ].join('\n'))
    const { settings, mutate, user } = seam()

    await expect(migrateLegacyImageGenSettings(dir, settings)).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith('cqai-imagegen', [
      { op: 'set', path: ['promptApiUrl'], value: 'https://legacy.example/v1' },
      { op: 'set', path: ['promptApiKey'], value: 'sk-legacy' },
    ], 4)
    expect(user.channels).toEqual([{ id: 'existing' }])
    expect(await readFile(path.join(dir, IMAGEGEN_SETTINGS_MIGRATION_MARKER), 'utf8')).not.toContain('sk-legacy')

    delete user.promptApiUrl
    await expect(migrateLegacyImageGenSettings(dir, settings)).resolves.toBe(false)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('also reads settings.yaml before the built-in rename completes', async () => {
    const dir = await home()
    await writeFile(path.join(dir, 'settings.yaml'), 'dsh-imagegen:\n  promptApiUrl: https://legacy.example/v1\n')
    const { settings, mutate } = seam()
    await expect(migrateLegacyImageGenSettings(dir, settings)).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith('cqai-imagegen', [
      { op: 'set', path: ['promptApiUrl'], value: 'https://legacy.example/v1' },
    ], 4)
  })
})
