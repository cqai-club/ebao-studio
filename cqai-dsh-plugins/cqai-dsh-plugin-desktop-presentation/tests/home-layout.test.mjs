import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Reuse the repository's existing browser runtime; no separate browser install.
const browserRequire = createRequire(new URL('../../../dsh-desktop-next/package.json', import.meta.url))
const desktopRequire = createRequire(new URL('../../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const { chromium } = browserRequire('playwright')
const React = browserRequire('react')
const jsxRuntime = browserRequire('react/jsx-runtime')
const { renderToStaticMarkup } = browserRequire('react-dom/server')
const presentationBundle = readFileSync(process.env.EBAO_LAYOUT_TEST_BUNDLE ?? new URL('../lib/client.js', import.meta.url), 'utf8')
const conversationBundle = readFileSync(desktopRequire.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const rendererBundle = readFileSync(desktopRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8')

function bundledRegion(filename) {
  const marker = conversationBundle.indexOf(`${filename}\n`)
  assert.notEqual(marker, -1, `Published conversation bundle must expose its ${filename} region`)
  const start = marker + filename.length + 1
  const end = conversationBundle.indexOf('//#endregion', start)
  assert.ok(end > start)
  return conversationBundle.slice(start, end)
}

// Execute the installed upstream component and its compiled CSS. Copying its
// wrappers into a fixture would let a changed upstream DOM pass unnoticed.
const shellCssRegion = bundledRegion('HeroShell.module.css.mjs')
const cssVariable = shellCssRegion.match(/const (\w+\$\d+) = /)?.[1]
assert.ok(cssVariable)
const upstream = runInNewContext(`${shellCssRegion}\n({ css: ${cssVariable}, classes: HeroShell_module_css_default })`)
const HeroShell = runInNewContext(`${bundledRegion('EmptyHero.js')}\nHeroShell`, {
  react: React, react_jsx_runtime: jsxRuntime,
  HeroShell_module_css_default: upstream.classes,
})
const slotAnchor = rendererBundle.match(/const ANCHOR_STYLE = [^;]+;/)?.[0]
const slotComponent = rendererBundle.match(/function SlotOutlet\([\s\S]*?\n\t\t}/)?.[0]
assert.ok(slotAnchor && slotComponent, 'Use the published renderer outlet, including its display:contents anchor')
const SlotOutlet = runInNewContext(`${slotAnchor}\n${slotComponent}\nSlotOutlet`, {
  // Only the slot host is a fixture: the upstream wrapper and style are real.
  react: { ...React, useSyncExternalStore() {} }, react_jsx_runtime: jsxRuntime,
  useHost: () => ({ locale: {}, subscribe() {}, getVersion: () => 0 }),
  useLocaleRevision() {}, useScopeBinding() {},
  renderOutletContent: (_host, _key, ownerProps) => ownerProps.content,
})

function presentation(mode) {
  const styles = []
  const slots = new Map()
  let api
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild: style => { styles.push(style.textContent) } },
  }
  const window = {
    location: { search: `?dsh-desktop-mode=${mode}` },
    __ModuleLoader__: { load: registration => { api = registration.factory(browserRequire) } },
  }
  runInNewContext(presentationBundle, { window, document, URLSearchParams })
  const panels = ['cqai-imagegen', 'cqai-ejianbao', 'cqai-publisher']
  const ctx = {
    inject: (_names, callback) => callback(ctx),
    effect: callback => callback(),
    layout: { selectPanel() {} },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, render) => { slots.set(options.name, render) },
      entriesOfSlot: name => panels.map(id => ({ options: name === 'main' ? { key: id } : { id } })),
      subscribe: () => () => {},
    },
  }
  api.apply(ctx)
  return { css: styles.join('\n'), slots }
}

function fixture({ mode = 'extended', phase = 'hero', renamed = false, ppt = false, withSlot = true }) {
  const product = presentation(mode)
  const headline = withSlot ? product.slots.get('conversation.hero.headline')?.() : undefined
  const shell = React.createElement(HeroShell, {
    t: key => key === 'hero.preview' ? '预览版' : '探索未知之境',
    renderSlot: (name, props) => React.createElement(SlotOutlet, {
      slotKey: name,
      ownerProps: { content: name === 'conversation.hero.headline'
        ? headline ?? '探索未知之境'
        : React.createElement('svg', { ...props, 'data-upstream-fish': '', width: 34, height: 25 }) },
    }),
    children: ppt ? React.createElement('div', { 'data-office-ppt-template-panel': '' }, 'PPT') : undefined,
  })
  let html = renderToStaticMarkup(shell)
  let css = upstream.css
  const classes = { ...upstream.classes }
  if (renamed) {
    for (const [key, original] of Object.entries(upstream.classes)) {
      const replacement = `${renamed}_${key}`
      html = html.replaceAll(original, replacement)
      css = css.replaceAll(original, replacement)
      classes[key] = replacement
    }
  }
  return {
    classes, installedSlots: product.slots.size,
    html: `<html><head><style>
      body { margin: 0; --dsh-conversation-column-width: calc(100vw - 48px); --dsh-composer-card-max-width: 720px; }
      [data-conversation-content], [data-conversation-scroll], [data-composer-seat] { width: 100%; }
      [data-conversation-scroll] { display: flex; flex-direction: column; align-items: stretch; }
      ${css}
      ${product.css}
    </style></head><body data-dsh-desktop-mode="${mode}">
      <div data-conversation-content data-content-phase="${phase}"><div data-conversation-scroll>
        <div data-composer-seat>${html}</div>
      </div></div>
    </body></html>`,
  }
}

