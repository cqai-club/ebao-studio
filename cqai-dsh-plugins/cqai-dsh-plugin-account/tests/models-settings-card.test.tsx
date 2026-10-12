// @vitest-environment jsdom

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DsnCategoryDefaultModels, DsnModel, DsnModelCatalog } from '../src/protocol.ts'

const rpc = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ children, disabled, onClick }: {
      children: ReactNode
      disabled?: boolean
      onClick?: () => void
    }) => createElement('button', { type: 'button', disabled, onClick }, children),
    StateDot: () => null,
    Tag: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  }
})
vi.mock('../src/client/rpc.ts', () => ({ rpcCall: rpc.call }))

import {
  CqaiModelsSettingsCard,
  modelsSettingsZh,
  type ModelsSettingsKey,
} from '../src/client/models-settings-card.tsx'

const ctx = {} as ClientContext
const selection = (model: string) => ({ provider: 'cqaiclub', model })
const textArchitecture = { inputModalities: ['text'], outputModalities: ['text'] }
const models: readonly DsnModel[] = [
  { id: 'chat-a', ownedBy: 'cqai', categories: ['text'], supportedEndpointTypes: ['openai'] },
  { id: 'image-a', ownedBy: 'cqai', categories: ['image'], supportedEndpointTypes: ['image-generation'] },
  {
    id: 'video-a', name: '晨光短片', ownedBy: 'cqai', categories: ['video'],
    supportedEndpointTypes: ['openai-video'], description: 'A cinematic video model',
  },
  { id: 'video-b', ownedBy: 'cqai', categories: ['video'], supportedEndpointTypes: ['openai-video'] },
  { id: 'video-metadata-only', ownedBy: 'cqai', categories: ['video'], supportedEndpointTypes: ['openai'] },
  {
    id: 'audio-a', ownedBy: 'cqai', categories: ['audio'], supportedEndpointTypes: [],
    architecture: { inputModalities: ['text'], outputModalities: ['speech'] },
  },
  {
    id: 'audio-b', ownedBy: 'cqai', categories: ['audio'], supportedEndpointTypes: [],
    architecture: { inputModalities: ['text'], outputModalities: ['speech'] },
  },
  {
    id: 'embedding-a', ownedBy: 'cqai', categories: ['other'], supportedEndpointTypes: ['embeddings'],
    architecture: textArchitecture,
  },
  {
    id: 'embedding-b', ownedBy: 'cqai', categories: ['other'], supportedEndpointTypes: ['embeddings'],
    architecture: textArchitecture,
  },
  {
    id: 'rank-a', ownedBy: 'cqai', categories: ['other'], supportedEndpointTypes: ['jina-rerank'],
    architecture: textArchitecture,
  },
  { id: 'unknown-a', ownedBy: 'cqai', categories: ['other'], supportedEndpointTypes: [] },
]

let root: Root | undefined
let container: HTMLDivElement | undefined

function defaults(): DsnCategoryDefaultModels {
  return {
    global: selection('chat-a'),
    categories: {
      image: selection('image-a'), video: selection('video-a'),
      audio: selection('audio-a'), embedding: selection('embedding-a'),
    },
  }
}

function accountRpc(options: {
  readonly refreshCatalog?: DsnModelCatalog
  readonly saveError?: Error
} = {}) {
  let currentDefaults = defaults()
  rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string, input: Record<string, unknown>) => {
    switch (endpoint) {
      case 'snapshot/get':
        return { state: 'signed-in', account: { userId: 1, platform: 'cqai' }, remainingQuota: 10 }
      case 'models/list':
        return input.refresh === true && options.refreshCatalog !== undefined
          ? options.refreshCatalog
          : { models, fetchedAt: Date.now(), stale: false }
      case 'models/default/get':
        return selection('chat-a')
      case 'models/category-defaults/get':
        return currentDefaults
      case 'models/category-defaults/set':
        if (options.saveError !== undefined) throw options.saveError
        currentDefaults = {
          ...currentDefaults,
          categories: { ...currentDefaults.categories, [String(input.category)]: selection(String(input.model)) },
        }
        return currentDefaults
      default:
        throw new Error(`Unexpected RPC: ${endpoint}`)
    }
  })
}

