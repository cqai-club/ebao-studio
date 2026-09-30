import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import robotArtwork from '../../assets/ebao-robot.webp'
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { HomeDock } from './home.tsx'
import { installHomeStyles } from './styles.ts'

export const inject = ['slots']

const HERO_ACTIONS = [
  { id: 'cqai-imagegen', label: 'e图宝', position: 'image', prompt: '想把灵感变成图片？试试 e图宝。' },
  { id: 'cqai-short-video', label: '短视频制作', position: 'short-video', prompt: '有短视频点子？可以从文案开始。' },
  { id: 'cqai-video', label: 'e剪宝', position: 'video', prompt: '有视频要剪？打开 e剪宝试试。' },
  { id: 'cqai-talkcraft', label: '口播视频制作', position: 'talkcraft', prompt: '需要口播视频？从文案开始吧。' },
  { id: 'cqai-publisher', label: '多平台发布', position: 'publisher', prompt: '内容准备好了？试试多平台发布。' },
] as const

const WELCOME_PROMPT = '我是e宝机器人，专属您的数字员工。'
const PROMPT_VISIBLE_MS = 20_000
const PROMPT_INTERVAL_MIN_MS = 60_000
const PROMPT_INTERVAL_RANGE_MS = 60_000
const PROMPT_CHARACTER_MS = 65

type EmployeeIcon = ComponentType<{ size: number; active: boolean }>

function heroMessages(enabledIds: ReadonlySet<string>): string[] {
  const today = new Date()
  const monthDay = `${today.getMonth() + 1}-${today.getDate()}`
  const specialDays: Record<string, string> = {
    '1-1': '元旦快乐，想先完成什么小目标？',
    '5-1': '劳动节快乐，今天也记得休息。',
    '10-1': '国庆节快乐，想记录点什么？',
  }
  const dayPrompt = specialDays[monthDay]
    ?? `今天是星期${'日一二三四五六'[today.getDay()]}，想先做哪件事？`

  return [
    WELCOME_PROMPT,
    ...HERO_ACTIONS.filter(action => enabledIds.has(action.id)).map(action => action.prompt),
    dayPrompt,
    '有待办想梳理？告诉我，我们一起安排。',
  ]
}

function useHeroPrompt(enabledKey: string) {
  const [prompt, setPrompt] = useState({ message: WELCOME_PROMPT, typed: '', visible: true })

  useEffect(() => {
    const enabledIds = new Set(enabledKey ? enabledKey.split(',') : [])
    const reducedMotion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    let messageIndex = -1
    let typingTimer: ReturnType<typeof setTimeout> | undefined
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let nextTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (typingTimer) clearTimeout(typingTimer)
      if (hideTimer) clearTimeout(hideTimer)
      if (nextTimer) clearTimeout(nextTimer)
      typingTimer = hideTimer = nextTimer = undefined
    }

    const showNext = () => {
      clearTimers()
      const messages = heroMessages(enabledIds)
      messageIndex = (messageIndex + 1) % messages.length
      const message = messages[messageIndex]
      const characters = Array.from(message)
      setPrompt({ message, typed: reducedMotion?.matches ? message : '', visible: true })

      if (!reducedMotion?.matches) {
        let characterIndex = 0
        const typeNext = () => {
          characterIndex += 1
          setPrompt(current => current.message === message
            ? { ...current, typed: characters.slice(0, characterIndex).join('') }
            : current)
          if (characterIndex < characters.length) {
            typingTimer = setTimeout(typeNext, PROMPT_CHARACTER_MS)
          }
        }
        typingTimer = setTimeout(typeNext, PROMPT_CHARACTER_MS)
      }

      hideTimer = setTimeout(() => setPrompt(current => ({ ...current, visible: false })), PROMPT_VISIBLE_MS)
      nextTimer = setTimeout(showNext, PROMPT_INTERVAL_MIN_MS + Math.random() * PROMPT_INTERVAL_RANGE_MS)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimers()
        setPrompt(current => ({ ...current, visible: false }))
      } else {
        showNext()
      }
    }
    const onMotionChange = () => {
      if (!reducedMotion?.matches) return
      if (typingTimer) clearTimeout(typingTimer)
      typingTimer = undefined
      setPrompt(current => ({ ...current, typed: current.message }))
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    reducedMotion?.addEventListener('change', onMotionChange)
    if (document.hidden) onVisibilityChange()
    else showNext()

    return () => {
      clearTimers()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      reducedMotion?.removeEventListener('change', onMotionChange)
    }
  }, [enabledKey])

  return prompt
}

