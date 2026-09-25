import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentSourceTools, AGENT_SOURCE_GUIDANCE } from '../src/agent-source-tools.ts'
import { listContents } from '../src/contents.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Agent Markdown source tools', () => {
  it('prepares an image-reference preview without creating a publication record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-agent-source-'))
    roots.push(root)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, 'dsh')
    const md = join(root, 'article.md')
    writeFileSync(md, '# 标题\n\n正文')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const attachmentId = `sha256:${createHash('sha256').update(png).digest('hex')}`
    const ref = { attachmentId, mediaType: 'image/png', bytes: png.length, width: 1, height: 1 }
    const tools = new Map<string, ToolDefinition>()
    let prompt = ''
    const ctx = {
      tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      attachments: { readImage: async () => ({ ref, data: png }) },
      systemPrompt: { section: (section: { text: string }) => { prompt = section.text; return () => { prompt = '' } } },
    } as unknown as Context
    const exec = { agent: { id: 'conversation-1', session: { header: { cwd: root } } },
      signal: new AbortController().signal } as unknown as ToolRunContext
    const dispose = registerAgentSourceTools(ctx)
    try {
      expect([...tools.keys()]).toEqual(['publisher_export_image', 'publisher_register_source', 'publisher_get_source', 'publisher_prepare_preview'])
      expect(prompt).toBe(AGENT_SOURCE_GUIDANCE)
      const exported = await tools.get('publisher_export_image')!.execute({ markdown_path: md, source_image: {
        attachment_id: attachmentId, media_type: 'image/png', bytes: png.length, width: 1, height: 1,
      } }, exec) as { relative_path: string }
      expect(exported.relative_path).toMatch(/^images\/[0-9a-f]{64}\.png$/u)
      writeFileSync(md, `# 标题\n\n正文 ![配图](${exported.relative_path})`)
      const source = await tools.get('publisher_register_source')!.execute({ markdown_path: md }, exec) as { id: string; revision: string }
      expect(source.revision).toMatch(/^[0-9a-f]{64}$/u)
      expect(await tools.get('publisher_get_source')!.execute({}, exec)).toMatchObject({
        id: source.id, markdown_path: realpathSync.native(md),
      })
      const candidate = await tools.get('publisher_prepare_preview')!.execute({
        source_revision: source.revision, content_type: 'article', platforms: ['wxmp'],
        platform_variants: [{ platform: 'wxmp', title: '公众号标题' }],
      }, exec) as { id: string; platformVariants: Record<string, { title: string }> }
      expect(candidate.platformVariants.wxmp?.title).toBe('公众号标题')
      expect(listContents({ DSH_HOME: process.env.DSH_HOME })).toEqual([])
    } finally {
      dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
    expect(tools.size).toBe(0)
    expect(prompt).toBe('')
  })

  it('keeps Host file reads inside the Agent workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-agent-boundary-'))
    roots.push(root)
    const outside = mkdtempSync(join(tmpdir(), 'ebao-outside-boundary-'))
    roots.push(outside)
    const md = join(outside, 'private.md')
    writeFileSync(md, '# 私有文件')
    const definitions = new Map<string, ToolDefinition>()
    const ctx = {
      tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
      systemPrompt: { section: () => () => undefined },
    } as unknown as Context
    const dispose = registerAgentSourceTools(ctx)
    try {
      const exec = { agent: { id: 'conversation-2', session: { header: { cwd: root } } },
        signal: new AbortController().signal } as unknown as ToolRunContext
      await expect(definitions.get('publisher_register_source')!.execute({ markdown_path: md }, exec))
        .rejects.toThrow('工作目录')
    } finally { dispose() }
  })
})
