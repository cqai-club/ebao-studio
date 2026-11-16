import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createEbaoWelcomeApi } from '../integrations/ebao-desktop-welcome/src/presentation.mjs'
import { buildWelcomePresentation, createWelcomePlan, transformWelcomeSource } from './prepare-ebao-welcome.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plan = createWelcomePlan({ root: ROOT })
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

test('copy composition preserves every preload operation, safe account snapshot and subscription disposer', async () => {
  const calls = []
  const snapshot = Object.freeze({ attempt: { id: 'attempt-1', phase: 'waiting-browser' }, user: null })
  const dispose = () => calls.push('dispose')
  const startSignIn = async () => { calls.push('start'); return snapshot }
  const onAccountState = callback => { callback(snapshot); return dispose }
  const sourceMessages = Object.freeze({ welcomeTitle: 'DeepSeek Harness', untouched: 'preserved', welcomeKeyFailed: 'upstream error' })
  const api = Object.freeze({ id: 'zh-CN', messages: sourceMessages, startSignIn, onAccountState,
    cancelSignIn: async id => id, copySignInLink: async id => id, saveApiKey: async key => key,
    skip: async () => {}, analytics: async () => {}, analyticsEnabled: async () => false, takeNotice: async () => undefined })
  const branded = createEbaoWelcomeApi(api)
  for (const [key, value] of Object.entries(api)) if (key !== 'messages') assert.equal(branded[key], value)
  assert.equal(await branded.startSignIn(), snapshot)
  let delivered
  assert.equal(branded.onAccountState(value => { delivered = value }), dispose)
  assert.equal(delivered, snapshot)
  assert.deepEqual(calls, ['start'])
  assert.equal(branded.messages.welcomeTitle, 'e宝工坊')
  assert.equal(branded.messages.welcomeSignIn, '使用 e宝账号登录')
  assert.equal(branded.messages.welcomeDescription, '连接 CQAI 账号，开启智能创作')
  assert.match(branded.messages.welcomeApiKey, /DeepSeek API Key/)
  assert.match(branded.messages.welcomeKeyDescription, /DeepSeek 官方模型.*CQAI/)
  assert.equal(branded.messages.untouched, 'preserved')
  assert.equal(branded.messages.welcomeKeyFailed, 'upstream error')
  assert.equal(api.messages, sourceMessages)
  assert.equal(api.messages.welcomeTitle, 'DeepSeek Harness')
  assert.match(createEbaoWelcomeApi({ ...api, id: 'en' }).messages.welcomeKeyDescription, /official DeepSeek models separately from CQAI/)
})

test('the pinned official sources expose exactly one guarded logo and mount seam', () => {
  const page = readFileSync(plan.welcomePage, 'utf8')
  const entry = readFileSync(plan.entry, 'utf8')
  const transformedPage = transformWelcomeSource(page, plan.welcomePage, plan)
  const transformedEntry = transformWelcomeSource(entry, plan.entry, plan)
  assert.equal(transformedPage.includes('<img className="brand"'), false)
  assert.match(transformedPage, /<EbaoBrand name=\{m.welcomeBrand\} \/>/)
  assert.match(transformedEntry, /<Welcome api=\{createEbaoWelcomeApi\(window.dshWelcome\)\} \/>/)
  assert.match(transformedEntry, /flushSync\(/)
  assert.match(transformedEntry, /root\.unmount\(\)/)
  for (const [source, id] of [[page, plan.welcomePage], [entry, plan.entry]]) {
    assert.throws(() => transformWelcomeSource('', id, plan), /exactly once/)
    assert.throws(() => transformWelcomeSource(source + source, id, plan), /exactly once/)
  }
  assert.equal(transformWelcomeSource('unrelated', join(plan.desktop, 'src', 'unrelated.ts'), plan), null)
})

test('upstream marker drift fails before loading the toolchain or writing output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ebao-welcome-guard-'))
  try {
    const fixture = createWelcomePlan({ root })
    mkdirSync(dirname(fixture.welcomePage), { recursive: true })
    writeFileSync(fixture.welcomePage, 'changed upstream markup')
    writeFileSync(fixture.entry, readFileSync(plan.entry))
    await assert.rejects(buildWelcomePresentation(fixture, { loadToolchain: () => assert.fail('must not load on drift') }), /brand marker.*exactly once/)
    assert.equal(existsSync(fixture.directory), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the builder refuses redirected generated directories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ebao-welcome-path-'))
  try {
    const fixture = createWelcomePlan({ root })
    mkdirSync(fixture.desktop, { recursive: true })
    const redirected = join(root, 'other-data')
    mkdirSync(redirected)
    symlinkSync(redirected, join(fixture.desktop, 'lib'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(buildWelcomePresentation(fixture), /redirected/)
    await assert.rejects(buildWelcomePresentation({ ...fixture, directory: join(fixture.desktop, 'renderer') }), /ignored official Desktop lib/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('real official Vite builds the owned brand, keeps same-origin assets and leaves upstream sources untouched', { timeout: 60_000 }, async () => {
  const directory = join(plan.desktop, 'lib', `.ebao-welcome-test-${process.pid}`)
  const before = [digest(plan.entry), digest(plan.welcomePage)]
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'keep-existing-generated-file'), 'preserved')
    const result = await buildWelcomePresentation({ ...plan, directory })
    assert.equal(result.directory, directory)
    for (const name of result.files) assert.equal(existsSync(join(directory, name)), true, name)
    assert.equal(readFileSync(join(directory, 'keep-existing-generated-file'), 'utf8'), 'preserved')
    assert.equal(digest(join(directory, 'ebao-robot.webp')), digest(plan.logo))
    assert.equal(digest(join(directory, 'brand-font.css')), digest(join(plan.shellAssets, 'brand-font.css')))
    const bundle = readFileSync(join(directory, 'welcome.js'), 'utf8')
    const css = readFileSync(join(directory, 'welcome.css'), 'utf8')
    assert.match(bundle, /e宝工坊/)
    assert.match(bundle, /使用 e宝账号登录/)
    assert.match(bundle, /\.\.\/lib\/welcome\/ebao-robot\.webp/)
    assert.equal(bundle.includes('assets/welcome-brand.svg'), false)
    assert.equal(bundle.includes('data:image/'), false)
    assert.equal(bundle.includes('MutationObserver'), false)
    assert.match(css, /main\.welcome \.ebao-brand/)
    assert.deepEqual([digest(plan.entry), digest(plan.welcomePage)], before)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
