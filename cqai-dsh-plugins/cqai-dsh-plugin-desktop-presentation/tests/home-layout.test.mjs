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

test('modern Desktop uses declared hero frame and brand slots without an obsolete mode parameter', () => {
  const { slots, styles } = register('', true)
  assert.deepEqual(slots.map(entry => entry.options.name), ['conversation.hero.brand.mark', 'conversation.hero.frame'])
  assert.equal(slots.find(entry => entry.options.name === 'conversation.hero.brand.mark').options.priority, -110)
  assert.match(styles.join('\n'), /data-slot="conversation\.hero\.brand\.mark"/)
  assert.match(styles.join('\n'), /\.eBaoHomeFrame\s*\{\s*display:\s*contents/)
})

test('compatibility and non-Desktop clients do not install the presentation', () => {
  for (const [search, desktop] of [['?dsh-desktop-mode=compatibility', true], ['', false]]) {
    const result = register(search, desktop)
    assert.equal(result.slots.length, 0)
    assert.equal(result.styles.length, 0)
  }
})
