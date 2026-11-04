import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

// Optional slots owned by the legacy CQAI management presentation. Their
// registrations wait for a declaring shell; the modern official page owns itself.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.shell': { kind: 'single'; scope: 'root'; owner: {
      readonly content: ReactNode
      readonly nativeView: { readonly kind: string }
      readonly showList: () => void
    } }
    'plugins.installed.cards': { kind: 'list'; scope: 'root'; owner: {
      readonly reportCount: (count: number) => void
    } }
  }
}
