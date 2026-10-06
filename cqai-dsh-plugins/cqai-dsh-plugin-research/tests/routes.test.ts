import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

it('serves the academic catalog over the loopback route and reports missing skills', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin({ ...plugin, inject: ['webServer'] })
    const base = `http://127.0.0.1:${ctx.webServer.port}/api/cqai-research`

    const catalog = await fetch(`${base}/catalog`)
    expect(catalog.status).toBe(200)
    const body = await catalog.json() as { ok: boolean; panel: string; catalog: { installedCount: number; available: boolean; skills: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.panel).toBe('cqai-research')
    expect(body.catalog.skills).toHaveLength(4)
    // No skill service is composed in this context, so nothing may claim to be installed.
    expect(body.catalog.available).toBe(false)
    expect(body.catalog.installedCount).toBe(0)

    const unknown = await fetch(`${base}/skill?name=not-a-real-skill`)
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).ok).toBe(false)

    const known = await fetch(`${base}/skill?name=academic-paper`)
    expect(known.status).toBe(404)
    expect((await known.json()).error).toContain('尚未安装')
  } finally {
    await ctx.fiber.dispose()
  }
}, 30000)