function HeroActionIcon({ position }: { position: typeof HERO_ACTIONS[number]['position'] }) {
  let drawing: ReactNode
  switch (position) {
    case 'image':
      drawing = <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m4 18 5-5 3 3 3-4 5 6" /></>
      break
    case 'short-video':
      drawing = <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M7 3l2 6m5-6 2 6m-5 3 5 3-5 3z" /></>
      break
    case 'video':
      drawing = <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="m8 8 11 11M8 16 19 5" /></>
      break
    case 'talkcraft':
      drawing = <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" /></>
      break
    case 'publisher':
      drawing = <><path d="m21 3-8.5 18-3.8-7.7L1 9.5 21 3Z" /><path d="M21 3 8.7 13.3" /></>
  }
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>
}

function HomeHeadline({ ctx }: { ctx: Context }) {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    const offMain = ctx.slots.subscribe('main', refresh)
    const offSidebar = ctx.slots.subscribe('sidebar.panellist', refresh)
    return () => { offMain(); offSidebar() }
  }, [ctx])

  const roster = useMemo(() => {
    const entries = new Map(ctx.slots.entriesOfSlot('sidebar.panellist').map(entry => [String(entry.options.id), entry]))
    const panels = new Set(ctx.slots.entriesOfSlot('main').map(entry => String(entry.options.key)))
    const icons = new Map(HERO_ACTIONS.map(action => {
      const component = entries.get(action.id)?.component
      return [action.id, typeof component === 'function' ? component as EmployeeIcon : undefined] as const
    }))
    return { panels, icons }
  }, [ctx, revision])
  const enabledKey = HERO_ACTIONS.filter(action => roster.panels.has(action.id)).map(action => action.id).join(',')
  const prompt = useHeroPrompt(enabledKey)

  return <span className="eBaoHeroSlot">
    <span className="eBaoRobotHero">
      <img className="eBaoRobotArtwork" src={robotArtwork} width={720} height={586} alt="举着金色星星的 E宝机器人" draggable={false} />
      <span className="eBaoHeroPrompt" data-visible={prompt.visible} role="status" aria-live="polite" aria-atomic="true" aria-label={prompt.visible ? prompt.message : ''} aria-hidden={!prompt.visible}>
        <span className="eBaoHeroPromptMeasure" aria-hidden="true">{prompt.message}</span>
        <span className="eBaoHeroPromptText" aria-hidden="true">{prompt.typed}</span>
      </span>
      {HERO_ACTIONS.map(action => {
        const Icon = roster.icons.get(action.id)
        const available = roster.panels.has(action.id)
        return <button
          key={action.id}
          type="button"
          className="eBaoHeroAction"
          data-position={action.position}
          disabled={!available}
          aria-label={available ? action.label : `${action.label}，插件未启用`}
          title={available ? action.label : `${action.label} · 插件未启用`}
          onClick={() => { ctx.layout.selectPanel(action.id as MainPanelId) }}
        >
          <span className="eBaoHeroActionIcon" aria-hidden="true">{Icon ? <Icon size={42} active={false} /> : <HeroActionIcon position={action.position} />}</span>
        </button>
      })}
    </span>
    <span className="eBaoHeroFallback">专属你的数字员工</span>
  </span>
}

/** The presentation is a Desktop mode layer, never a compatibility override. */
export function apply(ctx: Context): void {
  const mode = new URLSearchParams(window.location.search).get('dsh-desktop-mode')
  if (mode !== 'extended' && mode !== 'advanced') return

  ctx.inject(['layout'], scope => {
    scope.effect(() => installHomeStyles(), 'cqai-desktop-presentation: styles')
    scope.slots.inject('conversation.hero.headline', () => scope.slots.register({
      name: 'conversation.hero.headline',
      priority: -20,
    }, () => <HomeHeadline ctx={scope} />))
    scope.slots.inject('conversation.hero.dock', () => scope.slots.register({
      name: 'conversation.hero.dock',
      id: 'cqai-desktop-presentation:employees',
      order: 20,
    }, () => <HomeDock ctx={scope} />))
  })
}
