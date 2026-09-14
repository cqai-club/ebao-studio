import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { IMAGEGEN_MOUNT_CONFLICT_MESSAGE, installImagegenMountGuard } from '../src/imagegen-mount-guard.ts'

function context(runtimes: Array<{ name?: string; fibers: Array<{ uid: number | null }> }>) {
  const currentFiber = { uid: 1, runtime: runtimes[0] }
  let listener: ((fiber: { runtime?: { name?: string } }) => void) | undefined
  const dispose = vi.fn()
  return {
    ctx: {
      fiber: currentFiber,
      registry: { values: () => runtimes.values() },
      on: (_event: string, callback: typeof listener) => { listener = callback; return dispose },
    } as unknown as Context,
    publish: (fiber: { runtime?: { name?: string } }) => listener?.(fiber),
    dispose,
  }
}

describe('ImageGen mount guard', () => {
  it('rejects an already mounted legacy or duplicate imagegen before startup', () => {
    const fixture = context([
      { name: 'imagegen', fibers: [{ uid: 1 }] },
      { name: 'imagegen', fibers: [{ uid: 2 }] },
    ])
    expect(() => installImagegenMountGuard(fixture.ctx)).toThrow(IMAGEGEN_MOUNT_CONFLICT_MESSAGE)
  })

  it('vetoes a later imagegen publication but permits anonymous child effects', () => {
    const fixture = context([{ name: 'imagegen', fibers: [{ uid: 1 }] }])
    const release = installImagegenMountGuard(fixture.ctx)
    expect(() => fixture.publish({ runtime: {} })).not.toThrow()
    expect(() => fixture.publish({ runtime: { name: 'other' } })).not.toThrow()
    expect(() => fixture.publish({ runtime: { name: 'imagegen' } })).toThrow(IMAGEGEN_MOUNT_CONFLICT_MESSAGE)
    release()
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('ignores disposed historical fibers', () => {
    const fixture = context([
      { name: 'imagegen', fibers: [{ uid: 1 }] },
      { name: 'imagegen', fibers: [{ uid: null }] },
    ])
    expect(() => installImagegenMountGuard(fixture.ctx)).not.toThrow()
  })
})
