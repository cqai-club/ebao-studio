import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { mountVideoWorkspace } from 'cqai-dsh-media-settings/client'
import { TalkCraft } from './App.tsx'
import pluginIcon from '../../assets/plugin-icon.svg'

export const inject = ['slots']
const PANEL = 'cqai-talkcraft' as MainPanelId

function Icon({size = 20}: {size?: number}) {
  return <img className="cqai-plugin-panel-icon" src={pluginIcon} width={size} height={size} alt="" draggable={false}/>
}

export function apply(ctx: Context): void {
  mountVideoWorkspace(ctx, {id: 'talkcraft', panelId: PANEL, label: '口播视频制作', order: 42, icon: Icon, component: TalkCraft})
}
