import { describe, expect, it } from 'vitest'

import { AccountServiceClient } from '../src/account-service.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const account = { userId: 42, platform: 'dsn', tokenId: 'token-1', quota: 100, quotaUsed: 20 }

describe('AccountServiceClient', () => {
  it('reads the public account with a bearer token', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const client = new AccountServiceClient('https://account.example.test', async (input, init) => {
      seenUrl = String(input)
      seenInit = init
      return json({ success: true, data: account })
    })

    await expect(client.getAccount('access-secret')).resolves.toEqual(account)
    expect(seenUrl).toBe('https://account.example.test/api/account')
    expect(new Headers(seenInit?.headers).get('authorization')).toBe('Bearer access-secret')
    expect(seenInit?.credentials).toBe('omit')
  })

  it('strips caller authentication and browser identity headers before fetchAi', async () => {
    let seenInit: RequestInit | undefined
    const client = new AccountServiceClient('https://account.example.test', async (_input, init) => {
      seenInit = init
      return new Response('ok', { status: 200 })
    })

    await client.fetchAi('access-secret', '/v1/models', {
      headers: {
        Authorization: 'Bearer caller-token',
        Origin: 'https://evil.example.test',
        Cookie: 'session=secret',
        'X-Request-ID': 'request-1',
      },
    })

    const headers = new Headers(seenInit?.headers)
    expect(headers.get('authorization')).toBe('Bearer access-secret')
    expect(headers.get('origin')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('x-request-id')).toBe('request-1')
    expect(seenInit?.credentials).toBe('omit')
  })

  it('reads and normalizes the Account Service model catalog', async () => {
    const client = new AccountServiceClient('https://account.example.test', async () => json({
      success: true,
      data: [
        {
          id: 'vision-model',
          owned_by: 'relay',
          vendor: 'CQAI',
          description: 'A multimodal model',
          icon: 'cqai',
          categories: ['text', 'text-multimodal', 'text'],
          supported_endpoint_types: ['openai', 'openai-response'],
        },
        {
          id: 'legacy-model',
          owned_by: 'legacy',
          supported_endpoint_types: [],
        },
      ],
    }))

    await expect(client.getModels('access-secret')).resolves.toEqual([
      {
        id: 'vision-model',
        ownedBy: 'relay',
        vendor: 'CQAI',
        description: 'A multimodal model',
        icon: 'cqai',
        categories: ['text', 'text-multimodal'],
        supportedEndpointTypes: ['openai', 'openai-response'],
      },
      {
        id: 'legacy-model',
        ownedBy: 'legacy',
        categories: ['other'],
        supportedEndpointTypes: [],
      },
    ])
  })

  it('reads billing options and sends only the typed top-up payload', async () => {
    const requests: Request[] = []
    const client = new AccountServiceClient('https://account.example.test', async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.endsWith('/api/billing/topup/info')) {
        return json({
          success: true,
          data: {
            payment_options: [
              { id: 'card', name: 'Stripe', kind: 'amount', min_top_up: 10 },
              { id: 'package', name: 'Creem', kind: 'product', products: [{ id: 'starter', name: 'Starter', price: 5, currency: 'USD', quota: 1000 }] },
            ],
            amount_options: [10, 20],
            min_top_up: 10,
          },
        })
      }
      if (request.url.includes('/api/billing/topups?')) {
        return json({ success: true, data: { page: 2, page_size: 5, total: 1, items: [{ id: 9, money: 10, trade_no: 'trade-9', status: 'pending' }] } })
      }
      return json({ success: true, data: { payment_url: 'https://pay.example/checkout', payment_fields: { token: 'form-token' }, order_id: 'order-9' } })
    })

    await expect(client.getTopUpInfo('access-secret')).resolves.toEqual({
      paymentOptions: [
        { id: 'card', name: 'Stripe', kind: 'amount', minTopUp: 10 },
        { id: 'package', name: 'Creem', kind: 'product', products: [{ id: 'starter', name: 'Starter', price: 5, currency: 'USD', quota: 1000 }] },
      ],
      amountOptions: [10, 20],
      minTopUp: 10,
    })
    await expect(client.listTopUps('access-secret', { page: 2, pageSize: 5, keyword: 'trade' })).resolves.toEqual({
      page: 2,
      pageSize: 5,
      total: 1,
      items: [{ id: 9, money: 10, tradeNo: 'trade-9', status: 'pending' }],
    })
    await expect(client.createTopUp('access-secret', {
      paymentOptionId: 'card',
      amount: 10,
    })).resolves.toEqual({
      paymentUrl: 'https://pay.example/checkout',
      paymentFields: { token: 'form-token' },
      orderId: 'order-9',
    })

    expect(requests[1]?.url).toBe('https://account.example.test/api/billing/topups?page=2&page_size=5&keyword=trade')
    expect(requests[2]?.method).toBe('POST')
    expect(requests[2]?.headers.get('authorization')).toBe('Bearer access-secret')
    expect(requests[2]?.headers.get('origin')).toBeNull()
    expect(requests[2]?.headers.get('cookie')).toBeNull()
    expect(JSON.parse(await requests[2]!.text())).toEqual({ payment_option_id: 'card', amount: 10 })
  })

  it('rejects malformed model catalog payloads', async () => {
    const client = new AccountServiceClient('https://account.example.test', async () => json({
      success: true,
      data: [{ id: 'broken', owned_by: 'relay', categories: 'text' }],
    }))

    await expect(client.getModels('access-secret')).rejects.toMatchObject({
      code: 'DSN_PROTOCOL_ERROR',
    })
  })

  it('rejects paths outside the AI gateway namespace, including normalized traversal', async () => {
    const client = new AccountServiceClient('https://account.example.test')

    await expect(client.fetchAi('access-secret', '/api/client-credential' as `/v1/${string}`)).rejects.toThrow('not allowed')
    await expect(client.fetchAi('access-secret', '/v1/../api/account' as `/v1/${string}`)).rejects.toThrow('not allowed')
  })

  it.each([
    [401, {}, 'DSN_REAUTH_REQUIRED'],
    [403, { code: 'AUTH_CLIENT_FORBIDDEN' }, 'DSN_CLIENT_FORBIDDEN'],
    [403, { code: 'AUTH_SCOPE_FORBIDDEN' }, 'DSN_SCOPE_FORBIDDEN'],
    [503, { message: 'temporarily down' }, 'DSN_ACCOUNT_UNAVAILABLE'],
  ] as const)('maps Account Service %s errors to %s', async (status, body, code) => {
    const client = new AccountServiceClient('https://account.example.test', async () => json(body, status))
    await expect(client.getAccount('access-secret')).rejects.toMatchObject({ code })
  })

  it('keeps a temporary upstream failure retryable when the body is not JSON', async () => {
    const client = new AccountServiceClient('https://account.example.test', async () => new Response('<html>busy</html>', { status: 503 }))
    await expect(client.getAccount('access-secret')).rejects.toMatchObject({
      code: 'DSN_ACCOUNT_UNAVAILABLE',
      retryable: true,
    })
  })
})
