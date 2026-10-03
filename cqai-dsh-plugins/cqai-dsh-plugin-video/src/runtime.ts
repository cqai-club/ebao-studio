import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SetupManager, commonToolEnvironment, commonToolSteps, nodeEnvironment, python311, pythonEnvironment, run, uvExecutable } from 'cqai-dsh-plugin-media-runtime'

/** Python workers need a physical runtime directory outside Electron's ASAR. */
export function videoRuntime(source: string, base: NodeJS.ProcessEnv = process.env): string {
  if (base.EJIANBAO_RUNTIME) return base.EJIANBAO_RUNTIME
  const unpacked = source.replace(/\.asar([\\/])/, '.asar.unpacked$1')
  return existsSync(join(unpacked, 'runner.py')) ? unpacked : source
}

export function privatePython(dshHome: string): string {
  const venv = join(dshHome, 'ejianbao', 'engine', '.venv')
  return process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}
export function videoPython(dshHome: string, base: NodeJS.ProcessEnv = process.env): string {
  if (base.EJIANBAO_PYTHON) return base.EJIANBAO_PYTHON
  const local = privatePython(dshHome)
  try {if (existsSync(local) && /^[a-f0-9]{64}$/.test(readFileSync(join(dshHome, 'ejianbao', 'engine', '.setup-lock'), 'utf8').trim())) return local} catch {/* Keep the old interpreter until the private install is verified. */}
  return 'python'
}
export function videoEnvironment(dshHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = commonToolEnvironment(dshHome, base)
  return nodeEnvironment({...env,
    EJIANBAO_NODE: base.EJIANBAO_NODE || process.execPath,
    ...(base.FFMPEG_PATH ? {} : env.CQAI_FFMPEG ? {FFMPEG_PATH: env.CQAI_FFMPEG} : {}),
    PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  })
}
export type VideoHealth = Record<string, unknown>
export async function checkVideoHealth(runtime: string, python: string, env: NodeJS.ProcessEnv): Promise<VideoHealth> {
  return await new Promise(resolve => {
    const child = spawn(python, [join(runtime, 'runner.py'), '--health'], {windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe']})
    let text = ''
    const timer = setTimeout(() => child.kill(), 10000)
    const failed = () => ({python: false, pythonPackages: false, ffmpeg: false, message: '制作环境尚未就绪，请在制作环境中安装 / 修复依赖'})
    child.stdout.on('data', chunk => {text += chunk.toString(); if (text.length > 100_000) child.kill()})
    child.once('error', () => {clearTimeout(timer); resolve(failed())})
    child.once('close', () => {
      clearTimeout(timer)
      try {const parsed: unknown = JSON.parse(text); resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as VideoHealth : failed())} catch {resolve(failed())}
    })
  })
}
export function createVideoHealth(probe: () => Promise<VideoHealth>, ttl = 30_000, now = Date.now) {
  let cached: Promise<VideoHealth> | undefined, checkedAt = 0
  return {
    invalidate() {cached = undefined},
    read(force = false) {
      if (force || !cached || now() - checkedAt >= ttl) {checkedAt = now(); cached = probe().catch(error => {cached = undefined; throw error})}
      return cached
    },
  }
}
function requirementHash(runtime: string): string {
  return createHash('sha256').update(readFileSync(join(runtime, 'requirements.txt'))).digest('hex')
}
export function createVideoSetup(dshHome: string, runtime: string, probe: (python: string, env: NodeJS.ProcessEnv) => Promise<VideoHealth> = (python, env) => checkVideoHealth(runtime, python, env)) {
  const engine = join(dshHome, 'ejianbao', 'engine'), stamp = join(engine, '.setup-lock')
  const external = () => process.env.EJIANBAO_PYTHON
  const ready = async () => {
    if (!external()) {
      try {if (!existsSync(privatePython(dshHome)) || readFileSync(stamp, 'utf8').trim() !== requirementHash(runtime)) return false} catch {return false}
    }
    const health = await probe(videoPython(dshHome), videoEnvironment(dshHome))
    return health.python === true && health.pythonPackages === true
  }
  return new SetupManager(() => [...commonToolSteps(dshHome), {
    id: 'videoPackages', label: '动效视频 Python 包环境', ready,
    run: async log => {
      if (external()) throw new Error('EJIANBAO_PYTHON 指定的外部环境缺少所需 Python 包；请在该环境安装 runtime/requirements.txt，或移除覆盖后使用应用私有环境')
      const uvHome = join(dshHome, 'media-tools'), venv = join(engine, '.venv')
      await mkdir(engine, {recursive: true})
      const requirements = readFileSync(join(runtime, 'requirements.txt'))
      const expectedHash = createHash('sha256').update(requirements).digest('hex')
      const requirementFile = join(engine, 'requirements.txt')
      await writeFile(requirementFile, requirements)
      const selection = await python311(uvHome)
      const env = videoEnvironment(dshHome, pythonEnvironment(uvHome, selection))
      await run(uvExecutable(), ['venv', '--allow-existing', '--python', selection.python, venv], {env, log})
      await run(uvExecutable(), ['pip', 'install', '--python', privatePython(dshHome), '-r', requirementFile], {env, log})
      const health = await probe(privatePython(dshHome), videoEnvironment(dshHome))
      if (health.python !== true || health.pythonPackages !== true) throw new Error('动效视频 Python 包安装后未通过检查，请查看安装日志')
      if (requirementHash(runtime) !== expectedHash) throw new Error('动效视频依赖配置在安装期间变化，请重新安装 / 修复')
      await writeFile(stamp, expectedHash)
      log('Python 包环境已就绪；Remotion 渲染依赖保持独立，仍使用原有准备方式')
    },
  }])
}
