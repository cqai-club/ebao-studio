/** Exercise the Desktop plugin-management shell with the real composed Web client. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

export async function verifySkillMcpBrowser({ url, cookie, headers }) {
  const { chromium } = createRequire(new URL('../dsh-desktop-next/package.json', import.meta.url))('playwright')
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  })
  let page
  const errors = []
  try {
    const context = await browser.newContext({
      viewport: { width: 1448, height: 720 },
      locale: 'zh-CN',
      extraHTTPHeaders: headers,
    })
    const target = new URL(url)
    const separator = cookie.indexOf('=')
    await context.addCookies([{ url: target.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }])
    await context.addInitScript(() => {
      globalThis.dshDesktop = { protocolVersion: 1, cqaiPrimaryLogin: true }
    })
    page = await context.newPage()
    page.setDefaultTimeout(25_000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(target.href)
    await page.getByRole('button', { name: /CQAI Club 账号菜单/u }).click()
    await page.getByRole('menuitem', { name: '插件管理' }).click()

    const nav = page.locator('.cqpm-nav')
    await nav.getByRole('button', { name: '技能', exact: true }).click()
    await page.locator('.cqpm-external .SKV_page').waitFor()
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), '技能')
    assert.equal(await page.locator('.cqpm-external h2').first().innerText(), '技能')

    await nav.getByRole('button', { name: 'MCP', exact: true }).click()
    await page.locator('.cqpm-external .SKV_page').waitFor()
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), 'MCP')
    assert.match(await page.locator('.cqpm-external .MCP_section h3').first().innerText(), /MCP/u)
    assert.equal(await page.locator('.cqpm-native').isVisible(), false)
    assert.deepEqual(errors, [])
    console.log('Plugin management browser: Skills and MCP pages render from the bundled plugin')
  } catch (error) {
    if (page) console.error('Browser page errors:', errors)
    throw error
  } finally {
    await browser.close()
  }
}
