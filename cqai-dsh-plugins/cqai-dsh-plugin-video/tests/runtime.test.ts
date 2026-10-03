import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkVideoHealth, createVideoHealth, createVideoSetup, privatePython, videoEnvironment, videoPython, videoRuntime } from '../src/runtime.ts'
import { JobStore } from '../src/jobs.ts'

const tools = vi.hoisted(() => ({run: vi.fn(), python: vi.fn(async () => ({python: '3.11', managed: true})), steps: vi.fn(() => [])}))
vi.mock('cqai-dsh-plugin-media-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('cqai-dsh-plugin-media-runtime')>(),
  commonToolSteps: tools.steps, python311: tools.python, run: tools.run,
  commonToolEnvironment: (home: string, base: NodeJS.ProcessEnv = process.env) => ({...base, CQAI_MEDIA_TOOLS_HOME: join(home, 'media-tools'), CQAI_FFMPEG: base.CQAI_FFMPEG || join(home, 'media-tools', 'ffmpeg'), CQAI_FFPROBE: base.CQAI_FFPROBE || join(home, 'media-tools', 'ffprobe')}),
}))
const roots: string[] = []
afterEach(async () => {vi.unstubAllEnvs(); vi.clearAllMocks(); tools.run.mockReset(); await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))})
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'cqai-video-runtime-')); roots.push(home)
  const runtime = join(home, 'source'); await mkdir(runtime)
  await writeFile(join(runtime, 'requirements.txt'), 'numpy>=1.24,<3\nimageio-ffmpeg>=0.5,<1\n')
  return {home, runtime}
}
describe('video common tools and private packages', () => {
  it('selects the physical unpacked runtime and preserves source-tree and explicit overrides', async () => {
    const {home, runtime} = await fixture()
    expect(videoRuntime(runtime, {})).toBe(runtime)
    const archived = join(home, 'app.asar', 'node_modules', 'cqai-dsh-plugin-video', 'runtime')
    expect(videoRuntime(archived, {})).toBe(archived)
    const unpacked = join(home, 'app.asar.unpacked', 'node_modules', 'cqai-dsh-plugin-video', 'runtime')
    await mkdir(unpacked, {recursive: true})
    await writeFile(join(unpacked, 'runner.py'), 'import json, sys\nprint(json.dumps({"python": True, "runtimeFile": __file__}))\n')
    const selected = videoRuntime(archived, {})
    expect(selected).toBe(unpacked)
    expect(videoRuntime(archived, {EJIANBAO_RUNTIME: runtime})).toBe(runtime)
    expect(await checkVideoHealth(selected, 'python', videoEnvironment(home))).toMatchObject({python: true, runtimeFile: join(unpacked, 'runner.py')})
  })

  it('keeps explicit Python and media overrides ahead of shared defaults without mutating base environment', async () => {
    const {home} = await fixture()
    expect(videoPython(home, {})).toBe('python')
    await mkdir(dirname(privatePython(home)), {recursive: true}); await writeFile(privatePython(home), '')
    expect(videoPython(home, {})).toBe('python')
    await writeFile(join(home, 'ejianbao', 'engine', '.setup-lock'), 'a'.repeat(64))
    expect(videoPython(home, {})).toBe(privatePython(home))
    expect(videoPython(home, {EJIANBAO_PYTHON: 'external-python'})).toBe('external-python')
    const base = {FFMPEG_PATH: 'external-ffmpeg', EJIANBAO_NODE: 'external-node', EJIANBAO_BROWSER_EXECUTABLE: 'external-browser'}
    expect(videoEnvironment(home, base)).toMatchObject(base)
    expect(base).not.toHaveProperty('CQAI_FFMPEG')
    expect(videoEnvironment(home, {})).toMatchObject({FFMPEG_PATH: join(home, 'media-tools', 'ffmpeg'), EJIANBAO_NODE: process.execPath})
  })
  it('installs only its private package environment through common Python and immediately changes the resolver', async () => {
    vi.stubEnv('EJIANBAO_PYTHON', '')
    const {home, runtime} = await fixture(); let packagesReady = false
    tools.run.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'venv') {await mkdir(dirname(privatePython(home)), {recursive: true}); await writeFile(privatePython(home), '')}
      if (args[0] === 'pip') packagesReady = true
    })
    const probe = vi.fn(async () => ({python: true, pythonPackages: packagesReady}))
    const store = new JobStore(join(home, 'jobs'), runtime, () => videoPython(home), () => videoEnvironment(home))
    expect(store.python).toBe('python')
    const setup = createVideoSetup(home, runtime, probe); setup.start()
    await expect.poll(() => setup.snapshot().status).toBe('completed')
    expect(tools.steps).toHaveBeenCalledWith(home)
    expect(tools.python).toHaveBeenCalledWith(join(home, 'media-tools'))
    expect(tools.run.mock.calls.map(call => call[1][0])).toEqual(['venv', 'pip'])
    expect(tools.run.mock.calls[1][1]).toEqual(['pip', 'install', '--python', privatePython(home), '-r', join(home, 'ejianbao', 'engine', 'requirements.txt')])
    expect(tools.run.mock.calls[1][2].env).toMatchObject({CQAI_MEDIA_TOOLS_HOME: join(home, 'media-tools')})
    expect(store.python).toBe(privatePython(home))
    expect(await readFile(join(home, 'ejianbao', 'engine', 'requirements.txt'), 'utf8')).toBe(await readFile(join(runtime, 'requirements.txt'), 'utf8'))
    setup.start(); await expect.poll(() => setup.snapshot().status).toBe('completed')
    expect(tools.run).toHaveBeenCalledTimes(2)
  })
  it('refuses to modify an explicitly selected external interpreter when its packages are missing', async () => {
    vi.stubEnv('EJIANBAO_PYTHON', 'external-python')
    const {home, runtime} = await fixture()
    const setup = createVideoSetup(home, runtime, async () => ({python: true, pythonPackages: false})); setup.start()
    await expect.poll(() => setup.snapshot().status).toBe('failed')
    expect(setup.snapshot().logs.join('\n')).toContain('外部环境')
    expect(tools.run).not.toHaveBeenCalled()
    expect(videoPython(home)).toBe('external-python')
  })
  it('keeps the prior default interpreter after an incomplete private install', async () => {
    vi.stubEnv('EJIANBAO_PYTHON', '')
    const {home, runtime} = await fixture()
    tools.run.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'venv') {await mkdir(dirname(privatePython(home)), {recursive: true}); await writeFile(privatePython(home), '')}
    })
    const setup = createVideoSetup(home, runtime, async () => ({python: true, pythonPackages: false})); setup.start()
    await expect.poll(() => setup.snapshot().status).toBe('failed')
    expect(videoPython(home)).toBe('python')
    await expect(readFile(join(home, 'ejianbao', 'engine', '.setup-lock'))).rejects.toMatchObject({code: 'ENOENT'})
  })
  it('passes the same common environment to actual health and task workers', async () => {
    const {home, runtime} = await fixture()
    await writeFile(join(runtime, 'runner.py'), 'console.log(JSON.stringify({python:true,pythonPackages:true,ffmpegPath:process.env.FFMPEG_PATH,node:process.env.EJIANBAO_NODE}));')
    const env = videoEnvironment(home)
    expect(await checkVideoHealth(runtime, process.execPath, env)).toMatchObject({ffmpegPath: env.FFMPEG_PATH, node: env.EJIANBAO_NODE})
    await writeFile(join(runtime, 'runner.py'), 'import json, os, pathlib, sys\nout = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])\n(out / "worker-env.json").write_text(json.dumps({k:os.environ.get(k) for k in ["CQAI_FFMPEG", "FFMPEG_PATH", "EJIANBAO_NODE", "EJIANBAO_BROWSER_EXECUTABLE"]}))\n')
    const store = new JobStore(join(home, 'jobs'), runtime, 'python', () => env)
    const job = store.create({title: '环境测试', text: '测试文案。', duration: 5, mode: 'plan', optimize: false, covers: false, studio: false})
    store.start(job.id)
    await expect.poll(() => job.status, {timeout: 15000}).toBe('completed')
    expect(JSON.parse(await readFile(join(store.dir(job.id), 'worker-env.json'), 'utf8'))).toMatchObject({CQAI_FFMPEG: env.CQAI_FFMPEG, FFMPEG_PATH: env.FFMPEG_PATH, EJIANBAO_NODE: env.EJIANBAO_NODE})
    await store.dispose()
  })
  it('expires cached health and refreshes immediately after explicit invalidation', async () => {
    let time = 0, ready = false
    const probe = vi.fn(async () => ({python: ready}))
    const health = createVideoHealth(probe, 30, () => time)
    expect(await health.read()).toEqual({python: false})
    ready = true
    expect(await health.read()).toEqual({python: false})
    health.invalidate(); expect(await health.read()).toEqual({python: true})
    time = 31; await health.read(); expect(probe).toHaveBeenCalledTimes(3)
    await health.read(true); expect(probe).toHaveBeenCalledTimes(4)
  })
})
