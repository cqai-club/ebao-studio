import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const python = process.env.MPT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const available = spawnSync(python, ['--version'], {windowsHide: true, timeout: 10000}).status === 0

it.skipIf(!available)('discovers platform fonts and keeps Chinese defaults in the bounded list', () => {
  const script = fileURLToPath(new URL('./system-fonts.test.py', import.meta.url))
  const result = spawnSync(python, [script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
  })
  expect(result.status, result.stderr).toBe(0)
})
