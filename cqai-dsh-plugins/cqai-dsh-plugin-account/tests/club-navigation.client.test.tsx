// @vitest-environment jsdom

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { act, createElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ children }: { children: ReactNode }) => createElement('button', null, children),
    IconSettingsOutlineMedium: () => null,
    IconUserOutlineMedium: () => null,
    Menu: () => null,
    Modal: () => null,
    StateDot: () => null,
    Tag: () => null,
  }
})
vi.mock('../src/client/rpc.ts', () => ({ rpcCall: rpc.call }))

import { apply } from '../src/client/index.tsx'

let root: Root | undefined
let container: HTMLDivElement | undefined
let externalInput: HTMLInputElement | undefined

const labels: Record<string, string> = {
  title: 'CQAI Club', pointsInfo: '积分信息', membershipInfo: '会员信息',
  accountTab: '账户', billingTab: '充值',
}
const translate = (key: string) => labels[key] ?? key

async function mount(primaryDesktop = true) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  if (primaryDesktop) vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
  rpc.call.mockResolvedValue({ state: 'signed-out' })
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    'cqaiclub.club.extension': { kind: 'list', scope: 'root' },
    'cqaiclub.club.activities': { kind: 'list', scope: 'root' },
  } }, (_props: PropsRenderSlots<'cqaiclub.club.extension' | 'cqaiclub.club.activities'>) => null)
  const registrations: Array<{
    options: Record<string, unknown>
    render: (props: Record<string, unknown>) => ReactElement
  }> = []
  const ctx = {
    locale: { bind: () => translate, register: () => () => undefined },
    effect: (setup: () => unknown) => setup(),
    slots: {
      subscribe: (name: string, listener: () => void) => core.subscribe(name, listener),
      getVersion: (name: string) => core.getVersion(name),
      entriesOfSlot: (name: string) => core.entriesOfSlot(name),
      inject: (_name: string, setup: () => unknown) => setup(),
      register: (options: Record<string, unknown>, render: (props: Record<string, unknown>) => ReactElement) => {
        registrations.push({ options, render })
        return () => undefined
      },
    },
  } as unknown as ClientContext
  Object.assign(ctx, {
    inject: (_services: string[], setup: (scope: ClientContext) => unknown) => setup(Object.assign(Object.create(ctx), {
      layout: { selectPanel: vi.fn() },
    })),
  })
  apply(ctx)
  const page = registrations.find(entry => entry.options.name === (primaryDesktop ? 'main' : 'settings.section'))!
  const renderSlot = (name: string, owner: Record<string, unknown> = {}, options?: { only?: string }) => core.entriesOfSlot(name)
    .filter(entry => options?.only === undefined || entry.options.id === options.only)
    .map(entry => createElement(entry.component as ComponentType<Record<string, unknown>>, { ...owner, key: entry.options.id }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(page.render, {
      ...(page.options.inject as () => Record<string, unknown>)(), t: translate, renderSlot,
    }))
  })
  const register = (id: string, label: string, order: number) => core.register({
    name: 'cqaiclub.club.extension', id, label: () => label, order,
  }, () => createElement('div', null, `${label}内容`, createElement('input', { 'aria-label': `${label}输入` })))
  return { core, register }
}

function navigation() {
  return [...container!.querySelectorAll<HTMLButtonElement>('.cqai-club-section, button[role="tab"]')]
}

