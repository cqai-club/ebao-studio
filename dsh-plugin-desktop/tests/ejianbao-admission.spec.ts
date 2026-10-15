import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Include } from '@deepseek-ai/cordis-plugin-include'
import { Group, Loader, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { auditStartupEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, expect, it, vi } from 'vitest'
import { installEjianbaoEntryAdmission } from '../src/ejianbao-admission.ts'
import { isEjianbaoEntry } from '../src/ejianbao-migration.ts'
import { ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'
import { createDesktopProfileBoot } from '../src/profile-context.ts'

const homes: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function fixture(installAdmission = true) {
  const home = mkdtempSync(join(tmpdir(), 'desktop-ejianbao-include-'))
  homes.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  let installed = false
  if (installAdmission) installEjianbaoEntryAdmission(ctx, () => installed)
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(home).href + '/' })
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  const activated: { name: string, baseUrl: string }[] = []
  // Only module lookup is a fixture; all Include reads, patches, relative
  // bases, Loader lifecycle, configuration writes and startup audits are real.
  const imports = vi.fn(async (name: string) => {
    if (name === '@deepseek-ai/cordis-plugin-include') return { default: Include }
    if (name === '@deepseek-ai/cordis-plugin-group') return { default: Group }
    return { default: { apply(child: Context) { activated.push({ name, baseUrl: child.baseUrl! }) } } }
  })
  ctx.loader.internal = { import: imports } as never
  const mount = async (config: Include.Config) => {
    await ctx.loader.root.update([{ id: 'saved', name: 'cordis:include', config }])
    await ctx.loader.await()
    return ctx.loader.resolve('saved').subtree as Include
  }
  return { home, ctx, imports, activated, mount, setInstalled(value: boolean) { installed = value } }
}

function putJson(path: string, rows: unknown[]) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(rows, null, 2) + '\n')
  return readFileSync(path, 'utf8')
}

it('keeps official Includes and unrelated children running while saved E剪宝 rows stay inert and unmodified', async () => {
  const { home, ctx, imports, mount } = await fixture()
  const file = join(home, 'saved.json')
  const groupRows = [
    { id: 'cqai-short-video', name: 'cqai-dsh-plugin-short-video', config: { draft: true } },
    { id: 'inside', name: 'fixture-inside' },
  ]
  const rows = [
    { id: 'cqai-video', name: 'cqai-dsh-plugin-video', config: { model: 'original' } },
    { name: 'cqai-dsh-plugin-talkcraft/client', config: { anonymous: true } },
    { id: 'group', name: 'cordis:group', group: true, config: groupRows },
    { id: 'ordinary', name: 'fixture-ordinary', config: [{ name: 'cqai-dsh-plugin-video', keep: true }] },
    { id: 'user-disabled', name: 'fixture-disabled', disabled: true },
  ]
  const content = putJson(file, rows)
  const patches = [{ insert: [{ id: 'cqai-ejianbao', name: 'cqai-dsh-plugin-ejianbao' }] },
    { id: 'cqai-video', config: { model: 'patched' } }]
  const include = await mount({ path: './saved.json', patches })
  for (const entry of include.entries()) {
    if (!isEjianbaoEntry(entry.options)) continue
    expect(entry.disabled).toBe(true)
    expect(entry.fiber).toBeUndefined()
    expect(entry.options.disabled).toBeUndefined()
  }
  expect(imports.mock.calls.some(([name]) => isEjianbaoEntry({ name }))).toBe(false)
  expect(ctx.loader.resolve('saved:ordinary').fiber?.state).toBe(2)
  expect(ctx.loader.resolve('saved:inside').fiber?.state).toBe(2)
  expect(ctx.loader.resolve('saved:user-disabled').disabled).toBe(true)
  expect(ctx.loader.resolve('saved:ordinary').options.config).toEqual(rows[3]!.config)
  expect(readFileSync(file, 'utf8')).toBe(content)
  const warning = vi.fn()
  await auditStartupEntries(ctx, 'test', warning)
  expect(warning).not.toHaveBeenCalled()

  // The ordinary sibling's real Loader edit writes through the original
  // Include. Hidden rows/configs remain, and no migration name is persisted.
  await ctx.loader.update('saved:ordinary', { config: { edited: true } })
  await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).find((row: EntryOptions) => row.id === 'ordinary')?.config)
    .toEqual({ edited: true })
  const written = JSON.parse(readFileSync(file, 'utf8'))
  expect(written.find((row: EntryOptions) => row.id === 'cqai-video')).toEqual({ ...rows[0], config: { model: 'patched' } })
  expect(written.find((row: EntryOptions) => row.id === 'group').config[0]).toEqual(groupRows[0])
  expect(written.some((row: EntryOptions) => row.name === 'cqai-dsh-plugin-talkcraft/client')).toBe(true)
  expect(written.find((row: EntryOptions) => row.id === 'cqai-ejianbao')?.disabled).toBeUndefined()
})

