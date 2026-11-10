import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { collectProductionClosure } from '../scripts/prepare-payload.ts'
import { verifyNextPayload } from '../scripts/packaged-payload.ts'
import { physicalPayload } from '../src/runtime-tree.ts'
import { completeApplication, writeApplication, writePackage } from './runtime-fixture.ts'

it('collects and verifies an installed npm package even when its name is a Node builtin', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-builtin-package-'))
  try {
    writeApplication(root)
    completeApplication(root)
    const path = join(root, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies: Record<string, string> }
    manifest.dependencies.tr46 = '*'
    writeFileSync(path, JSON.stringify(manifest))
    const modules = join(root, 'node_modules')
    writePackage(modules, 'tr46', { dependencies: { punycode: '*', https: '*' } })
    const punycode = writePackage(modules, 'punycode', { dependencies: { 'punycode-helper': '*' } })
    const helper = writePackage(join(punycode, 'node_modules'), 'punycode-helper')
    expect(collectProductionClosure(root).map(pkg => pkg.name)).toEqual(expect.arrayContaining(['tr46', 'punycode', 'punycode-helper']))
    expect(() => verifyNextPayload(physicalPayload(root))).not.toThrow()
    rmSync(helper, { recursive: true, force: true })
    expect(() => verifyNextPayload(physicalPayload(root))).toThrow(/Missing packaged dependency punycode-helper required by punycode/u)
    // The npm package need not exist when the dependency is provided only by Node.
    rmSync(punycode, { recursive: true, force: true })
    expect(() => verifyNextPayload(physicalPayload(root))).not.toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
