import { describe, expect, it } from 'vitest'
import { SetupManager } from '../src/index.ts'

async function settled(manager: SetupManager): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (manager.snapshot().status !== 'running') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('setup did not settle')
}

describe('SetupManager', () => {
  it('skips ready steps and installs only missing steps', async () => {
    const calls: string[] = []
    const state = {uv: true, python: false, ffmpeg: false}
    const manager = new SetupManager(() => Object.entries(state).map(([id]) => ({
      id, label: id, ready: async () => state[id as keyof typeof state],
      run: async () => {calls.push(id);state[id as keyof typeof state] = true},
    })))
    manager.start();await settled(manager)
    expect(manager.snapshot().status).toBe('completed')
    expect(manager.snapshot().items.map(item => item.status)).toEqual(['ready', 'completed', 'completed'])
    expect(calls).toEqual(['python', 'ffmpeg'])
  })

  it('serializes duplicate clicks and retries failed items without repeating completed work', async () => {
    const calls: string[] = []
    let readyFirst = false, readySecond = false, fail = true
    const manager = new SetupManager(() => [
      {id: 'first', label: 'first', ready: async () => readyFirst, run: async () => {calls.push('first');readyFirst = true}},
      {id: 'second', label: 'second', ready: async () => readySecond, run: async () => {calls.push('second');if (fail) throw new Error('network interrupted');readySecond = true}},
    ])
    const initial = manager.start()
    expect(manager.start().updatedAt).toBe(initial.updatedAt)
    await settled(manager)
    expect(manager.snapshot().status).toBe('failed')
    expect(manager.snapshot().items[1].detail).toContain('network interrupted')
    fail = false;manager.start();await settled(manager)
    expect(calls).toEqual(['first', 'second', 'second'])
    expect(manager.snapshot().items.map(item => item.status)).toEqual(['ready', 'completed'])
  })

  it('rechecks actual readiness after application restart', async () => {
    let installed = false, calls = 0
    const steps = () => [{id: 'dependency', label: 'dependency', ready: async () => installed, run: async () => {calls++;installed = true}}]
    const first = new SetupManager(steps);first.start();await settled(first)
    const restarted = new SetupManager(steps);restarted.start();await settled(restarted)
    expect(restarted.snapshot().items[0].status).toBe('ready')
    expect(calls).toBe(1)
  })

  it('runs installation tasks from separate plugins one at a time', async () => {
    let active = 0, maximum = 0
    const create = (id: string) => new SetupManager(() => [{
      id, label: id, ready: async () => false,
      run: async () => {active++;maximum = Math.max(maximum, active);await new Promise(resolve => setTimeout(resolve, 15));active--},
    }])
    const shortVideo = create('short-video'), talkcraft = create('talkcraft')
    shortVideo.start();talkcraft.start()
    await Promise.all([settled(shortVideo), settled(talkcraft)])
    expect(maximum).toBe(1)
  })
})
