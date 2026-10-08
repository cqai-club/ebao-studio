/** Exercise the official CQAI MCP settings through the composed Desktop Host and Web client. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export async function verifyClubMcpBrowser({ url, cookie, headers, setExtensionEnabled }) {
  const { chromium } = createRequire(new URL('../dsh-desktop-next/package.json', import.meta.url))('playwright')
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const errors = []
  let page
  try {
    const context = await browser.newContext({ viewport: { width: 1448, height: 900 }, locale: 'zh-CN', extraHTTPHeaders: headers })
    const target = new URL(url)
    const separator = cookie.indexOf('=')
    await context.addCookies([{ url: target.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }])
    await context.addInitScript(() => { globalThis.dshDesktop = { protocolVersion: 1, cqaiPrimaryLogin: true } })
    page = await context.newPage()
    page.setDefaultTimeout(25_000)
    page.on('pageerror', error => errors.push(error.message))
    const openClub = async () => {
      await page.getByRole('button', { name: /CQAI Club 账号菜单/u }).click()
      await page.getByRole('menuitem', { name: 'CQAI Club', exact: true }).click()
      await page.locator('.cqai-club-nav').waitFor()
    }
    const assertExtensionEntries = async enabled => {
      await page.waitForFunction(expected => {
        const labels = [...document.querySelectorAll('.cqai-club-nav button')].map(button => button.textContent.trim())
        return labels.includes('俱乐部活动') === expected && labels.includes('MCP 服务') === expected
      }, enabled)
      assert.equal(await page.locator('.cqai-club-nav').getByRole('button', { name: '俱乐部活动', exact: true }).count(), enabled ? 1 : 0)
      assert.equal(await page.locator('.cqai-club-nav').getByRole('button', { name: 'MCP 服务', exact: true }).count(), enabled ? 1 : 0)
    }
    const openMcp = async () => {
      await openClub()
      await page.locator('.cqai-club-nav').getByRole('button', { name: 'MCP 服务', exact: true }).click()
      await page.getByRole('heading', { name: 'MCP 服务', exact: true }).waitFor()
    }
    await page.goto(target.href)
    await openClub()
    await assertExtensionEntries(false)
    await setExtensionEnabled(true)
    await assertExtensionEntries(true)
    await page.locator('.cqai-club-nav').getByRole('button', { name: 'MCP 服务', exact: true }).click()
    await page.getByRole('heading', { name: 'MCP 服务', exact: true }).waitFor()
    const panel = page.locator('.cqai-club-content')
    const toggle = panel.getByRole('switch', { name: '启用官网 MCP 服务' })
    await toggle.waitFor()
    await page.waitForFunction(() => !document.querySelector('input[role="switch"]')?.disabled)
    assert.equal(await toggle.isChecked(), false)
    assert.equal(await panel.getByRole('textbox').count(), 0)
    assert.match(await panel.innerText(), /未启用/u)
    await toggle.click()
    await panel.getByRole('button', { name: '登录并授权', exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: '连接服务', exact: true }).count(), 0)
    assert.match(await panel.innerText(), /需要登录/u)
    assert.match(await panel.innerText(), /可用工具: 0/u)
    if (process.env.DSH_CLUB_MCP_SCREENSHOT_DIR) {
      mkdirSync(process.env.DSH_CLUB_MCP_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.DSH_CLUB_MCP_SCREENSHOT_DIR, 'club-mcp-desktop.png'), fullPage: true })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot({ path: join(process.env.DSH_CLUB_MCP_SCREENSHOT_DIR, 'club-mcp-dark.png'), fullPage: true })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 820, height: 720 })
      await page.screenshot({ path: join(process.env.DSH_CLUB_MCP_SCREENSHOT_DIR, 'club-mcp-compact.png'), fullPage: true })
    }
    // Reload the composed client: its status must come from the real persisted Host setting.
    await page.reload()
    await openMcp()
    await page.waitForFunction(() => document.querySelector('input[role="switch"]')?.checked === true)
    assert.equal(await toggle.isChecked(), true)
    await toggle.click()
    await page.waitForFunction(() => {
      const input = document.querySelector('input[role="switch"]')
      return input && !input.checked && !input.disabled
    })
    assert.match(await panel.innerText(), /未启用/u)
    // Disabling the single extension while one of its panes is selected removes both entries.
    await setExtensionEnabled(false)
    await assertExtensionEntries(false)
    assert.equal(await page.getByRole('heading', { name: 'MCP 服务', exact: true }).count(), 0)
    await setExtensionEnabled(true)
    await assertExtensionEntries(true)
    await page.locator('.cqai-club-nav').getByRole('button', { name: 'MCP 服务', exact: true }).click()
    await toggle.waitFor()
    assert.deepEqual(errors, [])
    console.log('CQAI Club extension browser: one optional bundle, both dynamic entries, live disable/re-enable, official-only MCP settings and Host persistence passed')
  } catch (error) {
    if (page) console.error('CQAI Club MCP browser errors:', errors, '\nPage:', await page.locator('body').innerText())
    throw error
  } finally {
    await browser.close()
  }
}
