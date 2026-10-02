// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaSettingsEditor } from 'cqai-dsh-media-settings/client'
import type { MediaSettingsPublic } from 'cqai-dsh-media-settings/contracts'
import {Settings} from '../src/client/Settings.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {const {createElement} = await import('react'); return {Button: ({variant: _variant, ...props}: Record<string, unknown>) => createElement('button', props), Input: (props: object) => createElement('input', props), Tag: ({tone: _tone, ...props}: Record<string, unknown>) => createElement('span', props)}})
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})
const redacted: MediaSettingsPublic = {revision: 1, credentialRevision: 3, coverrRevision: 5, defaults: {aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'}, overrides: {}, providers: {pexels: {configured: true, overrides: {}, conflict: false}, pixabay: {configured: false, overrides: {}, conflict: false}}, coverrConfigured: false}

it('renders only credential status, sends a replacement with credential revision and clears its draft', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? {...redacted, credentialRevision: 4} : redacted), {status: 200, headers: {'content-type': 'application/json'}}))
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(MediaSettingsEditor, {api: '/api/cqai-ejianbao'})))
  expect(container.textContent).toContain('已配置')
  expect(container.querySelector('input[type=password]')).toBeNull()
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.textContent === '更换连接')!.click())
  const field = container.querySelector<HTMLInputElement>('input[type=password]')!
  expect(field.value).toBe('')
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'replacement-key'); field.dispatchEvent(new Event('input', {bubbles: true}))})
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.textContent === '保存连接')!.click())
  const mutation = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(mutation[1]!.body))).toMatchObject({operation: 'credential', expectedRevision: 3, provider: 'pexels', value: 'replacement-key'})
  expect(mutation[1]!.headers).toMatchObject({'x-ejianbao': '1'})
  expect(container.textContent).toContain('设置已保存')
  expect(container.textContent).not.toContain('replacement-key')
  expect(container.querySelector('input[type=password]')).toBeNull()
})

it('patches only the changed default field and preserves the configuration revision', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? {...redacted, revision: 2, defaults: {...redacted.defaults, aspect: '16:9'}} : redacted), {headers: {'content-type': 'application/json'}}))
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(MediaSettingsEditor, {api: '/api/cqai-ejianbao', engine: 'shortVideo'})))
  const aspect = container.querySelector<HTMLSelectElement>('select')!
  await act(async () => {aspect.value = '16:9'; aspect.dispatchEvent(new Event('change', {bubbles: true}))})
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.textContent === '保存默认值')!.click())
  const mutation = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(mutation[1]!.body))).toEqual({operation: 'defaults', expectedRevision: 1, engine: 'shortVideo', set: {aspect: '16:9'}})
})

it('shows public tools once, keeps engine badges specific and collapses repair failure logs', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let failed = false
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') failed = true
    const value = url.endsWith('/media-settings') ? redacted : url.endsWith('/tools') ? {python: true, uv: true, node: true, ffmpeg: true, ffprobe: true, pythonVersion: '3.11.13', ffmpegVersion: '7.1', setup: {status: 'idle'}} : /\/health(?:\?|$)/.test(url) ? {python: true, ...(url.includes('short-video') ? {pythonPackages: false} : {}), numpy: false, uv: true, node: true, ffmpeg: true, ffprobe: true, remotion: false, browser: false} : url.endsWith('/setup') ? failed && url.includes('short-video') ? {status: 'failed', items: [{id: 'python', label: 'Python 包环境', status: 'failed', detail: '下载失败'}], logs: ['无法访问下载源']} : {status: 'idle', items: [], logs: []} : url.includes('short-video') ? {subtitle_provider: 'edge', video_codec: 'libx264'} : {fish: false}
    return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}})
  })
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(Settings)))
  expect(container.querySelectorAll('[data-ejianbao-tools]')).toHaveLength(1)
  const tools = container.querySelector('[data-ejianbao-tools]')!
  expect(tools.querySelector('[data-environment-badges]')!.textContent).toContain('Python 3.11 · 就绪')
  expect(tools.querySelector('[data-environment-badges]')!.children).toHaveLength(5)
  const engines = container.querySelectorAll('[data-ejianbao-engine]')
  expect(engines).toHaveLength(3)
  for (const engine of engines) {
    const badges = engine.querySelector('[data-environment-badges]')!.textContent!
    expect(badges).toContain('Python 包环境')
    expect(badges).not.toMatch(/Python 3\.11|内置 uv|宿主 Node\.js|FFmpeg|ffprobe/)
  }
  expect(container.querySelector('[data-ejianbao-engine=video]')!.textContent).toContain('Python 包环境 · 待准备')
  expect(container.textContent).toContain('NumPy · 待准备')
  expect(container.textContent).toContain('Remotion 渲染 · 待准备')
  expect(container.textContent).toContain('渲染浏览器 · 待准备')
  const card = container.querySelector<HTMLElement>('[data-ejianbao-engine="short-video"]')!
  expect(card.textContent).toContain('Python 包环境 · 待准备')
  await act(async () => [...card.querySelectorAll('button')].find(button => button.textContent === '安装 / 修复专属依赖')!.click())
  expect(card.textContent).toContain('准备失败')
  expect(card.textContent).toContain('无法访问下载源')
  expect(card.querySelector('details')!.open).toBe(false)
  expect([...card.querySelectorAll('button')].some(button => button.textContent === '重试安装 / 修复专属依赖')).toBe(true)
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST').map(([url]) => url)).toEqual(['/cqai-short-video/setup'])
})

