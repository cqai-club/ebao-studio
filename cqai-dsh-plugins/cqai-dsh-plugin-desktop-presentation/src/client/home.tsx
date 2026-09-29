import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { coverForCard } from './covers'

const MARKET_OPEN_EVENT = 'cqai-desktop-presentation:open-market'
const STORAGE_PREFIX = 'cqai-desktop-presentation:home:v1:'
const UTILITY_PANELS = new Set(['plugins', 'schedules'])

interface HomeCard {
  id: string
  title: string
  description: string
  panelId?: string
  planned?: boolean
}

type CardIconComponent = ComponentType<{ size: number; active: boolean }>

interface HomePreference {
  order: string[]
  hidden: string[]
}

const DEFAULT_CARDS: readonly HomeCard[] = [
  { id: 'cqai-imagegen', title: 'e图宝', description: '图片生成、编辑与无限画布', panelId: 'cqai-imagegen' },
  { id: 'cqai-video', title: 'e剪宝', description: '视频制作与剪辑', panelId: 'cqai-video' },
  { id: 'cqai-short-video', title: '短视频制作', description: '从文案到成片', panelId: 'cqai-short-video' },
  { id: 'cqai-talkcraft', title: '口播视频制作', description: '口播与多轨编辑', panelId: 'cqai-talkcraft' },
  { id: 'cqai-publisher', title: '多平台发布', description: '内容编辑与发布', panelId: 'cqai-publisher' },
  { id: 'planned:writing', title: 'e文宝', description: '内容写作与整理', planned: true },
  { id: 'planned:customer', title: 'e客宝', description: '客户沟通与服务', planned: true },
  { id: 'planned:sales', title: 'e销宝', description: '营销内容与线索', planned: true },
  { id: 'planned:whiteboard', title: '创作白板', description: '共创想法与画面', planned: true },
  { id: 'planned:relationship', title: 'e恋爱宝', description: '对话与关系灵感', planned: true },
]

function FallbackCardIcon({ id }: { id: string }) {
  let drawing: ReactNode
  switch (id) {
    case 'planned:writing':
      drawing = <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>
      break
    case 'planned:customer':
      drawing = <><path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-1-2V7a2 2 0 0 1 2-2Z" /><path d="M7 10h10M7 13h6" /></>
      break
    case 'planned:sales':
      drawing = <><path d="M3 20h18M6 17v-4m6 4v-6m6 6V8M5 10l5-3 3 2 6-5" /><path d="M16 4h3v3" /></>
      break
    case 'planned:whiteboard':
      drawing = <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8m-4-4v4M7 12l3-3 2 2 4-4" /></>
      break
    case 'planned:relationship':
      drawing = <path d="M20.5 8.5c0 4.3-8.5 10-8.5 10s-8.5-5.7-8.5-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.5 2.3Z" />
      break
    default:
      drawing = <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>
}

const EMPTY_PREFERENCE: HomePreference = { order: [], hidden: [] }

function readPreference(key: string): HomePreference {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_PREFERENCE
    const value = parsed as Record<string, unknown>
    const strings = (input: unknown): string[] => Array.isArray(input)
      ? [...new Set(input.filter((item): item is string => typeof item === 'string' && item.length <= 128))].slice(0, 200)
      : []
    return { order: strings(value.order), hidden: strings(value.hidden) }
  } catch {
    return EMPTY_PREFERENCE
  }
}

function labelOf(entry: { options: object }): string | undefined {
  const label = (entry.options as { label?: unknown }).label
  if (typeof label === 'string') return label
  if (typeof label === 'function') {
    try {
      const resolved: unknown = label()
      return typeof resolved === 'string' ? resolved : undefined
    } catch { return undefined }
  }
  return undefined
}

