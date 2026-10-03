import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const registrations = []
const injections = []
const dictionaries = new Map()
const styles = []
let captured

const jsx = (type, props) => ({ type, props: props ?? {} })
const react = {
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: initial => ({ current: initial }),
  useCallback: callback => callback,
  useMemo: callback => callback(),
  createElement: jsx,
  Fragment: Symbol('Fragment'),
}
const require = name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: react.Fragment }
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`Unexpected browser import: ${name}`)
}
const document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: element => styles.push(element) },
}
const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
vm.runInNewContext(source, {
  console,
  document,
  window: { __ModuleLoader__: { load: entry => { captured = entry } } },
}, { filename: 'lib/client.js' })
assert.equal(captured?.id, 'dsh-skill-mcp-panel')
const plugin = captured.factory(require)

const ctx = {
  effect: callback => callback(),
  get: () => undefined,
  locale: {
    register: (namespace, translations) => { dictionaries.set(namespace, translations); return () => {} },
    bind: namespace => key => dictionaries.get(namespace)?.zh?.[key] ?? key,
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 }),
  },
  remote: { $mount: async () => {}, $on: () => () => {} },
  slots: {
    inject: (name, callback) => { injections.push(name); callback() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}
plugin.apply(ctx)

assert.deepEqual(injections.sort(), ['cqai.pluginManagement.mcp', 'cqai.pluginManagement.skills'])
assert.equal(registrations.length, 2)
assert.equal(registrations.some(({ options }) => options.name === 'main' || options.name === 'sidebar.panellist'), false)
for (const name of ['skills', 'mcp']) {
  const registration = registrations.find(({ options }) => options.name === `cqai.pluginManagement.${name}`)
  assert.equal(registration?.options.id, name)
  assert.equal(typeof registration.options.inject, 'function')
  const page = registration.component({ ...registration.options.inject(), t: () => name })
  assert.equal(page.props.className, 'SKV_page')
  assert.equal(JSON.stringify(page).includes('SKV_pageBack'), false)
}
assert.equal(styles.some(style => style.textContent.includes('.SKV_page{')), true)
console.log('desktop skill/MCP slot checks passed')
