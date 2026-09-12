import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-better-sidebar/client/service'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { QuickNavAction } from './QuickNavAction.tsx'
import { QuickNavPage } from './QuickNavPage.tsx'
import { en, zh } from './locales.ts'

const NS = 'cqai-quicknav'
const TAB_ID = 'cqai-dsh-plugin-quicknav:workbench'

export const inject = ['betterSidebar', 'slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cqai-quicknav: dictionaries')

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: TAB_ID,
    title: () => ctx.locale.bind(NS)('pageTitle'),
    description: () => ctx.locale.bind(NS)('pageDescription'),
    order: 60,
    single: true,
    component: (props) => <QuickNavPage {...props} t={ctx.locale.bind(NS)} />,
  }), 'cqai-quicknav: workbench tab')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'cqai-dsh-plugin-quicknav:launcher',
    order: 20,
    locale: NS,
    inject: () => ({
      openWorkbench: () => { ctx.betterSidebar.openTab({ type: TAB_ID }) },
    }),
  }, QuickNavAction))
}
