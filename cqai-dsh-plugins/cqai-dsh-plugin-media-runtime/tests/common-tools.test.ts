import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMON_FFMPEG_VERSION, commonFFmpegDirectory, commonMediaPackage, commonToolEnvironment, installCommonMediaTools, sharedMediaTool, SetupManager } from '../src/index.ts'

const fake = vi.hoisted(() => ({calls: [] as {bin: string; args: string[]}[], failInstall: false, fullProbeFailures: 0}))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {...actual, spawn: (bin: string, args: string[], options: {cwd?: string}) => {
    fake.calls.push({bin, args})
    const child = new EventEmitter() as EventEmitter & {stdout: PassThrough; stderr: PassThrough; kill: () => boolean}
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true
    queueMicrotask(async () => {
      if (args[1] === 'ci') {
        const manifest = JSON.parse(await readFile(join(options.cwd!, 'package.json'), 'utf8')) as {dependencies: Record<string, string>}
        const packageName = Object.keys(manifest.dependencies)[0]
        const directory = join(options.cwd!, 'node_modules', packageName)
        await mkdir(directory, {recursive: true})
        await writeFile(join(directory, 'package.json'), JSON.stringify({version: COMMON_FFMPEG_VERSION}))
        for (const name of ['ffmpeg', 'ffprobe']) await writeFile(join(directory, process.platform === 'win32' ? `${name}.exe` : name), 'binary')
        child.emit('close', fake.failInstall ? 1 : 0)
      } else if (args[0] === 'pip') {
        const target = args[args.indexOf('--target') + 1]
        const directory = join(target, 'imageio_ffmpeg', 'binaries')
        await mkdir(directory, {recursive: true})
        const name = process.platform === 'win32' ? 'ffmpeg-win-x86_64-v7.1.exe' : process.platform === 'darwin' ? `ffmpeg-macos-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-v7.1` : `ffmpeg-linux-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-v7.0.2`
        await writeFile(join(directory, name), 'full ffmpeg binary')
        child.emit('close', 0)
      } else if (bin.includes('imageio_ffmpeg') && args[0] === '-version' && fake.fullProbeFailures > 0) {
        fake.fullProbeFailures--; child.emit('close', 1)
      } else child.emit('close', 0)
    })
    return child
  }}
})
const roots: string[] = []
async function home(): Promise<string> {const root = await mkdtemp(join(tmpdir(), 'cqai-common-tools-')); roots.push(root); return root}
afterEach(async () => {fake.calls = []; fake.failInstall = false; fake.fullProbeFailures = 0; await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))})

