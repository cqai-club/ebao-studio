/** Exercise the packaged MatrixMedia Worker on a native Windows host. */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = join(
  workspaceRoot,
  'matrixmedia-publisher', 'build', 'publisher-worker', 'win-unpacked',
  'MatrixMedia Publisher Worker.exe',
)

function withTimeout(promise, milliseconds, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function smokeWindowsPublisherWorker() {
  if (process.platform !== 'win32') throw new Error('Windows Publisher Worker smoke requires native Windows')
  if (!existsSync(executable)) throw new Error(`Windows Publisher Worker is missing: ${executable}`)
  const dataRoot = mkdtempSync(join(tmpdir(), 'ebao-publisher-win-smoke-'))
  const child = spawn(executable, ['--publisher-worker', '--data-dir', dataRoot], {
    cwd: dataRoot,
    env: { ...process.env, MATRIXMEDIA_DATA_DIR: join(dataRoot, 'matrix-data') },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pendingRequests = new Map()
  let exitResult
  const failPending = error => {
    for (const [id, request] of pendingRequests) {
      pendingRequests.delete(id)
      request.reject(error)
    }
  }
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => {
    exitResult = { code, signal }
    failPending(new Error(`Windows Publisher Worker exited (${signal ?? String(code)})`))
    resolveExit(exitResult)
  }))
  child.once('error', failPending)
  child.stdin.on('error', failPending)
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    pending += chunk
    if (pending.length > 1024 * 1024) {
      failPending(new Error('Windows Publisher Worker response exceeds 1 MB'))
      child.kill()
      return
    }
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      if (!line) continue
      let response
      try { response = JSON.parse(line) }
      catch {
        failPending(new Error('Windows Publisher Worker emitted invalid NDJSON'))
        child.kill()
        return
      }
      const request = pendingRequests.get(response?.id)
      if (request === undefined) continue
      pendingRequests.delete(response.id)
      if (response.error) request.reject(new Error(`Windows Publisher Worker ${request.method} failed: ${response.error.code ?? 'unknown'}`))
      else request.resolve(response.result)
    }
  })
  // Drain stderr so Electron logging cannot fill the pipe. Do not print account data.
  child.stderr.resume()
  const request = async (id, method) => {
    if (exitResult !== undefined) throw new Error('Windows Publisher Worker exited before the request')
    const response = new Promise((resolveResponse, rejectResponse) => {
      pendingRequests.set(id, { method, resolve: resolveResponse, reject: rejectResponse })
    })
    try {
      child.stdin.write(`${JSON.stringify({ id, method, params: {} })}\n`, error => {
        if (error) failPending(error)
      })
      return await withTimeout(response, 30_000, `Windows Publisher Worker ${method}`)
    }
    finally { pendingRequests.delete(id) }
  }
  try {
    const result = await request('native-windows-handshake', 'system.handshake')
    if (result?.protocolVersion !== 2
      || !Array.isArray(result.platforms)
      || !Array.isArray(result.modes)
      || !result.modes.includes('publish')
      || !result.modes.includes('draft')) {
      throw new Error('Windows Publisher Worker handshake returned an incompatible contract')
    }
    const health = await request('native-windows-health', 'system.health')
    if (health?.ready !== true) throw new Error('Windows Publisher Worker health check failed')
    await request('native-windows-shutdown', 'system.shutdown')
    child.stdin.end()
    const outcome = await withTimeout(exited, 5_000, 'Windows Publisher Worker shutdown')
    if (outcome.code !== 0 || outcome.signal !== null) {
      throw new Error(`Windows Publisher Worker exited after shutdown (${outcome.signal ?? String(outcome.code)})`)
    }
    console.log(`Windows Publisher Worker lifecycle passed: protocol ${result.protocolVersion}, ${result.platforms.length} platforms`)
  } finally {
    if (child.pid !== undefined && exitResult === undefined) {
      child.kill()
      await withTimeout(exited, 3_000, 'Windows Publisher Worker termination').catch(() => undefined)
    }
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  smokeWindowsPublisherWorker().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
