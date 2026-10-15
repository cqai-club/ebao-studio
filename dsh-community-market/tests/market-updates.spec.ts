import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNpmRegistryVerifier,
  MarketInstallService,
  type MarketDesktopPnpm,
  type MarketDesktopPnpmOutcome,
} from '../src/install/service.js'

const packageName = 'cqai-dsh-plugin-fixture'
const oldVersion = '1.2.3'
const newVersion = '1.3.0'
const targets = [{ bundleId: 'fixture-bundle', packageName }]
const directories: string[] = []
const signal = () => new AbortController().signal

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async path => await rm(path, { recursive: true, force: true })))
})

async function writeInstalled(dir: string, name: string, version: string): Promise<void> {
  const path = join(dir, 'node_modules', name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
}

async function profile(spec = '^1.0.0', version = oldVersion): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'market-updates-'))
  directories.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'desktop-profile',
    private: true,
    dependencies: { [packageName]: spec, 'unrelated-package': '2.0.0' },
    dsh: { profile: { bundles: ['other-bundle', packageName], settings: { theme: 'custom' } }, custom: { preserved: true } },
  }))
  await writeFile(join(dir, 'pnpm-lock.yaml'), 'original-lockfile\n')
  await writeInstalled(dir, packageName, version)
  return dir
}

async function document(dir: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, any>
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function pnpm(
  dir: string,
  calls: string[][],
  after?: (version: string, index: number) => Promise<MarketDesktopPnpmOutcome>,
): MarketDesktopPnpm {
  return {
    run(argv) {
      calls.push([...argv])
      if (argv[0] === 'install') return {
        stdout: Readable.from([]), stderr: Readable.from([]), cancel: vi.fn(),
        done: Promise.resolve({ exitCode: 0, signal: null }),
      }
      const target = argv.at(-1)!
      const separator = target.lastIndexOf('@')
      const name = target.slice(0, separator)
      const version = target.slice(separator + 1)
      const index = calls.length
      return {
        stdout: Readable.from([]), stderr: Readable.from(['fixture package-manager output\n']), cancel: vi.fn(),
        done: (async () => {
          const manifest = await document(dir)
          manifest.dependencies[name] = version
          await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
          await writeFile(join(dir, 'pnpm-lock.yaml'), `lock-for-${version}\n`)
          await writeInstalled(dir, name, version)
          return after === undefined ? { exitCode: 0, signal: null } : await after(version, index)
        })(),
      }
    },
  }
}

function service(dir: string, verify = vi.fn(async () => ({ version: newVersion })), options = {}) {
  const calls: string[][] = []
  const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls), { verify }, options)
  return { instance, verify, calls }
}

