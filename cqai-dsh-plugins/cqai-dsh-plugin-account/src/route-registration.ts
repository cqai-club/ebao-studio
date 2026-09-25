import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'

import { safeErrorMessage } from './errors.ts'
import { CqaiClubAdapter, CQAI_PROVIDER } from './llm-adapter.ts'
import { isChatModel, type DsnAccountService, type DsnAccountSnapshot } from './protocol.ts'

/** Keep the CQAI provider route aligned with authenticated catalog readiness. */
export function bindCqaiModelRoute(ctx: Context, account: DsnAccountService): void {
  const registration = ctx.llm.registerAdapter([CQAI_PROVIDER], new CqaiClubAdapter(account, {
    resolveAttachments: () => ctx.get('attachments'),
  }))
  // An initial registration cannot be empty, so release the bootstrap route
  // immediately and expose it again only after private readiness is known.
  registration.replace([])

  let signedIn = false
  let routeEnabled = false
  let catalogGeneration = 0

  const setRouteEnabled = (enabled: boolean, refresh = false): void => {
    if (enabled === routeEnabled) {
      if (enabled && refresh) registration.replace([CQAI_PROVIDER])
      return
    }
    registration.replace(enabled ? [CQAI_PROVIDER] : [])
    routeEnabled = enabled
  }

  const syncCatalogRoute = (refresh = false): void => {
    const generation = ++catalogGeneration
    if (!signedIn) {
      setRouteEnabled(false)
      return
    }
    void account.listModels().then((catalog) => {
      if (generation !== catalogGeneration || !signedIn) return
      setRouteEnabled(catalog.models.some(isChatModel), refresh)
    }).catch((error: unknown) => {
      if (generation !== catalogGeneration) return
      setRouteEnabled(false)
      ctx.logger.warn('cqaiclub-dsn-account: CQAI model route remains unavailable: %s', safeErrorMessage(error))
    })
  }

  const syncAccountRoute = (snapshot: DsnAccountSnapshot): void => {
    signedIn = snapshot.state === 'signed-in'
    if (!signedIn) {
      catalogGeneration += 1
      setRouteEnabled(false)
      return
    }
    if (!routeEnabled) syncCatalogRoute()
  }

  ctx.on('dsn-account/changed', syncAccountRoute)
  ctx.on('dsn-account/models-updated', () => { syncCatalogRoute(true) })
  void account.getStatus().then(syncAccountRoute).catch((error: unknown) => {
    ctx.logger.warn('cqaiclub-dsn-account: failed to initialize CQAI model route: %s', safeErrorMessage(error))
  })
}
