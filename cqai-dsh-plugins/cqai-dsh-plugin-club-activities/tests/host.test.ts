import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { ActivitiesService } from '../src/index.ts'
import type { ActivityConfig } from '../src/protocol.ts'

const config: ActivityConfig = { portalUrl: 'https://cqaiclub.asia' }

function harness(authorization: 'signed-out' | 'reauth-required' | 'ready' = 'ready', manageStatus = 403) {
  const account = {
    extensionApiVersion: 1,
    getStatus: vi.fn(async () => ({ state: 'signed-in', account: { displayName: '当前用户' } })),
    getClubPortalAuthorization: vi.fn(async () => authorization),
    beginClubPortalAuthorization: vi.fn(async () => ({ state: 'authorizing', authorizationUrl: 'https://auth.cqaiclub.asia/login' })),
    fetchClubPortal: vi.fn(async (path: string) => new Response('{}', { status: path === '/api/v1/manage/activities' ? manageStatus : 200 })),
  }
  const registeredTools: unknown[] = []
  const registeredSkills: unknown[] = []
  const preToolListeners: ((exec: { name: string; arguments: unknown }, next: () => Promise<{ kind: 'allow' }>) => Promise<{ kind: string; displayReason?: { 'zh-CN': string } }>)[] = []
  const root = {
    root: undefined,
    connection: { rpc: { handle: () => async () => undefined } },
    dsnAccount: account,
    tools: { register: (definition: unknown) => { registeredTools.push(definition); return () => undefined } },
    skills: { register: (definition: unknown) => { registeredSkills.push(definition); return () => undefined } },
    get: (key: string) => (root as unknown as Record<string, unknown>)[key],
    inject: (_services: readonly string[], callback: (ctx: Context) => void) => { callback(root as unknown as Context) },
    on: (_event: string, listener: typeof preToolListeners[number]) => { preToolListeners.push(listener); return () => undefined },
    effect: () => undefined,
    reflect: { provide: () => () => undefined },
  } as unknown as Context & { root: Context }
  root.root = root
  const runtime = new ActivitiesService(root, config)
  const dispatch = (endpoint: string, payload: unknown = {}) =>
    (runtime as unknown as { dispatch(name: string, data: unknown): Promise<unknown> }).dispatch(endpoint, payload)
  return { runtime, account, dispatch, registeredTools, registeredSkills, preToolListeners }
}

afterEach(() => vi.unstubAllGlobals())

describe('activities Host shared-account boundary', () => {
  it('reads public activity data without an authorization token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ id: 'a1' }] })))
    const { dispatch, account } = harness('signed-out')
    await expect(dispatch('public/list')).resolves.toEqual({ items: [{ id: 'a1' }] })
    expect(account.fetchClubPortal).not.toHaveBeenCalled()
  })

  it('explains when the configured portal has no activity API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const { dispatch } = harness()
    await expect(dispatch('public/list')).rejects.toThrow('当前门户尚未提供所需的俱乐部接口')
  })

  it('requests a base-plugin login upgrade once for an older grant', async () => {
    const { runtime, account } = harness('reauth-required')
    await expect(runtime.snapshot()).resolves.toMatchObject({ state: 'reauth-required' })
    expect(account.fetchClubPortal).not.toHaveBeenCalled()
  })

  it('keeps activity management disabled after a server permission denial', async () => {
    const { runtime } = harness('ready', 403)
    await expect(runtime.snapshot()).resolves.toMatchObject({ state: 'signed-in', canManage: false })
  })

  it('restores the login action when portal token refresh requires a new login', async () => {
    const { runtime, account } = harness()
    account.fetchClubPortal.mockRejectedValueOnce(Object.assign(new Error('expired grant'), { code: 'DSN_REAUTH_REQUIRED' }))
    await expect(runtime.snapshot()).resolves.toMatchObject({ state: 'reauth-required' })
  })

  it('uses bounded pages when listing activities for management', async () => {
    const { dispatch, account } = harness()
    await dispatch('manage/list', { page: 2 })
    expect(account.fetchClubPortal).toHaveBeenCalledWith('/api/v1/manage/activities?page=2&limit=20', { method: 'GET' }, undefined)
    await expect(dispatch('manage/list', { page: 0 })).rejects.toThrow('页码无效')
    await expect(dispatch('manage/list', { page: 1_000_001 })).rejects.toThrow('页码无效')
    expect(account.fetchClubPortal).toHaveBeenCalledTimes(1)
  })

  it('sends registration and plugin submission through the base Host service', async () => {
    const { dispatch, account } = harness()
    await dispatch('registration/create', { id: 'activity-1' })
    await dispatch('submissions/create', { input: { packageName: '@club/tool', displayName: '工具', summary: '插件简介' } })
    expect(account.fetchClubPortal).toHaveBeenCalledWith('/api/v1/activities/activity-1/registration', { method: 'POST' }, undefined)
    expect(account.fetchClubPortal).toHaveBeenCalledWith('/api/v1/plugin-submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageName: '@club/tool', displayName: '工具', summary: '插件简介' }),
    }, undefined)
  })

  it('shows a clear error when the installed base plugin is too old', async () => {
    const { runtime, account } = harness()
    Object.assign(account, { fetchClubPortal: undefined })
    await expect(runtime.snapshot()).resolves.toMatchObject({ state: 'error', message: expect.stringContaining('CQAI Club 基础插件') })
  })

  it('requires the extension API even when an older account already supports portal requests', async () => {
    const { runtime, account, dispatch } = harness()
    Object.assign(account, { extensionApiVersion: undefined })
    await expect(runtime.snapshot()).resolves.toMatchObject({ state: 'error', message: expect.stringContaining('尚不支持俱乐部扩展') })
    await expect(dispatch('registration/create', { id: 'activity-1' })).rejects.toThrow('尚不支持俱乐部扩展')
    expect(account.fetchClubPortal).not.toHaveBeenCalled()
  })

  it('registers the DSH Skill and requires confirmation before an Agent submits metadata', async () => {
    const { registeredSkills, registeredTools, account, preToolListeners } = harness()
    expect(registeredSkills).toEqual([expect.objectContaining({ name: 'cqai-club', source: 'runtime' })])
    expect(registeredTools).toHaveLength(4)
    expect(preToolListeners).toHaveLength(1)
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(preToolListeners[0]!({ name: 'cqai_club_list_activities', arguments: {} }, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
    await expect(preToolListeners[0]!({
      name: 'cqai_club_submit_plugin', arguments: { package_name: '@club/tool', display_name: '工具', summary: '简介', confirmed: true },
    }, next)).resolves.toMatchObject({ kind: 'ask', displayReason: { 'zh-CN': expect.stringContaining('@club/tool') } })
    expect(next).toHaveBeenCalledOnce()
    const submit = registeredTools.find(value => (value as { name?: string }).name === 'cqai_club_submit_plugin') as {
      execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
    }
    const signal = new AbortController().signal
    await expect(submit.execute({ package_name: '@club/tool', display_name: '工具', summary: '简介' }, { signal }))
      .rejects.toThrow('用户确认')
    expect(account.fetchClubPortal).not.toHaveBeenCalled()
    await submit.execute({ package_name: '@club/tool', display_name: '工具', summary: '简介', confirmed: true }, { signal })
    expect(account.fetchClubPortal).toHaveBeenCalledWith('/api/v1/plugin-submissions', expect.objectContaining({ method: 'POST' }), signal)
  })
})