/** The current slot roster is the source of truth for usable employee panels. */
function installedCards(ctx: Context): { cards: HomeCard[]; panels: Set<string>; icons: Map<string, CardIconComponent>; market: boolean } {
  const panels = new Set(ctx.slots.entriesOfSlot('main').map(entry => String(entry.options.key)))
  const known = new Set(DEFAULT_CARDS.map(card => card.panelId ?? card.id))
  const sidebar = ctx.slots.entriesOfSlot('sidebar.panellist')
  const icons = new Map<string, CardIconComponent>()
  const cards = [...DEFAULT_CARDS]
  for (const entry of sidebar) {
    const id = String(entry.options.id)
    if (typeof entry.component === 'function') icons.set(id, entry.component as CardIconComponent)
    const title = labelOf(entry)
    if (!panels.has(id) || known.has(id) || UTILITY_PANELS.has(id) || title === undefined || title.trim() === '') continue
    const placeholder = cards.findIndex(card => card.planned && card.title === title.trim())
    if (placeholder !== -1) {
      cards[placeholder] = { ...cards[placeholder]!, panelId: id, planned: false }
      known.add(id)
      continue
    }
    cards.push({ id, title, description: '已安装的数字员工', panelId: id })
  }
  const market = ctx.slots.entriesOfSlot('shell.overlay').some(entry => entry.options.id === 'community-market')
  return { cards, panels, icons, market }
}

function orderedCards(cards: HomeCard[], order: readonly string[]): HomeCard[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return cards.map((card, index) => ({ card, index })).sort((a, b) => {
    const left = positions.get(a.card.id) ?? (order.length + a.index)
    const right = positions.get(b.card.id) ?? (order.length + b.index)
    return left - right
  }).map(item => item.card)
}

