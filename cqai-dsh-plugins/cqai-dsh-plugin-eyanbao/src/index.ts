import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type { ResearchModelServices } from './generation.ts'
import { API } from './protocol.ts'
import { createRouteHandler } from './routes.ts'

export const name = 'cqai-eyanbao'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  let services: ResearchModelServices = {}
  ctx.inject(['llm', 'agentDefaultModel'], modelCtx => {
    services = {
      llm: modelCtx.get('llm') as ResearchModelServices['llm'],
      defaultModel: modelCtx.get('agentDefaultModel') as ResearchModelServices['defaultModel'],
    }
    return () => {
      services = {}
    }
  })
  const handler = createRouteHandler({ services: () => services })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API,
    handler,
  }), 'e研宝 research routes')
}
