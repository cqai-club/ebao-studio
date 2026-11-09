/** Exercise bundled e宝 product surfaces in the actual official frontend, without Electron UI. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run from either Desktop workspace so each test uses that channel's runtime.
const root = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.ok(['dsh-plugin-desktop-beta', 'dsh-plugin-desktop'].includes(manifest.name), 'Run from a Stable or Beta Desktop workspace')
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('playwright')
const { DesktopHostProcess } = await import(pathToFileURL(join(root, 'lib/host-process.js')).href)
const { NextProfiles } = await import(pathToFileURL(join(root, 'lib/profiles.js')).href)
const { authenticateWebHost, serveWebDocument } = await import(pathToFileURL(join(root, 'lib/web-document.js')).href)
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
const temporaryHome = mkdtempSync(join(tmpdir(), 'ebao-builtins-'))
const manager = new NextProfiles(temporaryHome)
manager.ensure('desktop')
manager.setFeatures('desktop', { market: true, remoteControl: false })
manager.finishOnboarding('desktop')
writeFileSync(join(manager.directory('desktop'), 'cordis.patch.yml'), JSON.stringify([
  { id: 'ui-settings-account', config: { step: 'done', completion: 'skipped' } },
  { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-08-13.1' } },
]), { mode: 0o600 })

// The isolated user fixture keeps plugins away from live credentials. The skill
// plugin's global command shim must also be redirected into the temporary home.
const host = new DesktopHostProcess(process.execPath, root, manager.directory('desktop'), undefined,
  { ...process.env, DSH_HOME: temporaryHome, DSH_TELEMETRY_DISABLED: '1', npm_config_prefix: temporaryHome,
    ...(process.platform === 'win32' ? { APPDATA: temporaryHome } : {}) },
  undefined, undefined, undefined, join(root, 'scripts/fixtures/isolated-user-host.mjs'))
let browser
const errors = []
try {
  let readyTimer
  const ready = await Promise.race([
    host.start(),
    new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('Bundled plugin Host exceeded 60 seconds')), 60_000) }),
  ]).finally(() => { clearTimeout(readyTimer) })
  const origin = new URL(ready.url).origin
  const cookie = await authenticateWebHost(ready.url)
  const divider = cookie.indexOf('=')
  assert.ok(divider > 0, 'The temporary Host must issue a session cookie')
  const response = await serveWebDocument(new Request('dsh-app://app/'), webRoot)
  assert.equal(response.status, 200)
  const html = await response.text()
  browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_NEXT_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_NEXT_TEST_BROWSER_CHANNEL } : {}) })
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'zh-CN' })
  await context.addCookies([{ url: origin, name: cookie.slice(0, divider), value: cookie.slice(divider + 1) }])
  await context.grantPermissions(['local-network-access'], { origin })
  await context.route(url => url.origin === origin && url.pathname === '/', route =>
    route.fulfill({ contentType: 'text/html', body: html }))
  // Catalog discovery and automatic update checks are network-dependent; use
  // an empty local source while exercising the real market Client and slots.
  await context.route('**/api/community-market/**', route => {
    const path = new URL(route.request().url()).pathname
    const fixtures = {
      '/api/community-market/state': { sources: [], builtIns: [], desktopActions: { openTerminal: false } },
      '/api/community-market/updates': { updates: [], checkedAt: '2026-01-01T00:00:00.000Z' },
      '/api/community-market/installations': { installations: [] },
    }
    if (route.request().method() !== 'GET' || !(path in fixtures)) return route.abort('blockedbyclient')
    return route.fulfill({ json: fixtures[path] })
  })
  await context.exposeFunction('__ebaoBoot', async () => ({ injections: await host.collectInjections(), streamBaseUrl: origin }))
  await context.exposeFunction('__ebaoBootFailed', message => { errors.push(`Desktop boot: ${message}`) })
  await context.addInitScript(() => {
    globalThis.dshDesktop = { protocolVersion: 1 }
    globalThis.dshDesktopBoot = { ready: () => globalThis.__ebaoBoot(), failed: message => globalThis.__ebaoBootFailed(message) }
    globalThis.desktopNext = {
      state: async () => ({ selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
        features: { market: true, remoteControl: false }, preferences: {}, phase: 'ready', busy: false, failure: '', safeMode: false }),
      command: async () => {}, browserLinks: async () => ({ localUrl: null, lanUrls: [] }),
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => { errors.push(error.stack ?? error.message) })
  await page.goto(origin)
  await page.getByText('多平台发布', { exact: true }).first().waitFor()
  // CQAI account onboarding can be delayed by its initial signed-out RPC.
  await page.waitForTimeout(1000)
  for (let i = 0; i < 4; i++) {
    const later = page.getByRole('button', { name: /^(稍后登录|跳过|暂时跳过|Skip|Sign in later)$/u }).first()
    if (!await later.isVisible()) break
    await later.click()
    await page.waitForTimeout(300)
  }

  const robot = page.locator('.eBaoRobotArtwork')
  await robot.waitFor({ state: 'visible' })
  await page.locator('[data-ebao-home-dock]').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '打开e图宝', exact: true }).waitFor({ state: 'visible' })
  const artwork = await robot.evaluate(image => ({ naturalWidth: image.naturalWidth, width: image.getBoundingClientRect().width }))
  assert.ok(artwork.naturalWidth > 0 && artwork.width > 0, 'Robot artwork must load and have a visible size')
  await page.locator('style[data-plugin-css="cqai-dsh-plugin-cqai-club-theme/settings"]').waitFor({ state: 'attached' })
  await page.locator('style[data-plugin-css="cqai-dsh-plugin-cqai-club-theme/home-wallpaper"]').waitFor({ state: 'attached' })
  const background = await page.locator('[data-conversation-content][data-content-phase="hero"]').evaluate(node => getComputedStyle(node).backgroundImage)
  assert.notEqual(background, 'none', 'The theme must paint the modern homepage')

  const ppt = page.locator('[data-desktop-ppt]')
  await ppt.waitFor({ state: 'visible' })
  await ppt.click()
  await page.locator('[data-office-ppt-template-panel]').waitFor({ state: 'visible' })
  await page.locator('[data-ebao-home-dock]').waitFor({ state: 'hidden' })
  await ppt.click()
  await page.locator('[data-office-ppt-template-panel]').waitFor({ state: 'hidden' })
  await page.locator('[data-ebao-home-dock]').waitFor({ state: 'visible' })

  await page.getByText('CQAI Club', { exact: true }).first().click()
  await page.getByText('积分信息', { exact: true }).first().waitFor()
  await page.getByText('插件', { exact: true }).first().click()
  for (const name of ['插件市场', '技能', 'MCP']) {
    const tab = page.getByRole('tab', { name, exact: true })
    await tab.waitFor()
    await tab.click()
    if (name === '插件市场') await page.locator('.dshMarketRoot').waitFor({ state: 'visible' })
    if (name === '技能') {
      await page.getByText('管理全局与工作区里的技能：搜索、展开正文、启用/停用、删除、添加、迁移与分组。', { exact: true }).waitFor()
      await page.waitForFunction(() => !document.body.innerText.includes('正在读取技能…'))
      assert.equal(await page.getByText('暂时无法读取技能。', { exact: true }).count(), 0, 'Skills RPC must succeed')
    }
    if (name === 'MCP') await page.getByText('还没有 MCP 服务器。', { exact: true }).waitFor()
  }
  // An explicitly selected compatibility presentation retains upstream's hero.
  await page.goto(`${origin}/?dsh-desktop-mode=compatibility`)
  await page.getByText('探索未至之境', { exact: true }).waitFor()
  assert.equal(await page.locator('.eBaoRobotArtwork').count(), 0, 'Compatibility mode must retain the upstream hero')
  assert.equal(await page.locator('style[data-plugin-css="cqai-dsh-plugin-cqai-club-theme/home-wallpaper"]').count(), 0,
    'Compatibility mode must not install the product wallpaper')
  assert.deepEqual(errors, [], `Unexpected client errors: ${errors.join('\n')}`)
  console.log(`${manifest.name}: verified home, theme, PPT, Club, Market, Skills, MCP and compatibility mode`)
} finally {
  await browser?.close()
  await host.stop(true)
  rmSync(temporaryHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
