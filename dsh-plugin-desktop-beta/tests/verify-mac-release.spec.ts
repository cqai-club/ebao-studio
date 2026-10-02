import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  verifyMacRelease,
  type MacReleaseVerificationOptions,
} from '../scripts/verify-mac-release.ts'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES } from '../scripts/mac-universal.ts'
import {
  PACKAGED_PUBLISHER_HELPER_RELATIVE_PATH,
  PUBLISHER_HELPER_UNIVERSAL_ENTRIES,
} from '../scripts/publisher-helper.ts'

function options(overrides: Partial<MacReleaseVerificationOptions> = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const removeMountPoint = vi.fn()
  const value: MacReleaseVerificationOptions = {
    distDir: '/release/dist',
    productName: '易宝工坊 Beta',
    listDmgs: () => ['/release/dist/e宝工坊-Beta-2.0.0-universal.dmg'],
    makeMountPoint: () => '/private/tmp/dsh-desktop-dmg-test',
    run: (command, args) => { calls.push({ command, args: [...args] }) },
    removeMountPoint,
    ...overrides,
  }
  return { calls, removeMountPoint, value }
}

describe('macOS release artifact verification', () => {
  it('mounts one DMG and verifies signature, Gatekeeper, and the stapled ticket', () => {
    const harness = options()
    const appPath = join('/private/tmp/dsh-desktop-dmg-test', '易宝工坊 Beta.app')
    const publisherHelperPath = join(appPath, PACKAGED_PUBLISHER_HELPER_RELATIVE_PATH)

    expect(verifyMacRelease(harness.value)).toEqual({
      appPath,
      dmgPath: '/release/dist/e宝工坊-Beta-2.0.0-universal.dmg',
    })

    expect(harness.calls).toEqual([
      {
        command: 'hdiutil',
        args: [
          'attach', '/release/dist/e宝工坊-Beta-2.0.0-universal.dmg',
          '-mountpoint', '/private/tmp/dsh-desktop-dmg-test', '-nobrowse', '-readonly',
        ],
      },
      {
        command: 'lipo',
        args: [join(appPath, 'Contents', 'MacOS', '易宝工坊 Beta'), '-verify_arch', 'x86_64'],
      },
      {
        command: 'lipo',
        args: [join(appPath, 'Contents', 'MacOS', '易宝工坊 Beta'), '-verify_arch', 'arm64'],
      },
      ...MACOS_UNIVERSAL_NATIVE_ENTRIES.flatMap(entry => {
        const nativePath = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', entry.path)
        return [
          { command: 'lipo', args: [nativePath, '-verify_arch', entry.arch] },
          ...(entry.path.endsWith('/bin/uv') ? [
            { command: '/bin/test', args: ['-x', nativePath] },
            ...(entry.arch === (process.arch === 'x64' ? 'x86_64' : process.arch)
              ? [{ command: nativePath, args: ['--version'] }]
              : []),
          ] : []),
        ]
      }),
      ...PUBLISHER_HELPER_UNIVERSAL_ENTRIES.flatMap(entry => [
        {
          command: 'lipo',
          args: [join(publisherHelperPath, entry), '-verify_arch', 'x86_64'],
        },
        {
          command: 'lipo',
          args: [join(publisherHelperPath, entry), '-verify_arch', 'arm64'],
        },
      ]),
      {
        command: 'codesign',
        args: ['--verify', '--deep', '--strict', '--verbose=2', publisherHelperPath],
      },
      {
        command: 'codesign',
        args: ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      },
      {
        command: 'spctl',
        args: ['--assess', '--type', 'execute', '--verbose=4', appPath],
      },
      {
        command: 'xcrun',
        args: ['stapler', 'validate', appPath],
      },
      {
        command: 'hdiutil',
        args: ['detach', '/private/tmp/dsh-desktop-dmg-test'],
      },
    ])
    expect(harness.removeMountPoint).toHaveBeenCalledWith('/private/tmp/dsh-desktop-dmg-test')
  })

  it('accepts the legacy filename with the renamed visible bundle identity', () => {
    const readBundleNames = vi.fn((path: string) => ({
      name: 'e宝工坊 Beta', displayName: path.endsWith('Info.plist') ? '易宝工坊 Beta' : 'e宝工坊 Beta',
    }))
    const harness = options({ displayName: 'e宝工坊 Beta', readBundleNames })

    expect(verifyMacRelease(harness.value).appPath).toContain('易宝工坊 Beta.app')
    expect(readBundleNames).toHaveBeenCalledWith(
      join('/private/tmp/dsh-desktop-dmg-test', '易宝工坊 Beta.app', 'Contents', 'Info.plist'),
    )
    for (const locale of ['en', 'zh_CN']) {
      expect(readBundleNames).toHaveBeenCalledWith(
        join('/private/tmp/dsh-desktop-dmg-test', '易宝工坊 Beta.app', 'Contents', 'Resources', `${locale}.lproj`, 'InfoPlist.strings'),
      )
    }
  })

  it.each(['name', 'displayName'] as const)('rejects an invalid raw %s and detaches the bundle', key => {
    const names = { name: 'e宝工坊 Beta', displayName: '易宝工坊 Beta', [key]: key === 'name' ? '易宝工坊 Beta' : 'e宝工坊 Beta' }
    const harness = options({ displayName: 'e宝工坊 Beta', readBundleNames: () => names })

    expect(() => verifyMacRelease(harness.value)).toThrow(AggregateError)
    expect(harness.calls.at(-1)).toEqual({
      command: 'hdiutil', args: ['detach', '/private/tmp/dsh-desktop-dmg-test'],
    })
    expect(harness.removeMountPoint).toHaveBeenCalledOnce()
  })

  it.each(['en', 'zh_CN'])('rejects missing or stale %s visible names and detaches', locale => {
    for (const failure of ['missing', 'name', 'displayName']) {
      const harness = options({ displayName: 'e宝工坊 Beta', readBundleNames: path => {
        if (path.includes(`${locale}.lproj`)) {
          if (failure === 'missing') throw new Error('missing localized names')
          return { name: 'e宝工坊 Beta', displayName: 'e宝工坊 Beta', [failure]: '易宝工坊 Beta' }
        }
        return { name: 'e宝工坊 Beta', displayName: path.endsWith('Info.plist') ? '易宝工坊 Beta' : 'e宝工坊 Beta' }
      } })

      expect(() => verifyMacRelease(harness.value)).toThrow(AggregateError)
      expect(harness.calls.at(-1)).toEqual({
        command: 'hdiutil', args: ['detach', '/private/tmp/dsh-desktop-dmg-test'],
      })
      expect(harness.removeMountPoint).toHaveBeenCalledOnce()
    }
  })

  it('rejects absent or ambiguous release images before mounting', () => {
    for (const dmgs of [[], ['/one.dmg', '/two.dmg']]) {
      const harness = options({ listDmgs: () => dmgs })
      expect(() => verifyMacRelease(harness.value)).toThrow(`found ${String(dmgs.length)}`)
      expect(harness.calls).toEqual([])
    }
  })

  it('detaches the image and preserves verification and cleanup failures', () => {
    const verifyFailure = new Error('Gatekeeper rejected the app')
    const detachFailure = new Error('detach failed')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'spctl') throw verifyFailure
        if (command === 'hdiutil' && args[0] === 'detach') throw detachFailure
      },
    })

    let caught: unknown
    try {
      verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([verifyFailure, detachFailure])
    expect(harness.removeMountPoint).toHaveBeenCalledOnce()
  })
})
