import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../package.json', import.meta.url))
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function register(search, desktop) {
  let api
  const styles = []
  const slots = []
  const window = {
    location: { search },
    ...(desktop ? { desktopNext: {} } : {}),
    __ModuleLoader__: { load: row => { api = row.factory(require) } },
  }
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild: style => { styles.push(style.textContent) } },
  }
  runInNewContext(bundle, { window, document, URLSearchParams })
  const ctx = {
    inject: (_services, callback) => callback(ctx),
    effect: callback => callback(),
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { slots.push({ options, component }) },
    },
  }
  api.apply(ctx)
  return { slots, styles }
}

const presentationSlots = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'conversation.hero.frame']

test('modern Desktop uses the sidebar brand slots and the declared hero slots', () => {
  const { slots, styles } = register('', true)
  assert.deepEqual(slots.map(entry => entry.options.name), presentationSlots)
  const mark = slots.find(entry => entry.options.name === 'sidebar.brand.mark').component({ size: 24 })
  assert.equal(mark.props['aria-hidden'], 'true')
  assert.equal(mark.props.style.width, 24)
  assert.match(mark.props.style.maskImage, /^url\(data:image\/png;base64,/)
  const wordmark = slots.find(entry => entry.options.name === 'sidebar.brand.name').component()
  assert.equal(wordmark.props.children, 'e宝工坊')
  assert.equal(slots.find(entry => entry.options.name === 'conversation.hero.brand.mark').options.priority, -110)
  assert.match(styles.join('\n'), /data-slot="conversation\.hero\.brand\.mark"/)
  assert.match(styles.join('\n'), /\.eBaoHomeFrame\s*\{\s*display:\s*contents/)
})

test('official Desktop installs the presentation without legacy shell globals', () => {
  const result = register('', false)
  assert.deepEqual(result.slots.map(entry => entry.options.name), presentationSlots)
  assert.equal(result.styles.length, 1)
})