it('guards initial, nested relative Includes, refresh and config updates without rewriting Include identities', async () => {
  const { home, ctx, mount, activated, imports } = await fixture()
  const nestedFile = join(home, 'sub', 'nested.json')
  const nestedContent = putJson(nestedFile, [
    { id: 'old-nested', name: 'cqai-dsh-plugin-video', config: { keep: true } },
    { id: 'relative', name: './relative-plugin.mjs' },
  ])
  const initial = [{ id: 'nested', name: '@deepseek-ai/cordis-plugin-include', config: { path: './sub/nested.json' } },
    { id: 'cqai-talkcraft', name: 'cqai-dsh-plugin-talkcraft', config: { model: 'keep' } }]
  const include = await mount({ path: './initial.json', initial })
  expect(JSON.parse(readFileSync(join(home, 'initial.json'), 'utf8'))).toEqual(initial)
  expect(readFileSync(nestedFile, 'utf8')).toBe(nestedContent)
  expect(activated.find(row => row.name === './relative-plugin.mjs')?.baseUrl).toBe(pathToFileURL(join(home, 'sub')).href + '/')
  const nested = ctx.loader.resolve('saved:nested').subtree as Include
  putJson(nestedFile, [{ id: 'refreshed-old', name: 'cqai-dsh-plugin-short-video/client' },
    { id: 'relative', name: './relative-plugin.mjs', config: { refreshed: true } }])
  await nested.refresh()
  await ctx.loader.await()
  expect(ctx.loader.resolve('saved:nested:refreshed-old').disabled).toBe(true)
  expect(imports.mock.calls.some(([name]) => isEjianbaoEntry({ name }))).toBe(false)

  // Official Include internal/update reapplies config.patches to cached rows.
  await ctx.loader.resolve('saved').fiber!.update({ path: './initial.json', initial,
    patches: [{ insert: [{ id: 'patch-old', name: 'cqai-dsh-plugin-ejianbao' }] }] })
  await ctx.loader.await()
  expect(include.resolve('patch-old').disabled).toBe(true)
  await ctx.loader.update('saved:nested:relative', { config: { userEdited: true } })
  await expect.poll(() => JSON.parse(readFileSync(nestedFile, 'utf8')).find((row: EntryOptions) => row.id === 'relative')?.config)
    .toEqual({ userEdited: true })
  expect(JSON.parse(readFileSync(nestedFile, 'utf8')).find((row: EntryOptions) => row.id === 'refreshed-old')?.name)
    .toBe('cqai-dsh-plugin-short-video/client')
  include.write()
  await expect.poll(() => JSON.parse(readFileSync(join(home, 'initial.json'), 'utf8')).some((row: EntryOptions) => row.id === 'patch-old')).toBe(true)
  expect(JSON.parse(readFileSync(join(home, 'initial.json'), 'utf8')).find((row: EntryOptions) => row.id === 'nested')?.name)
    .toBe('@deepseek-ai/cordis-plugin-include')
  await auditStartupEntries(ctx, 'test')
})