describe('direct npm plugin update checks', () => {
  it('compares the installed version instead of the dependency range and caches npm results for 30 minutes', async () => {
    const dir = await profile('^1.0.0')
    let now = 1_000
    const { instance, verify } = service(dir, undefined, { now: () => now })
    const expected = { bundleId: 'fixture-bundle', packageName, currentVersion: oldVersion, latestVersion: newVersion, updateAvailable: true }
    expect((await instance.checkUpdates(targets, signal())).updates).toEqual([expected])
    now += 29 * 60 * 1_000
    const cached = await instance.checkUpdates(targets, signal())
    expect(cached.updates).toEqual([expected])
    expect(cached.checkedAt).toBe(new Date(1_000).toISOString())
    expect(verify).toHaveBeenCalledOnce()
    now += 60 * 1_000
    await instance.checkUpdates(targets, signal())
    expect(verify).toHaveBeenCalledTimes(2)
    await instance.checkUpdates(targets, signal(), true)
    expect(verify).toHaveBeenCalledTimes(3)
    await writeInstalled(dir, packageName, newVersion)
    expect((await instance.checkUpdates(targets, signal())).updates[0]?.updateAvailable).toBe(false)
    expect(verify).toHaveBeenCalledTimes(4)
  })

  it('skips official/product packages, indirect bundles, and special-source dependencies', async () => {
    const dir = await profile()
    const manifest = await document(dir)
    const names = {
      'fixture-workspace': 'workspace:*', 'fixture-file': 'file:../plugin', 'fixture-link': 'link:../plugin',
      'fixture-git': 'github:owner/plugin', 'fixture-url': 'https://example.test/plugin.tgz',
      'fixture-alias': 'npm:another-plugin@1.0.0', '@deepseek-ai/dsh-plugin': '1.0.0',
      'dsh-plugin-desktop': '1.0.0', 'dshmarket': '1.0.0', 'indirect-bundle': undefined,
    }
    for (const [name, spec] of Object.entries(names)) {
      if (spec !== undefined) manifest.dependencies[name] = spec
      manifest.dsh.profile.bundles.push(name)
    }
    manifest.dependencies['not-a-bundle'] = '1.0.0'
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    const { instance, verify } = service(dir)
    const checked = await instance.checkUpdates([...Object.keys(names), 'not-a-bundle'].map(name => ({ bundleId: name, packageName: name })), signal())
    expect(checked.updates).toEqual([])
    expect(verify).not.toHaveBeenCalled()
    await expect(instance.previewUpdatePackage('fixture-file', signal())).rejects.toMatchObject({ code: 'not-available' })
  })

  it('allows the npm latest tag using the actual installed version and skips next/canary tags', async () => {
    const dir = await profile('latest')
    const manifest = await document(dir)
    manifest.dependencies['fixture-next'] = 'next'
    manifest.dependencies['fixture-canary'] = 'canary'
    manifest.dsh.profile.bundles.push('fixture-next', 'fixture-canary')
    await writeInstalled(dir, 'fixture-next', '1.0.0')
    await writeInstalled(dir, 'fixture-canary', '1.0.0')
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    const { instance, verify, calls } = service(dir)
    const checked = await instance.checkUpdates([
      ...targets,
      { bundleId: 'next-bundle', packageName: 'fixture-next' },
      { bundleId: 'canary-bundle', packageName: 'fixture-canary' },
    ], signal())
    expect(checked.updates).toEqual([{ ...targets[0], currentVersion: oldVersion, latestVersion: newVersion, updateAvailable: true }])
    expect(verify).toHaveBeenCalledOnce()
    const preview = await instance.previewUpdatePackage(packageName, signal())
    expect(preview).toMatchObject({ currentVersion: oldVersion, version: newVersion })
    await expect(instance.executePreview(preview.intent, signal())).resolves.toMatchObject({ action: 'update', version: newVersion })
    expect(calls[0]?.at(-1)).toBe(`${packageName}@${newVersion}`)
    expect((await document(dir)).dependencies).toMatchObject({ [packageName]: newVersion, 'fixture-next': 'next', 'fixture-canary': 'canary' })
  })

  it('reports missing installed manifests and npm failures without claiming that a plugin is current', async () => {
    const dir = await profile()
    const { instance, verify } = service(dir)
    await rm(join(dir, 'node_modules', packageName), { recursive: true })
    expect((await instance.checkUpdates(targets, signal())).updates).toEqual([
      { ...targets[0], currentVersion: '', updateAvailable: false, error: expect.any(String) },
    ])
    expect(verify).not.toHaveBeenCalled()
    await writeInstalled(dir, packageName, oldVersion)
    verify.mockRejectedValueOnce(new Error('registry unavailable'))
    expect((await instance.checkUpdates(targets, signal())).updates).toEqual([
      { ...targets[0], currentVersion: oldVersion, updateAvailable: false, error: expect.any(String) },
    ])
    expect((await instance.checkUpdates(targets, signal())).updates[0]?.updateAvailable).toBe(true)
  })

  it('does not reuse a prior successful cache after a forced registry check fails', async () => {
    const dir = await profile()
    const { instance, verify } = service(dir)
    await instance.checkUpdates(targets, signal())
    verify.mockRejectedValueOnce(new Error('registry unavailable'))
    expect((await instance.checkUpdates(targets, signal(), true)).updates[0]).toHaveProperty('error')
    await instance.checkUpdates(targets, signal())
    expect(verify).toHaveBeenCalledTimes(3)
  })

  it.each(['1.0.0', oldVersion])('does not offer a downgrade or reinstall for npm latest %s', async latest => {
    const { instance } = service(await profile(), vi.fn(async () => ({ version: latest })))
    expect((await instance.checkUpdates(targets, signal())).updates[0]?.updateAvailable).toBe(false)
    await expect(instance.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'not-available' })
  })

  it('does not offer a prerelease as npm latest', async () => {
    const { instance } = service(await profile(), vi.fn(async () => ({ version: '2.0.0-beta.1' })))
    expect((await instance.checkUpdates(targets, signal())).updates[0]).toMatchObject({ error: expect.any(String), updateAvailable: false })
    await expect(instance.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'verification-failed' })
  })

  it('deduplicates concurrent requests while letting each caller cancel independently', async () => {
    const dir = await profile()
    const gate = deferred<{ version: string }>()
    let sharedSignal!: AbortSignal
    const verify = vi.fn(async (_candidate: unknown, requestSignal: AbortSignal) => { sharedSignal = requestSignal; return await gate.promise })
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, []), { verify })
    const cancelled = new AbortController()
    const first = instance.checkUpdates(targets, cancelled.signal)
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = instance.checkUpdates(targets, signal(), true)
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce())
    cancelled.abort()
    await rejection
    expect(sharedSignal.aborted).toBe(false)
    gate.resolve({ version: newVersion })
    expect((await second).updates[0]?.updateAvailable).toBe(true)
  })

  it('bounds concurrent npm checks and aborts both active and queued work on disposal', async () => {
    const dir = await profile()
    const manifest = await document(dir)
    const manyTargets = Array.from({ length: 9 }, (_, i) => ({ bundleId: `bundle-${i}`, packageName: `fixture-${i}` }))
    for (const target of manyTargets) {
      manifest.dependencies[target.packageName] = '1.0.0'
      manifest.dsh.profile.bundles.push(target.packageName)
      await writeInstalled(dir, target.packageName, '1.0.0')
    }
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    const verify = vi.fn(async (_candidate: unknown, requestSignal: AbortSignal) => await new Promise<{ version: string }>((_resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
    }))
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, []), { verify })
    const checked = instance.checkUpdates(manyTargets, signal())
    const rejection = expect(checked).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(4))
    instance.dispose()
    await rejection
    expect(verify).toHaveBeenCalledTimes(4)
  })
})

