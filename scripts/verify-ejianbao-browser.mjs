/** Validate the actual Profile's composed Web application in Edge/Chromium. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

async function verifyInputFocus(input, expectedHeight) {
  await input.scrollIntoViewIfNeeded()
  await input.focus()
  const style = await input.evaluate(element => {
    const wrapper = element.parentElement
    const innerStyle = getComputedStyle(element), outerStyle = getComputedStyle(wrapper)
    const innerBounds = element.getBoundingClientRect(), outerBounds = wrapper.getBoundingClientRect()
    return {innerOutline: innerStyle.outlineStyle, innerBorders: [innerStyle.borderTopWidth, innerStyle.borderRightWidth, innerStyle.borderBottomWidth, innerStyle.borderLeftWidth], outerOutline: outerStyle.outlineStyle, outerOutlineWidth: outerStyle.outlineWidth, radius: outerStyle.borderTopLeftRadius, height: outerBounds.height, contained: innerBounds.top >= outerBounds.top && innerBounds.bottom <= outerBounds.bottom && innerBounds.left >= outerBounds.left && innerBounds.right <= outerBounds.right}
  })
  assert.equal(style.innerOutline, 'none', 'Input drew a second focus outline')
  assert.deepEqual(style.innerBorders, ['0px', '0px', '0px', '0px'], 'Input drew a second border')
  assert.equal(style.outerOutline, 'solid', 'Input lost its visible focus indicator')
  assert.equal(style.outerOutlineWidth, '2px')
  assert.notEqual(style.radius, '0px', 'Input lost its rounded wrapper')
  assert.ok(style.contained, 'Input overflowed its wrapper')
  if (expectedHeight !== undefined) assert.equal(style.height, expectedHeight)
}

async function verifyEnvironmentComposition(shell) {
  const tools = shell.locator('[data-ejianbao-tools]')
  assert.equal(await tools.count(), 1, 'public tools card was repeated')
  assert.ok(await tools.evaluate(element => Math.abs(element.getBoundingClientRect().width - element.parentElement.getBoundingClientRect().width) < 2), 'public tools card did not fill its row')
  const sharedBadges = tools.locator('[data-environment-badges]')
  await sharedBadges.getByText(/^Python 3\.11 · /).waitFor()
  for (const label of ['Python 3.11', '内置 uv', '宿主 Node.js', 'FFmpeg', 'ffprobe']) {
    assert.equal(await sharedBadges.getByText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `)).count(), 1, `public ${label} badge was missing or repeated`)
  }
  const engines = shell.locator('[data-ejianbao-engine]')
  assert.equal(await engines.count(), 3, 'dedicated engine cards were missing')
  for (const id of ['video', 'short-video', 'talkcraft']) {
    const card = shell.locator(`[data-ejianbao-engine="${id}"]`)
    const badges = card.locator('[data-environment-badges]')
    await badges.getByText(/^Python 包环境 · /).waitFor()
    assert.ok(!/Python 3\.11|内置 uv|宿主 Node\.js|FFmpeg|ffprobe/.test(await badges.innerText()), `${id} repeated public tool badges`)
    assert.equal(await card.getByRole('button', {name: '安装 / 修复专属依赖', exact: true}).count() + await card.getByRole('button', {name: '重试安装 / 修复专属依赖', exact: true}).count(), 1, `${id} did not expose its dedicated setup action`)
    for (const details of await card.locator('details').all()) assert.equal(await details.evaluate(element => element.open), false, `${id} logs or preparation instructions opened automatically`)
  }
}

export async function verifyEjianbaoBrowser({url, cookie, headers}) {
  const {chromium} = createRequire(new URL('../dsh-desktop-next/package.json', import.meta.url))('playwright')
  const browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})})
  let page
  const errors = [], requests = []
  try {
    const target = new URL(url)
    const context = await browser.newContext({viewport: {width: 1448, height: 900}, locale: 'zh-CN', extraHTTPHeaders: headers})
    const separator = cookie.indexOf('=')
    await context.addCookies([{url: target.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1)}])
    await context.addInitScript(() => {globalThis.dshDesktop = {protocolVersion: 1, cqaiPrimaryLogin: true}})
    page = await context.newPage()
    page.setDefaultTimeout(25_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {if (/cqai-(?:short-video|talkcraft)/.test(request.url())) requests.push(request.url())})
    await page.goto(target.href)
    await page.locator('[contenteditable="true"]').first().waitFor({state: 'visible'})
    // The Home card uses the same installed navigation contribution as the sidebar.
    await page.getByRole('button', {name: 'e剪宝', exact: true}).first().click()
    const shell = page.locator('[data-ejianbao-main]')
    await shell.waitFor()
    assert.equal(await page.locator('#ejianbao-tab-video').getAttribute('aria-selected'), 'true')
    assert.equal(requests.length, 0, 'unvisited engines made requests')
    assert.equal(await page.locator('#ejianbao-workspace-video').getByRole('button', {name: '设置', exact: true}).count(), 0, 'digital human tab kept a settings entry')
    await verifyInputFocus(page.locator('#ejb-duration'))
    await verifyInputFocus(page.locator('#ejb-title'))
    if (process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR}/ejianbao-video-input.png`})

    await page.locator('#ejianbao-tab-short-video').click()
    const short = page.locator('#ejianbao-workspace-short-video')
    assert.equal(await short.getByRole('button', {name: /设置|安装运行环境/}).count(), 0, 'short video tab kept a settings entry')
    const subject = page.locator('#video_subject')
    await subject.fill('e剪宝状态保留验收草稿')
    await short.getByRole('button', {name: '字幕', exact: true}).click()
    assert.equal(await short.locator('#subtitle_provider').count(), 0, 'short video tab kept the global subtitle setting')
    assert.equal(await short.getByRole('button', {name: '保存字幕引擎', exact: true}).count(), 0)
    await short.getByRole('button', {name: '主题与文案', exact: true}).click()
    await page.locator('#ejianbao-tab-talkcraft').click()
    const talk = page.locator('#ejianbao-workspace-talkcraft')
    assert.equal(await talk.getByRole('button', {name: '设置', exact: true}).count(), 0, 'TalkCraft tab kept a settings entry')
    await talk.getByRole('button', {name: /做新视频/}).first().click()
    await talk.locator('#tc-script').fill('这是一份仅用于页面状态验收的口播稿。')
    await shell.locator('.ejianbao-header').getByRole('button', {name: '设置', exact: true}).click()
    await shell.locator('.ejianbao-settings').waitFor()
    await verifyEnvironmentComposition(shell)
    if (process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR) {
      await shell.locator('[data-ejianbao-environments]').scrollIntoViewIfNeeded()
      await page.screenshot({path: `${process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR}/ejianbao-environments.png`})
    }
    await shell.getByRole('button', {name: '返回制作', exact: true}).click()
    assert.equal(await talk.locator('#tc-script').inputValue(), '这是一份仅用于页面状态验收的口播稿。')
    await page.locator('#ejianbao-tab-short-video').click()
    assert.equal(await subject.inputValue(), 'e剪宝状态保留验收草稿')

    const countTalk = () => requests.filter(value => value.includes('cqai-talkcraft')).length
    const hiddenStart = countTalk()
    await page.waitForTimeout(3500)
    assert.equal(countTalk(), hiddenStart, 'hidden TalkCraft kept polling')
    await page.locator('#ejianbao-tab-talkcraft').click()
    await page.waitForFunction(() => !document.querySelector('#ejianbao-workspace-talkcraft')?.hidden)
    assert.ok(countTalk() > hiddenStart, 'return did not refresh TalkCraft')
    if (process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR}/ejianbao-workspace.png`})

    await shell.locator('.ejianbao-header').getByRole('button', {name: '设置', exact: true}).click()
    const editor = page.locator('.ejb-settings-editor')
    await editor.getByRole('button', {name: '保存默认值'}).waitFor()
    assert.equal(await editor.getByLabel(/^默认画幅/).inputValue(), '9:16')
    await verifyInputFocus(editor.getByLabel(/^Edge 默认音色/), 40)
    if (process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR}/ejianbao-settings-input.png`})
    await editor.getByRole('button', {name: '配置连接', exact: true}).first().click()
    await verifyInputFocus(editor.locator('input[type="password"]'), 40)
    const fish = shell.locator('.ejianbao-setting-card').filter({has: page.getByRole('heading', {name: '口播专属 · Fish Audio 配音'})})
    await fish.getByRole('button', {name: '配置连接', exact: true}).click()
    await verifyInputFocus(page.locator('#ejianbao-fish'), 40)
    const publicState = await page.evaluate(async () => {
      const response = await fetch('/api/cqai-ejianbao/media-settings')
      return {status: response.status, text: await response.text()}
    })
    assert.equal(publicState.status, 200)
    const state = JSON.parse(publicState.text)
    assert.equal(state.defaults.edgeVoiceId, 'zh-CN-XiaoxiaoNeural')
    assert.ok(!/api_key|"fish"\s*:\s*"|"pexels"\s*:\s*"/.test(publicState.text), 'public API exposed secrets')
    if (process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.EJIANBAO_SMOKE_SCREENSHOT_DIR}/ejianbao-settings.png`})
    assert.deepEqual(errors, [])
    console.log('e剪宝 browser: single settings entry, public tools plus three dedicated engine cards, lazy tabs, preserved drafts, settings return, hidden polling, public defaults and input focus styles passed')
  } catch (error) {
    if (page) console.error('e剪宝 browser state:', errors, (await page.locator('body').innerText()).slice(0, 2200))
    throw error
  } finally {await browser.close()}
}
