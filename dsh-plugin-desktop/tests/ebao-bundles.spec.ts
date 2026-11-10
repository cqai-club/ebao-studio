import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Profile } from '@deepseek-ai/dsh-app-boot'
import { composeEbaoProductBundles, EBAO_PRODUCT_BUNDLES } from '../src/ebao-bundles.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ebao-bundles-')); roots.push(root)
  const anchor = join(root, 'package.json'); writeFileSync(anchor, '{}\n')
  for (const name of EBAO_PRODUCT_BUNDLES) {
    const directory = join(root, 'node_modules', name); mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(directory, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: name, name }] }]))
  }
  const patch = { id: 'user-setting', config: { enabled: false } }
  const profile: Profile = { name: 'desktop', dir: root, layers: [], patchPath: join(root, 'cordis.patch.yml'), patches: [patch], skippedBundles: [] }
  writeFileSync(profile.patchPath, JSON.stringify([patch]))
  return { anchor, profile, original: readFileSync(anchor, 'utf8') }
}
it('recomposes all product capabilities once and retains the user manifest and patch', () => {
  vi.stubEnv('DSH_EBAO_SAFE_MODE', '0')
  const { anchor, profile, original } = fixture()
  composeEbaoProductBundles(profile, anchor)
  composeEbaoProductBundles(profile, anchor)
  expect(profile.layers.map(layer => layer.packageName)).toEqual([...EBAO_PRODUCT_BUNDLES])
  expect(profile.layers.find(layer => layer.packageName === 'dsh-skill-mcp-panel')?.patches).toEqual([{ insert: [{ id: 'dsh-skill-mcp-panel', name: 'dsh-skill-mcp-panel', isolate: { mcpManager: 'ebao-skills-mcp-manager' } }] }])
  expect(readFileSync(anchor, 'utf8')).toBe(original)
  expect(profile.patches).toEqual([{ id: 'user-setting', config: { enabled: false } }])
  const reloaded: Profile = { ...profile, layers: [] }
  composeEbaoProductBundles(reloaded, anchor)
  expect(reloaded.layers.map(layer => layer.packageName)).toEqual([...EBAO_PRODUCT_BUNDLES])
})
it('keeps the recovery Safe Mode free of product plugins', () => {
  vi.stubEnv('DSH_EBAO_SAFE_MODE', '1')
  const { anchor, profile } = fixture()
  composeEbaoProductBundles(profile, anchor)
  expect(profile.layers).toEqual([])
})