describe('confirmed plugin updates', () => {
  it('installs the previewed exact version, preserves Profile configuration, invalidates checks, and grants one restart', async () => {
    const dir = await profile()
    const before = await document(dir)
    const { instance, verify, calls } = service(dir)
    await instance.checkUpdates(targets, signal())
    const preview = await instance.previewUpdatePackage(packageName, signal())
    expect(preview).toMatchObject({ action: 'update', currentVersion: oldVersion, version: newVersion, profileName: 'desktop' })
    verify.mockResolvedValue({ version: '9.0.0' })
    const result = await instance.executePreview(preview.intent, signal())
    expect(result).toMatchObject({ action: 'update', packageName, version: newVersion, restartToken: expect.any(String) })
    expect(calls).toEqual([['add', '--save-exact', '--registry=https://registry.npmjs.org/', `${packageName}@${newVersion}`]])
    expect(await document(dir)).toEqual({ ...before, dependencies: { ...before.dependencies, [packageName]: newVersion } })
    await instance.checkUpdates(targets, signal())
    expect(verify).toHaveBeenCalledTimes(3)
    instance.consumeRestartToken(result.restartToken)
    expect(() => instance.consumeRestartToken(result.restartToken)).toThrow('already used')
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'intent-expired' })
  })

  it('rejects expired confirmations and a changed active Profile before running pnpm', async () => {
    const dir = await profile()
    let name = 'desktop'
    let now = 100
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name, dir }), pnpm(dir, calls), { verify: vi.fn(async () => ({ version: newVersion })) }, { now: () => now, intentTtlMs: 10 })
    const expired = await instance.previewUpdatePackage(packageName, signal())
    now = 110
    await expect(instance.executePreview(expired.intent, signal())).rejects.toMatchObject({ code: 'intent-expired' })
    const changed = await instance.previewUpdatePackage(packageName, signal())
    name = 'other-profile'
    await expect(instance.executePreview(changed.intent, signal())).rejects.toMatchObject({ code: 'conflict' })
    expect(calls).toEqual([])
  })

  it.each(['spec', 'version'])('rejects a changed installed plugin %s after preview', async changed => {
    const dir = await profile()
    const { instance, calls } = service(dir)
    const preview = await instance.previewUpdatePackage(packageName, signal())
    if (changed === 'version') await writeInstalled(dir, packageName, '1.2.4')
    else {
      const manifest = await document(dir)
      manifest.dependencies[packageName] = '~1.2.3'
      await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    }
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'conflict' })
    expect(calls).toEqual([])
  })

  it('restores the old exact package and original manifest/lock when pnpm fails after changing files', async () => {
    const dir = await profile()
    await chmod(join(dir, 'package.json'), 0o664)
    await chmod(join(dir, 'pnpm-lock.yaml'), 0o600)
    const original = await readFile(join(dir, 'package.json'), 'utf8')
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async (_version, index) => ({ exitCode: index === 1 ? 1 : 0, signal: null })), { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({
      code: 'operation-failed', message: expect.stringContaining('were restored'), details: expect.stringContaining('fixture package-manager output'),
    })
    expect(calls.slice(0, 2).map(call => call.at(-1))).toEqual([`${packageName}@${newVersion}`, `${packageName}@${oldVersion}`])
    expect(calls[2]).toEqual(['install', '--frozen-lockfile', '--registry=https://registry.npmjs.org/'])
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(original)
    expect(await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8')).toBe('original-lockfile\n')
    expect((await lstat(join(dir, 'package.json'))).mode & 0o777).toBe(0o664)
    expect((await lstat(join(dir, 'pnpm-lock.yaml'))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(dir, 'node_modules', packageName, 'package.json'), 'utf8')).version).toBe(oldVersion)
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'intent-expired' })
  })

  it('reports recovery failure explicitly instead of claiming that the old version was restored', async () => {
    const dir = await profile()
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async () => ({ exitCode: 1, signal: null })), { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({
      code: 'operation-failed', message: expect.stringContaining('restoring the previously installed version also failed'), details: expect.stringContaining('Recovery failure'),
    })
    expect(calls).toHaveLength(2)
  })

  it('recovers when pnpm reports success but installs the wrong package version', async () => {
    const dir = await profile()
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async (_version, index) => {
      if (index === 1) await writeInstalled(dir, packageName, '8.0.0')
      return { exitCode: 0, signal: null }
    }), { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'operation-failed', message: expect.stringContaining('were restored') })
    expect((await document(dir)).dependencies[packageName]).toBe('^1.0.0')
  })

  it('reports recovery failure when rebuilding the old frozen dependency tree fails', async () => {
    const dir = await profile()
    const calls: string[][] = []
    const delegate = pnpm(dir, calls, async (_version, index) => ({ exitCode: index === 1 ? 1 : 0, signal: null }))
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), {
      run(argv, requestSignal) {
        if (argv[0] !== 'install') return delegate.run(argv, requestSignal)
        calls.push([...argv])
        return { stdout: Readable.from([]), stderr: Readable.from([]), cancel: vi.fn(), done: Promise.resolve({ exitCode: 1, signal: null }) }
      },
    }, { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({
      code: 'operation-failed', message: expect.stringContaining('restoring the previously installed version also failed'), details: expect.stringContaining('pnpm install --frozen-lockfile'),
    })
    expect(calls).toHaveLength(3)
  })

  it('rejects an unsafe symlink Profile manifest before pnpm can mutate it', async () => {
    const dir = await profile()
    const { instance, calls } = service(dir)
    const preview = await instance.previewUpdatePackage(packageName, signal())
    const backup = join(dir, 'linked-package.json')
    await writeFile(backup, await readFile(join(dir, 'package.json')))
    await rm(join(dir, 'package.json'))
    await symlink(backup, join(dir, 'package.json'))
    await expect(instance.executePreview(preview.intent, signal())).rejects.toThrow('unsafe Profile backup source')
    expect(calls).toEqual([])
  })

  it('preserves unrelated Profile configuration/dependency changes made while the update was running', async () => {
    const dir = await profile()
    const original = await document(dir)
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async (_version, index) => {
      if (index === 1) {
        const changed = await document(dir)
        changed.dsh.profile.settings.theme = 'new-user-choice'
        changed.dependencies['new-user-plugin'] = '3.0.0'
        changed.dsh.profile.bundles.push('new-user-plugin')
        await writeFile(join(dir, 'package.json'), JSON.stringify(changed))
      }
      return { exitCode: index === 1 ? 1 : 0, signal: null }
    }), { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'operation-failed', message: expect.stringContaining('unrelated Profile changes were preserved') })
    expect(await document(dir)).toEqual({
      ...original,
      dependencies: { ...original.dependencies, [packageName]: oldVersion, 'new-user-plugin': '3.0.0' },
      dsh: { ...original.dsh, profile: { ...original.dsh.profile, settings: { theme: 'new-user-choice' }, bundles: [...original.dsh.profile.bundles, 'new-user-plugin'] } },
    })
    expect(await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8')).toBe(`lock-for-${oldVersion}\n`)
    expect(calls).toHaveLength(2)
  })

  it('keeps updates mutually exclusive while pnpm is running', async () => {
    const dir = await profile()
    const gate = deferred<MarketDesktopPnpmOutcome>()
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async () => await gate.promise), { verify: vi.fn(async () => ({ version: newVersion })) })
    const first = await instance.previewUpdatePackage(packageName, signal())
    const second = await instance.previewUpdatePackage(packageName, signal())
    const running = instance.executePreview(first.intent, signal())
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await expect(instance.executePreview(second.intent, signal())).rejects.toMatchObject({ code: 'conflict' })
    gate.resolve({ exitCode: 0, signal: null })
    await expect(running).resolves.toMatchObject({ action: 'update' })
  })

  it('finishes recovery after the request is aborted during the package operation', async () => {
    const dir = await profile()
    const request = new AbortController()
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls, async (_version, index) => {
      if (index === 1) request.abort()
      return { exitCode: 0, signal: null }
    }), { verify: vi.fn(async () => ({ version: newVersion })) })
    const preview = await instance.previewUpdatePackage(packageName, signal())
    await expect(instance.executePreview(preview.intent, request.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(3)
    expect((await document(dir)).dependencies[packageName]).toBe('^1.0.0')
  })

  it('rejects an update with a known incompatible official DSH peer during preview', async () => {
    const dir = await profile()
    await writeInstalled(dir, '@deepseek-ai/dsh-client-ui-settings', '0.2.0-rc.2')
    const verify = createNpmRegistryVerifier({ getJson: async () => ({
      finalUrl: `https://registry.npmjs.org/${packageName}/latest`,
      value: { name: packageName, version: newVersion, dsh: { bundle: { patch: './cordis.patch.yml' } }, peerDependencies: { '@deepseek-ai/dsh-client-ui-settings': '>=0.3.0' } },
    }) })
    const calls: string[][] = []
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, calls), verify)
    await expect(instance.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'verification-failed', message: expect.stringContaining('current Profile has 0.2.0-rc.2') })
    expect(calls).toEqual([])
  })

  it('checks inherited Desktop DSH peers and reports incompatible releases in the update list', async () => {
    const dir = await profile()
    const verifier = { verify: vi.fn(async () => ({ version: newVersion, peerDependencies: { '@deepseek-ai/cordis': '>99999.0.0' } })) }
    const instance = new MarketInstallService(() => ({ name: 'desktop', dir }), pnpm(dir, []), verifier)
    expect((await instance.checkUpdates(targets, signal())).updates[0]).toMatchObject({ currentVersion: oldVersion, updateAvailable: false, error: expect.stringContaining('current Profile has') })
    await expect(instance.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'verification-failed' })
  })
})
