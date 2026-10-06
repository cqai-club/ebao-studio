/**
 * e研宝 — Host half.
 *
 * Bridges the installed `academic-research-skills` skills into the desktop
 * product: it reads them back from the Harness skill registry and serves a
 * read-only catalog the panel renders. No skill content is vendored here, so
 * the upstream project keeps owning its own text and updates.
 *
 * @module cqai-dsh-plugin-research
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  RESEARCH_PANEL,
  RESEARCH_SKILLS,
  ROUTE_PREFIX,
  UPSTREAM,
  type CatalogPayload,
  type CatalogSkill,
} from './catalog.ts'

export const name = 'cqai-research'
export const inject = ['webServer']

/** Longest skill body the preview route returns, so one request stays bounded. */
const MAX_PREVIEW_CHARS = 200_000

/**
 * Structural view of the Harness skill registry this plugin reads.
 *
 * Declared locally on purpose: the registry is an optional Host service
 * (`ctx.get('skills')`), so a profile that composes this panel without a skill
 * provider still mounts it and reports the skills as missing.
 */
interface SkillSummaryView {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly path?: string
}

interface SkillDefinitionView extends SkillSummaryView {
  readonly content: string
}

interface SkillRegistryView {
  list(): Promise<readonly SkillSummaryView[]>
  get(name: string): Promise<SkillDefinitionView | undefined>
}

function skillRegistry(ctx: Context): SkillRegistryView | undefined {
  return ctx.get('skills') as SkillRegistryView | undefined
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress
  if (typeof address !== 'string') return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: '仅允许本机应用访问' })
    return false
  }
  return true
}

/** Read the live skill catalog without letting a failure break the panel. */
async function readCatalog(ctx: Context): Promise<CatalogPayload> {
  const catalog = new Map<string, { source: string; path?: string }>()
  const registry = skillRegistry(ctx)
  let available = false
  try {
    for (const summary of await registry?.list() ?? []) {
      catalog.set(summary.name, {
        source: summary.source,
        ...(summary.path === undefined ? {} : { path: summary.path }),
      })
    }
    available = registry !== undefined
  } catch {
    available = false
  }

  const skills: CatalogSkill[] = RESEARCH_SKILLS.map((skill) => {
    const entry = catalog.get(skill.name)
    return {
      ...skill,
      installed: entry !== undefined,
      source: entry?.source ?? null,
      path: entry?.path ?? null,
    }
  })

  return {
    upstream: UPSTREAM,
    available,
    installedCount: skills.filter((skill) => skill.installed).length,
    skills,
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers: Array<() => void> = []

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/catalog`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          writeJson(res, 200, { ok: true, panel: RESEARCH_PANEL, catalog: await readCatalog(ctx) })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/skill`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
          const known = RESEARCH_SKILLS.some((skill) => skill.name === requested)
          if (!known) {
            writeJson(res, 404, { ok: false, error: '未知的学术技能' })
            return
          }
          const skill = await skillRegistry(ctx)?.get(requested)
          if (skill === undefined) {
            writeJson(res, 404, { ok: false, error: '该技能尚未安装' })
            return
          }
          const truncated = skill.content.length > MAX_PREVIEW_CHARS
          writeJson(res, 200, {
            ok: true,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            content: truncated ? skill.content.slice(0, MAX_PREVIEW_CHARS) : skill.content,
            truncated,
          })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))

    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'cqai-research: catalog routes')
}
