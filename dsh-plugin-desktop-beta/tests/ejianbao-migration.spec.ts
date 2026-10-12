import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  completeEjianbaoDisabledBundleMigration,
  EJIANBAO_PACKAGE_NAME,
  externalEjianbaoPackage,
  isEjianbaoEntry,
  migrateEjianbaoProfile,
  pendingEjianbaoDisabledBundles,
} from '../src/ejianbao-migration.ts'
import { clearDesktopProfileDisabledBundleNames, readDesktopDisabledBundles } from '../src/desktop-plugins.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-ejianbao-migration-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const installation = join(root, 'installation')
  mkdirSync(profile, { recursive: true })
  mkdirSync(installation, { recursive: true })
  writeFileSync(join(installation, 'package.json'), '{"name":"fixture-desktop","type":"module"}\n')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'fixture-profile',
    type: 'module',
    dsh: { profile: { bundles: [EJIANBAO_PACKAGE_NAME] } },
  }) + '\n')
  return { root, profile, installation, anchor: join(installation, 'package.json') }
}

function packageAt(directory: string, name: string, external = false) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      ...(external ? { ejianbao: { distribution: 'external', version: 1 } } : {}),
    },
  }) + '\n')
}

function editDependencies(profile: string, dependencies: Record<string, string>) {
  const path = join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.dependencies = dependencies
  writeFileSync(path, JSON.stringify(manifest) + '\n')
}

it('admits only a directly installed external root, including an explicit linked development install', () => {
  const { root, profile } = fixture()
  const local = join(root, 'external-project')
  packageAt(local, EJIANBAO_PACKAGE_NAME, true)
  const installed = join(profile, 'node_modules', EJIANBAO_PACKAGE_NAME)
  mkdirSync(dirname(installed), { recursive: true })
  symlinkSync(local, installed, process.platform === 'win32' ? 'junction' : 'dir')
  expect(externalEjianbaoPackage(profile)).toBeUndefined()
  editDependencies(profile, { [EJIANBAO_PACKAGE_NAME]: `link:${local}` })
  expect(externalEjianbaoPackage(profile)).toBe(installed)
  packageAt(local, EJIANBAO_PACKAGE_NAME)
  expect(externalEjianbaoPackage(profile)).toBeUndefined()
  packageAt(local, 'wrong-package-name', true)
  expect(externalEjianbaoPackage(profile)).toBeUndefined()
})

it('retires only dependencies and junctions proved to point at the Desktop product graph', () => {
  const { root, profile, installation, anchor } = fixture()
  const bundled = join(installation, 'node_modules', EJIANBAO_PACKAGE_NAME)
  packageAt(bundled, EJIANBAO_PACKAGE_NAME)
  const productLink = join(profile, 'node_modules', EJIANBAO_PACKAGE_NAME)
  mkdirSync(dirname(productLink), { recursive: true })
  symlinkSync(bundled, productLink, process.platform === 'win32' ? 'junction' : 'dir')
  const customTalkcraft = join(root, 'user-talkcraft-project')
  const talkcraftName = 'cqai-dsh-plugin-talkcraft'
  packageAt(customTalkcraft, talkcraftName)
  packageAt(join(installation, 'node_modules', talkcraftName), talkcraftName)
  const userLink = join(profile, 'node_modules', talkcraftName)
  symlinkSync(customTalkcraft, userLink, process.platform === 'win32' ? 'junction' : 'dir')
  editDependencies(profile, {
    [EJIANBAO_PACKAGE_NAME]: `link:${bundled}`,
    [talkcraftName]: `link:${customTalkcraft}`,
    'other-package': '^1.0.0',
  })

  expect(migrateEjianbaoProfile(profile, anchor)).toBe(true)
  expect(existsSync(productLink)).toBe(false)
  expect(existsSync(bundled)).toBe(true)
  expect(existsSync(userLink)).toBe(true)
  expect(existsSync(customTalkcraft)).toBe(true)
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  expect(manifest.dependencies).toEqual({
    [talkcraftName]: `link:${customTalkcraft}`,
    'other-package': '^1.0.0',
  })
  expect(manifest.dsh.profile.bundles).toEqual([])
  expect(migrateEjianbaoProfile(profile, anchor)).toBe(false)
})

