// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import clsx from 'clsx'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceFolderController,
  WorkspaceFolderError,
  WorkspaceFolderMenuItem,
  type WorkspaceFolderErrorProps,
  type WorkspaceFolderMenuProps,
  workspaceFolderEn,
  workspaceFolderZh,
} from '../src/client/workspace-folder.tsx'

// The published primitives entry also imports markdown/highlighting build-only
// dependencies that are absent from its npm runtime closure. Load the exact
// published menu/overlay regions instead, with real React and no CSS layout.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { readFileSync } = await import('node:fs')
  const { createRequire } = await import('node:module')
  const { dirname, join } = await import('node:path')
  const react = await import('react')
  const runtime = await import('react/jsx-runtime')
  const { createPortal } = await import('react-dom')
  const { default: clsx } = await import('clsx')
  const require = createRequire(import.meta.url)
  const source = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json')), 'lib/index.js'), 'utf8')
  const region = (from: string, to: string): string => {
    const start = source.indexOf(`//#region lib/types/${from}.js`)
    const end = source.indexOf(`//#region lib/types/${to}.js`, start)
    if (start < 0 || end < 0) throw new Error(`Published primitive regions changed: ${from}/${to}`)
    return source.slice(start, end)
  }
  const create = new Function('bindings', `
    const { Fragment, jsx, jsxs, createPortal, clsx, createElement, cloneElement, forwardRef,
      createContext, useContext, useSyncExternalStore, useRef, useState, useEffect,
      useLayoutEffect, useCallback, useMemo, useId } = bindings;
    const Fragment$1 = Fragment;
    const style = new Proxy({}, { get: (_target, key) => String(key) });
    const css$3 = style, css$12 = style, css$13 = style, css$14 = style,
      css$16 = style, css$17 = style, css$18 = style;
    ${region('icons/shared-artwork', 'StateDot')}
    ${region('Button', 'Pill')}
    ${region('overlay-top-margin', 'MenuGroup')}
    ${region('useAnchoredMaxHeight', 'RiskConfirmation')}
    return { Button, Menu, MenuItemButton, Modal, Tooltip, HoverCard,
      IconFolderOpenRegular, IconFolderCloseRegular, IconTriangleRightFillRegular,
      IconEditOutlineRegular, IconTrashOutlineRegular, IconEllipsisOutlineRegular,
      IconNewChatOutlineRegular };
  `)
  return create({ ...react, ...runtime, createPortal, clsx })
})

type Opener = ConstructorParameters<typeof WorkspaceFolderController>[0]
type OpenResult = Awaited<ReturnType<Opener['openWorkspacePath']>>
const WORKSPACE = 'workspace-folder-test' as WorkspaceId
const OTHER = 'workspace-other' as WorkspaceId
const PATH = '/Users/本地用户/工作区 空格/文章-发布确认功能验收'
const OPENED = { ok: true, value: { opened: true } } as const
const FAILED = {
  ok: false,
  error: Object.assign(new Error('private Host opener details'), {
    code: 'gateway/internal' as const, details: {}, isDSHRemoteError: true as const,
  }),
} as const

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(pathFor: (id: WorkspaceId) => string | undefined = () => PATH) {
  const canOpenWorkspacePath = vi.fn<Opener['canOpenWorkspacePath']>(async () => ({ ok: true, value: true }))
  const openWorkspacePath = vi.fn<Opener['openWorkspacePath']>(async () => OPENED)
  const controller = new WorkspaceFolderController({ canOpenWorkspacePath, openWorkspacePath }, pathFor)
  controllers.push(controller)
  return { controller, canOpenWorkspacePath, openWorkspacePath }
}