it.each(['tools', 'video'])('refreshes public tools and all engine health after %s setup finishes', async id => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let setupStatus = 'idle'
  const setupRoute = id === 'tools' ? '/api/cqai-ejianbao/tools/setup' : '/api/cqai-video/setup'
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === setupRoute && init?.method === 'POST') setupStatus = 'running'
    const value = url.endsWith('/media-settings') ? redacted : url.endsWith('/tools') ? {python: true, uv: true, node: true, ffmpeg: true, ffprobe: true, setup: {status: id === 'tools' ? setupStatus : 'idle'}} : /\/health(?:\?|$)/.test(url) ? {pythonPackages: true, python: true, numpy: true} : url.endsWith('/setup') ? {status: url === setupRoute ? setupStatus : 'idle'} : url.includes('short-video') ? {subtitle_provider: 'edge', video_codec: 'libx264'} : {fish: false}
    return new Response(JSON.stringify(value), {status: init?.method === 'POST' ? 202 : 200, headers: {'content-type': 'application/json'}})
  })
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(Settings)))
  const card = container.querySelector<HTMLElement>(id === 'tools' ? '[data-ejianbao-tools]' : '[data-ejianbao-engine=video]')!
  const install = [...card.querySelectorAll('button')].find(button => button.textContent?.startsWith('安装 / 修复'))!
  await act(async () => install.click())
  expect(install.disabled).toBe(true)
  const beforeCompletion = fetcher.mock.calls.length
  setupStatus = 'completed'
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  const refreshed = fetcher.mock.calls.slice(beforeCompletion).map(([url]) => url)
  expect(refreshed).toEqual(expect.arrayContaining(['/api/cqai-ejianbao/tools', '/api/cqai-video/health?refresh=1', '/cqai-short-video/health?refresh=1', '/api/cqai-talkcraft/health?refresh=1']))
  expect(card.textContent).toContain('准备完成')
  expect(install.disabled).toBe(false)
  const mutation = fetcher.mock.calls.find(([url, options]) => url === setupRoute && options?.method === 'POST')!
  expect(mutation[1]!.headers).toMatchObject({'x-ejianbao': '1'})
  const afterCompletion = fetcher.mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(4000))
  expect(fetcher.mock.calls).toHaveLength(afterCompletion)
})

it('keeps GET failures visible with a working retry and does not install on retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let fail = true
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/tools') && fail) return new Response(JSON.stringify({error: '公共工具检测服务暂不可用'}), {status: 503, headers: {'content-type': 'application/json'}})
    const value = url.endsWith('/media-settings') ? redacted : url.endsWith('/tools') ? {python: true, uv: true, node: true, ffmpeg: true, ffprobe: true, setup: {status: 'idle'}} : /\/health(?:\?|$)/.test(url) ? {pythonPackages: true} : url.endsWith('/setup') ? {status: 'idle'} : url.includes('short-video') ? {subtitle_provider: 'edge', video_codec: 'libx264'} : {fish: false}
    return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}})
  })
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(Settings)))
  const card = container.querySelector<HTMLElement>('[data-ejianbao-tools]')!
  expect(card.querySelector('[role=alert]')!.textContent).toContain('公共工具检测服务暂不可用')
  expect(card.querySelector('[data-environment-badges]')!.textContent).toContain('环境状态未读取')
  fail = false
  await act(async () => [...card.querySelectorAll('button')].find(button => button.textContent === '重试检查')!.click())
  expect(card.querySelector('[role=alert]')).toBeNull()
  expect(card.querySelector('[data-environment-badges]')!.textContent).toContain('Python 3.11 · 就绪')
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})