function button(label: string) {
  const found = navigation().find(element => element.textContent === label)
  if (found === undefined) throw new Error(`Navigation not found: ${label}`)
  return found
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  externalInput?.remove()
  externalInput = undefined
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('optional CQAI Club navigation lifecycle', () => {
  it('adds activities, plugins and MCP in declared order and removes every entry when the extension is disabled', async () => {
    const { register } = await mount()
    expect(navigation().map(element => element.textContent)).toEqual(['积分信息', '会员信息'])
    let remove!: () => void
    await act(async () => {
      const offMcp = register('mcp', 'MCP 服务', 40)
      const offPlugins = register('plugins', '俱乐部插件', 35)
      const offActivities = register('activities', '俱乐部活动', 30)
      remove = () => { offMcp(); offPlugins(); offActivities() }
    })
    expect(navigation().map(element => element.textContent)).toEqual(['积分信息', '会员信息', '俱乐部活动', '俱乐部插件', 'MCP 服务'])
    for (const label of ['俱乐部活动', '俱乐部插件', 'MCP 服务']) {
      await click(label)
      expect(container!.querySelector('.cqai-club-content')?.textContent).toBe(`${label}内容`)
    }
    await act(async () => { remove() })
    expect(navigation().map(element => element.textContent)).toEqual(['积分信息', '会员信息'])
    expect(button('积分信息').getAttribute('aria-current')).toBe('page')
    expect(container!.textContent).not.toContain('MCP 服务内容')
    expect(container!.textContent).not.toContain('活动插件未安装或未启用')
    await act(async () => {
      register('activities', '俱乐部活动', 30)
      register('plugins', '俱乐部插件', 35)
      register('mcp', 'MCP 服务', 40)
    })
    expect(navigation().map(element => element.textContent)).toEqual(['积分信息', '会员信息', '俱乐部活动', '俱乐部插件', 'MCP 服务'])
    expect(button('积分信息').getAttribute('aria-current')).toBe('page')
    await click('俱乐部插件')
    expect(container!.querySelector('.cqai-club-content')?.textContent).toBe('俱乐部插件内容')
    expect(rpc.call.mock.calls.every(([, endpoint]) => endpoint === 'snapshot/get')).toBe(true)
  })

  it.each(['navigation', 'page'] as const)('restores keyboard focus from removed extension %s to points', async location => {
    const { register } = await mount()
    let remove!: () => void
    await act(async () => { remove = register('plugins', '俱乐部插件', 35) })
    await click('俱乐部插件')
    const focused = location === 'navigation' ? button('俱乐部插件') : container!.querySelector<HTMLInputElement>('input[aria-label="俱乐部插件输入"]')!
    await act(async () => { focused.focus() })
    expect(document.activeElement).toBe(focused)
    await act(async () => { remove() })
    expect(document.activeElement).toBe(button('积分信息'))
    expect(button('积分信息').getAttribute('aria-current')).toBe('page')
  })

  it('keeps focus on a surviving page and on external settings while slot registrations change', async () => {
    const { register } = await mount()
    let removePlugins!: () => void
    let removeMcp!: () => void
    await act(async () => {
      removePlugins = register('plugins', '俱乐部插件', 35)
      removeMcp = register('mcp', 'MCP 服务', 40)
    })
    await click('俱乐部插件')
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="俱乐部插件输入"]')!
    await act(async () => { input.focus() })
    await act(async () => { removeMcp() })
    expect(document.activeElement).toBe(input)
    expect(button('俱乐部插件').getAttribute('aria-current')).toBe('page')
    externalInput = document.createElement('input')
    document.body.append(externalInput)
    await act(async () => { externalInput!.focus() })
    await act(async () => { removePlugins() })
    expect(document.activeElement).toBe(externalInput)
    expect(button('积分信息').getAttribute('aria-current')).toBe('page')
  })

  it('restores focus to the account tab when Next removes a focused extension page', async () => {
    const { register } = await mount(false)
    let remove!: () => void
    await act(async () => { remove = register('mcp', 'MCP 服务', 40) })
    await click('MCP 服务')
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="MCP 服务输入"]')!
    await act(async () => { input.focus() })
    await act(async () => { remove() })
    expect(navigation().map(element => element.textContent)).toEqual(['账户'])
    expect(document.activeElement).toBe(button('账户'))
    expect(button('账户').getAttribute('aria-selected')).toBe('true')
  })
})