let root: Root | undefined
let container: HTMLDivElement | undefined
let controllers: WorkspaceFolderController[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Menus track native placement each frame. These tests inspect behavior,
  // not layout; keep the loop dormant while retaining all real menu effects.
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {}; unobserve() {}; disconnect() {} })
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  for (const controller of controllers) controller.dispose()
  controllers = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Desktop workspace folder controller', () => {
  it('resolves the current registered path exactly, including Chinese and spaces, without a Session', async () => {
    const pathFor = vi.fn((id: WorkspaceId) => id === WORKSPACE ? PATH : undefined)
    const { controller, openWorkspacePath } = setup(pathFor)
    await controller.refresh()
    await controller.open(WORKSPACE)
    expect(pathFor).toHaveBeenCalledExactlyOnceWith(WORKSPACE)
    expect(openWorkspacePath).toHaveBeenCalledExactlyOnceWith({ path: PATH }, expect.any(AbortSignal))
    expect(controller.getSnapshot()).toEqual({ available: true, opening: null, failed: null })
  })

  it('does not dispatch a stale workspace path when its registry row has disappeared', async () => {
    const { controller, openWorkspacePath } = setup(() => undefined)
    await controller.refresh()
    await controller.open(WORKSPACE)
    expect(openWorkspacePath).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toEqual({ available: true, opening: null, failed: WORKSPACE })
  })

  it('suppresses repeat activation and concurrent activation of a second workspace', async () => {
    const flight = deferred<OpenResult>()
    const { controller, openWorkspacePath } = setup()
    openWorkspacePath.mockReturnValueOnce(flight.promise)
    await controller.refresh()
    const opening = controller.open(WORKSPACE)
    await controller.open(WORKSPACE)
    await controller.open(OTHER)
    expect(openWorkspacePath).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().opening).toBe(WORKSPACE)
    flight.resolve(OPENED)
    await opening
    await controller.open(OTHER)
    expect(openWorkspacePath).toHaveBeenCalledTimes(2)
  })

  it.each(['result', 'rejection'] as const)('ignores an older capability %s after a newer refresh has completed', async failure => {
    const first = deferred<Awaited<ReturnType<Opener['canOpenWorkspacePath']>>>()
    const { controller, canOpenWorkspacePath, openWorkspacePath } = setup()
    canOpenWorkspacePath.mockReturnValueOnce(first.promise)
    const pending = controller.refresh()
    expect(controller.getSnapshot().available).toBeNull()
    await controller.open(WORKSPACE)
    expect(openWorkspacePath).not.toHaveBeenCalled()
    await controller.refresh()
    expect(controller.getSnapshot().available).toBe(true)
    if (failure === 'result') first.resolve({ ok: true, value: false })
    else first.reject(new Error('stale disconnect'))
    await pending
    expect(controller.getSnapshot().available).toBe(true)
  })

  it.each(['result', 'rejection'] as const)('recovers from an RPC %s and re-reads the current path on retry', async failure => {
    let currentPath = PATH
    const { controller, openWorkspacePath } = setup(() => currentPath)
    if (failure === 'result') openWorkspacePath.mockResolvedValueOnce(FAILED)
    else openWorkspacePath.mockRejectedValueOnce(new Error('assembly failed'))
    await controller.refresh()
    await controller.open(WORKSPACE)
    expect(controller.getSnapshot()).toEqual({ available: true, opening: null, failed: WORKSPACE })
    currentPath = '/Users/本地用户/重命名后 目录'
    await controller.open(WORKSPACE)
    expect(openWorkspacePath).toHaveBeenLastCalledWith({ path: currentPath }, expect.any(AbortSignal))
    expect(controller.getSnapshot().failed).toBeNull()
  })

  it.each(['unsupported', 'result', 'rejection'] as const)('does not call the opener when capability is %s', async failure => {
    const { controller, canOpenWorkspacePath, openWorkspacePath } = setup()
    if (failure === 'unsupported') canOpenWorkspacePath.mockResolvedValueOnce({ ok: true, value: false })
    else if (failure === 'result') canOpenWorkspacePath.mockResolvedValueOnce(FAILED)
    else canOpenWorkspacePath.mockRejectedValueOnce(new Error('Host disconnected'))
    await controller.open(WORKSPACE)
    await controller.refresh()
    await controller.open(WORKSPACE)
    expect(controller.getSnapshot().available).toBe(false)
    expect(openWorkspacePath).not.toHaveBeenCalled()
  })

  it('aborts an in-flight opener on disposal and ignores late failure and capability completions', async () => {
    const flight = deferred<OpenResult>()
    const capability = deferred<Awaited<ReturnType<Opener['canOpenWorkspacePath']>>>()
    const { controller, canOpenWorkspacePath, openWorkspacePath } = setup()
    await controller.refresh()
    openWorkspacePath.mockReturnValueOnce(flight.promise)
    canOpenWorkspacePath.mockReturnValueOnce(capability.promise)
    const listener = vi.fn()
    controller.subscribe(listener)
    const opening = controller.open(WORKSPACE)
    const refresh = controller.refresh()
    const signal = openWorkspacePath.mock.calls[0]![1]
    expect(signal?.aborted).toBe(false)
    controller.dispose()
    const snapshot = controller.getSnapshot()
    listener.mockClear()
    expect(signal?.aborted).toBe(true)
    flight.reject(new Error('cancelled'))
    capability.resolve({ ok: true, value: false })
    await Promise.all([opening, refresh])
    await controller.open(OTHER)
    expect(controller.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    expect(openWorkspacePath).toHaveBeenCalledOnce()
  })
})

type Owner = Pick<WorkspaceFolderMenuProps, 'workspaceId' | 'path' | 'displayTitle'>
type MenuState = ReturnType<WorkspaceFolderMenuProps['useMenuOpenState']>
interface RowProps {
  group: { key: string; workspaceId?: WorkspaceId; label: string; cwd?: string; expanded: boolean; containsCurrent: boolean }
  onToggle: () => void
  onCreate: () => void
  actions: { rename: () => void; delete: () => void }
  renderSlot: (name: string, owner: Owner, options: { hookContext: MenuState }) => ReactNode
  t: (key: string, values?: { name: string }) => string
}

