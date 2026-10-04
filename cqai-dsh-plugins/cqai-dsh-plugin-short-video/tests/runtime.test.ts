import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { checkHealth, shortVideoEnvironment } from '../src/index.ts'

const mock = vi.hoisted(() => ({event: {python: true, ffmpeg: true} as Record<string, unknown>, calls: [] as Array<{bin: string; args: string[]; env: NodeJS.ProcessEnv}>}))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: (bin: string, args: string[], options: {env: NodeJS.ProcessEnv}) => {
    mock.calls.push({bin, args, env: options.env})
    const child = Object.assign(new EventEmitter(), {stdout: new EventEmitter(), kill() {}})
    queueMicrotask(() => {child.stdout.emit('data', Buffer.from('MPT_EVENT ' + JSON.stringify(mock.event))); child.emit('close', 0)})
    return child
  },
}))
vi.mock('cqai-dsh-plugin-media-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('cqai-dsh-plugin-media-runtime')>(), run: vi.fn(async () => {}),
  commonToolEnvironment: (home: string, base: NodeJS.ProcessEnv = process.env) => ({...base, CQAI_MEDIA_TOOLS_HOME: join(home, 'media-tools'), CQAI_FFMPEG: base.CQAI_FFMPEG || join(home, 'media-tools', 'ffmpeg')}),
}))
const roots: string[] = []
afterEach(async () => {mock.calls.length = 0; await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))})
describe('short-video common tool environment', () => {
  it('keeps transient keys and explicit overrides in the worker environment without changing their base object', () => {
    const root = join(tmpdir(), 'application-home', 'short-video')
    const base = {MPT_PEXELS_API_KEY: 'transient-test', IMAGEIO_FFMPEG_EXE: 'explicit-ffmpeg'}
    expect(shortVideoEnvironment(root, base)).toMatchObject({...base, MPT_DSH_DATA_ROOT: root, CQAI_MEDIA_TOOLS_HOME: join(dirname(root), 'media-tools')})
    expect(base).not.toHaveProperty('CQAI_MEDIA_TOOLS_HOME')
  })
  it('uses common tools for health and reports package readiness while retaining old python compatibility', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cqai-short-runtime-')); roots.push(home)
    const root = join(home, 'short-video'), runtime = join(home, 'source')
    await mkdir(join(root, 'engine'), {recursive: true}); await mkdir(join(runtime, 'mpt'), {recursive: true})
    await writeFile(join(runtime, 'mpt', 'uv.lock'), 'locked')
    await writeFile(join(root, 'engine', '.setup-lock'), createHash('sha256').update('locked').digest('hex'))
    mock.event = {python: true, ffmpeg: true}
    expect(await checkHealth(root, runtime)).toMatchObject({python: true, pythonPackages: true})
    expect(mock.calls[0].env).toMatchObject({MPT_DSH_DATA_ROOT: root, CQAI_MEDIA_TOOLS_HOME: join(home, 'media-tools'), CQAI_FFMPEG: join(home, 'media-tools', 'ffmpeg')})
    mock.event = {python: true, pythonPackages: false, ffmpeg: true}
    expect(await checkHealth(root, runtime)).toMatchObject({python: false, pythonPackages: false})
  })
  it.each([
    [{CQAI_FFMPEG: 'shared-ffmpeg'}, 'shared-ffmpeg'],
    [{CQAI_FFMPEG: 'shared-ffmpeg', FFMPEG_PATH: 'legacy-override'}, 'legacy-override'],
    [{CQAI_FFMPEG: 'shared-ffmpeg', IMAGEIO_FFMPEG_EXE: 'imageio-override'}, 'imageio-override'],
    [{}, 'private-fallback'],
  ])('resolves the bridge FFmpeg before importing the engine (%j)', (overrides, expected) => {
    const bridge = fileURLToPath(new URL('../runtime/bridge.py', import.meta.url))
    const code = 'import os, pathlib, sys, types\nsys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent))\nsys.modules["imageio_ffmpeg"] = types.SimpleNamespace(get_ffmpeg_exe=lambda: "private-fallback")\nsource = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").split("\\ndef send(", 1)[0]\nexec(compile(source, sys.argv[1], "exec"), {"__file__":sys.argv[1]})\nprint(os.environ["IMAGEIO_FFMPEG_EXE"], file=sys.__stdout__)'
    const env = {...process.env}
    delete env.CQAI_FFMPEG; delete env.FFMPEG_PATH; delete env.IMAGEIO_FFMPEG_EXE
    const child = spawnSync('python', ['-c', code, bridge], {env: {...env, ...overrides}, encoding: 'utf8', windowsHide: true, timeout: 10000})
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout.trim()).toBe(expected)
  })
})