describe('shared media CLI tools', () => {
  it('selects supported pinned platform packages and rejects unknown platforms', () => {
    expect(commonMediaPackage('win32', 'x64')).toBe('@remotion/compositor-win32-x64-msvc')
    expect(commonMediaPackage('darwin', 'arm64')).toBe('@remotion/compositor-darwin-arm64')
    expect(commonMediaPackage('linux', 'x64', 'gnu')).toBe('@remotion/compositor-linux-x64-gnu')
    expect(commonMediaPackage('linux', 'arm64', 'musl')).toBe('@remotion/compositor-linux-arm64-musl')
    expect(() => commonMediaPackage('win32', 'arm64')).toThrow('暂不支持')
  })

  it('does not expose incomplete installs and resumes an interrupted installation', async () => {
    const root = await home()
    fake.failInstall = true
    await expect(installCommonMediaTools(root, () => {})).rejects.toThrow('退出码')
    expect(sharedMediaTool(root, 'ffmpeg')).toBeUndefined()
    expect(sharedMediaTool(root, 'ffprobe')).toBeUndefined()
    fake.failInstall = false
    await installCommonMediaTools(root, () => {})
    const binary = sharedMediaTool(root, 'ffmpeg')!
    expect(binary).toContain(join(root, 'media-tools', 'ffmpeg', COMMON_FFMPEG_VERSION))
    expect(existsSync(sharedMediaTool(root, 'ffprobe')!)).toBe(true)
    const lock = JSON.parse(await readFile(join(commonFFmpegDirectory(root), 'package-lock.json'), 'utf8'))
    const original = JSON.parse(readFileSync(new URL('../../cqai-dsh-plugin-talkcraft/upstream/runtime/remotion-lock.json', import.meta.url), 'utf8'))
    const dependency = `node_modules/${commonMediaPackage()}`
    expect(lock.packages[dependency].integrity).toBe(original.packages[dependency].integrity)
    expect(fake.calls.find(call => call.args[1] === 'ci')!.args).toContain('--ignore-scripts')
    const fullInstall = fake.calls.find(call => call.args[0] === 'pip')!
    expect(fullInstall.args).toContain('--require-hashes')
    expect(fullInstall.args).toContain('--reinstall')
    expect(fullInstall.args).toContain('--link-mode=copy')
    const requirements = await readFile(join(commonFFmpegDirectory(root), 'ffmpeg-requirements.txt'), 'utf8')
    expect(requirements).toContain('imageio_ffmpeg-0.6.0')
    const shortLock = await readFile(new URL('../../cqai-dsh-plugin-short-video/runtime/mpt/uv.lock', import.meta.url), 'utf8')
    expect(shortLock).toContain(requirements.match(/sha256:([a-f0-9]+)/)![1])
    expect(binary).toContain(join('imageio', 'imageio_ffmpeg', 'binaries'))
    const installs = fake.calls.filter(call => call.args[1] === 'ci').length
    await installCommonMediaTools(root, () => {})
    expect(fake.calls.filter(call => call.args[1] === 'ci')).toHaveLength(installs)
    const markerPath = join(commonFFmpegDirectory(root), '.media-tools-ready.json')
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    writeFileSync(markerPath, JSON.stringify({...marker, ffmpegPath: '../outside.exe'}))
    expect(sharedMediaTool(root, 'ffmpeg')).toBeUndefined()
    writeFileSync(markerPath, JSON.stringify(marker))
    // A package upgrade or incomplete replacement cannot silently satisfy the old marker.
    writeFileSync(join(commonFFmpegDirectory(root), 'node_modules', commonMediaPackage(), 'package.json'), JSON.stringify({version: '0.0.0'}))
    expect(sharedMediaTool(root, 'ffmpeg')).toBeUndefined()
  })

  it('shares one installation across simultaneous engine setup requests', async () => {
    const root = await home()
    const manager = () => new SetupManager(() => [{id: 'shared', label: 'shared', ready: async () => Boolean(sharedMediaTool(root, 'ffmpeg') && sharedMediaTool(root, 'ffprobe')), run: log => installCommonMediaTools(root, log)}])
    const first = manager(), second = manager(); first.start(); second.start()
    for (let attempt = 0; attempt < 100 && (first.snapshot().status === 'running' || second.snapshot().status === 'running'); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(first.snapshot().status).toBe('completed'); expect(second.snapshot().status).toBe('completed')
    expect(fake.calls.filter(call => call.args[1] === 'ci')).toHaveLength(1)
  })

  it('repairs an invalid extracted wheel cache once before reporting success', async () => {
    const root = await home(); fake.fullProbeFailures = 1
    await installCommonMediaTools(root, () => {})
    expect(fake.calls.filter(call => call.args[0] === 'pip')).toHaveLength(2)
    expect(fake.calls.find(call => call.args[0] === 'cache')?.args).toEqual(['cache', 'clean', 'imageio-ffmpeg'])
    expect(sharedMediaTool(root, 'ffmpeg')).toBeTruthy()
  })

  it('passes identical shared media paths to engines while respecting explicit overrides', async () => {
    const root = await home(); await installCommonMediaTools(root, () => {})
    const inherited = {PATH: 'unchanged', CUSTOM: 'keep'}
    const env = commonToolEnvironment(root, inherited)
    expect(env.CQAI_FFMPEG).toBe(sharedMediaTool(root, 'ffmpeg'))
    expect(env.CQAI_FFPROBE).toBe(sharedMediaTool(root, 'ffprobe'))
    expect(env).toMatchObject(inherited)
    expect(commonToolEnvironment(root, {...inherited, CQAI_FFMPEG: 'explicit'}).CQAI_FFMPEG).toBe('explicit')
    expect(inherited).toEqual({PATH: 'unchanged', CUSTOM: 'keep'})
  })
})