/**
 * The published workspace client uses the ModuleLoader wrapper, so it has no
 * direct React row export. Execute its unchanged, installed ProjectRowItem
 * function with the published primitives. Only its CSS names and unmounted
 * workspace hover-card content are outside this harness; the menu, portal, keyboard
 * navigation, dismissal, event propagation and owner hook are real code.
 */
function loadPublishedWorkspaceRow(): ComponentType<RowProps> {
  const require = createRequire(import.meta.url)
  const source = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')), 'lib/client.js'), 'utf8')
  const start = source.indexOf('function ProjectRowItem(')
  const end = source.indexOf('\n\t\t/* v8 ignore next 3 -- closed-union backstop', start)
  if (start < 0 || end < 0) throw new Error('Published workspace row boundaries changed; update this mounted harness')
  const createRow = new Function('react', 'react_jsx_runtime', '_deepseek_ai_dsh_client_ui_primitives', 'Rows_module_css_default', 'clsx',
    `return (${source.slice(start, end).trim()})`)
  return createRow(React, jsxRuntime, primitives, new Proxy({}, { get: (_target, key) => String(key) }), clsx) as ComponentType<RowProps>
}
const PublishedWorkspaceRow = loadPublishedWorkspaceRow()

async function mount(controller: WorkspaceFolderController, locale: 'zh' | 'en' = 'zh', groupOverrides: Partial<RowProps['group']> = {}) {
  const copy = locale === 'zh' ? workspaceFolderZh : workspaceFolderEn
  const onToggle = vi.fn()
  const onCreate = vi.fn()
  const rename = vi.fn()
  const remove = vi.fn()
  const ownerCalls: Owner[] = []
  const props: RowProps = {
    group: { key: WORKSPACE, workspaceId: WORKSPACE, label: '验收文章工作区', cwd: PATH, expanded: true, containsCurrent: false, ...groupOverrides },
    onToggle, onCreate, actions: { rename, delete: remove },
    renderSlot: (name, owner, options) => {
      expect(name).toBe('sidebar.workspaces.workspace.menu.item')
      ownerCalls.push(owner)
      const itemProps = {
        ...owner, controller, useMenuOpenState: () => options.hookContext,
        t: (key: keyof typeof copy) => copy[key],
      } as WorkspaceFolderMenuProps
      return createElement(WorkspaceFolderMenuItem, { ...itemProps, key: 'desktop-open-workspace' })
    },
    t: (key, values) => {
      if (key === 'rename') return locale === 'zh' ? '重命名' : 'Rename'
      if (key === 'delete.workspace') return locale === 'zh' ? '删除工作区' : 'Delete workspace'
      if (key === 'actions.workspace.aria') return `${locale === 'zh' ? '工作区操作' : 'Workspace actions'}: ${values?.name}`
      return key
    },
  }
  const errorProps = { controller, t: (key: keyof typeof copy) => copy[key] } as WorkspaceFolderErrorProps
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(React.Fragment, {}, createElement(PublishedWorkspaceRow, props), createElement(WorkspaceFolderError, errorProps)))
  })
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="工作区操作"], button[aria-label^="Workspace actions"]')!
  return { trigger, ownerCalls, onToggle, onCreate, rename, remove, copy }
}

const menuItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button[role="menuitem"]'))
async function click(button: HTMLButtonElement) { await act(async () => { button.click() }) }
async function key(target: HTMLElement, keyValue: string) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true })) })
}

