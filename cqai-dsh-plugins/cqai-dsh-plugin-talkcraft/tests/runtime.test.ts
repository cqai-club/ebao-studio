import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMON_FFMPEG_VERSION, commonMediaPackage } from 'cqai-dsh-plugin-media-runtime'
import { ffmpegExecutable, health, pythonExecutable, remotionCompositorExecutable } from '../src/runtime.ts'
import { sharedMediaBinary } from '../upstream/scripts/common_media_tools.mjs'

vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {...original, spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()})
    queueMicrotask(() => child.emit('close', 0))
    return child
  })}
})

const roots: string[] = []
const write = (path: string, value = 'fixture') => {mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, value); return path}
const binaryName = (name: string) => `${name}${process.platform === 'win32' ? '.exe' : ''}`
const platformPackage = commonMediaPackage().slice('@remotion/'.length)
const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'talkcraft-tools-')); roots.push(home)
  const snapshot = join(home, 'talkcraft', 'runtime', 'v1-test')
  const upstream = join(snapshot, 'upstream')
  const native = join(upstream, 'runtime', 'node_modules', '@remotion', platformPackage)
  const shared = join(home, 'media-tools', 'ffmpeg', COMMON_FFMPEG_VERSION)
  const common = join(shared, 'node_modules', '@remotion', platformPackage)
  const ffmpegName = `ffmpeg-${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'linux' ? 'v7.0.2' : 'v7.1'}${process.platform === 'win32' ? '.exe' : ''}`
  const ffmpegPath = `imageio/imageio_ffmpeg/binaries/${ffmpegName}`
  const commonFfmpeg = write(join(shared, ffmpegPath))
  write(join(common, 'package.json'), JSON.stringify({name: `@remotion/${platformPackage}`, version: COMMON_FFMPEG_VERSION}))
  const commonFfprobe = process.platform === 'darwin' ? write(join(shared, 'bin', 'ffprobe'), `#!/bin/sh\nDYLD_LIBRARY_PATH='${common}' exec '${join(common, 'ffprobe')}' "$@"\n`) : join(common, binaryName('ffprobe'))
  const marker = {version: COMMON_FFMPEG_VERSION, package: `@remotion/${platformPackage}`, ffmpegProvider: 'imageio-ffmpeg@0.6.0', ffmpegPath, ffprobePath: process.platform === 'darwin' ? 'bin/ffprobe' : `node_modules/@remotion/${platformPackage}/${binaryName('ffprobe')}`}
  write(join(shared, '.media-tools-ready.json'), JSON.stringify(marker))
  for (const name of ['ffmpeg', 'ffprobe']) {write(join(common, binaryName(name))); write(join(native, binaryName(name)))}
  write(join(native, binaryName('remotion')))
  return {home, snapshot, upstream, native, shared, common, commonFfmpeg, commonFfprobe, marker}
}

afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})

