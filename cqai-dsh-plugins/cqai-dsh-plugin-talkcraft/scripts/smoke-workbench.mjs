import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JobStore } from '../src/store.ts'
import { Workbench } from '../src/workbench.ts'

async function browserSmoke(workbenchUrl) {
  // Resolve the repository's existing Playwright installation; the plugin adds no browser dependency.
  const { chromium } = createRequire(new URL('../../../dsh-desktop-next/package.json', import.meta.url))('playwright')
  const frameOrigin = new URL(workbenchUrl).origin
  const parent = createServer((req, res) => {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'})
    if (req.url === '/sender') {res.end('<!doctype html><title>Sibling sender</title>'); return}
    res.end(`<!doctype html><title>TalkCraft iframe smoke</title><iframe id="workbench" title="TalkCraft Workbench"></iframe><iframe id="sender" src="/sender" title="Sibling sender"></iframe><script>
      window.workbenchReady = false;
      window.addEventListener('message', event => {
        if (event.origin === ${JSON.stringify(frameOrigin)} && event.source === document.getElementById('workbench').contentWindow && event.data?.type === 'talkcraft:ready') window.workbenchReady = true;
      });
      document.getElementById('workbench').src = ${JSON.stringify(workbenchUrl)};
    </script>`)
  })
  let browser
  try {
    await new Promise((accept, reject) => {parent.once('error', reject); parent.listen(0, '127.0.0.1', accept)})
    const parentUrl = `http://127.0.0.1:${parent.address().port}/`
    if (new URL(parentUrl).origin === frameOrigin) throw new Error('iframe smoke must use different origins')
    browser = await chromium.launch({channel: 'msedge', headless: true})
    const page = await browser.newPage()
    const resources = new Map()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
    page.on('response', response => {resources.set(response.url(), response.status())})
    await page.goto(parentUrl)
    await page.waitForFunction(() => window.workbenchReady === true)
    const frame = await page.locator('#workbench').elementHandle().then(handle => handle?.contentFrame())
    if (!frame) throw new Error('workbench iframe not attached')
    try {await frame.waitForFunction(() => document.getElementById('root')?.childElementCount > 0)}
    catch (error) {
      const body = await frame.locator('body').innerText()
      throw new Error(`workbench app did not render: ${JSON.stringify({errors: errors.slice(-8), body: body.slice(0, 600), failedResources: [...resources].filter(([, status]) => status >= 400)})}`, {cause: error})
    }
    if (await frame.locator('vite-error-overlay').count()) throw new Error('workbench module load failed')
    for (const path of ['/@desktop/visibility.js', '/src/playerRef.ts', '/src/main.tsx', '/src/exportJob.ts']) {
      if (![...resources].some(([url, status]) => new URL(url).pathname === path && status === 200)) throw new Error(`workbench module did not load: ${path}`)
    }
    const transformedExport = await frame.evaluate(async () => await (await fetch('/src/exportJob.ts')).text())
    if (!transformedExport.includes('desktopPollExport') || !transformedExport.includes('__talkcraftDesktopActive')) throw new Error('export progress visibility transform not applied')
    const visibility = async active => {
      await page.evaluate(({origin, active}) => document.getElementById('workbench').contentWindow.postMessage({type: 'talkcraft:visibility', active}, origin), {origin: frameOrigin, active})
      await frame.waitForFunction(active => window.__talkcraftDesktopActive === active, active)
    }
    await visibility(false)
    const sibling = await page.locator('#sender').elementHandle().then(handle => handle?.contentFrame())
    if (!sibling) throw new Error('sibling sender iframe not attached')
    // A real message with the parent's origin but another source must be rejected.
    await sibling.evaluate(origin => window.parent.document.getElementById('workbench').contentWindow.postMessage({type: 'talkcraft:visibility', active: true}, origin), frameOrigin)
    await frame.evaluate(() => new Promise(accept => setTimeout(accept, 100)))
    if (await frame.evaluate(() => window.__talkcraftDesktopActive) !== false) throw new Error('visibility bridge accepted an unrelated source')
    // Hold source constant to independently exercise the origin check in the running module.
    await frame.evaluate(() => window.dispatchEvent(new MessageEvent('message', {source: window.parent, origin: 'https://unrelated.invalid', data: {type: 'talkcraft:visibility', active: true}})))
    if (await frame.evaluate(() => window.__talkcraftDesktopActive) !== false) throw new Error('visibility bridge accepted an unrelated origin')
    await visibility(true)
    console.log('TalkCraft Edge iframe loaded bridge and app modules, applied export transform, handled hide/show, and rejected unrelated source/origin')
  } finally {
    await browser?.close()
    if (parent.listening) {
      parent.closeAllConnections()
      await new Promise((accept, reject) => parent.close(error => error ? reject(error) : accept()))
    }
  }
}

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'talkcraft-workbench-smoke-'))
const store = new JobStore(root)
const editor = new Workbench(store, join(packageRoot, 'upstream'))
try {
  const jobs = ['第一条视频。', '第二条视频。'].map(text => {
    const job = store.create({text})
    job.completedStages = ['sample']; job.approvedSample = true; store.persist(job)
    mkdirSync(store.file(job.id, 'remotion/src'), {recursive: true})
    writeFileSync(store.file(job.id, 'remotion/src/shots.ts'), 'export const SHOTS = [];\n')
    return job
  })
  const first = await editor.open(jobs[0].id)
  const page = await fetch(first)
  if (page.status !== 200 || !(await page.text()).includes('TalkCraft Workbench')) throw new Error('first workbench did not load')
  const pipeline = await fetch(new URL('/api/pipeline', first))
  if (pipeline.status !== 200 || !(await pipeline.json()).linked) throw new Error('project mapping failed')
  const saved = await fetch(new URL('/api/pipeline/overrides', first), {method: 'POST', headers: {'content-type': 'application/json', 'x-workbench-project': encodeURIComponent(store.directory(jobs[0].id))}, body: JSON.stringify({s01: {scale: 1.1}})})
  if (saved.status !== 200 || JSON.parse(readFileSync(store.file(jobs[0].id, 'remotion/overrides.json'), 'utf8')).s01.scale !== 1.1) throw new Error('shot parameter write-back failed')
  if (process.argv.includes('--browser')) await browserSmoke(first)
  const second = await editor.open(jobs[1].id)
  if (first === second || (await fetch(second)).status !== 200) throw new Error('task switch failed')
  let oldClosed = false
  try {await fetch(first, {signal: AbortSignal.timeout(1500)})} catch {oldClosed = true}
  if (!oldClosed) throw new Error('old workbench remains reachable')
  console.log('TalkCraft workbench loaded, wrote shot parameters, mapped two jobs, and closed the old service')
} finally {
  await editor.close()
  const target = resolve(root), base = resolve(tmpdir())
  if (!target.startsWith(base + sep)) throw new Error('unsafe smoke cleanup')
  rmSync(target, {recursive: true, force: true})
}
