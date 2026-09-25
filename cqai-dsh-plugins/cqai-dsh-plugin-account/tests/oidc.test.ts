import { describe, expect, it } from 'vitest'

import { OidcClient, Prompt } from '../src/oidc.ts'

const issuer = 'https://auth.example.test/oidc'
const resource = 'https://account.example.test'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestBody(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''))
}

function discovery(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    ...extra,
  }
}

describe('OidcClient', () => {
  it('builds an authorization-code URL with resource, scopes, and PKCE', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init })
        return json(discovery())
      },
    })

    const request = await client.createAuthorizationRequest(
      'http://127.0.0.1:38992/callback',
      { prompt: Prompt.LoginConsent },
    )
    const url = new URL(request.authorizationUrl)

    expect(url.origin).toBe('https://auth.example.test')
    expect(url.pathname).toBe('/oidc/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:38992/callback')
    expect(url.searchParams.get('resource')).toBe(resource)
    expect(url.searchParams.get('scope')).toBe('openid offline_access ai:invoke')
    expect(url.searchParams.get('prompt')).toBe(Prompt.LoginConsent)
    expect(url.searchParams.get('state')).toBe(request.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(request.expiresAt).toBeGreaterThan(Date.now())
    expect(requests).toHaveLength(1)
  })

  it('exchanges the callback code with the redirect URI, verifier, and resource', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        const url = String(input)
        requests.push({ url, init })
        if (url.endsWith('/.well-known/openid-configuration')) return json(discovery())
        return json({ access_token: 'header.payload.signature', refresh_token: 'refresh-1', expires_in: 3600 })
      },
    })

    const token = await client.exchangeAuthorizationCode(
      'authorization-code',
      'http://127.0.0.1:38992/callback',
      'verifier-secret',
    )

    expect(token).toMatchObject({ accessToken: 'header.payload.signature', refreshToken: 'refresh-1' })
    const form = requestBody(requests[1]?.init)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe('authorization-code')
    expect(form.get('redirect_uri')).toBe('http://127.0.0.1:38992/callback')
    expect(form.get('client_id')).toBe('client-123')
    expect(form.get('code_verifier')).toBe('verifier-secret')
    expect(form.get('resource')).toBe(resource)
  })

  it('refreshes with the configured resource and supports refresh-token rotation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        const url = String(input)
        requests.push({ url, init })
        if (url.endsWith('/.well-known/openid-configuration')) return json(discovery())
        return json({ access_token: 'header.payload.rotated', refresh_token: 'refresh-2', expires_in: 3600, scope: 'openid ai:invoke' })
      },
    })

    const token = await client.refreshAccessToken('refresh-1')

    expect(token).toMatchObject({ accessToken: 'header.payload.rotated', refreshToken: 'refresh-2' })
    const form = requestBody(requests[1]?.init)
    expect(form.get('resource')).toBe(resource)
    expect(form.get('refresh_token')).toBe('refresh-1')
  })

  it('rejects discovery endpoints outside the issuer origin', async () => {
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async () => json(discovery({ authorization_endpoint: 'https://evil.example.test/authorize' })),
    })

    await expect(client.discovery()).rejects.toMatchObject({ code: 'DSN_PROTOCOL_ERROR' })
  })

  it('revokes the refresh token without exposing it outside the revocation request', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        const url = String(input)
        requests.push({ url, init })
        if (url.endsWith('/.well-known/openid-configuration')) {
          return json(discovery({ revocation_endpoint: `${issuer}/token/revocation` }))
        }
        return new Response(null, { status: 200 })
      },
    })

    await expect(client.revoke('refresh-secret', 'refresh_token')).resolves.toBe(true)
    const form = requestBody(requests[1]?.init)
    expect(form.get('token')).toBe('refresh-secret')
    expect(form.get('token_type_hint')).toBe('refresh_token')
    expect(form.get('client_id')).toBe('client-123')
  })

  it('maps invalid_grant during refresh to reauthentication', async () => {
    const client = new OidcClient({
      issuer,
      clientId: 'client-123',
      resource,
      scopes: ['openid', 'offline_access', 'ai:invoke'],
      timeoutMs: 1000,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith('/.well-known/openid-configuration')) return json(discovery())
        return json({ error: 'invalid_grant', error_description: 'expired' }, 400)
      },
    })

    await expect(client.refreshAccessToken('expired-refresh')).rejects.toMatchObject({ code: 'DSN_REAUTH_REQUIRED' })
  })
})
