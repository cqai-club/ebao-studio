import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentSourceTools, isAgentWorkspacePath } from '../src/agent-source-tools.ts'
import { validPublicationCandidate } from '../src/publication-candidates.ts'
import { listContents } from '../src/contents.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Agent Markdown source tools', () => {
  it('accepts drive and UNC workspace paths on Windows, but rejects relative paths', () => {
    expect(isAgentWorkspacePath('C:\\Users\\writer\\project', 'win32')).toBe(true)
    expect(isAgentWorkspacePath('\\\\server\\share\\project', 'win32')).toBe(true)
    expect(isAgentWorkspacePath('\\project', 'win32')).toBe(false)
    expect(isAgentWorkspacePath('/project', 'win32')).toBe(false)
    expect(isAgentWorkspacePath('C:project', 'win32')).toBe(false)
    expect(isAgentWorkspacePath('project', 'win32')).toBe(false)
    expect(isAgentWorkspacePath('/Users/writer/project', 'darwin')).toBe(true)
  })

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
    const ctx = {
      tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      attachments: { readImage: async () => ({ ref, data: png }) },
    } as unknown as Context
    const exec = { agent: { id: 'conversation-1', session: { header: { cwd: root } } },
      signal: new AbortController().signal } as unknown as ToolRunContext
    const dispose = registerAgentSourceTools(ctx)
    try {
      expect([...tools.keys()]).toEqual(['publisher_export_image', 'publisher_register_source', 'publisher_get_source', 'publisher_prepare_preview'])
      for (const tool of tools.values()) expect(tool.description.length).toBeLessThan(240)
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
      const preview = tools.get('publisher_prepare_preview')!
      const args = {
        source_revision: source.revision, content_type: 'article', platforms: ['wxmp'],
        platform_variants: [{ platform: 'wxmp', title: '公众号标题' }],
      }
      const candidate = await preview.execute(args, exec) as { id: string; platformVariants: Record<string, { title: string }> }
      expect(candidate.platformVariants.wxmp?.title).toBe('公众号标题')
      expect(candidate).toMatchObject({ candidate_id: candidate.id, state: 'preview-ready', submitted: false,
        next_action: { tool: 'publisher_request_publication', arguments: { source: 'prepared-preview', candidate_id: candidate.id } } })
      const next = await preview.execute(args, exec) as { id: string; candidate_id: string }
      expect(next.id).not.toBe(candidate.id)
      expect(next.candidate_id).toBe(next.id)
      expect(() => validPublicationCandidate('conversation-1', candidate.id)).toThrow('已失效')
      expect(validPublicationCandidate('conversation-1', next.id).id).toBe(next.id)
      await expect(preview.execute({ ...args, platform_variants: [...args.platform_variants, ...args.platform_variants] }, exec))
        .rejects.toThrow('同一平台只能有一个候选版本')
      expect(validPublicationCandidate('conversation-1', next.id).id).toBe(next.id)
      writeFileSync(md, '# 更新标题\n\n更新正文')
      await tools.get('publisher_register_source')!.execute({ markdown_path: md }, exec)
      await expect(preview.execute(args, exec)).rejects.toThrow('原稿已变化')
      expect(listContents({ DSH_HOME: process.env.DSH_HOME })).toEqual([])
    } finally {
      dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
    expect(tools.size).toBe(0)
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
