import type { Context } from '@deepseek-ai/cordis'
import type { CommunityMarketService } from 'dsh-community-market'

/**
 * Host half of the CQAI market plugin. The installation engine remains owned
 * by dsh-community-market; CQAI contributes only presentation policy.
 */
export const name = 'cqai-dsh-plugin-market'
// Community Market is an optional Desktop provider. Keep this plugin loadable
// when the provider is disabled, and activate the policy only when available.
export const inject: readonly string[] = []

const CQAI_POLICY = {
  id: 'cqai-curated',
  featuredCategories: ['tools', 'interface', 'workflow'],
  defaultSource: {
    manifestUrl: 'https://cqaiclub.asia/catalog-source.json',
  },
  branding: {
    title: 'CQAI 插件市场',
    subtitle: '发现、安装和管理 CQAI 精选插件',
  },
} as const

export function apply(ctx: Context): void {
  ctx.inject(['communityMarket'], marketCtx => {
    const market = marketCtx.get('communityMarket') as CommunityMarketService
    marketCtx.effect(
      () => market.registerPolicy(CQAI_POLICY),
      'cqai-market: curated policy',
    )
  })
}
