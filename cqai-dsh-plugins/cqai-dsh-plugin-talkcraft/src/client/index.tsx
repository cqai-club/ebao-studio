import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { TalkCraft } from './App.tsx'

export const inject = ['slots']
const PANEL = 'cqai-talkcraft' as MainPanelId

function Icon({size = 20}: {size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="15" rx="2"/><path d="m8 2 3 3M14 2l3 3M8 10l6 3-6 3z"/></svg>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: PANEL}, TalkCraft))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: PANEL, order: 42, label: '口播视频制作'}, ({size}: PropsRuntime<'sidebar.panellist'>) => <Icon size={size}/>))
}