/** Home entries remain in the resident blank conversation, preserving its composer. */
export function HomeDock({ ctx }: { ctx: Context }) {
  const [revision, setRevision] = useState(0)
  const [profile, setProfile] = useState<string | null>(null)
  const [preference, setPreference] = useState<HomePreference>(EMPTY_PREFERENCE)
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    const refresh = () => { setRevision(value => value + 1) }
    const offMain = ctx.slots.subscribe('main', refresh)
    const offSidebar = ctx.slots.subscribe('sidebar.panellist', refresh)
    const offMarket = ctx.slots.subscribe('shell.overlay', refresh)
    return () => { offMain(); offSidebar(); offMarket() }
  }, [ctx])

  useEffect(() => {
    let alive = true
    void fetch('/api/desktop/settings', {
      method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' },
    }).then(async response => {
      if (!response.ok) throw new Error('Desktop settings unavailable')
      const data: unknown = await response.json()
      const current = (data as { current?: unknown } | null)?.current
      if (typeof current !== 'string' || current.length === 0) throw new Error('Missing profile')
      if (alive) {
        setProfile(current)
        setPreference(readPreference(STORAGE_PREFIX + current))
      }
    }).catch(() => { if (alive) setProfile(null) })
    return () => { alive = false }
  }, [])

  // revision intentionally re-evaluates the live slot roster after a plugin changes it.
  const roster = useMemo(() => installedCards(ctx), [ctx, revision])
  const cards = orderedCards(roster.cards, preference.order)
  const hidden = new Set(preference.hidden)
  const visibleCards = cards.filter(card => !hidden.has(card.id))
  const hiddenCards = cards.filter(card => hidden.has(card.id))
  const readyCount = visibleCards.filter(card => card.panelId !== undefined && roster.panels.has(card.panelId)).length

  const save = (next: HomePreference) => {
    setPreference(next)
    if (profile === null) { setSaveError(true); return }
    try {
      localStorage.setItem(STORAGE_PREFIX + profile, JSON.stringify(next))
      setSaveError(false)
    } catch { setSaveError(true) }
  }
  const move = (id: string, direction: -1 | 1) => {
    const order = cards.map(card => card.id)
    const visibleOrder = visibleCards.map(card => card.id)
    const index = visibleOrder.indexOf(id)
    const target = visibleOrder[index + direction]
    if (target === undefined) return
    const first = order.indexOf(id)
    const second = order.indexOf(target)
    ;[order[first], order[second]] = [order[second]!, order[first]!]
    save({ ...preference, order })
  }
  const toggleHidden = (id: string) => {
    const next = hidden.has(id) ? preference.hidden.filter(item => item !== id) : [...preference.hidden, id]
    save({ ...preference, hidden: next })
  }
  const open = (panelId: string) => {
    if (roster.panels.has(panelId)) ctx.layout.selectPanel(panelId as MainPanelId)
  }

  return (
    <section className="eBaoHomeDock" data-ebao-home-dock="" data-editing={editing || undefined} aria-labelledby="ebao-home-employees">
      <div className="eBaoHomeSectionHeader">
        <div className="eBaoHomeSectionIntro">
          <span className="eBaoHomeEyebrow">我的工作台</span>
          <div className="eBaoHomeSectionTitle">
            <h2 id="ebao-home-employees">我的数字员工</h2>
            <span className="eBaoHomeReadyCount">{readyCount} 位可用</span>
          </div>
          <p>从灵感到交付，找到合适的帮手。</p>
        </div>
        <div className="eBaoHomeSectionActions">
          {editing && <button type="button" onClick={() => { save(EMPTY_PREFERENCE) }}>恢复默认</button>}
          <button type="button" onClick={() => { setEditing(value => !value) }}>{editing ? '完成' : '调整布局'}</button>
          {roster.market && <button type="button" className="eBaoHomeAdd" onClick={() => { window.dispatchEvent(new Event(MARKET_OPEN_EVENT)) }}>添加数字员工 <span aria-hidden="true">＋</span></button>}
        </div>
      </div>
      <div className="eBaoHomeGrid">
      {visibleCards.map((card, index) => {
          const available = card.panelId !== undefined && roster.panels.has(card.panelId)
          const state = available ? 'ready' : card.planned ? 'planned' : 'unavailable'
          const Icon = card.panelId === undefined ? undefined : roster.icons.get(card.panelId)
          const content = <>
            <span className="eBaoHomeCardTop">
              <span className="eBaoHomeCardIcon" aria-hidden="true">{Icon ? <Icon size={22} active={false} /> : <FallbackCardIcon id={card.id} />}</span>
              {available && !editing
                ? <svg className="eBaoHomeCardArrow" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
                : <span className="eBaoHomeCardState">{available ? '可使用' : card.planned ? '即将上线' : '未启用'}</span>}
            </span>
            <strong>{card.title}</strong>
            <span className="eBaoHomeCardDescription">{card.description}</span>
            <span className="eBaoHomeCardFooter">{available ? (editing ? '使用下方按钮调整' : '打开工作台') : (card.planned ? '敬请期待' : '当前未启用')}</span>
          </>
          return <div key={card.id} className="eBaoHomeCardWrap">
            {available && !editing
              ? <button type="button" className="eBaoHomeCard" data-state={state} data-cover={coverForCard(card)} onClick={() => { open(card.panelId!) }} aria-label={`打开${card.title}`}>{content}</button>
              : <div className="eBaoHomeCard" data-state={state} data-cover={coverForCard(card)}>{content}</div>}
            {editing && <div className="eBaoHomeCardEdit" aria-label={`${card.title}布局操作`}>
              <button type="button" aria-label={`${card.title}前移`} disabled={index === 0} onClick={() => { move(card.id, -1) }}>←</button>
              <button type="button" aria-label={`${card.title}后移`} disabled={index === visibleCards.length - 1} onClick={() => { move(card.id, 1) }}>→</button>
              <button type="button" onClick={() => { toggleHidden(card.id) }}>隐藏</button>
            </div>}
          </div>
        })}
      </div>
      {visibleCards.length === 0 && <p className="eBaoHomeEmpty">首页暂无数字员工。选择「调整布局」即可重新显示。</p>}
      {editing && hiddenCards.length > 0 && <div className="eBaoHomeHidden"><span>已隐藏</span>{hiddenCards.map(card => <button key={card.id} type="button" onClick={() => { toggleHidden(card.id) }}>{card.title} ＋</button>)}</div>}
      {saveError && <p className="eBaoHomeSaveError" role="status">布局暂未保存到当前 Profile，请稍后重试。</p>}
    </section>
  )
}
