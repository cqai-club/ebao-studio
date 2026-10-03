import {describe, expect, it, vi} from 'vitest'
import type {Context} from '@deepseek-ai/cordis'
import {SlotCore} from '@deepseek-ai/dsh-client-ui-slots'
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client'
import {mountVideoWorkspace} from 'cqai-dsh-media-settings/client'
import type {EjianbaoUi} from 'cqai-dsh-media-settings/contracts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({Button: () => null, Input: () => null, Tag: () => null}))

function fixture() {
  const core = new SlotCore()
  core.register({name: 'root', children: {main: {kind: 'keyed', scope: 'root'}, 'sidebar.panellist': {kind: 'list', scope: 'root'}}}, (() => null) as never)
  const lifetime: (() => void)[] = []
  let optional: ((scope: Context) => void) | undefined
  let optionalCleanup: (() => void)[] = []
  const context = {
    slots: {
      register: core.register.bind(core),
      inject: (key: string, callback: () => () => void) => {
        let installed: (() => void) | undefined
        let epoch: number | undefined
        const reconcile = () => {const next = core.declarationEpoch(key); if (installed && next === epoch) return; installed?.(); installed = undefined; epoch = next; if (core.specDynamic(key)) installed = callback()}
        const unsubscribe = core.subscribeDeclaration(key, reconcile); reconcile()
        const dispose = () => {unsubscribe(); installed?.(); installed = undefined}
        lifetime.push(dispose); return dispose
      },
    },
    effect: (factory: () => (() => void)) => {const cleanup = factory(); lifetime.push(cleanup); return cleanup},
    inject: (_keys: string[], callback: (scope: Context) => void) => {optional = callback; lifetime.push(() => {optional = undefined; for (const cleanup of optionalCleanup.reverse()) cleanup(); optionalCleanup = []})},
    ejianbaoUi: undefined as EjianbaoUi | undefined,
  }
  const setUi = (service?: EjianbaoUi) => {
    for (const cleanup of optionalCleanup.reverse()) cleanup(); optionalCleanup = []
    context.ejianbaoUi = service
    if (!service || !optional) return
    optional({...context, effect: (factory: () => () => void) => {const cleanup = factory(); optionalCleanup.push(cleanup); return cleanup}} as unknown as Context)
  }
  return {core, ctx: context as unknown as Context, setUi, unload: () => {for (const dispose of lifetime.reverse()) dispose()}}
}

describe('public engine contributions', () => {
  it('keeps legacy main, removes and restores sidebar with the optional shell, and follows slot declaration lifetimes', () => {
    const {core, ctx, setUi, unload} = fixture()
    mountVideoWorkspace(ctx, {id: 'video', panelId: 'cqai-video' as MainPanelId, label: '数字人视频制作', order: 41, icon: () => null, component: () => null})
    expect(core.entriesOfSlot('main').map(entry => entry.options.key)).toEqual(['cqai-video'])
    expect(core.entriesOfSlot('sidebar.panellist').map(entry => entry.options.id)).toEqual(['cqai-video'])
    const declareShell = () => core.register({name: 'main', key: 'cqai-ejianbao', children: {'ejianbao.workspace': {kind: 'keyed', scope: 'root'}}}, (() => null) as never)
    let collapse = declareShell()
    expect(core.entriesOfSlot('ejianbao.workspace').map(entry => entry.options.key)).toEqual(['video'])
    setUi({open: vi.fn(), openSettings: vi.fn()})
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
    expect(core.entriesOfSlot('main').some(entry => entry.options.key === 'cqai-video')).toBe(true)
    setUi(undefined)
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(1)
    collapse()
    expect(core.specDynamic('ejianbao.workspace')).toBeUndefined()
    collapse = declareShell()
    expect(core.entriesOfSlot('ejianbao.workspace')).toHaveLength(1)
    setUi({open: vi.fn(), openSettings: vi.fn()}); unload(); setUi(undefined)
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
    expect(core.entriesOfSlot('main').some(entry => entry.options.key === 'cqai-video')).toBe(false)
    collapse()
  })
  it('rejects re-declaring main as an embedded child', () => {
    const {core} = fixture()
    expect(() => core.register({name: 'main', key: 'bad-shell', children: {main: {kind: 'keyed', scope: 'root'}}}, (() => null) as never)).toThrow()
  })
})
