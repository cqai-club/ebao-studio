import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configurePortableRuntime, portablePaths } from '../src/portable-runtime.ts'

const roots: string[] = []
const original = {...process.env}
afterEach(() => {process.env = {...original}; for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
it('leaves installed builds alone and derives a portable home from the current executable', () => {
  const root = mkdtempSync(join(tmpdir(), 'portable-')); roots.push(root)
  expect(portablePaths(join(root, 'app.exe'))).toBeUndefined()
  for (const folder of ['original', '移动后']) {
    const location = join(root, folder); mkdirSync(location)
    writeFileSync(join(location, 'portable.json'), '{}')
    const setPath = vi.fn()
    const paths = configurePortableRuntime(join(location, 'e剪宝.exe'), setPath)
    expect(paths?.root).toBe(location)
    expect(process.env.DSH_HOME).toBe(join(location, 'data/dsh'))
    expect(setPath).toHaveBeenCalledWith(join(location, 'data/desktop'))
    expect(process.env.EJIANBAO_PYTHON).toBe(join(location, 'resources/ejianbao-runtime/python312/python.exe'))
    expect(process.env.EJIANBAO_BROWSER_EXECUTABLE).toContain(location)
    expect(process.env.EJIANBAO_MATRIXMEDIA).toBeUndefined()
  }
})