it('synchronizes target defaults, clears credential drafts and blocks saves until the target reload completes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const initial: MediaSettingsPublic = {...redacted, defaults: {...redacted.defaults, aspect: '16:9'}, overrides: {talkcraft: {aspect: '9:16'}}}
  const latest: MediaSettingsPublic = {...initial, revision: 2, overrides: {talkcraft: {aspect: '9:16', edgeVoiceId: 'zh-CN-YunxiNeural'}}}
  const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}})
  let reads = 0
  let resolveRead: (response: Response) => void = () => {throw new Error('Target read not started')}
  let resolveSave: (response: Response) => void = () => {throw new Error('Save not started')}
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(resolve => {resolveSave = resolve})
    if (++reads === 1) return Promise.resolve(json(initial))
    return new Promise<Response>(resolve => {resolveRead = resolve})
  })
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(MediaSettingsEditor, {api: '/api/cqai-ejianbao'})))
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.textContent === '更换连接')!.click())
  const credential = container.querySelector<HTMLInputElement>('input[type=password]')!
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(credential, 'public-target-draft'); credential.dispatchEvent(new Event('input', {bubbles: true}))})
  const target = container.querySelector<HTMLSelectElement>('select[id$="-target"]')!
  const aspect = container.querySelector<HTMLSelectElement>('select[id$="-aspect"]')!
  const save = [...container.querySelectorAll('button')].find(button => button.textContent === '保存默认值')!
  await act(async () => {target.value = 'talkcraft'; target.dispatchEvent(new Event('change', {bubbles: true}))})
  expect(aspect.value).toBe('9:16')
  expect(aspect.disabled).toBe(true)
  expect(target.disabled).toBe(true)
  expect(save.disabled).toBe(true)
  expect(container.querySelector('input[type=password]')).toBeNull()
  expect(container.querySelector('[aria-busy=true]')).not.toBeNull()
  await act(async () => save.click())
  expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  await act(async () => resolveRead(json(latest)))
  expect(target.disabled).toBe(false)
  expect(aspect.disabled).toBe(false)
  expect(container.querySelector<HTMLInputElement>('input[id$="-voice"]')!.value).toBe('zh-CN-YunxiNeural')
  expect(save.disabled).toBe(true)
  await act(async () => {aspect.value = '16:9'; aspect.dispatchEvent(new Event('change', {bubbles: true}))})
  await act(async () => save.click())
  expect(target.disabled).toBe(true)
  const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(mutation[1]!.body))).toEqual({operation: 'defaults', expectedRevision: 2, engine: 'talkcraft', set: {aspect: '16:9'}})
  await act(async () => resolveSave(json({...latest, revision: 3, overrides: {talkcraft: {...latest.overrides.talkcraft, aspect: '16:9'}}})))
  expect(target.disabled).toBe(false)
  expect(container.textContent).toContain('设置已保存')
})

it('keeps stale target settings read-only after a failed reload and enables editing only after retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const state: MediaSettingsPublic = {...redacted, defaults: {...redacted.defaults, aspect: '16:9'}, overrides: {talkcraft: {aspect: '9:16'}}}
  let reads = 0
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (++reads === 2) throw new Error('目标设置读取失败')
    return new Response(JSON.stringify(state), {headers: {'content-type': 'application/json'}})
  })
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(MediaSettingsEditor, {api: '/api/cqai-ejianbao'})))
  const target = container.querySelector<HTMLSelectElement>('select[id$="-target"]')!
  await act(async () => {target.value = 'talkcraft'; target.dispatchEvent(new Event('change', {bubbles: true}))})
  const aspect = container.querySelector<HTMLSelectElement>('select[id$="-aspect"]')!
  const save = [...container.querySelectorAll('button')].find(button => button.textContent === '保存默认值')!
  expect(container.textContent).toContain('目标设置读取失败')
  expect(aspect.value).toBe('9:16')
  expect(aspect.disabled).toBe(true)
  expect(save.disabled).toBe(true)
  await act(async () => save.click())
  expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  await act(async () => [...container!.querySelectorAll('button')].find(button => button.textContent === '重新读取')!.click())
  expect(aspect.disabled).toBe(false)
  expect(save.disabled).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(3)
})
