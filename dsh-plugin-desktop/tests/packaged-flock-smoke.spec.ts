import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')('reports each lock stage and rejects the wrong architecture', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const script = fileURLToPath(new URL('../scripts/packaged-flock-smoke.mjs', import.meta.url))
  const run = spawnSync(process.execPath, [script, root, process.arch], { encoding: 'utf8', timeout: 30_000 })
  expect(run.status, run.stderr).toBe(0)
  for (const stage of ['script started', 'loading session lock provider', 'session lock provider loaded',
    'acquiring first lock', 'checking lock contention', 'reacquiring after release', 'session lock passed']) {
    expect(run.stderr).toContain(stage)
  }
  const wrong = spawnSync(process.execPath, [script, root, 'not-this-cpu'], { encoding: 'utf8', timeout: 30_000 })
  expect(wrong.status).not.toBe(0)
  expect(wrong.stderr).toContain('script started')
  expect(wrong.stderr).toContain('expected not-this-cpu')
})