it('reenables saved rows after installation, respects user disabled state, and stops them after withdrawal', async () => {
  const { home, ctx, mount, setInstalled } = await fixture()
  const file = join(home, 'saved.json')
  const rows = [{ id: 'cqai-video', name: 'cqai-dsh-plugin-video', config: { saved: true } },
    { id: 'explicit-disabled', name: 'cqai-dsh-plugin-talkcraft', disabled: true },
    { id: 'ordinary', name: 'fixture-ordinary' }]
  const content = putJson(file, rows)
  const include = await mount({ path: './saved.json' })
  const entry = include.resolve('cqai-video')
  expect(entry.disabled).toBe(true)
  setInstalled(true)
  await include.root.update(include.root.data)
  await ctx.loader.await()
  expect(entry.disabled).toBe(false)
  expect(entry.fiber?.state).toBe(2)
  expect(entry.options.config).toEqual({ saved: true })
  expect(include.resolve('explicit-disabled').disabled).toBe(true)
  expect(include.resolve('explicit-disabled').fiber).toBeUndefined()
  setInstalled(false)
  await include.root.update(include.root.data)
  await ctx.loader.await()
  expect(entry.disabled).toBe(true)
  expect(entry.fiber?.state).toBe(4)
  expect(include.resolve('ordinary').disabled).toBe(false)
  expect(include.resolve('ordinary').fiber?.state).toBe(2)
  expect(readFileSync(file, 'utf8')).toBe(content)
  await auditStartupEntries(ctx, 'test')
})

it('does not admit a reselected old root, and follows verified external installation on Profile rereads', async () => {
  const { home, ctx, mount } = await fixture(false)
  const profile = ensureDesktopProfile(home)
  const root = join(profile, 'node_modules', 'cqai-dsh-plugin-ejianbao')
  mkdirSync(root, { recursive: true })
  const manifest = { name: 'cqai-dsh-plugin-ejianbao', version: '0.1.0', type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ejianbao: undefined as undefined | { distribution: string, version: number } } }
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
  const profileManifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  profileManifest.dependencies = { 'cqai-dsh-plugin-ejianbao': '^0.0.7' }
  profileManifest.dsh.profile.bundles.push('cqai-dsh-plugin-ejianbao')
  writeFileSync(join(profile, 'package.json'), JSON.stringify(profileManifest))
  const prepared = prepareDesktopProfile('1', home, 'win32')
  expect(prepared.profile.layers.some(layer => layer.packageName === 'cqai-dsh-plugin-ejianbao')).toBe(false)
  expect(prepared.profile.skippedBundles).toContainEqual(expect.objectContaining({ packageName: 'cqai-dsh-plugin-ejianbao' }))
  const pnpm = { activeProfileName: 'desktop', activeProfileDir: profile, homeDir: home, appExecutable: process.execPath,
    pnpmBinPath: join(home, 'pnpm.mjs'), electronVersion: '44.0.0', nodeBinDir: join(home, 'bin'),
    nodeShimPath: join(home, 'bin', 'node'), clearEnvironmentPath: join(home, 'clear.mjs'), dshBootstrapPath: join(home, 'dsh.mjs') }
  createDesktopProfileBoot(prepared, pnpm).prepare(ctx)
  const file = join(home, 'saved.json')
  const content = putJson(file, [{ id: 'saved-video', name: 'cqai-dsh-plugin-video', config: { model: 'retained' } }])
  const include = await mount({ path: './saved.json' })
  const entry = include.resolve('saved-video')
  expect(entry.disabled).toBe(true)
  expect(entry.fiber).toBeUndefined()
  // A real package upgrade gives the direct root the required marker. The
  // launcher's reread updates both the generation names and runtime getter.
  manifest.dsh.ejianbao = { distribution: 'external', version: 1 }
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  ctx.profileContext.readPatches!()
  await include.root.update(include.root.data)
  await ctx.loader.await()
  expect(entry.disabled).toBe(false)
  expect(entry.fiber?.state).toBe(2)
  manifest.dsh.ejianbao = undefined
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  ctx.profileContext.readPatches!()
  await include.root.update(include.root.data)
  await ctx.loader.await()
  expect(entry.disabled).toBe(true)
  expect(entry.fiber?.state).toBe(4)
  expect(readFileSync(file, 'utf8')).toBe(content)
})
