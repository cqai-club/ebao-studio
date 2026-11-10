/** Product-owned default capabilities, recomposed before each Profile operation and HMR reload. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { bundlePatchPaths, loadOverlayPatches, type Profile } from '@deepseek-ai/dsh-app-boot'

export const EBAO_PRODUCT_BUNDLES = [
  '@cqaiclub/dsn-account', 'cqai-dsh-plugin-imagegen', 'cqai-dsh-plugin-publisher',
  '@xmanrui/dsh-im', 'cqai-dsh-plugin-market', 'dsh-skill-mcp-panel', 'dsh-ppt-composer',
  'cqai-dsh-plugin-desktop-presentation', 'cqai-dsh-plugin-cqai-club-theme',
] as const

/** Add bundled product layers without rewriting the user's manifest or overriding their patch. */
export function composeEbaoProductBundles(profile: Profile, installAnchor: string): void {
  if (process.env.DSH_EBAO_SAFE_MODE === '1') return
  const require = createRequire(installAnchor)
  for (const packageName of EBAO_PRODUCT_BUNDLES) {
    if (profile.layers.some(layer => layer.packageName === packageName)) continue
    const manifestPath = require.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: { bundle?: { patch: string | string[] } } }
    if (!manifest.dsh?.bundle) throw new Error(`e宝工坊: bundled capability ${packageName} has no bundle declaration`)
    const packageDir = dirname(manifestPath)
    const patchPaths = bundlePatchPaths(packageDir, manifest.dsh.bundle)
    profile.layers.push({ packageName, packageDir, patchPaths,
      patches: patchPaths.flatMap(path => loadOverlayPatches('e宝工坊', path)) })
    profile.skippedBundles = profile.skippedBundles.filter(bundle => bundle.packageName !== packageName)
  }
  // The retained Skills/MCP panel owns its older gateway under the same service
  // name as current Harness. Keep both wire manifests and implementations in
  // their own realms, as Desktop already does for legacy Computer Use.
  const skills = profile.layers.find(layer => layer.packageName === 'dsh-skill-mcp-panel')
  for (const patch of skills?.patches ?? []) {
    if (!('insert' in patch) || !Array.isArray(patch.insert)) continue
    for (const row of patch.insert) {
      if (row.name === 'dsh-skill-mcp-panel') row.isolate = { ...row.isolate, mcpManager: 'ebao-skills-mcp-manager' }
    }
  }
}