describe('Desktop action inside the published workspace row menu', () => {
  it.each(['zh', 'en'] as const)('renders first in %s, opens the registered folder, and closes without running other row actions', async locale => {
    const { controller, openWorkspacePath } = setup()
    await controller.refresh()
    const row = await mount(controller, locale)
    await click(row.trigger)
    expect(menuItems().map(item => item.textContent)).toEqual(locale === 'zh'
      ? ['打开工作区', '重命名', '删除工作区']
      : ['Open workspace', 'Rename', 'Delete workspace'])
    expect(row.ownerCalls.at(-1)).toEqual({ workspaceId: WORKSPACE, path: PATH, displayTitle: '验收文章工作区' })
    await click(menuItems()[0]!)
    expect(openWorkspacePath).toHaveBeenCalledExactlyOnceWith({ path: PATH }, expect.any(AbortSignal))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(row.onToggle).not.toHaveBeenCalled()
    expect(row.onCreate).not.toHaveBeenCalled()
    expect(row.rename).not.toHaveBeenCalled()
    expect(row.remove).not.toHaveBeenCalled()
  })

  it('keeps builtin rename and delete functional after composing the new first entry', async () => {
    const { controller, openWorkspacePath } = setup()
    await controller.refresh()
    const row = await mount(controller)
    await click(row.trigger)
    await click(menuItems()[1]!)
    expect(row.rename).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await click(row.trigger)
    await click(menuItems()[2]!)
    expect(row.remove).toHaveBeenCalledOnce()
    expect(row.onToggle).not.toHaveBeenCalled()
    expect(openWorkspacePath).not.toHaveBeenCalled()
  })

  it('joins the real menu keyboard walk and returns focus after Enter activation', async () => {
    const { controller, openWorkspacePath } = setup()
    await controller.refresh()
    const row = await mount(controller, 'en')
    row.trigger.focus()
    await click(row.trigger)
    await key(row.trigger, 'ArrowDown')
    expect(document.activeElement).toBe(menuItems()[0])
    await key(document.activeElement as HTMLElement, 'ArrowDown')
    expect(document.activeElement).toBe(menuItems()[1])
    await key(document.activeElement as HTMLElement, 'Home')
    const openItem = menuItems()[0]!
    expect(document.activeElement).toBe(openItem)
    // jsdom omits native button keyboard defaults. Dispatch real key events,
    // then supply the browser's default Enter click only if unprevented.
    act(() => {
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      openItem.dispatchEvent(enter)
      expect(enter.defaultPrevented).toBe(false)
      openItem.click()
      openItem.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    })
    // Native discrete-event commits precede the primitive's queued focus
    // return. Flush the event synchronously, then observe that microtask.
    await act(async () => { await Promise.resolve() })
    expect(openWorkspacePath).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(row.trigger)
  })

  it('keeps the menu available while an opener is in flight and blocks repeat clicks', async () => {
    const flight = deferred<OpenResult>()
    const { controller, openWorkspacePath } = setup()
    openWorkspacePath.mockReturnValueOnce(flight.promise)
    await controller.refresh()
    const row = await mount(controller)
    await click(row.trigger)
    const first = menuItems()[0]!
    await act(async () => { first.click(); first.click() })
    expect(openWorkspacePath).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await click(row.trigger)
    expect(menuItems()[0]?.disabled).toBe(true)
    expect(menuItems()[0]?.textContent).toBe('正在打开…')
    await click(menuItems()[0]!)
    expect(openWorkspacePath).toHaveBeenCalledOnce()
    await act(async () => { flight.resolve(OPENED) })
    expect(menuItems()[0]?.disabled).toBe(false)
  })

  it.each(['zh', 'en'] as const)('retains recoverable %s failure feedback after menu unmount and retries the current path', async locale => {
    let path = PATH
    const { controller, openWorkspacePath } = setup(() => path)
    openWorkspacePath.mockResolvedValueOnce(FAILED)
    await controller.refresh()
    const row = await mount(controller, locale)
    await click(row.trigger)
    await click(menuItems()[0]!)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(row.copy.error)
    expect(document.body.textContent).not.toContain('private Host opener details')
    const retry = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === row.copy.retry)
    expect(retry).toBeDefined()
    path = '/Users/本地用户/改名目录 新路径'
    await click(retry!)
    expect(openWorkspacePath).toHaveBeenLastCalledWith({ path }, expect.any(AbortSignal))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('hides the action when the Host has no native opener while retaining the builtin menu', async () => {
    const { controller, canOpenWorkspacePath, openWorkspacePath } = setup()
    canOpenWorkspacePath.mockResolvedValueOnce({ ok: true, value: false })
    await controller.refresh()
    const row = await mount(controller)
    await click(row.trigger)
    expect(menuItems().map(item => item.textContent)).toEqual(['重命名', '删除工作区'])
    expect(openWorkspacePath).not.toHaveBeenCalled()
  })

  it('disables retry while capability is refreshing or unavailable and recovers after reconnect', async () => {
    const capability = deferred<Awaited<ReturnType<Opener['canOpenWorkspacePath']>>>()
    const { controller, canOpenWorkspacePath, openWorkspacePath } = setup()
    openWorkspacePath.mockResolvedValueOnce(FAILED)
    await controller.refresh()
    const row = await mount(controller)
    await click(row.trigger)
    await click(menuItems()[0]!)
    const retry = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === row.copy.retry)!
    canOpenWorkspacePath.mockReturnValueOnce(capability.promise)
    let refresh!: Promise<void>
    await act(async () => { refresh = controller.refresh() })
    expect(retry().disabled).toBe(true)
    await click(retry())
    expect(openWorkspacePath).toHaveBeenCalledOnce()
    await act(async () => { capability.resolve({ ok: true, value: false }); await refresh })
    expect(retry().disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(row.copy.unavailable)
    await act(async () => { await controller.refresh() })
    expect(retry().disabled).toBe(false)
    await click(retry())
    expect(openWorkspacePath).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
