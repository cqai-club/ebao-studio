import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { MARKET_WORKSPACES, latestMarket, marketResolution, prepareMarket } from './prepare-dsh-market.mjs'

const reply = version => async () => new Response(JSON.stringify({ name: 'dshmarket', version }))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-market-prepare-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => writeFileSync(join(root, path), `${JSON.stringify(data, null, 2)}\n`)
  write('package.json', { resolutions: { 'dshmarket@npm:1.0.0': 'patch:old', other: '2.0.0' } })
  writeFileSync(join(root, 'yarn.lock'), 'original lock\n')
  for (const name of MARKET_WORKSPACES) {
    mkdirSync(join(root, name, 'node_modules/dshmarket'), { recursive: true })
    write(`${name}/package.json`, { name, dependencies: { dshmarket: '1.0.0', other: '2.0.0' } })
    write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version: '1.0.0' })
  }
  const install = () => {
    for (const name of MARKET_WORKSPACES) {
      const version = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies.dshmarket
      write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version })
    }
    writeFileSync(join(root, 'yarn.lock'), 'updated lock\n')
  }
  return { root, write, install }
}

test('refreshes all editions and rechecks the tag on every invocation', async t => {
  const { root, install } = fixture(t)
  let version = '1.59.0', queries = 0, installs = 0
  const options = { fetcher: async (...args) => { queries++; return reply(version)(...args) }, runInstall: () => { installs++; install() } }
  await prepareMarket(root, options)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).resolutions, { other: '2.0.0', 'dshmarket@npm:1.59.0': marketResolution('1.59.0') })
  for (const name of MARKET_WORKSPACES) assert.deepEqual(JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies, { dshmarket: version, other: '2.0.0' })
  await prepareMarket(root, options)
  assert.equal(installs, 1)
  version = '1.60.0'
  await prepareMarket(root, options)
  assert.equal(queries, 3)
  assert.equal(installs, 2)
  assert.equal(await prepareMarket(root, { ...options, check: true }), '1.60.0')
})

test('check is read-only and rejects stale installed copies', async t => {
  const { root, install, write } = fixture(t)
  await assert.rejects(prepareMarket(root, { check: true, fetcher: reply('1.59.0'), runInstall: () => assert.fail('must not install') }), /market:prepare/)
  assert.equal(readFileSync(join(root, 'yarn.lock'), 'utf8'), 'original lock\n')
  await prepareMarket(root, { fetcher: reply('1.59.0'), runInstall: install })
  write('dsh-desktop-next/node_modules/dshmarket/package.json', { name: 'dshmarket', version: '1.0.0' })
  await assert.rejects(prepareMarket(root, { check: true, fetcher: reply('1.59.0') }), /dsh-desktop-next/)
})

test('restores manifests and the lockfile after an interrupted installation', async t => {
  const { root } = fixture(t)
  const paths = ['package.json', 'yarn.lock', ...MARKET_WORKSPACES.map(name => `${name}/package.json`)]
  const before = paths.map(path => readFileSync(join(root, path), 'utf8'))
  await assert.rejects(prepareMarket(root, { fetcher: reply('1.59.0'), runInstall: () => {
    writeFileSync(join(root, 'yarn.lock'), 'incomplete')
    throw new Error('interrupted')
  } }), /restored/)
  assert.deepEqual(paths.map(path => readFileSync(join(root, path), 'utf8')), before)
})

test('does not accept an offline or malformed latest response', async () => {
  await assert.rejects(latestMarket(async () => { throw new Error('offline') }), /offline/)
  await assert.rejects(latestMarket(async () => new Response('', { status: 503 })), /503/)
  await assert.rejects(latestMarket(reply('latest')), /invalid/)
  await assert.rejects(latestMarket(async () => new Response(JSON.stringify({ name: 'other', version: '1.0.0' }))), /invalid/)
})

