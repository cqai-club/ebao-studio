import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import robotArtwork from '../../assets/ebao-robot.webp'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { HomeDock } from './home.tsx'
import { installHomeStyles } from './styles.ts'

export const inject = ['slots']

const HERO_EMPLOYEES = [
  { id: 'cqai-imagegen', layer: 'back' },
  { id: 'cqai-video', layer: 'back' },
  { id: 'cqai-short-video', layer: 'back' },
  { id: 'cqai-talkcraft', layer: 'front' },
  { id: 'cqai-publisher', layer: 'front' },
] as const

type EmployeeIcon = ComponentType<{ size: number; active: boolean }>

function HomeHeadline({ ctx }: { ctx: Context }) {
  const [revision, setRevision] = useState(0)

  useEffect(() => ctx.slots.subscribe('sidebar.panellist', () => setRevision(value => value + 1)), [ctx])

  const employees = useMemo(() => {
    const entries = new Map(ctx.slots.entriesOfSlot('sidebar.panellist').map(entry => [String(entry.options.id), entry]))
    return HERO_EMPLOYEES.flatMap(employee => {
      const component = entries.get(employee.id)?.component
      return typeof component === 'function'
        ? [{ ...employee, Icon: component as EmployeeIcon }]
        : []
    })
  }, [ctx, revision])

  const orbit = (layer: 'back' | 'front') => <span className={`eBaoEmployeeOrbit eBaoEmployeeOrbit--${layer}`} aria-hidden="true">
    {employees.filter(employee => employee.layer === layer).map(({ id, Icon }) =>
      <span className="eBaoEmployeeBadge" data-employee={id} key={id}><Icon size={22} active={false} /></span>)}
  </span>

  return <span className="eBaoHeroSlot">
    <span className="eBaoRobotHero">
      {orbit('back')}
      <img src={robotArtwork} width={720} height={586} alt="E宝机器人举着星星，周围环绕数字员工图标" draggable={false} />
      {orbit('front')}
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
