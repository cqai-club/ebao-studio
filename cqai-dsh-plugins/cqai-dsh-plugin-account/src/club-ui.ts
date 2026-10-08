import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Optional Club pages contribute their navigation metadata and UI together. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'cqaiclub.club.extension': {
      kind: 'list'
      scope: 'root'
      owner: {}
    }
  }
}

export type ClubExtensionProps = PropsRuntime<'cqaiclub.club.extension'>
