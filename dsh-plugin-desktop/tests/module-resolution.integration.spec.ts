import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installProfilePackageResolver, updateProfilePackageResolverBundles } from '../src/module-resolution.ts'

const roots: string[] = []

function writeManifest(directory: string, manifest: Record<string, unknown>): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('real Node Profile package hook', () => {
  it('preserves CJS/ESM conditions, callable identity, exports and manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-resolver-integration-'))
    roots.push(root)
    const profileDirectory = join(root, 'profiles', 'smoke')
    const profileManifestPath = join(profileDirectory, 'package.json')
    const modulesDirectory = join(profileDirectory, 'node_modules')
    const cjsDirectory = join(modulesDirectory, 'dsh-resolver-cjs-fixture')
    const esmDirectory = join(modulesDirectory, 'dsh-resolver-esm-fixture')
    const staleSchemaDirectory = join(
      root,
      'profiles',
      'node_modules',
      '@deepseek-ai',
      'schemastery',
    )

    writeManifest(profileDirectory, {
      name: 'dsh-profile-resolver-integration',
      private: true,
      type: 'module',
    })
    writeManifest(staleSchemaDirectory, {
      name: '@deepseek-ai/schemastery',
      version: '999.0.0',
      type: 'commonjs',
      main: './index.cjs',
    })
    writeFileSync(join(staleSchemaDirectory, 'index.cjs'), 'module.exports = { stale: true }\n')

    writeManifest(cjsDirectory, {
      name: 'dsh-resolver-cjs-fixture',
      version: '1.0.0',
      type: 'commonjs',
      exports: {
        '.': { import: './wrong-import.mjs', require: './index.cjs' },
        './features/*': './features/*.cjs',
        './package.json': './package.json',
      },
    })
    mkdirSync(join(cjsDirectory, 'features'))
    writeFileSync(join(cjsDirectory, 'wrong-import.mjs'), 'throw new Error("require selected import")\n')
    writeFileSync(join(cjsDirectory, 'features', 'shape.cjs'), 'module.exports = "wildcard-cjs"\n')
    writeFileSync(join(cjsDirectory, 'index.cjs'), [
      "const Schema = require('@deepseek-ai/schemastery')",
      "const manifest = require('@deepseek-ai/schemastery/package.json')",
      "const yamlUtil = require('yaml/util')",
      "const frontend = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')",
      'function consumer() { return "callable-cjs" }',
      'consumer.Schema = Schema',
      'consumer.manifest = manifest',
      'consumer.yamlUtil = yamlUtil',
      'consumer.frontend = frontend',
      "consumer.loadEsm = () => import('dsh-resolver-esm-fixture')",
      'module.exports = consumer',
      '',
    ].join('\n'))

    writeManifest(esmDirectory, {
      name: 'dsh-resolver-esm-fixture',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './index.mjs', require: './wrong-require.cjs' } },
    })
    writeFileSync(join(esmDirectory, 'wrong-require.cjs'), 'throw new Error("import selected require")\n')
    writeFileSync(join(esmDirectory, 'index.mjs'), [
      "import Schema from '@deepseek-ai/schemastery'",
      "import { parse } from 'yaml'",
      'export { Schema }',
      "export const value = parse('value: 7').value",
      '',
    ].join('\n'))

    const release = installProfilePackageResolver(pathToFileURL(profileManifestPath).href)
    try {
      const profileRequire = createRequire(profileManifestPath)
      const installRequire = createRequire(new URL('../package.json', import.meta.url))
      const consumer = profileRequire('dsh-resolver-cjs-fixture') as {
        (): string
        Schema?: unknown
        manifest?: { name?: unknown }
        yamlUtil?: { createNode?: unknown }
        frontend?: unknown
        loadEsm?: () => Promise<{ Schema?: unknown; value?: unknown }>
      }

      expect(consumer()).toBe('callable-cjs')
      expect(consumer.Schema).toBe(installRequire('@deepseek-ai/schemastery'))
      expect(consumer.manifest?.name).toBe('@deepseek-ai/schemastery')
      expect(typeof consumer.yamlUtil?.createNode).toBe('function')
      expect(consumer.frontend).toEqual(expect.stringContaining(join('dist', 'index.html')))
      expect(profileRequire('dsh-resolver-cjs-fixture/features/shape')).toBe('wildcard-cjs')
      expect(profileRequire('dsh-resolver-cjs-fixture/package.json')).toEqual(expect.objectContaining({
        name: 'dsh-resolver-cjs-fixture',
      }))

      const esm = await consumer.loadEsm?.()
      const installationEsm = await import('@deepseek-ai/schemastery')
      expect(esm?.Schema).toBe(installationEsm.default)
      expect(esm?.value).toBe(7)
    } finally {
      release()
    }
  })

  it('resolves physical bundled engines, their clients, and shared host SDKs from the admitted generation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bundled-profile-resolver-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const profileManifest = join(profile, 'package.json')
    const suite = join(profile, 'node_modules', 'dsh-bundled-suite-fixture')
    const engine = join(suite, 'node_modules', 'dsh-bundled-engine-fixture')
    const library = join(engine, 'node_modules', 'dsh-bundled-library-fixture')
    writeManifest(profile, { name: 'bundle-profile-fixture', private: true, type: 'module' })
    writeManifest(suite, { name: 'dsh-bundled-suite-fixture', version: '1.0.0',
      dependencies: { 'dsh-bundled-engine-fixture': '1.0.0' }, bundledDependencies: ['dsh-bundled-engine-fixture'] })
    writeManifest(engine, { name: 'dsh-bundled-engine-fixture', version: '1.0.0', type: 'module',
      dependencies: { 'dsh-bundled-library-fixture': '1.0.0' }, peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' },
      exports: { '.': { import: './index.mjs', require: './index.cjs' }, './client': './client.mjs', './package.json': './package.json' },
      dsh: { client: { platform: 'web', inject: [] } } })
    writeManifest(library, { name: 'dsh-bundled-library-fixture', version: '1.0.0', type: 'commonjs', main: './index.cjs' })
    writeFileSync(join(library, 'index.cjs'), "module.exports = require('@deepseek-ai/cordis')\n")
    writeFileSync(join(engine, 'index.cjs'), "module.exports = require('dsh-bundled-library-fixture')\n")
    writeFileSync(join(engine, 'index.mjs'), "import SDK from 'dsh-bundled-library-fixture'; export { SDK }\n")
    writeFileSync(join(engine, 'client.mjs'), 'export const client = "bundled-client"\n')
    writeFileSync(join(profile, 'load.cjs'), "module.exports = () => import('dsh-bundled-engine-fixture')\n")
    const inactive = join(profile, 'node_modules', 'dsh-inactive-suite-fixture')
    writeManifest(inactive, { name: 'dsh-inactive-suite-fixture', dependencies: { 'dsh-inactive-engine-fixture': '1.0.0' } })
    writeManifest(join(inactive, 'node_modules', 'dsh-inactive-engine-fixture'), { name: 'dsh-inactive-engine-fixture', main: './index.cjs' })
    const base = pathToFileURL(profileManifest).href
    const release = installProfilePackageResolver(base, { bundleNames: ['dsh-bundled-suite-fixture'] })
    try {
      const profileRequire = createRequire(profileManifest)
      const installRequire = createRequire(new URL('../package.json', import.meta.url))
      expect(profileRequire('dsh-bundled-engine-fixture')).toBe(installRequire('@deepseek-ai/cordis'))
      const engineUrl = profileRequire.resolve('dsh-bundled-engine-fixture/client')
      expect(engineUrl).toBe(join(engine, 'client.mjs'))
      expect(await import(pathToFileURL(engineUrl).href)).toMatchObject({ client: 'bundled-client' })
      const loadEsm = profileRequire('./load.cjs') as () => Promise<{ SDK: unknown }>
      const esm = await loadEsm()
      expect(esm.SDK).toBe(installRequire('@deepseek-ai/cordis'))
      expect(profileRequire('dsh-bundled-engine-fixture/package.json').dsh.client.platform).toBe('web')
      expect(() => profileRequire.resolve('dsh-inactive-engine-fixture')).toThrow('cannot resolve package')
      updateProfilePackageResolverBundles(base, [])
      expect(() => profileRequire.resolve('dsh-bundled-engine-fixture/client')).toThrow('cannot resolve package')
      updateProfilePackageResolverBundles(base, ['dsh-bundled-suite-fixture'])
      expect(profileRequire.resolve('dsh-bundled-engine-fixture/client')).toBe(engineUrl)
    } finally { release() }
  })

  it('rejects retired direct Host and Client paths until the external suite is admitted', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-retired-profile-resolver-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const profileManifest = join(profile, 'package.json')
    writeManifest(profile, { name: 'retired-profile-fixture', private: true, type: 'module' })
    const names = ['cqai-dsh-plugin-ejianbao', 'cqai-dsh-plugin-video',
      'cqai-dsh-plugin-short-video', 'cqai-dsh-plugin-talkcraft']
    for (const name of names) {
      const directory = join(profile, 'node_modules', name)
      writeManifest(directory, { name, version: '999.0.0', type: 'commonjs',
        exports: { '.': './index.cjs', './client': './client.cjs' } })
      writeFileSync(join(directory, 'index.cjs'), 'module.exports = "direct-host"\n')
      writeFileSync(join(directory, 'client.cjs'), 'module.exports = "direct-client"\n')
    }
    const base = pathToFileURL(profileManifest).href
    const suite = join(profile, 'node_modules', 'cqai-dsh-plugin-ejianbao')
    writeManifest(suite, { name: names[0], version: '999.0.0', type: 'commonjs',
      dependencies: Object.fromEntries(names.slice(1).map(name => [name, '0.1.0'])),
      exports: { '.': './index.cjs', './client': './client.cjs' } })
    for (const name of names.slice(1)) {
      const directory = join(suite, 'node_modules', name)
      writeManifest(directory, { name, version: '0.1.0', type: 'commonjs',
        exports: { '.': './index.cjs', './client': './client.cjs' } })
      writeFileSync(join(directory, 'index.cjs'), 'module.exports = "suite-host"\n')
      writeFileSync(join(directory, 'client.cjs'), 'module.exports = "suite-client"\n')
    }
    const release = installProfilePackageResolver(base, { bundleNames: [] })
    try {
      const profileRequire = createRequire(profileManifest)
      for (const name of names) {
        expect(() => profileRequire.resolve(name)).toThrow('cannot resolve package')
        expect(() => profileRequire.resolve(name + '/client')).toThrow('cannot resolve package')
      }
      updateProfilePackageResolverBundles(base, ['cqai-dsh-plugin-ejianbao'])
      for (const name of names) {
        const directory = name === 'cqai-dsh-plugin-ejianbao' ? suite : join(suite, 'node_modules', name)
        expect(profileRequire.resolve(name)).toBe(join(directory, 'index.cjs'))
        expect(profileRequire.resolve(name + '/client')).toBe(join(directory, 'client.cjs'))
      }
      updateProfilePackageResolverBundles(base, [])
      expect(() => profileRequire.resolve('cqai-dsh-plugin-video/client')).toThrow('cannot resolve package')
    } finally { release() }
  })

  it('does not treat DSH_HOME node_modules as part of the active Profile overlay', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-resolver-boundary-'))
    roots.push(root)
    const profileDirectory = join(root, 'profiles', 'smoke')
    const profileManifestPath = join(profileDirectory, 'package.json')
    const ancestorYamlDirectory = join(root, 'node_modules', 'yaml')

    writeManifest(profileDirectory, {
      name: 'dsh-profile-resolver-boundary',
      private: true,
      type: 'module',
    })
    writeManifest(ancestorYamlDirectory, {
      name: 'yaml',
      version: '999.0.0',
      type: 'commonjs',
      main: './index.cjs',
    })
    writeFileSync(join(ancestorYamlDirectory, 'index.cjs'), 'module.exports = { rogue: true }\n')

    const release = installProfilePackageResolver(pathToFileURL(profileManifestPath).href)
    try {
      const profileRequire = createRequire(profileManifestPath)
      const installRequire = createRequire(new URL('../package.json', import.meta.url))
      expect(profileRequire('yaml')).toBe(installRequire('yaml'))
      expect(profileRequire('yaml')).not.toEqual({ rogue: true })
    } finally {
      release()
    }
  })
})
