import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import icon from '../../assets/plugin-icon.svg'
import { EyanbaoWorkspace } from './EyanbaoWorkspace.tsx'

export const EYANBAO_PANEL_ID = 'cqai-eyanbao' as MainPanelId
export const inject = ['slots']

function PanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <img className="cqai-plugin-panel-icon" src={icon} width={size} height={size} alt="" draggable={false} />
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: EYANBAO_PANEL_ID,
  }, () => <EyanbaoWorkspace />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: EYANBAO_PANEL_ID,
    order: 39,
    label: 'e研宝',
  }, PanelIcon))
}

export { EyanbaoWorkspace } from './EyanbaoWorkspace.tsx'
