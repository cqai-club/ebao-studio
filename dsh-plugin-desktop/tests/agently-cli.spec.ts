import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { AGENTLY_CLI_PLATFORM_PACKAGES, installAgentlyCliResolution } from '../src/host/agently-cli.ts'

const roots: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  const cache = createRequire(import.meta.url).cache
  for (const path of Object.keys(cache)) {
    if (roots.some(root => path.startsWith(root + sep))) Reflect.deleteProperty(cache, path)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const PLATFORM = `${AGENTLY_CLI_PLATFORM_PACKAGES}darwin-arm64`
const manifest = `node_modules/${PLATFORM}/package.json`

function fixture(options: { unpacked?: boolean; runtimeName?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-agently-resolution-')))
  roots.push(root)
  const runtime = options.runtimeName === undefined ? join(root, 'app.asar') : join(root, 'app.asar', options.runtimeName)
  const unpacked = options.runtimeName === undefined ? join(root, 'app.asar.unpacked') : join(root, 'app.asar.unpacked', options.runtimeName)
  for (const base of options.unpacked === false ? [runtime] : [runtime, unpacked]) {
    const path = join(base, manifest)
    mkdirSync(join(dirname(path), 'bin'), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: PLATFORM, path: realpathSync(dirname(path)) }))
    const binary = join(dirname(path), 'bin', 'agently-cli')
    writeFileSync(binary, '#!/bin/sh\nprintf agently-ok\n')
    chmodSync(binary, 0o755)
  }
  const require = createRequire(join(runtime, 'node_modules', '@xmanrui', 'dsh-im', 'entry.js'))
  hooks.push(installAgentlyCliResolution(runtime)!)
  return { root, runtime, unpacked, require }
}

it('routes the platform manifest to the physical CLI beside the archive', () => {
  const f = fixture()
  // Electron honors registerHooks for require.resolve; Node's test runner does not on every release.
  const resolved = f.require(`${PLATFORM}/package.json`) as { path: string }
  const directory = realpathSync(dirname(join(f.unpacked, manifest)))
  expect(resolved.path).toBe(directory)
  const binary = join(resolved.path, 'bin', 'agently-cli')
  expect(existsSync(binary)).toBe(true)
  if (process.platform !== 'win32') expect(execFileSync(binary, { encoding: 'utf8' })).toBe('agently-ok')
})

it('rejects a missing unpacked package and leaves prepared runtimes alone', () => {
  const f = fixture({ unpacked: false })
  expect(() => f.require(`${PLATFORM}/package.json`)).toThrow()
  expect(installAgentlyCliResolution(join(f.root, 'plain-runtime'))).toBeUndefined()
})

it('preserves nested runtime paths and does not redirect external Profile packages', () => {
  const f = fixture({ runtimeName: 'dsh' })
  expect(f.require(`${PLATFORM}/package.json`)).toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
  const other = join(f.root, 'app.asar', 'other', manifest)
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  expect(() => createRequire(join(f.root, 'app.asar', 'other', 'entry.js'))(`${PLATFORM}/package.json`)).toThrow('outside the runtime package directory')
  const external = join(f.root, 'external', manifest)
  mkdirSync(dirname(external), { recursive: true })
  writeFileSync(external, JSON.stringify({ path: realpathSync(dirname(external)) }))
  expect(createRequire(join(f.root, 'external', 'entry.js'))(`${PLATFORM}/package.json`))
    .toMatchObject({ path: realpathSync(dirname(external)) })
})