it('leaves real installed package directories and registry dependencies intact', () => {
  const { profile, installation, anchor } = fixture()
  const product = join(installation, 'node_modules', EJIANBAO_PACKAGE_NAME)
  const direct = join(profile, 'node_modules', EJIANBAO_PACKAGE_NAME)
  packageAt(product, EJIANBAO_PACKAGE_NAME)
  packageAt(direct, EJIANBAO_PACKAGE_NAME)
  editDependencies(profile, { [EJIANBAO_PACKAGE_NAME]: '^0.0.7' })
  migrateEjianbaoProfile(profile, anchor)
  expect(existsSync(direct)).toBe(true)
  expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dependencies).toEqual({ [EJIANBAO_PACKAGE_NAME]: '^0.0.7' })
})

it('removes a dangling product junction even after the new Desktop no longer carries its payload', () => {
  const { profile, installation, anchor } = fixture()
  const retired = join(installation, 'node_modules', EJIANBAO_PACKAGE_NAME)
  const installed = join(profile, 'node_modules', EJIANBAO_PACKAGE_NAME)
  mkdirSync(dirname(installed), { recursive: true })
  symlinkSync(retired, installed, process.platform === 'win32' ? 'junction' : 'dir')
  editDependencies(profile, { [EJIANBAO_PACKAGE_NAME]: `link:${retired}` })
  migrateEjianbaoProfile(profile, anchor)
  expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dependencies).toEqual({})
  // Recreating the old installation directory must not make the retired link live again.
  packageAt(retired, EJIANBAO_PACKAGE_NAME)
  expect(existsSync(installed)).toBe(false)
})

it('retires manifest links into the old module-projection tree even after the upstream sweep removed it', () => {
  const { profile, anchor } = fixture()
  editDependencies(profile, { [EJIANBAO_PACKAGE_NAME]: 'link:./.dsh-module-fallback/node_modules/cqai-dsh-plugin-ejianbao' })
  migrateEjianbaoProfile(profile, anchor)
  expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dependencies).toEqual({})
})

it('clears the old private disable markers once and preserves later user disables and other Profiles', async () => {
  const { root, profile, anchor } = fixture()
  migrateEjianbaoProfile(profile, anchor)
  const statePath = join(root, 'private-state', 'state.json')
  mkdirSync(dirname(statePath), { recursive: true })
  const initial = {
    version: 1,
    profiles: [
      { profileName: 'desktop', disabledBundles: [EJIANBAO_PACKAGE_NAME, 'cqai-dsh-plugin-video', 'other-plugin'] },
      { profileName: 'web', disabledBundles: [EJIANBAO_PACKAGE_NAME] },
    ],
  }
  writeFileSync(statePath, JSON.stringify(initial) + '\n')
  const pending = pendingEjianbaoDisabledBundles(profile)
  expect(pending).toContain(EJIANBAO_PACKAGE_NAME)
  await clearDesktopProfileDisabledBundleNames(statePath, 'desktop', pending!)
  completeEjianbaoDisabledBundleMigration(profile)
  expect([...readDesktopDisabledBundles(statePath, 'desktop')]).toEqual(['other-plugin'])
  expect([...readDesktopDisabledBundles(statePath, 'web')]).toEqual([EJIANBAO_PACKAGE_NAME])
  const later = JSON.parse(readFileSync(statePath, 'utf8'))
  later.profiles[0].disabledBundles.push(EJIANBAO_PACKAGE_NAME)
  writeFileSync(statePath, JSON.stringify(later) + '\n')
  expect(pendingEjianbaoDisabledBundles(profile)).toBeUndefined()
  expect(readDesktopDisabledBundles(statePath, 'desktop')).toContain(EJIANBAO_PACKAGE_NAME)
})

it('recognizes saved Host ids and package subpaths while retaining unrelated rows', () => {
  expect(isEjianbaoEntry({ id: 'cqai-talkcraft' })).toBe(true)
  expect(isEjianbaoEntry({ name: 'cqai-dsh-plugin-video/client' })).toBe(true)
  expect(isEjianbaoEntry({ name: 'cqai-dsh-plugin-video-other' })).toBe(false)
  expect(isEjianbaoEntry({ id: 'dsn-account', name: '@cqaiclub/dsn-account' })).toBe(false)
})
