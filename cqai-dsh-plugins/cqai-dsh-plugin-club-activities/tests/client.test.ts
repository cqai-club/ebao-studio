import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SlotCore, resolveSlotLabel, type PropsRenderSlots, type PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null, StateDot: () => null, Tag: () => null,
}))

import { apply, inject } from '../src/client/index.tsx'

/** Use the real slot ledger; only the account declaration and scoped effects are fixtures. */
function harness(core = new SlotCore()) {
  const disposers: (() => void)[] = []
  const injected: string[] = []
  const dictionaries = new Map<string, Record<string, Record<string, string>>>()
  let activeLocale = 'zh'
  const ctx = {
    locale: {
      bind: (namespace: string) => (key: string) => dictionaries.get(namespace)?.[activeLocale]?.[key] ?? key,
      register: (namespace: string, dicts: Record<string, Record<string, string>>) => {
        dictionaries.set(namespace, dicts)
        return () => { dictionaries.delete(namespace) }
      },
    },
    effect: (setup: () => (() => void)) => { const dispose = setup(); disposers.push(dispose); return dispose },
    slots: {
      inject: (name: string, setup: () => unknown) => {
        injected.push(name)
        if (!core.specDynamic(name)) throw new Error('Missing account club extension slot')
        return setup()
      },
      register: (options: unknown, component: unknown) => {
        const register = core.register.bind(core) as (options: unknown, component: unknown) => () => void
        const dispose = register(options, component)
        disposers.push(dispose)
        return dispose
      },
    },
  } as unknown as Context
  return {
    ctx, core, injected, dictionaries,
    setLocale: (locale: string) => { activeLocale = locale },
    dispose: () => { while (disposers.length) disposers.pop()!() },
  }
}

function declareAccount(core: SlotCore) {
  return core.register({
    name: 'root',
    children: { 'cqaiclub.club.extension': { kind: 'list', scope: 'root' } },
  }, (_props: PropsRuntime<'root'> & PropsRenderSlots<'cqaiclub.club.extension'>) => null)
}

describe('CQAI Club activities extension client', () => {
  it('contributes localized activities and MCP entries from one extension', () => {
    const fixture = harness()
    const disposeAccount = declareAccount(fixture.core)
    apply(fixture.ctx)

    expect(inject).toEqual(['slots', 'locale', 'connection'])
    expect(fixture.injected).toEqual(['cqaiclub.club.extension', 'cqaiclub.club.extension'])
    const entries = fixture.core.entriesOfSlot('cqaiclub.club.extension')
    expect(entries.map(entry => entry.options.id)).toEqual(['activities', 'mcp'])
    const entry = entries.find(entry => entry.options.id === 'activities')
    expect(entry).toMatchObject({ options: { id: 'activities', order: 30 }, locale: 'cqaiclub-activities' })
    expect(resolveSlotLabel(entry!.options.label)).toBe('俱乐部活动')
    fixture.setLocale('en')
    expect(resolveSlotLabel(entry!.options.label)).toBe('Club activities')
    expect(fixture.core.entriesOfSlot('cqaiclub.club.activities')).toHaveLength(0)

    fixture.dispose()
    disposeAccount()
  })

  it('removes its slot entry and dictionaries on disable and can register after re-enable', async () => {
    const fixture = harness()
    const disposeAccount = declareAccount(fixture.core)
    const changes = vi.fn()
    const unsubscribe = fixture.core.subscribe('cqaiclub.club.extension', changes)
    apply(fixture.ctx)
    await Promise.resolve()
    expect(fixture.core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(2)
    fixture.dispose()
    await Promise.resolve()
    expect(fixture.core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(0)
    expect(fixture.dictionaries.size).toBe(0)
    expect(fixture.core.spec('cqaiclub.club.extension')).toBeDefined()
    expect(changes).toHaveBeenCalledTimes(2)

    apply(fixture.ctx)
    expect(fixture.core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(2)
    fixture.dispose()
    unsubscribe()
    disposeAccount()
  })

  it('releases the content when the declaring account slot disappears', () => {
    const fixture = harness()
    const disposeAccount = declareAccount(fixture.core)
    apply(fixture.ctx)
    disposeAccount()
    expect(fixture.core.entriesOfSlot('cqaiclub.club.extension')).toHaveLength(0)
    expect(() => fixture.dispose()).not.toThrow()
  })
})
