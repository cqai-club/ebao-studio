import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { commonToolEnvironment, nodeEnvironment } from 'cqai-dsh-plugin-media-runtime'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { JobStore } from './store.ts'
import { writeWorkbenchVisibilityConfig } from './workbench-visibility.ts'

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export class Workbench {
  private active?: {id: string; port: number; child: ChildProcessWithoutNullStreams}
  private openingId?: string
  constructor(private readonly store: JobStore, private readonly upstream: string) {}
  async open(id: string): Promise<string> {
    if (this.openingId) throw new Error('工作台正在打开，请稍后重试')
    const job = this.store.get(id)
    if (!job.approvedSample) throw new Error('请先确认有声样板镜，再打开多轨工作台')
    if (this.active?.id === id && this.active.child.exitCode === null) return `http://127.0.0.1:${this.active.port}/?tracks`
    await this.close()
    const publicDir = this.store.file(id, 'remotion/public')
    mkdirSync(publicDir, {recursive: true})
    const thumbDir = join(this.upstream, 'gallery', 'thumbs')
    if (existsSync(thumbDir)) cpSync(thumbDir, join(publicDir, 'cardthumbs'), {recursive: true, force: false, errorOnExist: false})
    const root = join(this.upstream, 'workbench')
    const environment = nodeEnvironment(commonToolEnvironment(resolveDshHome(), {...process.env, TALKCRAFT_PROJECT: this.store.directory(id)}))
    const generator = spawn(process.execPath, [join(root, 'scripts', 'gen-index.mjs')], {cwd: root, env: environment, windowsHide: true})
    this.openingId = id
    let generateCode: number
    try {generateCode = await new Promise<number>((resolve, reject) => {generator.once('error', reject); generator.once('close', code => resolve(code ?? -1))})}
    finally {this.openingId = undefined}
    if (generateCode !== 0) throw new Error('工作台工程索引生成失败')
    const port = await availablePort()
    this.store.get(id)
    const vite = join(this.upstream, 'runtime', 'node_modules', 'vite', 'bin', 'vite.js')
    if (!existsSync(vite)) throw new Error('工作台依赖未安装，请先在设置中一键安装')
    const config = writeWorkbenchVisibilityConfig(this.store.directory(id), root)
    const child = spawn(process.execPath, [vite, '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd: root, env: environment, windowsHide: true})
    this.active = {id, port, child}
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('工作台启动超时')), 30000)
        let output = ''
        const onData = (chunk: Buffer) => {output = (output + chunk.toString()).slice(-3000); if (output.includes(`127.0.0.1:${port}`)) {clearTimeout(timer); resolve()}}
        child.stdout.on('data', onData); child.stderr.on('data', onData)
        child.once('error', error => {clearTimeout(timer); reject(error)})
        child.once('exit', code => {clearTimeout(timer); reject(new Error(`工作台启动失败 (${code}): ${output}`))})
      })
      return `http://127.0.0.1:${port}/?tracks`
    } catch (error) {await this.close(); throw error}
  }
  async close(expectedId?: string): Promise<void> {
    if (expectedId && this.openingId === expectedId) throw new Error('工作台正在打开，请稍后重试删除')
    const active = this.active
    if (expectedId && active?.id !== expectedId) return
    this.active = undefined
    if (!active || active.child.exitCode !== null) return
    if (process.platform === 'win32' && active.child.pid) {
      await new Promise<void>(resolve => {const killer = spawn('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], {windowsHide: true}); killer.once('error', () => resolve()); killer.once('close', () => resolve())})
    }
    if (active.child.exitCode === null) active.child.kill()
    await new Promise<void>((resolve, reject) => {
      if (active.child.exitCode !== null) return resolve()
      const timer = setTimeout(() => {active.child.kill('SIGKILL'); reject(new Error('旧工作台服务未退出'))}, 5000)
      active.child.once('exit', () => {clearTimeout(timer); resolve()})
    })
  }
  current(): {id: string; url: string} | null {return this.active ? {id: this.active.id, url: `http://127.0.0.1:${this.active.port}/?tracks`} : null}
}
