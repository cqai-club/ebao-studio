import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchModelServices } from '../src/generation.ts'
import { API, type ScholarProject, type StreamEvent } from '../src/protocol.ts'
import { createRouteHandler } from '../src/routes.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(options: { stream?: (request: unknown) => AsyncGenerator<unknown> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eyanbao-routes-'))
  roots.push(root)
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    results: [{
      id: 'https://openalex.org/W7',
      doi: 'https://doi.org/10.1000/route',
      title: 'Route test source',
      language: 'en',
      publication_year: 2025,
      authorships: [{ author: { display_name: 'Test Author' } }],
      primary_location: { source: { display_name: 'Test Journal' } },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
  const handler = createRouteHandler({
    services: () => ({
      defaultModel: { currentSelection: () => ({ provider: 'demo', model: 'demo' }) },
      ...options.stream === undefined
        ? {}
        : { llm: { stream: options.stream } as unknown as ResearchModelServices['llm'] },
    }),
    projectRoot: root,
    fetcher,
  })
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { base: `http://127.0.0.1:${port}`, root, fetcher }
}

describe('e研宝 HTTP routes', () => {
  it('streams a literature search, persists the project, edits it, and exports DOCX', async () => {
    const { base } = await fixture()
    const response = await fetch(`${base}${API}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
      body: JSON.stringify({
        prompt: '生成式 AI 与知识工作',
        kind: 'search',
        degree: 'master',
        discipline: '管理学',
        language: 'zh',
        literatureScope: 'foreign',
        citationStyle: 'gb7714',
        sourceCount: 8,
      }),
    })
    expect(response.status).toBe(200)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as StreamEvent)
    const initial = events.find(event => event.type === 'project')
    expect(initial?.type).toBe('project')
    const result = events.find(event => event.type === 'result')
    if (result?.type !== 'result') throw new Error('missing result')
    expect(result.project.sources).toHaveLength(1)
    expect(result.project.status).toBe('complete')
    expect(result.project.literatureScope).toBe('foreign')

    const patched = await fetch(`${base}${API}/projects/${result.project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
      body: JSON.stringify({ title: '更新后的研究', layout: { template: 'thesis', degree: 'doctoral' } }),
    })
    expect(patched.status).toBe(200)
    const updated = (await patched.json() as { project: ScholarProject }).project
    expect(updated.title).toBe('更新后的研究')
    expect(updated.layout.degree).toBe('doctoral')

    const exported = await fetch(`${base}${API}/projects/${result.project.id}/export.docx`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('wordprocessingml')
    expect(Buffer.from(await exported.arrayBuffer()).subarray(0, 2).toString()).toBe('PK')

    const listed = await fetch(`${base}${API}/projects`)
    expect((await listed.json() as { projects: unknown[] }).projects).toHaveLength(1)
    const removed = await fetch(`${base}${API}/projects/${result.project.id}`, {
      method: 'DELETE',
      headers: { 'x-eyanbao': '1' },
    })
    expect(removed.status).toBe(200)
  })

  it('requires the local mutation header', async () => {
    const { base } = await fixture()
    const response = await fetch(`${base}${API}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('streams text and saves a generated manuscript', async () => {
    const { base } = await fixture({
      stream: async function* () {
        yield { type: 'text-delta', text: '# 生成式 AI 研究\n\n摘要：这是一份研究摘要。\n\n关键词：生成式 AI；学术写作\n\n## 引言\n\n正文。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    })
    const response = await fetch(`${base}${API}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
      body: JSON.stringify({
        prompt: '写一篇生成式 AI 研究论文',
        kind: 'journal',
        degree: 'master',
        language: 'zh',
        citationStyle: 'gb7714',
        sourceCount: 8,
      }),
    })
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as StreamEvent)
    expect(events.some(event => event.type === 'delta')).toBe(true)
    const result = events.find(event => event.type === 'result')
    if (result?.type !== 'result') throw new Error('missing result')
    expect(result.project).toMatchObject({
      title: '生成式 AI 研究',
      abstract: '这是一份研究摘要。',
      status: 'complete',
    })
    expect(result.project.keywords).toEqual(['生成式 AI', '学术写作'])
  })
})
