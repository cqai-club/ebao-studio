import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { CQAI_PROVIDER } from '../src/llm-adapter.ts'
import { bindCqaiModelRoute } from '../src/route-registration.ts'
import type {
  DsnAccountService,
  DsnAccountSnapshot,
  DsnModelCatalog,
} from '../src/protocol.ts'

const signedIn: DsnAccountSnapshot = {
  state: 'signed-in',
  account: { userId: 7, platform: 'dsn' },
  refreshedAt: 1,
  stale: false,
}

function catalog(models: DsnModelCatalog['models']): DsnModelCatalog {
  return { models, fetchedAt: 1, stale: false }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('CQAI model route registration', () => {
  it('exposes the provider only while a signed-in account has a chat model', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const replace = vi.fn()
    const registration = Object.assign(vi.fn(), { replace })
    const registerAdapter = vi.fn(() => registration)
    const ctx = {
      llm: { registerAdapter },
      logger: { warn: vi.fn() },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
        return () => undefined
      },
    } as unknown as Context

    let currentSnapshot: DsnAccountSnapshot = { state: 'signed-out' }
    let currentCatalog = catalog([{
      id: 'deepseek/deepseek-v4-flash',
      ownedBy: 'cqai',
      categories: ['text'],
      supportedEndpointTypes: ['openai'],
    }])
    const account = {
      getStatus: vi.fn(async () => currentSnapshot),
      listModels: vi.fn(async () => currentCatalog),
    } as unknown as DsnAccountService

    bindCqaiModelRoute(ctx, account)
    await flushAsyncWork()

    expect(registerAdapter).toHaveBeenCalledWith([CQAI_PROVIDER], expect.anything())
    expect(replace).toHaveBeenLastCalledWith([])
    expect(account.listModels).not.toHaveBeenCalled()

    currentSnapshot = signedIn
    listeners.get('dsn-account/changed')?.(currentSnapshot)
    await flushAsyncWork()
    expect(replace).toHaveBeenLastCalledWith([CQAI_PROVIDER])

    currentCatalog = catalog([])
    listeners.get('dsn-account/models-updated')?.()
    await flushAsyncWork()
    expect(replace).toHaveBeenLastCalledWith([])

    currentSnapshot = { state: 'signed-out' }
    listeners.get('dsn-account/changed')?.(currentSnapshot)
    expect(replace).toHaveBeenLastCalledWith([])
  })
})
