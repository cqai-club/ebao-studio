import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findOverlayPackage,
  packageNameFromSpecifier,
  resolveOverlayPackage,
} from '../src/package-overlay.ts'

const roots: string[] = []

function fixture(): {
  root: string
  install: string
  profile: string
  options: { installPackageUrl: string; profilePackageUrl: string }
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-overlay-'))
  roots.push(root)
  const install = join(root, 'install')
  const profile = join(root, 'profile')
  mkdirSync(install)
  mkdirSync(profile)
  writeFileSync(join(install, 'package.json'), '{"name":"install-root"}\n')
  writeFileSync(join(profile, 'package.json'), '{"name":"profile-root"}\n')
  return {
    root,
    install,
    profile,
    options: {
      installPackageUrl: pathToFileURL(join(install, 'package.json')).href,
      profilePackageUrl: pathToFileURL(join(profile, 'package.json')).href,
    },
  }
}

function installPackage(root: string, name: string, version: string, actualName = name): string {
  const directory = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name: actualName, version })}\n`)
  return directory
}

function halfWrittenPackage(root: string, name: string): string {
  const directory = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  return directory
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Desktop package overlay', () => {
  it('uses the only available side', () => {
    const installOnly = fixture()
    installPackage(installOnly.install, 'desktop-only', '1.0.0')
    expect(resolveOverlayPackage('desktop-only', installOnly.options).selected.source).toBe('install')

    const profileOnly = fixture()
    installPackage(profileOnly.profile, 'profile-only', '1.0.0')
    expect(resolveOverlayPackage('profile-only', profileOnly.options).selected.source).toBe('profile')
  })

  it('distinguishes an absent package from an invalid declared candidate', () => {
    const absent = fixture()
    expect(findOverlayPackage('missing-package', absent.options)).toBeUndefined()
    expect(() => resolveOverlayPackage('missing-package', absent.options)).toThrow('cannot resolve package')
    expect(() => resolveOverlayPackage('plugin/subpath', absent.options)).toThrow('exact npm package name')
  })

  it('treats a package directory without a manifest as a missing candidate', () => {
    const profileBroken = fixture()
    installPackage(profileBroken.install, '@scope/plugin', '1.0.0')
    halfWrittenPackage(profileBroken.profile, '@scope/plugin')
    expect(resolveOverlayPackage('@scope/plugin', profileBroken.options).selected).toMatchObject({
      source: 'install',
      version: '1.0.0',
    })

    const installBroken = fixture()
    halfWrittenPackage(installBroken.install, '@scope/plugin')
    installPackage(installBroken.profile, '@scope/plugin', '1.0.0')
    expect(resolveOverlayPackage('@scope/plugin', installBroken.options).selected.source).toBe('profile')

    const bothBroken = fixture()
    halfWrittenPackage(bothBroken.install, '@scope/plugin')
    halfWrittenPackage(bothBroken.profile, '@scope/plugin')
    expect(findOverlayPackage('@scope/plugin', bothBroken.options)).toBeUndefined()
    expect(() => resolveOverlayPackage('@scope/plugin', bothBroken.options))
      .toThrow('cannot resolve package "@scope/plugin"')
  })

  it('ignores stale ancestor projections for bundle preparation as well as imports', () => {
    const state = fixture()
    installPackage(state.install, '@scope/plugin', '1.0.0')
    installPackage(state.root, '@scope/plugin', '99.0.0')
    expect(resolveOverlayPackage('@scope/plugin', state.options).selected.source).toBe('install')
    expect(resolveOverlayPackage('@scope/plugin', state.options).profile).toBeUndefined()
    const nested = join(state.profile, 'profiles', 'active')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), '{}')
    installPackage(state.profile, 'ancestor-only', '1.0.0')
    expect(findOverlayPackage('ancestor-only', {
      ...state.options, profilePackageUrl: pathToFileURL(join(nested, 'package.json')).href,
    })).toBeUndefined()
  })

  it('selects the newer semantic version in either direction', () => {
    const profileNewer = fixture()
    installPackage(profileNewer.install, '@scope/plugin', '1.9.9')
    installPackage(profileNewer.profile, '@scope/plugin', '2.0.0')
    expect(resolveOverlayPackage('@scope/plugin', profileNewer.options).selected).toMatchObject({
      source: 'profile',
      version: '2.0.0',
    })

    const installNewer = fixture()
    installPackage(installNewer.install, 'plugin', '3.0.0')
    installPackage(installNewer.profile, 'plugin', '2.9.9')
    expect(resolveOverlayPackage('plugin', installNewer.options).selected).toMatchObject({
      source: 'install',
      version: '3.0.0',
    })
  })

  it('orders prereleases and keeps Desktop on equal precedence', () => {
    const prerelease = fixture()
    installPackage(prerelease.install, 'plugin', '1.0.0-rc.1')
    installPackage(prerelease.profile, 'plugin', '1.0.0-rc.2')
    expect(resolveOverlayPackage('plugin', prerelease.options).selected.source).toBe('profile')

    const equal = fixture()
    installPackage(equal.install, 'plugin', '1.0.0+desktop')
    installPackage(equal.profile, 'plugin', '1.0.0+profile')
    expect(resolveOverlayPackage('plugin', equal.options).selected.source).toBe('install')
  })

  it('uses the only package even without a comparable version and rejects invalid identities', () => {
    const version = fixture()
    installPackage(version.install, 'plugin', 'not-a-version')
    expect(resolveOverlayPackage('plugin', version.options).selected).toMatchObject({
      source: 'install',
    })
    expect(resolveOverlayPackage('plugin', version.options).selected.version).toBeUndefined()

    const profileVersion = fixture()
    installPackage(profileVersion.profile, 'plugin', 'not-a-version')
    expect(resolveOverlayPackage('plugin', profileVersion.options).selected.source).toBe('profile')

    const identity = fixture()
    installPackage(identity.profile, 'plugin', '1.0.0', 'another-package')
    expect(() => resolveOverlayPackage('plugin', identity.options)).toThrow('package identity is invalid')
  })

  it('keeps a valid Desktop package when Profile metadata cannot be compared', () => {
    const version = fixture()
    installPackage(version.install, 'plugin', '1.0.0')
    installPackage(version.profile, 'plugin', 'not-a-version')
    expect(resolveOverlayPackage('plugin', version.options).selected).toMatchObject({
      source: 'install',
      version: '1.0.0',
    })

    const identity = fixture()
    installPackage(identity.install, 'plugin', '1.0.0')
    installPackage(identity.profile, 'plugin', '2.0.0', 'another-package')
    expect(resolveOverlayPackage('plugin', identity.options).selected.source).toBe('install')

    const installVersion = fixture()
    installPackage(installVersion.install, 'plugin', 'not-a-version')
    installPackage(installVersion.profile, 'plugin', '2.0.0')
    expect(resolveOverlayPackage('plugin', installVersion.options).selected.source).toBe('install')
  })

  it('finds only declared physical dependencies of admitted Profile bundles', () => {
    const state = fixture()
    const suite = installPackage(state.profile, 'suite-fixture', '1.0.0')
    writeFileSync(join(suite, 'package.json'), JSON.stringify({
      name: 'suite-fixture', version: '1.0.0',
      dependencies: { 'engine-fixture': '1.0.0' },
      bundledDependencies: ['engine-fixture'],
    }))
    const engine = installPackage(suite, 'engine-fixture', '1.0.0')
    writeFileSync(join(engine, 'package.json'), JSON.stringify({
      name: 'engine-fixture', version: '1.0.0', optionalDependencies: { 'engine-library': '1.0.0' },
    }))
    const library = installPackage(engine, 'engine-library', '1.0.0')
    installPackage(suite, 'undeclared-private-package', '1.0.0')
    const inactive = installPackage(state.profile, 'inactive-suite', '1.0.0')
    writeFileSync(join(inactive, 'package.json'), JSON.stringify({
      name: 'inactive-suite', version: '1.0.0', dependencies: { 'inactive-engine': '1.0.0' },
    }))
    installPackage(inactive, 'inactive-engine', '1.0.0')
    const options = { ...state.options, profileBundleNames: ['suite-fixture'] }
    expect(findOverlayPackage('engine-fixture', state.options)).toBeUndefined()
    expect(findOverlayPackage('engine-fixture', { ...options, profileBundleNames: [] })).toBeUndefined()
    expect(resolveOverlayPackage('engine-fixture', options).selected).toMatchObject({
      packageDir: engine, source: 'profile', bundlePackageName: 'suite-fixture',
      resolutionAnchorUrl: pathToFileURL(join(suite, 'package.json')).href,
    })
    expect(resolveOverlayPackage('engine-library', options).selected.packageDir).toBe(library)
    expect(findOverlayPackage('undeclared-private-package', options)).toBeUndefined()
    expect(findOverlayPackage('inactive-engine', options)).toBeUndefined()
  })

  it('uses the admitted bundle rather than undeclared hoisted leftovers while retaining installation SDKs', () => {
    const state = fixture()
    const suite = installPackage(state.profile, 'suite-fixture', '1.0.0')
    writeFileSync(join(suite, 'package.json'), JSON.stringify({
      name: 'suite-fixture', version: '1.0.0', dependencies: { 'engine-fixture': '1.0.0', 'host-sdk': '1.0.0' },
    }))
    const engine = installPackage(suite, 'engine-fixture', '1.0.0')
    installPackage(suite, 'host-sdk', '99.0.0')
    installPackage(state.root, 'engine-fixture', '99.0.0')
    const sdk = installPackage(state.install, 'host-sdk', '1.0.0')
    writeFileSync(join(state.install, 'package.json'), JSON.stringify({
      name: 'install-root', dependencies: { 'host-sdk': '1.0.0' },
    }))
    const options = { ...state.options, profileBundleNames: ['suite-fixture'] }
    expect(resolveOverlayPackage('engine-fixture', options).selected.packageDir).toBe(engine)
    expect(resolveOverlayPackage('host-sdk', options).selected.packageDir).toBe(sdk)
  })

  it('prefers an admitted physical bundle root over an equal undeclared installation ancestor', () => {
    const state = fixture()
    const name = 'cqai-dsh-plugin-ejianbao'
    const oldAncestor = installPackage(state.root, name, '0.1.0')
    const externalRoot = installPackage(state.profile, name, '0.1.0')
    expect(resolveOverlayPackage(name, state.options).selected.packageDir).toBe(oldAncestor)
    const options = { ...state.options, profileBundleNames: [name] }
    expect(resolveOverlayPackage(name, options).selected.packageDir).toBe(externalRoot)
    writeFileSync(join(state.install, 'package.json'), JSON.stringify({
      name: 'install-root', dependencies: { [name]: '0.1.0' },
    }))
    expect(resolveOverlayPackage(name, options).selected.packageDir).toBe(oldAncestor)
  })

  it.each(['0.1.0', '99.0.0'])('keeps suite engines when preserved direct engines have version %s', version => {
    const state = fixture()
    const rootName = 'cqai-dsh-plugin-ejianbao'
    const engineNames = ['cqai-dsh-plugin-video', 'cqai-dsh-plugin-short-video', 'cqai-dsh-plugin-talkcraft']
    const suite = installPackage(state.profile, rootName, '0.1.0')
    writeFileSync(join(suite, 'package.json'), JSON.stringify({
      name: rootName, version: '0.1.0', dependencies: Object.fromEntries(engineNames.map(name => [name, '0.1.0'])),
      bundledDependencies: engineNames, dsh: { ejianbao: { distribution: 'external', version: 1 } },
    }))
    const anotherSuite = installPackage(state.profile, 'another-admitted-suite', '1.0.0')
    writeFileSync(join(anotherSuite, 'package.json'), JSON.stringify({
      name: 'another-admitted-suite', version: '1.0.0',
      dependencies: Object.fromEntries(engineNames.map(name => [name, '99.0.0'])),
    }))
    const options = { ...state.options, profileBundleNames: [rootName, 'another-admitted-suite'] }
    for (const name of engineNames) {
      installPackage(state.install, name, version)
      installPackage(state.profile, name, version)
      installPackage(anotherSuite, name, '99.0.0')
      installPackage(suite, name, '0.1.0')
    }
    for (const name of engineNames) {
      expect(resolveOverlayPackage(name, options).selected).toMatchObject({
        packageDir: join(suite, 'node_modules', name), version: '0.1.0', source: 'profile', bundlePackageName: rootName,
      })
    }
  })

  it('requires the admitted external suite before resolving retired direct payloads', () => {
    const state = fixture()
    const names = ['cqai-dsh-plugin-ejianbao', 'cqai-dsh-plugin-video',
      'cqai-dsh-plugin-short-video', 'cqai-dsh-plugin-talkcraft']
    for (const name of names) {
      installPackage(state.install, name, '1.0.0')
      installPackage(state.profile, name, '2.0.0')
      // The migration still inspects old product links before live admission exists.
      expect(resolveOverlayPackage(name, state.options).selected.source).toBe('profile')
      expect(findOverlayPackage(name, { ...state.options, profileBundleNames: [] })).toBeUndefined()
      expect(findOverlayPackage(name, { ...state.options, profileBundleNames: ['unrelated-suite'] })).toBeUndefined()
      const admitted = { ...state.options, profileBundleNames: ['cqai-dsh-plugin-ejianbao'] }
      if (name === 'cqai-dsh-plugin-ejianbao') {
        expect(resolveOverlayPackage(name, admitted).selected.source).toBe('profile')
      } else {
        // An incomplete suite cannot borrow engines from preserved standalone installs.
        expect(findOverlayPackage(name, admitted)).toBeUndefined()
      }
    }
    installPackage(state.install, 'cqai-dsh-plugin-account', '1.0.0')
    expect(resolveOverlayPackage('cqai-dsh-plugin-account', {
      ...state.options, profileBundleNames: [],
    }).selected.source).toBe('install')
  })

  it('extracts scoped and unscoped roots without treating URLs as packages', () => {
    expect(packageNameFromSpecifier('@scope/plugin/subpath')).toBe('@scope/plugin')
    expect(packageNameFromSpecifier('plugin/subpath')).toBe('plugin')
    expect(packageNameFromSpecifier('node:fs')).toBeUndefined()
    expect(packageNameFromSpecifier('./relative.js')).toBeUndefined()
  })
})
