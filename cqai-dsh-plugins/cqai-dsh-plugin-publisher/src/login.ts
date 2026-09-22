import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CLI_LOGIN_PLATFORMS, PLATFORM_LABELS, type Platform } from './protocol.ts'
import { collect, launchChild, type Launcher, type MatrixMedia } from './runtime.ts'

/** How long upstream's own `--timeout-sec` lets a login run, in seconds. */
const LOGIN_TIMEOUT_SEC = 900
/** Give the QR a moment to land on disk before telling the panel to keep waiting. */
const QR_POLL_MS = 400

/** One in-flight scan-login. */
interface LoginSession {
  id: string
  platform: Platform
  phone: string
  /** Data URL of the QR image, once upstream has written it. */
  qr: string
  /** `pending` until the child exits, then `ok` or `failed`. */
  state: 'pending' | 'ok' | 'failed'
  message: string
  child: {kill(): boolean}
}

/**
 * Drive `cli login` on the panel's behalf.
 *
 * Upstream prints a terminal QR only when stdout is a TTY
 * (`if(!process.stdout.isTTY && !n.saveQrPngPath) return`), and our child is never
 * a TTY — so every session is started with `--save-qr-png` and the panel renders
 * the PNG upstream wrote. Upstream itself drives only 抖音 and 视频号; every other
 * platform is signed in through the MatrixMedia window, and this class says so
 * rather than starting a child that would fail.
 */
export class Logins {
  private readonly sessions = new Map<string, LoginSession>()

  constructor(private readonly mm: MatrixMedia, private readonly launch: Launcher = launchChild) {}

  /** Start one scan-login and return as soon as the QR is on disk. */
  async start(platform: Platform, phone: string): Promise<LoginSession> {
    if (!CLI_LOGIN_PLATFORMS.includes(platform)) {
      throw new Error(`${PLATFORM_LABELS[platform]} 不支持扫码登录，请在矩媒界面里登录该平台`)
    }
    if (!this.mm.location.exe) throw new Error('矩媒运行体未就位')
    for (const session of this.sessions.values()) {
      if (session.state === 'pending') throw new Error('已有登录流程在进行中，请先完成或取消')
    }
    const id = randomUUID()
    const dir = mkdtempSync(join(tmpdir(), 'ejianbao-login-'))
    const qrPath = join(dir, 'qr.png')
    const args = ['cli', 'login', '-p', platform, '--save-qr-png', qrPath, '--timeout-sec', String(LOGIN_TIMEOUT_SEC)]
    if (phone) args.push('--phone', phone)
    const child = this.launch(this.mm.location.exe, args, this.mm.location.dir)
    const session: LoginSession = {id, platform, phone, qr: '', state: 'pending', message: '请用手机端 App 扫码', child}
    this.sessions.set(id, session)
    const finished = collect(child, (LOGIN_TIMEOUT_SEC + 60) * 1000)
    void this.watch(session, qrPath, dir, finished)
    for (let waited = 0; waited < 20000 && !session.qr; waited += QR_POLL_MS) {
      if (session.state !== 'pending') break
      await new Promise(resume => setTimeout(resume, QR_POLL_MS))
      this.readQr(session, qrPath)
    }
    if (!session.qr && session.state === 'pending') throw new Error('矩媒没有输出登录二维码，请在矩媒界面里登录该平台')
    return session
  }

  /** Poll one session's progress. */
  poll(id: string): LoginSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('登录会话不存在或已过期')
    return session
  }

  /** Abandon a session and drop its temporary QR directory. */
  cancel(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.child.kill()
    session.state = 'failed'
    session.message = '已取消登录'
    this.sessions.delete(id)
  }

  /** Task a finished session off the map once the panel has read the outcome. */
  forget(id: string): void {
    const session = this.sessions.get(id)
    if (session && session.state !== 'pending') this.sessions.delete(id)
  }

  /**
   * Kill every login child still waiting on a scan. Called when the plugin is
   * torn down, so a reload cannot leave a resident `matrixmedia.exe` behind.
   */
  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) session.child.kill()
    this.sessions.clear()
  }

  private readQr(session: LoginSession, qrPath: string): void {
    if (session.qr || !existsSync(qrPath)) return
    try {session.qr = `data:image/png;base64,${readFileSync(qrPath).toString('base64')}`} catch { /* rewriting, try again next tick */ }
  }

  private async watch(session: LoginSession, qrPath: string, dir: string, finished: Promise<{code: number | undefined; timedOut: boolean; stderr: string}>): Promise<void> {
    try {
      const result = await finished
      this.readQr(session, qrPath)
      if (result.code === 0) {
        session.state = 'ok'
        session.message = '已登录'
      } else {
        session.state = 'failed'
        session.message = result.timedOut ? '登录超时，请重新获取二维码'
          : result.code === 3 ? '未在时限内完成扫码，请重试'
            : result.code === 2 ? '登录参数被矩媒拒绝，请更新矩媒版本'
              : '登录失败，请重试或改用矩媒界面登录'
      }
    } catch (error) {
      session.state = 'failed'
      session.message = error instanceof Error ? error.message : '登录失败'
    } finally {
      try {rmSync(dir, {recursive: true, force: true})} catch { /* the OS will reclaim the temp dir */ }
    }
  }
}
