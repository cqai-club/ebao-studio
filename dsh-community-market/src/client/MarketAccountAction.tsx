import { useEffect, useRef, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { MarketStoreIcon } from './MarketLauncher.js'
import type { createMarketViewStore } from './market-view-store.js'

interface AccountMenuAction {
  readonly id: string
  readonly label: () => string
  readonly icon?: ReactNode
  readonly onSelect: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'cqaiclub.account.menu.action': {
      kind: 'list'
      scope: 'root'
      owner: { registerAction: (action: AccountMenuAction) => () => void }
    }
  }
}

type MarketAccountActionProps = PropsRuntime<'cqaiclub.account.menu.action'>
  & PropsStore<ReturnType<typeof createMarketViewStore>>
  & PropsLocale<'community-market'>

/** Registers the active market's existing overlay action in the CQAI account menu. */
export function MarketAccountAction({ registerAction, actions, t }: MarketAccountActionProps) {
  const translate = useRef(t)
  translate.current = t

  useEffect(() => registerAction({
    id: 'community-market',
    label: () => translate.current('tab'),
    icon: <MarketStoreIcon size={16} />,
    onSelect: () => actions.open(),
  }), [registerAction, actions])

  return null
}
