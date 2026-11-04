import type {} from '@deepseek-ai/dsh-client-ui-slots'

// The legacy advanced shell declares these optional product slots. The modern
// official shell keeps its own hero and does not mount this presentation layer.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.hero.headline': { kind: 'single'; scope: 'session-maybe' }
    'conversation.hero.dock': { kind: 'list'; scope: 'session-maybe' }
  }
}
