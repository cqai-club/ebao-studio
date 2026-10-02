import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { workbenchVisibilityScript, visibilityExportTransform, writeWorkbenchVisibilityConfig } from '../src/workbench-visibility.ts'

describe('Desktop workbench visibility adapter', () => {
  it('trusts only its embedding parent and pauses playback and keys while hidden', () => {
    const listeners = new Map<string, (event: any) => void>()
    const pause = vi.fn(), blur = vi.fn(), refresh = vi.fn(), postMessage = vi.fn()
    const parent = {postMessage}
    const window: any = {parent, __talkcraftRefreshExport: refresh, addEventListener: (name: string, callback: any) => listeners.set(name, callback)}
    const document = {referrer: 'http://127.0.0.1:3000/', activeElement: {blur}, querySelectorAll: () => [{pause}], addEventListener: (name: string, callback: any) => listeners.set(name, callback)}
    const playerPause = vi.fn()
    new Function('window', 'document', 'playerRef', workbenchVisibilityScript.replace("import { playerRef } from '/src/playerRef.ts';", ''))(window, document, {current: {pause: playerPause}})
    expect(postMessage).toHaveBeenCalledWith({type: 'talkcraft:ready'}, 'http://127.0.0.1:3000')
    const message = listeners.get('message')!
    message({source: {}, origin: 'http://127.0.0.1:3000', data: {type: 'talkcraft:visibility', active: false}})
    message({source: parent, origin: 'https://example.com', data: {type: 'talkcraft:visibility', active: false}})
    expect(pause).not.toHaveBeenCalled()
    message({source: parent, origin: 'http://127.0.0.1:3000', data: {type: 'talkcraft:visibility', active: false}})
    expect(playerPause).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(window.__talkcraftDesktopActive).toBe(false)
    const key = {preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()}
    listeners.get('keydown')!(key)
    expect(key.stopImmediatePropagation).toHaveBeenCalledOnce()
    message({source: parent, origin: 'http://127.0.0.1:3000', data: {type: 'talkcraft:visibility', active: true}})
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('suspends export progress reads without stopping server rendering', async () => {
    const original = 'timer = window.setInterval(async () => { await fetch("/api/export/id"); }, 1000);'
    const transformed = visibilityExportTransform(original, 'E:\\workbench\\src\\exportJob.ts')!
    let poll: () => Promise<void> = async () => {}
    const window: any = {__talkcraftDesktopActive: false, setInterval: (callback: any) => {poll = callback; return 1}}
    const fetch = vi.fn().mockResolvedValue({})
    new Function('window', 'fetch', `let timer; ${transformed}`)(window, fetch)
    await poll()
    expect(fetch).not.toHaveBeenCalled()
    window.__talkcraftDesktopActive = true
    await window.__talkcraftRefreshExport()
    expect(fetch).toHaveBeenCalledOnce()
    expect(visibilityExportTransform(original, '/src/other.ts')).toBeUndefined()
    expect(() => visibilityExportTransform('changed contract', '/src/exportJob.ts')).toThrow('接口已改变')
  })

  it('writes an adapter config outside the vendored workbench', () => {
    const directory = mkdtempSync(join(tmpdir(), 'talkcraft-visibility-'))
    try {
      const config = writeWorkbenchVisibilityConfig(directory, join(directory, 'upstream', 'workbench'))
      const source = readFileSync(config, 'utf8')
      expect(source).toContain('...upstream.plugins')
      expect(source).toContain('/@desktop/visibility.js')
      expect(config).toBe(join(directory, 'desktop-workbench.vite.mjs'))
    } finally {rmSync(directory, {recursive: true, force: true})}
  })
})
