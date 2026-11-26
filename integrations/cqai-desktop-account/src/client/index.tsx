/** Settings contributed by the e宝工坊 account integration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PointsSection, pointsLocales } from './points.tsx'
import { registerModelSettings } from './models.tsx'

export const inject = ['slots', 'locale', 'connection', 'accountUi']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('ebao.points', pointsLocales), 'ebao: points settings copy')
  const t = ctx.locale.bind('ebao.points')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: -10,
    label: () => t('title'),
    locale: 'ebao.points',
    inject: () => ({ accountContext: ctx }),
  }, PointsSection))
  registerModelSettings(ctx)
}