describe('shared ordinary media tools and isolated Remotion natives', () => {
  it('prefers a published shared tool without redirecting native compositor resolution', () => {
    const f = fixture()
    expect(ffmpegExecutable(f.upstream, 'ffmpeg', f.home)).toBe(f.commonFfmpeg)
    expect(ffmpegExecutable(f.upstream, 'ffprobe', f.home)).toBe(f.commonFfprobe)
    expect(remotionCompositorExecutable(f.upstream, 'ffmpeg')).toBe(join(f.native, binaryName('ffmpeg')))
    expect(remotionCompositorExecutable(f.upstream, 'remotion')).toBe(join(f.native, binaryName('remotion')))
  })

  it('falls back to the legacy runtime while the shared installation is incomplete', () => {
    const f = fixture()
    rmSync(join(f.shared, '.media-tools-ready.json'))
    expect(ffmpegExecutable(f.upstream, 'ffmpeg', f.home)).toBe(join(f.native, binaryName('ffmpeg')))
    expect(sharedMediaBinary('ffmpeg', f.snapshot, {})).toBeUndefined()
    write(join(f.shared, '.media-tools-ready.json'), JSON.stringify({...f.marker, version: 'wrong-version'}))
    expect(ffmpegExecutable(f.upstream, 'ffprobe', f.home)).toBe(join(f.native, binaryName('ffprobe')))
    expect(sharedMediaBinary('ffprobe', f.snapshot, {})).toBeUndefined()
  })

  it('honors explicit ordinary tool paths without affecting the native renderer', () => {
    const f = fixture()
    const explicit = write(join(f.home, 'custom-ffmpeg'))
    const env = {CQAI_FFMPEG: explicit, CQAI_FFPROBE: join(f.home, 'missing-ffprobe')}
    expect(ffmpegExecutable(f.upstream, 'ffmpeg', f.home, env)).toBe(explicit)
    expect(ffmpegExecutable(f.upstream, 'ffprobe', f.home, env)).toBe(f.commonFfprobe)
    expect(remotionCompositorExecutable(f.upstream, 'ffmpeg')).toBe(join(f.native, binaryName('ffmpeg')))
  })

  it('rejects a missing shared binary and still reports a missing private native tool', () => {
    const f = fixture()
    rmSync(join(f.common, binaryName('ffprobe')))
    expect(ffmpegExecutable(f.upstream, 'ffprobe', f.home)).toBe(join(f.native, binaryName('ffprobe')))
    rmSync(join(f.native, binaryName('ffprobe')))
    expect(() => ffmpegExecutable(f.upstream, 'ffprobe', f.home)).toThrow('ffprobe')
  })

  it('does not let healthy shared FFmpeg hide an absent private renderer', async () => {
    const f = fixture()
    write(join(f.upstream, 'runtime', 'node_modules', 'remotion', 'package.json'), '{}')
    write(join(f.upstream, 'runtime', 'node_modules', 'vite', 'package.json'), '{}')
    write(pythonExecutable(f.upstream))
    const complete = await health(f.upstream, undefined, f.home)
    expect(complete.pythonPackages).toBe(true)
    expect(complete.python).toBe(complete.pythonPackages)
    expect(complete.remotionCompositor).toBe(true)
    expect(complete.remotion).toBe(true)
    rmSync(join(f.native, binaryName('remotion')))
    const broken = await health(f.upstream, undefined, f.home)
    expect(broken.ffmpeg).toBe(true)
    expect(broken.ffprobe).toBe(true)
    expect(broken.remotionCompositor).toBe(false)
    expect(broken.remotion).toBe(false)
  })

  it('uses the same published shared path in the owned segment-rendering adapter', () => {
    const f = fixture()
    expect(sharedMediaBinary('ffmpeg', f.snapshot, {})).toBe(f.commonFfmpeg)
    expect(sharedMediaBinary('ffprobe', undefined, {DSH_HOME: f.home})).toBe(f.commonFfprobe)
    const explicit = write(join(f.home, 'explicit-ffmpeg'))
    expect(sharedMediaBinary('ffmpeg', f.snapshot, {CQAI_FFMPEG: explicit})).toBe(explicit)
    expect(existsSync(remotionCompositorExecutable(f.upstream, 'remotion'))).toBe(true)
  })

  it('rejects an obsolete provider and paths escaping the fixed imageio binary directory', () => {
    const f = fixture()
    for (const invalid of [
      {...f.marker, ffmpegProvider: 'compositor'},
      {...f.marker, ffmpegPath: '../ffmpeg'},
      {...f.marker, ffmpegPath: 'imageio/imageio_ffmpeg/binaries/../../ffmpeg'},
      {...f.marker, ffmpegPath: 'imageio/imageio_ffmpeg/binaries/ffmpeg-test/child.exe'},
    ]) {
      write(join(f.shared, '.media-tools-ready.json'), JSON.stringify(invalid))
      expect(sharedMediaBinary('ffmpeg', f.snapshot, {})).toBeUndefined()
      expect(sharedMediaBinary('ffprobe', f.snapshot, {})).toBeUndefined()
      expect(ffmpegExecutable(f.upstream, 'ffmpeg', f.home)).toBe(join(f.native, binaryName('ffmpeg')))
    }
  })
})
