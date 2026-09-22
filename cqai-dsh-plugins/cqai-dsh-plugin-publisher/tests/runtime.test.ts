import { describe, expect, it } from 'vitest'
import { VERSION_PROBE } from '../src/runtime.ts'
import { fakeRuntime } from './fixture.ts'

/**
 * Upstream decides whether to run as a CLI with `argv.includes('cli')`. Anything
 * else — `--version` included — boots the whole GUI, which never exits, so the
 * runtime card's probe has to stay a CLI run. These lock both halves of that
 * down: the shape of the probe, and the fact that it only ever runs once.
 */
describe('the runtime version probe', () => {
  it('asks as a CLI run, because a bare flag would boot the GUI instead', () => {
    expect(VERSION_PROBE).toContain('cli')
  })

  it('reads the version out of the banner and never probes a second time', async () => {
    const fake = fakeRuntime([{stdout: ['', '0.11.3 -------', '[startup] 可用子命令: publish']}])
    try {
      expect(await fake.mm.status()).toMatchObject({ready: true, version: '0.11.3'})
      expect(fake.cli.calls).toHaveLength(1)
      expect(fake.cli.calls[0]).toEqual([...VERSION_PROBE])
      // The panel polls `status` every 2 s; a probe each time would boot Chromium
      // each time, so a memoized answer is the difference between usable and not.
      await fake.mm.status()
      expect(await fake.mm.version()).toBe('0.11.3')
      expect(fake.cli.calls).toHaveLength(1)
    } finally { fake.dispose() }
  })

  it('still reports the runtime as ready when the banner never arrives', async () => {
    // A runtime that dies before printing anything is a missing *version*, not a
    // missing runtime: the panel must not tell the user to reinstall.
    const fake = fakeRuntime([{silent: true}])
    try {
      expect(await fake.mm.status()).toMatchObject({ready: true, version: ''})
    } finally { fake.dispose() }
  })
})