let browser
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_NEXT_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_NEXT_TEST_BROWSER_CHANNEL } : {}) })
})
after(async () => { await browser?.close() })

async function measure(options, viewport = { width: 1280, height: 900 }) {
  const rendered = fixture(options)
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    await page.setContent(rendered.html)
    await page.waitForFunction(() => [...document.images].every(image => image.complete))
    return { ...await page.evaluate(classes => {
      const find = key => document.getElementsByClassName(classes[key])[0]
      const rect = node => {
        if (!node) return undefined
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height }
      }
      const image = document.querySelector('.eBaoRobotArtwork')
      return {
        robot: rect(image), naturalWidth: image?.naturalWidth,
        hero: rect(document.querySelector('.eBaoRobotHero')),
        root: rect(find('root')), containerName: getComputedStyle(find('root')).containerName,
        fishDisplay: getComputedStyle(find('fishHitbox')).display,
        badgeDisplay: getComputedStyle(find('previewBadge')).display,
        titleDisplay: getComputedStyle(find('titleGroup')).display,
        headlineAlignSelf: getComputedStyle(find('headline')).alignSelf,
        fallbackDisplay: document.querySelector('.eBaoHeroFallback') && getComputedStyle(document.querySelector('.eBaoHeroFallback')).display,
        actionXs: [...document.querySelectorAll('.eBaoHeroAction')].map(button => button.getBoundingClientRect().x),
      }
    }, rendered.classes), installedSlots: rendered.installedSlots }
  } finally { await context.close() }
}

for (const renamed of [false, 'zNic4G', 'rebuiltModule']) {
  test(`robot and actions keep real dimensions with ${renamed || 'published'} module classes`, async () => {
    const result = await measure({ renamed })
    assert.equal(result.naturalWidth, 720, 'The actual bundled robot artwork must decode')
    assert.ok(result.robot.width >= 200 && result.robot.height > 100,
      `The robot must not collapse in its percentage-sized wrappers (${result.robot.width} × ${result.robot.height})`)
    assert.ok(Math.max(...result.actionXs) - Math.min(...result.actionXs) > 100, 'Actions must surround the robot instead of sharing one x coordinate')
    assert.equal(result.containerName, 'eBaoHero')
    assert.equal(result.fishDisplay, 'none')
    assert.equal(result.badgeDisplay, 'none')
    assert.equal(result.titleDisplay, 'block')
  })
}

test('narrow advanced home still displays the robot and separated actions', async () => {
  const result = await measure({ mode: 'advanced', renamed: 'narrowModule' }, { width: 390, height: 844 })
  assert.equal(result.naturalWidth, 720)
  assert.ok(result.robot.width > 100 && result.robot.height > 80, `Narrow robot size: ${result.robot.width} × ${result.robot.height}`)
  assert.ok(result.robot.x >= 0 && result.robot.x + result.robot.width <= 390)
  assert.ok(Math.max(...result.actionXs) - Math.min(...result.actionXs) > 80)
  assert.equal(result.fishDisplay, 'none')
  assert.equal(result.badgeDisplay, 'none')
})

test('PPT keeps upstream chrome and its text fallback', async () => {
  const result = await measure({ ppt: true, renamed: 'pptModule' })
  assert.ok(result.fishDisplay !== 'none' && result.badgeDisplay !== 'none')
  assert.equal(result.hero.width, 0)
  assert.equal(result.fallbackDisplay, 'inline')
  assert.equal(result.containerName, 'none')
})

test('compatibility mode does not install a home override', async () => {
  const result = await measure({ mode: 'compatibility' })
  assert.equal(result.installedSlots, 0)
  assert.equal(result.robot, undefined)
  assert.ok(result.fishDisplay !== 'none' && result.badgeDisplay !== 'none')
  assert.equal(result.containerName, 'none')
})

for (const options of [{ phase: 'messages' }, { withSlot: false }]) {
  test(`upstream chrome stays untouched ${options.phase ? 'outside the hero phase' : 'without the product slot'}`, async () => {
    const result = await measure(options)
    assert.ok(result.fishDisplay !== 'none' && result.badgeDisplay !== 'none')
    assert.equal(result.titleDisplay, 'flex')
    assert.equal(result.headlineAlignSelf, 'auto')
    assert.equal(result.containerName, 'none')
  })
}
