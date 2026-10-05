import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGenApi, ImageGenApiError } from '../src/client/api.ts'
import { CANVAS_SKILL_API, type CanvasSkillInstallResult } from '../src/protocol.ts'

afterEach(() => vi.unstubAllGlobals())

const library = { root: '/tmp/test-skills', entries: [], catalog: [], networkAvailable: true }
const source = 'https://github.com/ningzimu/image-to-editable-ppt-skill'
function response(body: unknown, status = 200) {
  return vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('skill install API business results', () => {
  it('preserves a failed source and the refreshed library instead of throwing HTTP 200', async () => {
    const body: CanvasSkillInstallResult = { ok: false, installed: [], failed: [{ source, message: '该来源里没有找到 SKILL.md' }], library }
    const fetch = response(body)
    vi.stubGlobal('fetch', fetch)
    const result = await new ImageGenApi().canvasSkillInstall({ sources: [source] })
    expect(result).toEqual(body)
    expect(result.failed[0].message).toBe('该来源里没有找到 SKILL.md')
    expect(fetch.mock.calls[0]?.[0]).toBe(CANVAS_SKILL_API.install)
  })

  it('returns partial installation results with every failed source intact', async () => {
    const body: CanvasSkillInstallResult = { ok: true, installed: ['one-skill'], failed: [{ source: 'other', message: '下载失败' }], library }
    vi.stubGlobal('fetch', response(body))
    expect(await new ImageGenApi().canvasSkillInstall({ sources: [source, 'other'] })).toEqual(body)
  })

  it('keeps top-level host errors when no installation result can be returned', async () => {
    vi.stubGlobal('fetch', response({ ok: false, code: 'library-unavailable', message: '本宿主不支持安装技能。' }))
    await expect(new ImageGenApi().canvasSkillInstall({ sources: [source] })).rejects.toMatchObject({ message: '本宿主不支持安装技能。', code: 'library-unavailable' })
  })

  it('rejects an HTTP failure even if its body resembles a successful install', async () => {
    vi.stubGlobal('fetch', response({ ok: true, installed: ['unexpected'], failed: [], library }, 403))
    await expect(new ImageGenApi().canvasSkillInstall({ sources: [source] })).rejects.toThrow('HTTP 403')
  })

  it('does not report malformed or incomplete responses as successful installs', async () => {
    vi.stubGlobal('fetch', response({ ok: true, installed: ['unexpected'] }))
    await expect(new ImageGenApi().canvasSkillInstall({ sources: [source] })).rejects.toMatchObject({ code: 'install-response-invalid' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy page</html>', { status: 200 })))
    await expect(new ImageGenApi().canvasSkillInstall({ sources: [source] })).rejects.toBeInstanceOf(ImageGenApiError)
  })
})
