import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { python311 } from '../src/index.ts'

const probe = vi.hoisted(() => ({home: '', stderr: ''}))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {...actual,
    // Exercise the bundled uv parser and managed discovery, without downloading
    // Python or relying on interpreters installed on the developer/CI machine.
    spawn: (bin: string, args: string[], options: import('node:child_process').SpawnOptions) => {
      const child = actual.spawn(bin, args, {...options, cwd: probe.home})
      child.stderr!.on('data', chunk => {probe.stderr += chunk.toString()})
      return child
    },
    spawnSync: () => ({status: 1, stdout: ''}),
  }
})

afterEach(async () => {if (probe.home) await rm(probe.home, {recursive: true, force: true}); probe.home = ''; probe.stderr = ''})

it('accepts the app managed-Python configuration and checks for an interpreter', async () => {
  probe.home = await mkdtemp(join(tmpdir(), 'cqai-python-discovery-'))
  await expect(python311(probe.home)).rejects.toThrow('未找到兼容的 Python 3.11')
  expect(probe.stderr).toContain('No interpreter found for Python 3.11')
  expect(probe.stderr).not.toContain('cannot be used with')
})
