/** Opt-in macOS Beta launcher for validating Toutiao article drafts. */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const defaultHelper = fileURLToPath(new URL(
  '../matrixmedia-publisher/build/publisher-worker-article-test/mac-universal/MatrixMedia Publisher Worker.app',
  import.meta.url,
))
const appPath = resolve(process.env.EBAO_PUBLISHER_WORKER || defaultHelper)
const executable = appPath.endsWith('.app')
  ? join(appPath, 'Contents', 'MacOS', basename(appPath, '.app'))
  : appPath
const flags = new Set((process.env.EBAO_PUBLISHER_EXPERIMENTAL_CAPABILITIES || 'juejin:article,blbl:article')
  .split(',').map(value => value.trim()).filter(Boolean))
flags.delete('tt:article:publish')
flags.add('tt:article:draft')
const env = {
  ...process.env,
  EBAO_PUBLISHER_WORKER: appPath,
  EBAO_PUBLISHER_EXPERIMENTAL_CAPABILITIES: [...flags].join(','),
}

async function verifyHelper() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ebao-tt-draft-check-'))
  const child = spawn(executable, ['--publisher-worker', '--data-dir', dataDir], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let pending = ''
  let checked = false
  let failure
  const timer = setTimeout(() => { failure = new Error('Worker 能力检查超时'); child.kill('SIGKILL') }, 20_000)
  child.stderr.on('data', () => {})
  child.stdin.on('error', error => { failure ||= error })
  child.stdout.on('data', chunk => {
    pending += String(chunk)
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      try {
        const frame = JSON.parse(line)
        if (frame.id !== 'cap') continue
        const modes = frame.result?.find(item => item.platform === 'tt')?.modes?.article
        if (JSON.stringify(modes) !== '["draft"]') {
          failure = new Error('所选 Helper 未提供仅头条文章草稿能力；不能启动测试模式')
        } else {
          checked = true
        }
        child.stdin.write(`${JSON.stringify({ id: 'bye', method: 'system.shutdown' })}\n`)
      } catch (error) {
        failure = error
        child.kill()
      }
    }
  })
  child.stdin.write(`${JSON.stringify({ id: 'cap', method: 'system.capabilities' })}\n`)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => {
        if (failure || !checked || code !== 0) reject(failure || new Error(`Worker 能力检查失败（退出码 ${String(code)}）`))
        else resolve()
      })
    })
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

if (process.platform !== 'darwin') throw new Error('头条文章草稿测试仅支持 macOS Beta')
if (!existsSync(executable)) {
  throw new Error(`缺少独立的文章测试 Helper：${executable}；不要覆盖正在运行的默认 Helper`)
}
await verifyHelper()
console.log('已验证：头条文章仅开放“转存草稿”，未开放“立即发布”。')

if (!process.argv.includes('--check')) {
  const processes = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' })
  if (/corepack yarn workspace dsh-plugin-desktop-beta dev|dsh-plugin-desktop-beta\/lib\/bin\.js/u.test(processes)) {
    throw new Error('当前 Beta 仍在运行。请先确认本地草稿已保存并完全退出 Beta，再执行此命令。')
  }
  const child = spawn('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop-beta', 'dev'], {
    cwd: root, env, stdio: 'inherit',
  })
  child.once('error', error => { console.error(error); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
