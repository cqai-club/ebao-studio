import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createMediaSettings, createMediaSettingsHandler, mediaSettingsPermitted } from 'cqai-dsh-media-settings'
import { SetupManager, commonToolHealth, commonToolSteps } from 'cqai-dsh-plugin-media-runtime'
import type { ServerResponse } from 'node:http'

export const name = 'cqai-ejianbao'
export const inject = ['webServer', 'credentials']
export const API = '/api/cqai-ejianbao'
function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
  res.end(JSON.stringify(data))
}
export function apply(ctx: Context): void {
  const home = resolveDshHome()
  const store = createMediaSettings({home, credentials: ctx.credentials})
  const settings = createMediaSettingsHandler(store, {path: `${API}/media-settings`})
  const setup = new SetupManager(() => commonToolSteps(home))
  ctx.effect(() => ctx.webServer.register({kind: 'prefix', path: API, handler: async (req, res) => {
    if (await settings(req, res)) return
    const action = new URL(req.url ?? '/', 'http://localhost').pathname.slice(API.length + 1)
    if (action === 'tools' || action === 'tools/setup') {
      if (!mediaSettingsPermitted(req)) return json(res, 403, {error: '仅允许本机应用访问'})
      try {
        if (req.method === 'GET' && action === 'tools') return json(res, 200, {...await commonToolHealth(home), setup: setup.snapshot()})
        if (req.method === 'GET' && action === 'tools/setup') return json(res, 200, setup.snapshot())
        if (req.method === 'POST' && action === 'tools/setup') return json(res, 202, setup.start())
        return json(res, 405, {error: '请求方法不支持'})
      } catch (error) {return json(res, 500, {error: error instanceof Error ? error.message : '公共工具检测失败'})}
    }
    json(res, 404, {error: '接口不存在'})
  }}))
}
