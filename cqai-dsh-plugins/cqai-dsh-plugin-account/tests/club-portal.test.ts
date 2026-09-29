import { describe, expect, it, vi } from 'vitest'

import { ClubPortalClient, tokenHasAudience } from '../src/club-portal.ts'

const portalResource = 'https://cqaiclub.asia/'

function jwt(aud: string | string[]): string {
  return `header.${Buffer.from(JSON.stringify({ aud })).toString('base64url')}.signature`
}

describe('club portal boundary', () => {
  it('accepts only the portal audience', () => {
    expect(tokenHasAudience(jwt(portalResource), portalResource)).toBe(true)
    expect(tokenHasAudience(jwt(['another', portalResource]), portalResource)).toBe(true)
    expect(tokenHasAudience(jwt('https://account.cqaiclub.asia'), portalResource)).toBe(false)
    expect(tokenHasAudience('header.payload.signature', portalResource)).toBe(false)
  })

  it('sends a scoped request to the fixed portal origin without caller credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const client = new ClubPortalClient('https://cqaiclub.asia', fetchImpl)
    await client.request('/api/v1/plugin-submissions', 'portal-secret', {
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', Cookie: 'session=attacker' },
      body: JSON.stringify({ packageName: '@test/plugin' }),
    })
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cqaiclub.asia/api/v1/plugin-submissions')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer portal-secret')
    expect(new Headers(init.headers).get('cookie')).toBeNull()
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
  })

  it('rejects unapproved paths and methods before sending a request', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    const client = new ClubPortalClient('https://cqaiclub.asia', fetchImpl)
    await expect(client.request('/api/v1/../admin/plugins' as `/api/v1/${string}`, 'secret')).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/plugin-submissions', 'secret', { method: 'DELETE' })).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/activities/id/registration?redirect=https://evil.test' as `/api/v1/${string}`, 'secret', { method: 'POST' })).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/activities?limit=101', 'secret')).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/manage/activities?page=0&limit=20', 'secret')).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/manage/activities?page=1000001&limit=20', 'secret')).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    await expect(client.request('/api/v1/manage/activities?page=1&limit=101', 'secret')).rejects.toMatchObject({ code: 'DSN_CLIENT_FORBIDDEN' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows only a bounded public activity limit and rejects a hidden base path', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]')) as unknown as typeof fetch
    const client = new ClubPortalClient('https://cqaiclub.asia', fetchImpl)
    await client.request('/api/v1/activities?limit=100', 'secret')
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('https://cqaiclub.asia/api/v1/activities?limit=100')
    await client.request('/api/v1/manage/activities?page=1000000&limit=20', 'secret')
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toBe('https://cqaiclub.asia/api/v1/manage/activities?page=1000000&limit=20')
    expect(() => new ClubPortalClient('https://cqaiclub.asia/proxy', fetchImpl)).toThrow('origin root')
  })
})
