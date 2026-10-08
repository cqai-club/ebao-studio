// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import { SlotCore, resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null, Tag: () => null, StateDot: () => null,
}))

import { applyClubMcpClient } from '../src/client/mcp/index.tsx'
import { apply as applyExtensionClient } from '../src/client/index.tsx'

describe('CQAI Club extension MCP Client page', () => {
  it('registers navigation and its page together and removes both with its plugin lifetime', () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'cqaiclub.club.extension': { kind: 'list', scope: 'root' },
    } }, (_props: PropsRenderSlots<'cqaiclub.club.extension'>) => null)
    const disposers: Array<() => void> = []
    let language: 'zh' | 'en' = 'zh'
    const dictionaries: Record<string, Record<string, string>> = {}
    const ctx = {
      locale: {
        register: (namespace: string, values: { zh: Record<string, string>; en: Record<string, string> }) => {
          dictionaries.zh = values.zh
          dictionaries.en = values.en
          expect(namespace).toBe('cqaiclub-mcp')
          return () => undefined
        },
        bind: () => (key: string) => dictionaries[language]![key]!,
      },
      effect: (setup: () => () => void) => { disposers.push(setup()) },
      slots: {
        inject: (name: string, setup: () => () => void) => {
          expect(name).toBe('cqaiclub.club.extension')
          disposers.push(setup())
        },
        register: core.register.bind(core),
      },
      connection: { rpc: { call: vi.fn() } },
    } as unknown as Context
    applyClubMcpClient(ctx)
    const entries = core.entriesOfSlot('cqaiclub.club.extension')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'mcp', order: 40 })
    expect(entries[0]?.locale).toBe('cqaiclub-mcp')
    expect(resolveSlotLabel(entries[0]?.options.label)).toBe('MCP 服务')
    language = 'en'
    expect(resolveSlotLabel(entries[0]?.options.label)).toBe('MCP service')
    expect(ctx.connection.rpc.call).not.toHaveBeenCalled()
    for (const dispose of disposers.reverse()) dispose()
    expect(core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(0)
  })

  it('registers activities and MCP from one extension entry and removes both on its teardown', () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'cqaiclub.club.extension': { kind: 'list', scope: 'root' },
    } }, (_props: PropsRenderSlots<'cqaiclub.club.extension'>) => null)
    const disposers: Array<() => void> = []
    const dictionaries = new Map<string, Record<string, string>>()
    const ctx = {
      locale: {
        register: (namespace: string, values: { zh: Record<string, string> }) => {
          dictionaries.set(namespace, values.zh)
          return () => { dictionaries.delete(namespace) }
        },
        bind: (namespace: string) => (key: string) => dictionaries.get(namespace)![key]!,
      },
      effect: (setup: () => () => void) => { disposers.push(setup()) },
      slots: {
        inject: (name: string, setup: () => () => void) => {
          expect(name).toBe('cqaiclub.club.extension')
          disposers.push(setup())
        },
        register: core.register.bind(core),
      },
      connection: { rpc: { call: vi.fn() } },
    } as unknown as Context
    applyExtensionClient(ctx)
    expect(core.entriesOfSlot('cqaiclub.club.extension').map(entry => [entry.options.id, resolveSlotLabel(entry.options.label)])).toEqual([
      ['activities', '俱乐部活动'], ['mcp', 'MCP 服务'],
    ])
    expect(ctx.connection.rpc.call).not.toHaveBeenCalled()
    for (const dispose of disposers.reverse()) dispose()
    expect(core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(0)
    expect(dictionaries.size).toBe(0)
  })
})
