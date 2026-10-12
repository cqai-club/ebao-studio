/** Verify the built-in account page without installing any Club extension. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

export async function verifyClubAccountBrowser({ url, cookie, headers }) {
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
    const assertBaseNavigation = async () => {
      const nav = page.locator('.cqai-club-nav')
      await page.waitForFunction(() => {
        const labels = [...document.querySelectorAll('.cqai-club-nav button:not(.cqai-club-back)')].map(button => button.textContent.trim())
        return labels.length === 2 && labels[0] === '积分信息' && labels[1] === '会员信息'
      })
      assert.deepEqual(await nav.locator('button:not(.cqai-club-back)').allTextContents(), ['积分信息', '会员信息'])
      assert.equal(await nav.getByRole('button', { name: '俱乐部活动', exact: true }).count(), 0)
      assert.equal(await nav.getByRole('button', { name: 'MCP 服务', exact: true }).count(), 0)
      await nav.getByRole('button', { name: '会员信息', exact: true }).click()
      await page.locator('.cqai-club-content[aria-label="会员信息"]').waitFor()
      await nav.getByRole('button', { name: '积分信息', exact: true }).click()
      await page.getByRole('heading', { name: '积分信息', exact: true }).waitFor()
    }
    await page.goto(target.href)
    await openClub()
    await assertBaseNavigation()
    await page.reload()
    await openClub()
    await assertBaseNavigation()
    assert.deepEqual(errors, [])
    console.log('CQAI Club base browser: built-in account, points and membership, no optional extension entries, reload passed')
  } catch (error) {
    if (page) console.error('CQAI Club account browser errors:', errors, '\nPage:', await page.locator('body').innerText())
    throw error
  } finally {
    await browser.close()
  }
}
