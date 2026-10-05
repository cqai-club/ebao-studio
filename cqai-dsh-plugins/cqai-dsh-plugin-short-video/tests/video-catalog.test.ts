import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../src/index.ts'
import { API, defaultParams, defaultVideoModel, videoModelIssue, type Catalog } from '../src/protocol.ts'

const catalog: Catalog = { signedIn: true, text: [], image: [], video: [
  { id: 'wan3.0-video', name: 'Wan', callable: false },
  { id: 'supported-video', name: 'Supported', callable: true },
] }

describe('video catalog submission boundary', () => {
  it('defaults only to callable models and blocks unavailable restored selections', () => {
    expect(defaultVideoModel(catalog)).toBe('supported-video')
    expect(defaultVideoModel({ ...catalog, video: catalog.video!.slice(0, 1) })).toBe('')
    expect(defaultVideoModel({ ...catalog, signedIn: false })).toBe('')
    expect(defaultVideoModel(catalog, 'wan3.0-video')).toBe('wan3.0-video')
    expect(videoModelIssue(catalog, 'wan3.0-video')).toContain('未声明可用的视频生成服务')
    expect(videoModelIssue(catalog, 'supported-video')).toBeUndefined()
    expect(videoModelIssue(catalog, 'removed-model')).toContain('不在当前')
    expect(videoModelIssue(catalog, '')).toContain('请选择')
    expect(videoModelIssue(undefined, 'supported-video')).toContain('登录')
    expect(videoModelIssue({ ...catalog, signedIn: false }, 'supported-video')).toContain('登录')
  })
  it('keeps catalog-only Wan visible but rejects it before creating a material job', async () => {
    const home = await mkdtemp(join(tmpdir(), 'short-video-catalog-'))
    const jobsRoot = join(home, 'short-video', 'jobs')
    await mkdir(jobsRoot, { recursive: true })
    vi.stubEnv('DSH_HOME', home)
    let handler: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>
    let cleanup: (() => Promise<void>) | undefined
    const fetchAi = vi.fn()
    const ctx = {
      credentials: {},
      dsnAccount: {
        getStatus: async () => ({ state: 'signed-in' }),
        listModels: async () => ({ models: [
          { id: 'wan3.0-video', categories: ['video'], supportedEndpointTypes: [] },
          { id: 'supported-video', categories: ['video'], supportedEndpointTypes: ['openai-video'] },
        ] }),
        getCategoryDefaultModels: async () => ({ global: {}, categories: {} }),
        fetchAi,
      },
      webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } },
      effect: (setup: () => typeof cleanup) => { cleanup = setup() },
    } as unknown as Context
    const request = async (action: string, body?: unknown) => {
      let status = 0, result = ''
      const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), {
        method: body ? 'POST' : 'GET', url: `${API}/${action}`,
        socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3000', 'x-short-video': '1' },
      }) as unknown as IncomingMessage
      const res = { writeHead: (value: number) => { status = value }, end: (value: string) => { result = value } } as unknown as ServerResponse
      await handler(req, res)
      return { status, data: JSON.parse(result) }
    }
    try {
      apply(ctx)
      const catalog = await request('catalog')
      expect(catalog.data.video).toEqual([
        { id: 'wan3.0-video', name: 'wan3.0-video', callable: false },
        { id: 'supported-video', name: 'supported-video', callable: true },
      ])
      const draft = { textModel: '', imageModel: '', videoModel: 'wan3.0-video', stopAt: 'materials',
        params: { ...defaultParams, video_script: '城市故事', video_terms: '城市', video_source: 'cqai_video' } }
      const rejected = await request('jobs', draft)
      expect(rejected.status).toBe(400)
      expect(rejected.data.error).toContain('未声明可用的视频生成服务')
      expect(await readdir(jobsRoot)).toEqual([])
      expect(fetchAi).not.toHaveBeenCalled()
      const accepted = await request('jobs', { ...draft, videoModel: 'supported-video' })
      expect(accepted.status).toBe(201)
      expect(accepted.data.status).toBe('draft')
    } finally {
      await cleanup?.()
      vi.unstubAllEnvs()
      await rm(home, { recursive: true, force: true })
    }
  })
})
