import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import { composeAccountPatch } from '../../../scripts/prepare-cqai-account.mjs'

const upstream = fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))

test('the real official Include composer activates only CQAI while disabling the original account provider', () => {
  const require = createRequire(join(upstream, 'node_modules', '.pnpm', 'cqai-composition-test.cjs'))
  const { applyEntryPatches, entryListSchema } = require('@deepseek-ai/cordis-plugin-include')
  const yaml = require('js-yaml')
  const base = yaml.load(readFileSync(join(upstream, 'packages', 'bundle', 'base', 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  const warnings = []
  const warn = (...args) => warnings.push(args)
  const officialEntries = applyEntryPatches([], base, warn)
  const composed = applyEntryPatches(officialEntries, composeAccountPatch({
    issuer: 'https://auth.cqaiclub.asia/oidc', clientId: 'public-native-client', clubPortalUrl: 'https://cqaiclub.asia',
  }), warn)
  const flatten = entries => entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? flatten(entry.config) : [])])
  const entries = flatten(composed)
  assert.deepEqual(warnings, [])
  const original = entries.find(entry => entry.id === 'deepseek-account')
  assert.equal(original.name, '@deepseek-ai/dsh-deepseek-account')
  assert.equal(original.disabled, true)
  const accountProviders = entries.filter(entry => ['@deepseek-ai/dsh-deepseek-account', '@cqaiclub/desktop-account'].includes(entry.name) && entry.disabled !== true)
  assert.deepEqual(accountProviders.map(entry => ({ id: entry.id, name: entry.name })), [{ id: 'cqai-desktop-account', name: '@cqaiclub/desktop-account' }])
  assert.equal(accountProviders[0].config.issuer, 'https://auth.cqaiclub.asia/oidc')
  assert.equal(entries.find(entry => entry.id === 'cqaiclub-dsn-account').disabled === true, false)
  assert.equal(entries.find(entry => entry.id === 'llm-deepseek-account').disabled, true)
})
