import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ blockedRoot: '' }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: ((...args: unknown[]) => {
      const path = String(args[0])
      if (state.blockedRoot && path.startsWith(state.blockedRoot) && path.includes('.ebao-project-probe-')) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return Reflect.apply(actual.mkdirSync, actual, args)
    }) as typeof actual.mkdirSync,
  }
})

import { readProjectSettings, saveProjectSettings } from '../src/project-workspace.ts'

const roots: string[] = []
afterEach(() => {
  state.blockedRoot = ''
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('rejects an unwritable custom root without replacing the saved project setting', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ebao-project-settings-home-')))
  const firstRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ebao-project-settings-first-')))
  const blockedRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ebao-project-settings-blocked-')))
  roots.push(home, firstRoot, blockedRoot)
  const env = { DSH_HOME: home }
  expect(saveProjectSettings(firstRoot, env).defaultRoot).toBe(firstRoot)

  state.blockedRoot = blockedRoot
  expect(() => saveProjectSettings(blockedRoot, env)).toThrow('项目根目录不可写')
  expect(readProjectSettings(env)).toEqual({ defaultRoot: firstRoot, isCustom: true })
  expect(readdirSync(blockedRoot)).toEqual([])
})