async function mount(translate: (key: ModelsSettingsKey) => string = key => key) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(CqaiModelsSettingsCard, { ctx, t: translate }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function listedIds() {
  return [...container!.querySelectorAll('article')].map(article => article.querySelector('strong')!.textContent)
}

function button(label: string) {
  const result = [...container!.querySelectorAll('button')].find(candidate => candidate.textContent?.startsWith(label))
  if (result === undefined) throw new Error(`Button not found: ${label}`)
  return result
}

function select(label: string) {
  const result = container!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (result === null) throw new Error(`Select not found: ${label}`)
  return result
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

async function search(query: string, label = 'modelsSearch') {
  const input = container!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (input === null) throw new Error(`Search not found: ${label}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function choose(label: string, model: string) {
  await act(async () => {
    const input = select(label)
    input.value = model
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('CQAI model settings', () => {
  it('keeps all catalog entries visible initially and intersects category filters with search', async () => {
    accountRpc()
    await mount()

    expect(listedIds()).toEqual(models.map(model => model.id))
    expect(button('modelsAll').getAttribute('aria-pressed')).toBe('true')
    expect(button('modelsAll').textContent).toContain(String(models.length))
    await click('modelCategoryVideo')
    expect(button('modelCategoryVideo').getAttribute('aria-pressed')).toBe('true')
    expect(button('modelsAll').getAttribute('aria-pressed')).toBe('false')
    expect(listedIds()).toEqual(['video-a', 'video-b', 'video-metadata-only'])
    await search('晨光')
    expect(listedIds()).toEqual(['video-a'])

    await click('modelCategoryAudio')
    expect(listedIds()).toEqual([])
    await click('modelsClearFilters')
    expect(listedIds()).toEqual(models.map(model => model.id))
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="modelsSearch"]')!.value).toBe('')
    expect(button('modelsAll').getAttribute('aria-pressed')).toBe('true')
  })

  it('recognizes endpoint-declared vectors and rerank models and searches translated Chinese categories', async () => {
    accountRpc()
    await mount(key => modelsSettingsZh[key])

    await click(modelsSettingsZh.modelCategoryEmbedding)
    expect(listedIds()).toEqual(['embedding-a', 'embedding-b'])
    await search(modelsSettingsZh.modelCategoryEmbedding, modelsSettingsZh.modelsSearch)
    expect(listedIds()).toEqual(['embedding-a', 'embedding-b'])
    await search('', modelsSettingsZh.modelsSearch)
    await click(modelsSettingsZh.modelCategoryRerank)
    expect(listedIds()).toEqual(['rank-a'])
    await click(modelsSettingsZh.modelCategoryOther)
    expect(listedIds()).toEqual(['unknown-a'])
  })

  it('limits default selectors to callable models while retaining catalog-only video entries', async () => {
    accountRpc()
    await mount()

    expect([...select('modelsVideoDefault').options].map(option => option.value)).toEqual(['', 'video-a', 'video-b'])
    expect([...select('modelsAudioDefault').options].map(option => option.value)).toEqual(['', 'audio-a', 'audio-b'])
    expect([...select('modelsEmbeddingDefault').options].map(option => option.value)).toEqual(['', 'embedding-a', 'embedding-b'])
    expect(listedIds()).toContain('video-metadata-only')
    expect([...select('modelsDefault').options].map(option => option.value)).toEqual(['', 'chat-a'])
  })

  it.each([
    ['video', 'modelsVideoDefault', 'video-a', 'video-b'],
    ['audio', 'modelsAudioDefault', 'audio-a', 'audio-b'],
    ['embedding', 'modelsEmbeddingDefault', 'embedding-a', 'embedding-b'],
  ])('saves the %s default through its category RPC', async (category, label, previous, next) => {
    accountRpc()
    await mount()
    expect(select(label).value).toBe(previous)

    await choose(label, next)

    expect(rpc.call).toHaveBeenCalledWith(ctx, 'models/category-defaults/set', { category, model: next })
    expect(select(label).value).toBe(next)
    expect(select('modelsDefault').value).toBe('chat-a')
  })

  it('retains the previous default and shows the error when a category save fails', async () => {
    accountRpc({ saveError: new Error('The audio model is unavailable') })
    await mount()

    await choose('modelsAudioDefault', 'audio-b')

    expect(select('modelsAudioDefault').value).toBe('audio-a')
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain('The audio model is unavailable')
    expect(select('modelsAudioDefault').disabled).toBe(false)
  })

  it('warns when refresh removes a saved default and when the catalog is stale', async () => {
    accountRpc({
      refreshCatalog: {
        models: models.filter(model => model.id !== 'video-a'),
        fetchedAt: Date.now(), stale: true, warning: 'Using the last available server catalog',
      },
    })
    await mount()
    expect(select('modelsVideoDefault').value).toBe('video-a')

    await click('modelsRefresh')

    expect(select('modelsVideoDefault').value).toBe('')
    expect(container!.textContent).toContain('modelsCategoryDefaultUnavailable')
    expect(container!.textContent).toContain('Using the last available server catalog')
    expect(listedIds()).not.toContain('video-a')
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'models/list', { refresh: true }, undefined)
  })
})
