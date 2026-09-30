import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { TalkCraft } from './App.tsx'
import pluginIcon from '../../assets/plugin-icon.svg'

export const inject = ['slots']
const PANEL = 'cqai-talkcraft' as MainPanelId

function Icon({size = 20}: {size?: number}) {
  return <img className="cqai-plugin-panel-icon" src={pluginIcon} width={size} height={size} alt="" draggable={false}/>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: PANEL}, TalkCraft))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: PANEL, order: 42, label: '口播视频制作'}, ({size}: PropsRuntime<'sidebar.panellist'>) => <Icon size={size}/>))
}
