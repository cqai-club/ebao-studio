import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useEffect, useState } from 'react'
import {
  RESEARCH_PANEL,
  RESEARCH_SKILLS,
  ROUTE_PREFIX,
  UPSTREAM,
  type CatalogPayload,
  type CatalogSkill,
} from '../catalog.ts'

export const inject = ['slots']

const PANEL = RESEARCH_PANEL as MainPanelId

const styles = `
.cqaiResearch{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font-family:inherit}
.cqaiResearch-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.cqaiResearch-header h1{font-size:20px;line-height:1.4;margin:0 0 6px}
.cqaiResearch-header p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7;max-width:62ch}
.cqaiResearch-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.cqaiResearch-badge[data-state=ready]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.cqaiResearch-badge[data-state=missing]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.cqaiResearch-body{flex:1;min-height:0;overflow:auto;padding:20px 24px 32px;display:grid;gap:16px;align-content:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.cqaiResearch-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:18px;min-width:0;display:grid;gap:10px;align-content:start}
.cqaiResearch-card h2{margin:0;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cqaiResearch-card p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7}
.cqaiResearch-code{font:12px/1.6 ui-monospace,monospace;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cqaiResearch-chips{display:flex;flex-wrap:wrap;gap:6px}
.cqaiResearch-chip{padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}
.cqaiResearch-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cqaiResearch button{font:inherit;cursor:pointer;min-height:34px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.cqaiResearch button:hover:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.cqaiResearch button:disabled{opacity:.5;cursor:not-allowed}
.cqaiResearch button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.cqaiResearch-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.cqaiResearch-error{margin:0 24px;padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:13px}
.cqaiResearch-note{margin:0 24px 28px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}
`

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, { cache: 'no-store', credentials: 'same-origin' })
  const payload = await response.json().catch(() => undefined) as { ok?: boolean; error?: string } & T | undefined
  if (payload === undefined) throw new Error(`HTTP ${response.status}`)
  if (payload.ok !== true) throw new Error(payload.error ?? '请求失败')
  return payload
}

function promptFor(skill: CatalogSkill): string {
  return `请使用 ${skill.name} 技能，帮我完成一份${skill.title}任务：`
}

function ResearchPanel() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let alive = true
    const load = () => {
      getJson<{ catalog: CatalogPayload }>('/catalog')
        .then((payload) => { if (alive) { setCatalog(payload.catalog); setError('') } })
        .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const copy = async (skill: CatalogSkill) => {
    const text = promptFor(skill)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(skill.name)
      setTimeout(() => { setCopied((current) => (current === skill.name ? '' : current)) }, 2000)
    } catch {
      setCopied('')
      setError('无法写入剪贴板，请手动复制下方指令')
    }
  }

  const skills = catalog?.skills ?? RESEARCH_SKILLS.map((skill) => ({ ...skill, installed: false, source: null, path: null }))
  const installedCount = catalog?.installedCount ?? 0

  return (
    <section className="cqaiResearch" data-cqai-research-panel="">
      <style>{styles}</style>
      <header className="cqaiResearch-header">
        <div>
          <h1>e研宝</h1>
          <p>学术研究数字员工。选定技能后，把你想做的题目补在指令后面发给 e宝，研究、写作、评审到返修都能接着走。</p>
        </div>
        <span className="cqaiResearch-badge" data-state={installedCount === skills.length ? 'ready' : 'missing'}>
          {installedCount === skills.length ? '技能已就绪' : `已就绪 ${installedCount}/${skills.length}`}
        </span>
      </header>
      {error !== '' && <p className="cqaiResearch-error" role="alert">{error}</p>}
      <div className="cqaiResearch-body">
        {skills.map((skill) => (
          <article className="cqaiResearch-card" key={skill.name}>
            <h2>
              {skill.title}
              <span className="cqaiResearch-chip">{skill.installed ? '已安装' : '未安装'}</span>
            </h2>
            <p>{skill.summary}</p>
            <div className="cqaiResearch-chips">
              {skill.modes.map((mode) => <span className="cqaiResearch-chip" key={mode}>{mode}</span>)}
            </div>
            <div className="cqaiResearch-code">{skill.path ?? `技能 ${skill.name}`}</div>
            <div className="cqaiResearch-actions">
              <button type="button" onClick={() => { void copy(skill) }}>
                {copied === skill.name ? '已复制指令' : '复制调用指令'}
              </button>
              <span className="cqaiResearch-hint">{skill.triggers.slice(0, 3).join(' · ')}</span>
            </div>
          </article>
        ))}
      </div>
      <p className="cqaiResearch-note">
        技能来自 {UPSTREAM.author} 的开源项目 {UPSTREAM.name}（{UPSTREAM.license}），
        由 e宝工坊按原样调用，内容与版权归原作者所有。
      </p>
    </section>
  )
}

function ResearchIcon({ size }: { size?: number }) {
  const edge = typeof size === 'number' ? size : 18
  return (
    <svg width={edge} height={edge} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4 2.5 8.2 12 12.4l9.5-4.2L12 4Z" />
      <path d="M7 10.5V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5.5" />
      <path d="M21.5 8.2v5.3" />
    </svg>
  )
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, ResearchPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: RESEARCH_PANEL, order: 44, label: 'e研宝' },
    ({ size }: PropsRuntime<'sidebar.panellist'>) => <ResearchIcon size={size} />,
  ))
}
