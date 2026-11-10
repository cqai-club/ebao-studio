import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

// Exercise each installed, patched browser bundle against the actual conversation
// package for that Desktop channel. A permissive fake slot catalog would hide
// registrations that can never mount, which caused the original regression.
for (const desktop of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta']) {
  test(`${desktop}: PPT selection mounts in the current conversation and follows the active session`, async () => {
    const require = createRequire(new URL(`../${desktop}/package.json`, import.meta.url))
    const React = require('react')
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',
      { url: 'https://desktop.example/', pretendToBeVisual: true })
    const saved = new Map()
    for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    }
    const { createRoot } = require('react-dom/client')
    const client = readFileSync(process.env.EBAO_PPT_TEST_BUNDLE ?? require.resolve('dsh-ppt-composer/client'), 'utf8')
    const conversation = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
    const registrations = []
    const calls = []
    let plugin
    dom.window.__ModuleLoader__ = { load: entry => { plugin = entry.factory(name => {
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
      return require(name)
    }) } }
    try {
      runInNewContext(client, { window: dom.window, document: dom.window.document, console,
        setTimeout, clearTimeout, URL, AbortController })
      const ctx = {
        effect: callback => callback(),
        locale: { register: () => () => {} },
        get: name => {
          assert.equal(name, 'connection')
          return { rpc: { call: async (service, method, args) => {
            calls.push({ service, method, args })
            if (calls.filter(call => call.method === 'state').length > 4) {
              return { ok: false, error: { message: 'Template catalog requested repeatedly' } }
            }
            return { ok: true, value: { status: 'ok', data: { templates: [], selectedTemplateId: null, presentationMode: null } } }
          } } }
        },
        slots: {
          inject(name, callback) {
            assert.ok(conversation.includes(`"${name}"`), `installed Conversation must declare ${name}`)
            return callback()
          },
          register(options, component) { registrations.push({ options, component }); return () => {} },
        },
      }
      plugin.apply(ctx)
      const action = registrations.find(row => row.options.name === 'conversation.hero.options')
      const preview = registrations.find(row => row.options.id === 'dsh-ppt-selection')
      const chooser = registrations.find(row => row.options.id === 'dsh-ppt-chooser')
      assert.ok(action && preview && chooser)
      assert.equal(preview.options.name, 'conversation.input.dock')
      assert.equal(chooser.options.name, 'conversation.input.dock')
      assert.notEqual(preview.options.id, chooser.options.id)
      const root = createRoot(dom.window.document.getElementById('root'))
      const t = value => value
      const view = sessionId => React.createElement('div', { 'data-conversation-scroll': '' },
        React.createElement('div', { 'data-composer-seat': '' },
          React.createElement('div', { 'data-composer-card': '' }),
          React.createElement(action.component, { ...action.options.inject(sessionId), sessionId, t }),
          React.createElement(preview.component, { ...preview.options.inject(sessionId), sessionId, session: { blank: true }, t }),
          React.createElement(chooser.component, { ...chooser.options.inject(sessionId), sessionId, session: { blank: true }, t })))
      await React.act(async () => { root.render(view('one')) })
      const button = dom.window.document.querySelector('[data-desktop-ppt]')
      assert.ok(button, 'the blank-session PPT button is visible')
      assert.equal(dom.window.document.querySelector('[data-office-ppt-template-panel]'), null)
      await React.act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      assert.ok(dom.window.document.querySelector('[data-office-ppt-template-panel]'), 'click opens the template panel')
      assert.ok(calls.some(call => call.method === 'presentation/mode' && call.args.sessionId === 'one' && call.args.mode === 'ppt'))
      assert.ok(calls.filter(call => call.method === 'state').length <= 4,
        'an empty template catalog does not trigger an endless request loop')
      await React.act(async () => { root.render(view('two')) })
      assert.equal(dom.window.document.querySelector('[data-office-ppt-template-panel]'), null, 'another session starts without the first session mode')
      await React.act(async () => { root.unmount() })
      const { mode, client: syncClient } = action.options.inject('sync')
      const template = { id: 'template-one' }
      mode.select('sync', template, 'ppt')
      const remote = { templates: [template], selectedTemplateId: null, presentationMode: 'ppt' }
      const request = { client: syncClient, sessionId: 'sync' }
      mode.applyLoadedTemplates('sync', syncClient, mode.revision('sync'), remote, request)
      assert.equal(mode.snapshot('sync').selectedId, null, 'a remote deselection clears the local selection')
      const revision = mode.revision('sync')
      mode.applyLoadedTemplates('sync', syncClient, revision, remote, request)
      assert.equal(mode.revision('sync'), revision, 'unchanged remote state does not retrigger a load')
    } finally {
      dom.window.close()
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) delete globalThis[name]
        else Object.defineProperty(globalThis, name, descriptor)
      }
    }
  })
}
