// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { Workspace, createWorkspaceNavigation } from '../src/client/index.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const {createElement} = await import('react')
  return {Button: ({variant: _variant, ...props}: Record<string, unknown>) => createElement('button', props), Input: (props: object) => createElement('input', props), Tag: ({tone: _tone, ...props}: Record<string, unknown>) => createElement('span', props)}
})
vi.mock('../src/client/Settings.tsx', () => ({Settings: () => createElement('div', {'data-test-settings': ''}, '公共设置')}))

let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); vi.restoreAllMocks(); vi.useRealTimers()})

async function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const ticks = new Map<string, number>()
  const mounts = new Map<string, number>()
  function Engine({id, active}: {id: string; active: boolean}) {
    const [draft, setDraft] = useState('')
    useEffect(() => {mounts.set(id, (mounts.get(id) || 0) + 1)}, [])
    useEffect(() => {if (!active) return; const timer = setInterval(() => ticks.set(id, (ticks.get(id) || 0) + 1), 1000); return () => clearInterval(timer)}, [active, id])
    return <div data-test-engine={id}><input aria-label={`${id}文案`} value={draft} onChange={event => setDraft(event.target.value)}/><input type="file" aria-label={`${id}文件`}/><iframe title={`${id}编辑器`} src="about:blank"/></div>
  }
  let roster = ['video', 'short-video', 'talkcraft']
  let listener: (() => void) | undefined
  const ctx = {slots: {subscribe: (_slot: string, next: () => void) => {listener = next; return () => {listener = undefined}}, entriesOfSlot: () => roster.map(key => ({options: {key}}))}} as unknown as Context
  const navigation = createWorkspaceNavigation(vi.fn())
  const renderSlot = ((_name: string, owner: {active: boolean}, options: {entryKey: string}) => createElement(Engine, {id: options.entryKey, active: owner.active})) as PropsRenderSlots<'ejianbao.workspace'>['renderSlot']
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<Workspace ctx={ctx} navigation={navigation} renderSlot={renderSlot}/>))
  return {ticks, mounts, navigation, setRoster: async (next: string[]) => {await act(async () => {roster = next; listener?.()})}}
}
async function click(label: string) {const button = [...container!.querySelectorAll('button')].find(button => button.textContent === label)!; await act(async () => button.click()); return button}

describe('e剪宝 workspace composition', () => {
  it('ignores legacy redirects during shell disposal and resumes after slot recreation', () => {
    const select = vi.fn()
    const navigation = createWorkspaceNavigation(select)
    navigation.service.open('talkcraft')
    navigation.deactivate()
    navigation.service.open('video')
    navigation.service.openSettings('short-video')
    expect(navigation.state.getSnapshot()).toEqual({workspace: 'talkcraft', settings: false})
    expect(select).toHaveBeenCalledTimes(1)
    navigation.activate()
    navigation.service.open('video')
    expect(select).toHaveBeenCalledTimes(2)
  })
  it('lazily mounts visited engines and retains draft, selected files and iframe while switching', async () => {
    const {mounts} = await fixture()
    expect(mounts.has('talkcraft')).toBe(false)
    const input = container!.querySelector<HTMLInputElement>('[aria-label="video文案"]')!
    await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '保留文案'); input.dispatchEvent(new Event('input', {bubbles: true}))})
    const fileInput = container!.querySelector<HTMLInputElement>('[aria-label="video文件"]')!
    const selectedFile = new File(['clip'], 'clip.mp4', {type: 'video/mp4'})
    Object.defineProperty(fileInput, 'files', {value: [selectedFile]})
    const iframe = container!.querySelector('iframe')!
    await click('短视频制作')
    expect(container!.querySelector('#ejianbao-workspace-video')!.hasAttribute('hidden')).toBe(true)
    await click('数字人视频制作')
    expect(container!.querySelector('[aria-label="video文案"]')).toBe(input)
    expect(input.value).toBe('保留文案')
    expect(fileInput.files![0]).toBe(selectedFile)
    expect(container!.querySelector('#ejianbao-workspace-video iframe')).toBe(iframe)
    expect(mounts.get('video')).toBe(1)
  })
  it('stops hidden page polling and restores the caller after shared settings', async () => {
    vi.useFakeTimers(); const {ticks} = await fixture()
    await act(async () => vi.advanceTimersByTime(1000)); expect(ticks.get('video')).toBe(1)
    await click('口播视频制作'); await act(async () => vi.advanceTimersByTime(2000))
    expect(ticks.get('video')).toBe(1); expect(ticks.get('talkcraft')).toBe(2)
    const before = container!.querySelector('#ejianbao-workspace-talkcraft iframe')
    const settingsButton = [...container!.querySelectorAll('button')].find(button => button.textContent === '设置')!; settingsButton.focus()
    await click('设置'); await act(async () => vi.advanceTimersByTime(1000))
    expect(ticks.get('talkcraft')).toBe(2); expect(container!.querySelector('[data-test-settings]')).not.toBeNull()
    await click('返回制作')
    expect(container!.querySelector('#ejianbao-tab-talkcraft')!.getAttribute('aria-selected')).toBe('true')
    expect(container!.querySelector('#ejianbao-workspace-talkcraft iframe')).toBe(before)
    expect(document.activeElement).toBe(settingsButton)
  })
  it('selects the first remaining engine on unload and marks unavailable tabs', async () => {
    const fixtureState = await fixture(); await click('口播视频制作')
    await fixtureState.setRoster(['short-video'])
    expect(fixtureState.navigation.state.getSnapshot().workspace).toBe('short-video')
    expect(container!.querySelector<HTMLButtonElement>('#ejianbao-tab-talkcraft')!.disabled).toBe(true)
    expect(container!.querySelector('#ejianbao-tab-talkcraft')!.textContent).toContain('未启用')
  })
})