test('detects the installation-owned market and isolates update cache by its version', async t => {
  const { root } = fixture(t)
  const desktopRequire = createRequire(new URL('../dsh-plugin-desktop-beta/package.json', import.meta.url))
  const marketDirectory = dirname(desktopRequire.resolve('dshmarket/package.json'))
  const updates = await import(pathToFileURL(join(marketDirectory, 'lib/updates.js')).href)
  const proxyNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'npm_config_proxy', 'npm_config_https_proxy']
  const proxyValues = new Map(proxyNames.map(name => [name, process.env[name]]))
  for (const name of proxyNames) delete process.env[name]
  t.after(() => {
    updates.setUpdateRegistry('https://registry.npmjs.org')
    for (const [name, value] of proxyValues) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  let requests = 0
  const registry = createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ name: 'dshmarket', version: '9.0.0', 'dist-tags': { latest: '9.0.0' } }))
  })
  await new Promise((resolve, reject) => registry.listen(0, '127.0.0.1', resolve).once('error', reject))
  t.after(() => new Promise(resolve => registry.close(resolve)))
  updates.setUpdateRegistry(`http://127.0.0.1:${registry.address().port}`)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
  const check = version => updates.checkUpdates('test', false, root, new Map([['dshmarket', 'stable']]),
    new Map(), new Map(), {}, new Map([['dshmarket', version]]))
  const first = (await check('1.0.0')).dshmarket
  assert.equal(first.current, '1.0.0')
  assert.equal(first.latest, '9.0.0')
  assert.equal(first.updateAvailable, true)
  assert.equal((await check('2.0.0')).dshmarket.current, '2.0.0')
  assert.equal(requests, 2, 'a different desktop-provided version must not reuse the previous cache entry')
  assert.deepEqual(await updates.checkUpdates('test', false, root), {}, 'no market is invented for an ordinary profile')
})

test('keeps existing composition failures but rolls back newly introduced errors', async () => {
  const desktopRequire = createRequire(new URL('../dsh-plugin-desktop-beta/package.json', import.meta.url))
  const source = readFileSync(join(dirname(desktopRequire.resolve('dshmarket/package.json')), 'lib/routes.js'), 'utf8')
  const start = source.indexOf('let trialError = null;')
  const end = source.indexOf('let compatibility;', start)
  assert.ok(start !== -1 && end > start, 'the installed market must retain its composition rollback branch')
  const block = source.slice(start, end)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const run = new AsyncFunction('trialBefore', 'trial', 'rollbackAttemptBuild', `
    let ok = true, rollbackOk, rollbackDetail;
    const name = 'fixture', activeProfileDir = '/fixture', hostAnchorOption = undefined, config = { profile: 'test' };
    const readBundleStack = () => ({ community: [] });
    const trialValidate = () => trial;
    const logEvent = () => {};
    ${block}
    return { ok, rollbackOk, rollbackDetail, trialError };
  `)
  const existing = { layer: 'old-plugin', message: 'pre-existing issue' }
  const introduced = { layer: 'updated-plugin', message: 'new invalid patch' }
  let rollbacks = 0
  const rollback = async () => { rollbacks++; return { ok: true } }
  const unchanged = await run({ errors: [existing] }, { errors: [existing] }, rollback)
  assert.equal(unchanged.ok, true)
  assert.equal(rollbacks, 0)
  const broken = await run({ errors: [existing] }, { errors: [existing, introduced] }, rollback)
  assert.equal(broken.ok, false)
  assert.equal(broken.rollbackOk, true)
  assert.match(broken.trialError, /updated-plugin: new invalid patch/)
  assert.equal(rollbacks, 1)
  const failedRollback = await run({ errors: [] }, { errors: [introduced] }, async () => ({ ok: false, detail: 'restore failed' }))
  assert.equal(failedRollback.rollbackOk, false)
  assert.match(failedRollback.trialError, /restore failed/)
})

test('all root launch, build and packaging entry points prepare the market first', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const entrypoints = Object.entries(scripts).filter(([name]) => /^(build$|dev(?::|$)|start(?::|$)|package:dir|dist:)/.test(name))
  assert.ok(entrypoints.length >= 18)
  const preparesMarket = (name, seen = new Set()) => {
    if (seen.has(name)) return false
    const command = scripts[name]
    if (command.startsWith('yarn market:prepare && ')) return true
    // A few product debug commands only delegate to another root entry point.
    const delegated = /(?:^|\s)yarn (dev:beta(?::publisher-(?:debug|tabs))?)$/u.exec(command)?.[1]
    return delegated !== undefined && preparesMarket(delegated, new Set([...seen, name]))
  }
  for (const [name] of entrypoints) assert.ok(preparesMarket(name), name)
})
