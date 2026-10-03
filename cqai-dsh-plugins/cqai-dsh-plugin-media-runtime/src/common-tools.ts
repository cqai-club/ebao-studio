import { chmodSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { makeNodeShim, nodeEnvironment, npmCli, python311, pythonEnvironment, run, uvEnvironment, uvExecutable, type SetupStep } from './index.ts'

/** ffprobe native package version, not the FFmpeg executable's version. */
export const COMMON_FFMPEG_VERSION = '4.0.519'
export const COMMON_FFMPEG_PROVIDER = 'imageio-ffmpeg@0.6.0'
// Same pinned wheels and hashes as the Short Video engine's uv.lock.
const fullFFmpeg: Record<string, {binary: string; platform: string; url: string; hash: string}> = {
  'win32-x64': {binary: 'ffmpeg-win-x86_64-v7.1.exe', platform: 'x86_64-pc-windows-msvc', url: 'https://files.pythonhosted.org/packages/2c/c6/fa760e12a2483469e2bf5058c5faff664acf66cadb4df2ad6205b016a73d/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl', hash: '02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a'},
  'darwin-arm64': {binary: 'ffmpeg-macos-aarch64-v7.1', platform: 'aarch64-apple-darwin', url: 'https://files.pythonhosted.org/packages/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl', hash: 'b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742'},
  'darwin-x64': {binary: 'ffmpeg-macos-x86_64-v7.1', platform: 'x86_64-apple-darwin', url: 'https://files.pythonhosted.org/packages/da/58/87ef68ac83f4c7690961bce288fd8e382bc5f1513860fc7f90a9c1c1c6bf/imageio_ffmpeg-0.6.0-py3-none-macosx_10_9_intel.macosx_10_9_x86_64.whl', hash: '9d2baaf867088508d4a3458e61eeb30e945c4ad8016025545f66c4b5aaef0a61'},
  'linux-arm64': {binary: 'ffmpeg-linux-aarch64-v7.0.2', platform: 'aarch64-unknown-linux-gnu', url: 'https://files.pythonhosted.org/packages/33/e7/1925bfbc563c39c1d2e82501d8372734a5c725e53ac3b31b4c2d081e895b/imageio_ffmpeg-0.6.0-py3-none-manylinux2014_aarch64.whl', hash: '1d47bebd83d2c5fc770720d211855f208af8a596c82d17730aa51e815cdee6dc'},
  'linux-x64': {binary: 'ffmpeg-linux-x86_64-v7.0.2', platform: 'x86_64-unknown-linux-gnu', url: 'https://files.pythonhosted.org/packages/a0/2d/43c8522a2038e9d0e7dbdf3a61195ecc31ca576fb1527a528c877e87d973/imageio_ffmpeg-0.6.0-py3-none-manylinux2014_x86_64.whl', hash: 'c7e46fcec401dd990405049d2e2f475e2b397779df2519b544b8aab515195282'},
}
function fullFFmpegSelection() {
  const selected = fullFFmpeg[`${process.platform}-${process.arch}`]
  if (!selected) throw new Error(`公共 FFmpeg 暂不支持 ${process.platform}/${process.arch}`)
  return selected
}
const integrity: Record<string, string> = {
  'darwin-arm64': 'sha512-Cuu6UxdqaAgY8p0f6WdstmXp1acCcGw2qywVqnbe8/iVY6CTtmOFcN5kNXhbYoEbXiaYCPFTXsfN/ifWtxAMOg==',
  'darwin-x64': 'sha512-/d8OAASFwjegBWvhIBbK9AJZ74CfI/1+9pmWYqbTPLyyLe3yV4YI0fPQ2hrpIpYFbS3cqwCsNXARkReowzbxfA==',
  'linux-arm64-gnu': 'sha512-qzmENRPPFPEfZNZikhTYQXr2mudmNyJoBndvkKRHeiHV5stjEIgUSdPYSVdkzD/kZWcTFeI1Aw+c9nL8lpcW6Q==',
  'linux-arm64-musl': 'sha512-JBmlggwud3U994IO9ziA2gLeDBVWm3u70DjxaRAAFWxlTINsCwcwdr8cPvUBW/pxDHtUMFyWCkZ4Jjgq5jNUmA==',
  'linux-x64-gnu': 'sha512-1+hvRzWhh1La6EVn4REOOtTgh7hByk4wpNPyu/E4SzhXF4U1WNSjXNGwtouSt6Eb/XXesqET/Yfj/FmUDcQUZA==',
  'linux-x64-musl': 'sha512-fzJhtUSqHi/XDHbNKuogzluenHazEii5L8bhWNZFhPdlJP4f/BYZ7YeCcLtA0rc9/CUK3jFxUT79riRHOhDujQ==',
  'win32-x64-msvc': 'sha512-/OHodGzDaymlPFTzqp84HFiAlzmXWb/IEaPZvqtJYYqCG0WmNmOcLIjB40q8lYTll5E6aGuelUwlaZxDAoIZ1A==',
}
function linuxLibc(): 'gnu' | 'musl' {
  const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined
  return report?.header?.glibcVersionRuntime ? 'gnu' : 'musl'
}
export function commonMediaPackage(platform: string = process.platform, arch: string = process.arch, libc: string = platform === 'linux' ? linuxLibc() : ''): string {
  const suffix = platform === 'win32' ? 'msvc' : platform === 'linux' ? libc : ''
  const target = [platform, arch, suffix].filter(Boolean).join('-')
  if (!integrity[target]) throw new Error(`公共媒体工具暂不支持 ${platform}/${arch}${libc ? `/${libc}` : ''}`)
  return `@remotion/compositor-${target}`
}
export function commonToolsHome(home: string): string {return join(home, 'media-tools')}
export function commonFFmpegDirectory(home: string): string {return join(commonToolsHome(home), 'ffmpeg', COMMON_FFMPEG_VERSION)}
const markerName = '.media-tools-ready.json'
function ffprobePath(packageName: string): string {
  return process.platform === 'darwin' ? 'bin/ffprobe' : `node_modules/${packageName}/ffprobe${process.platform === 'win32' ? '.exe' : ''}`
}
function macProbeLauncher(directory: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  if (/[\r\n]/.test(directory)) throw new Error('媒体工具路径不能包含换行符')
  // Remotion's macOS ffprobe loads bare dylib names. Set its private search
  // path inside the launcher, since macOS strips DYLD_* when starting /bin/sh.
  return `#!/bin/sh\nDYLD_LIBRARY_PATH=${quote(directory)} exec ${quote(join(directory, 'ffprobe'))} "$@"\n`
}

/** Never select an incomplete installation, even while another engine is preparing tools. */
export function sharedMediaTool(home: string, name: 'ffmpeg' | 'ffprobe'): string | undefined {
  try {
    const root = commonFFmpegDirectory(home), packageName = commonMediaPackage()
    const marker = JSON.parse(readFileSync(join(root, markerName), 'utf8')) as {version?: string; package?: string; ffmpegProvider?: string; ffmpegPath?: string; ffprobePath?: string}
    const directory = join(root, 'node_modules', packageName)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {version?: string}
    if (marker.version !== COMMON_FFMPEG_VERSION || marker.package !== packageName || manifest.version !== COMMON_FFMPEG_VERSION || marker.ffmpegProvider !== COMMON_FFMPEG_PROVIDER) return
    const relative = `imageio/imageio_ffmpeg/binaries/${fullFFmpegSelection().binary}`
    if (marker.ffmpegPath !== relative) return
    const path = name === 'ffmpeg' ? join(root, relative) : join(root, ffprobePath(packageName))
    if (name === 'ffprobe' && process.platform === 'darwin' && (marker.ffprobePath !== ffprobePath(packageName) || readFileSync(path, 'utf8') !== macProbeLauncher(directory))) return
    if (name === 'ffprobe' && process.platform === 'darwin' && (!statSync(join(directory, 'ffprobe')).isFile() || statSync(join(directory, 'ffprobe')).size === 0)) return
    if (!realpathSync(path).startsWith(realpathSync(root) + sep)) return
    return statSync(path).isFile() && statSync(path).size > 0 ? path : undefined
  } catch {return undefined}
}
export function commonToolEnvironment(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const root = commonToolsHome(home), ffmpeg = sharedMediaTool(home, 'ffmpeg'), ffprobe = sharedMediaTool(home, 'ffprobe')
  const node = join(root, 'bin', process.platform === 'win32' ? 'node.cmd' : 'node')
  return {...base, CQAI_MEDIA_TOOLS_HOME: root,
    ...(ffmpeg ? {CQAI_FFMPEG: base.CQAI_FFMPEG || ffmpeg} : {}),
    ...(ffprobe ? {CQAI_FFPROBE: base.CQAI_FFPROBE || ffprobe} : {}),
    ...(existsSync(node) ? {CQAI_NODE: base.CQAI_NODE || node} : {})}
}
async function probe(bin: string | undefined, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  if (!bin) return false
  try {await run(bin, args, {env, timeout: 15000}); return true} catch {return false}
}
async function pairedToolsReady(home: string): Promise<boolean> {
  const values = await Promise.all(['ffmpeg', 'ffprobe'].map(name => probe(sharedMediaTool(home, name as 'ffmpeg' | 'ffprobe'), ['-version'])))
  return values.every(Boolean)
}

/** Full FFmpeg is wheel-hash locked; ffprobe's native directory is npm-SRI locked. */
export async function installCommonMediaTools(home: string, log: (line: string) => void): Promise<void> {
  if (await pairedToolsReady(home)) {log('公共 FFmpeg 与 ffprobe 已就绪'); return}
  const packageName = commonMediaPackage(), target = packageName.slice('@remotion/compositor-'.length)
  const root = commonFFmpegDirectory(home)
  await mkdir(root, {recursive: true})
  await rm(join(root, markerName), {force: true})
  const dependencies = {[packageName]: COMMON_FFMPEG_VERSION}
  const manifest = {name: 'cqai-shared-media-tools', version: '1.0.0', private: true, dependencies}
  const lock = {name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: {
    '': {name: manifest.name, version: manifest.version, dependencies},
    [`node_modules/${packageName}`]: {version: COMMON_FFMPEG_VERSION,
      resolved: `https://registry.npmjs.org/${packageName}/-/compositor-${target}-${COMMON_FFMPEG_VERSION}.tgz`,
      integrity: integrity[target], cpu: [process.arch], os: [process.platform]},
  }}
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
  log('准备完整 FFmpeg 与 ffprobe，安装后供各功能复用')
  await run(process.execPath, [npmCli(), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-progress'],
    {cwd: root, env: nodeEnvironment({...process.env, npm_config_cache: join(commonToolsHome(home), 'npm-cache')}), log})
  const full = fullFFmpegSelection(), selection = await python311(commonToolsHome(home))
  const requirements = join(root, 'ffmpeg-requirements.txt')
  await writeFile(requirements, `imageio-ffmpeg @ ${full.url} --hash=sha256:${full.hash}\n`)
  const installArguments = ['pip', 'install', '--python', selection.python, '--python-platform', full.platform,
    '--target', join(root, 'imageio'), '--link-mode=copy', '--reinstall', '--no-deps', '--only-binary=:all:', '--require-hashes', '-r', requirements]
  const environment = pythonEnvironment(commonToolsHome(home), selection)
  await run(uvExecutable(), installArguments, {env: environment, log})
  const directory = join(root, 'node_modules', packageName)
  const ffmpegPath = `imageio/imageio_ffmpeg/binaries/${full.binary}`
  const probePath = ffprobePath(packageName)
  if (process.platform === 'darwin') {
    await mkdir(join(root, 'bin'), {recursive: true})
    await writeFile(join(root, probePath), macProbeLauncher(directory), {mode: 0o700})
    chmodSync(join(root, probePath), 0o700)
  }
  if (!await probe(join(root, ffmpegPath), ['-version'])) {
    // Older hardlinked installations could damage the extracted wheel cache too.
    log('FFmpeg 检查失败，重新获取已锁定的工具包')
    await run(uvExecutable(), ['cache', 'clean', 'imageio-ffmpeg'], {env: uvEnvironment(commonToolsHome(home)), log})
    await run(uvExecutable(), installArguments, {env: environment, log})
  }
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binary = name === 'ffmpeg' ? join(root, ffmpegPath) : join(root, probePath)
    if (!await probe(binary, ['-version'])) throw new Error(`公共 ${name} 安装后未通过检查`)
  }
  await writeFile(join(root, markerName), JSON.stringify({version: COMMON_FFMPEG_VERSION, package: packageName, ffmpegProvider: COMMON_FFMPEG_PROVIDER, ffmpegPath, ffprobePath: probePath}) + '\n')
}

export function commonToolSteps(home: string): SetupStep[] {
  const root = commonToolsHome(home), nodeDir = join(root, 'bin')
  return [
    {id: 'uv', label: '公共 uv', ready: async () => {try {return await probe(uvExecutable(), ['--version'])} catch {return false}}, run: async log => {await run(uvExecutable(), ['--version'], {log})}},
    {id: 'node', label: '宿主 Node.js', ready: async () => {
      const shim = join(nodeDir, process.platform === 'win32' ? 'node.cmd' : 'node')
      return existsSync(shim) && readFileSync(shim, 'utf8').includes(process.execPath) && await probe(process.execPath, ['--version'], nodeEnvironment())
    }, run: async log => {makeNodeShim(nodeDir); await run(process.execPath, ['--version'], {env: nodeEnvironment(), log})}},
    {id: 'python', label: '公共 Python 3.11', ready: async () => {try {await python311(root); return true} catch {return false}}, run: async log => {
      await mkdir(root, {recursive: true}); await run(uvExecutable(), ['python', 'install', '3.11'], {env: uvEnvironment(root), log})
    }},
    {id: 'mediaTools', label: '公共 FFmpeg / ffprobe', ready: async () => pairedToolsReady(home), run: log => installCommonMediaTools(home, log)},
  ]
}

export interface CommonToolHealth {uv: boolean; node: boolean; python: boolean; ffmpeg: boolean; ffprobe: boolean; pythonVersion?: string; ffmpegVersion?: string; error?: string}
export async function commonToolHealth(home: string): Promise<CommonToolHealth> {
  const packageError = (() => {try {commonMediaPackage(); return undefined} catch (error) {return error instanceof Error ? error.message : String(error)}})()
  const [uv, node, python, ffmpeg, ffprobe] = await Promise.all([
    (async () => {try {return await probe(uvExecutable(), ['--version'])} catch {return false}})(),
    probe(process.execPath, ['--version'], nodeEnvironment()),
    python311(commonToolsHome(home)).then(() => true).catch(() => false),
    probe(sharedMediaTool(home, 'ffmpeg'), ['-version']), probe(sharedMediaTool(home, 'ffprobe'), ['-version']),
  ])
  return {uv, node, python, ffmpeg, ffprobe, ...(python ? {pythonVersion: '3.11'} : {}), ...(packageError ? {error: packageError} : {})}
}
