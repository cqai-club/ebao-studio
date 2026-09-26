/** Exercise the packaged MatrixMedia Worker on a native Windows host. */

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
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
  const pipePath = String.raw`\\.\pipe\ebao-publisher-win-smoke-${process.pid}-${randomUUID()}`
  const token = randomBytes(32).toString('hex')
  const server = createServer()
  const pendingRequests = new Map()
  let child
  let socket
  let exited
  let exitResult
  let stderrTail = ''
  let protocolFailure
  let responseBuffer = ''

  const bootDetails = () => {
    const detail = stderrTail.trim()
    const tracePath = join(dataRoot, 'boot-trace.log')
    const trace = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').slice(-4096).trim() : ''
    return `${detail ? `stderr: ${detail}` : 'no stderr output'}; boot trace: ${trace || 'none'}`
  }
  const failPending = error => {
    protocolFailure = error
    for (const [id, request] of pendingRequests) {
      pendingRequests.delete(id)
      request.reject(error)
    }
  }
  const consumeResponses = chunk => {
    responseBuffer += chunk
    if (Buffer.byteLength(responseBuffer, 'utf8') > 1024 * 1024) {
      failPending(new Error('Windows Publisher Worker response exceeds 1 MB'))
      socket.destroy()
      return
    }
    for (;;) {
      const newline = responseBuffer.indexOf('\n')
      if (newline < 0) break
      const line = responseBuffer.slice(0, newline).trim()
      responseBuffer = responseBuffer.slice(newline + 1)
      if (!line) continue
      let response
      try { response = JSON.parse(line) }
      catch {
        failPending(new Error('Windows Publisher Worker emitted invalid NDJSON'))
        socket.destroy()
        return
      }
      const request = pendingRequests.get(response?.id)
      if (request === undefined) continue
      pendingRequests.delete(response.id)
      if (response.error) request.reject(new Error(`Windows Publisher Worker ${request.method} failed: ${response.error.code ?? 'unknown'}`))
      else request.resolve(response.result)
    }
  }

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(pipePath, () => {
        server.off('error', rejectListen)
        resolveListen()
      })
    })
    let resolveReady
    let rejectReady
    const ready = new Promise((resolveConnection, rejectConnection) => {
      resolveReady = resolveConnection
      rejectReady = rejectConnection
    })
    server.on('error', error => {
      rejectReady(error)
      failPending(error)
    })
    server.on('connection', connection => {
      if (socket !== undefined) {
        connection.destroy()
        return
      }
      socket = connection
      socket.setEncoding('utf8')
      let authenticated = false
      let authBuffer = ''
      const authTimer = setTimeout(() => {
        rejectReady(new Error('Windows Publisher Worker pipe authentication timed out after 5000 ms'))
        socket.destroy()
      }, 5_000)
      socket.on('data', chunk => {
        if (authenticated) {
          consumeResponses(chunk)
          return
        }
        authBuffer += chunk
        const newline = authBuffer.indexOf('\n')
        const frame = newline < 0 ? authBuffer : authBuffer.slice(0, newline)
        if (Buffer.byteLength(frame, 'utf8') > 256) {
          clearTimeout(authTimer)
          rejectReady(new Error('Windows Publisher Worker pipe authentication exceeds 256 bytes'))
          socket.destroy()
          return
        }
        if (newline < 0) return
        let message
        try { message = JSON.parse(frame.trim()) }
        catch {
          clearTimeout(authTimer)
          rejectReady(new Error('Windows Publisher Worker pipe authentication is invalid JSON'))
          socket.destroy()
          return
        }
        if (message?.auth !== token) {
          clearTimeout(authTimer)
          rejectReady(new Error('Windows Publisher Worker pipe authentication failed'))
          socket.destroy()
          return
        }
        authenticated = true
        clearTimeout(authTimer)
        resolveReady()
        const remainder = authBuffer.slice(newline + 1)
        authBuffer = ''
        if (remainder) consumeResponses(remainder)
      })
      socket.on('error', error => {
        clearTimeout(authTimer)
        rejectReady(error)
        failPending(error)
      })
      socket.on('close', () => {
        clearTimeout(authTimer)
        const error = new Error('Windows Publisher Worker pipe closed')
        if (!authenticated) rejectReady(error)
        failPending(error)
      })
    })

    child = spawn(executable, ['--publisher-worker', '--data-dir', dataRoot], {
      cwd: dataRoot,
      env: {
        ...process.env,
        MATRIXMEDIA_DATA_DIR: join(dataRoot, 'matrix-data'),
        EBAO_PUBLISHER_WORKER_BOOT_TRACE: '1',
        EBAO_PUBLISHER_PIPE: pipePath,
        EBAO_PUBLISHER_PIPE_TOKEN: token,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderrTail = `${stderrTail}${chunk}`.slice(-8192)
    })
    exited = new Promise(resolveExit => child.once('close', (code, signal) => {
      exitResult = { code, signal }
      const error = new Error(`Windows Publisher Worker exited (${signal ?? String(code)})`)
      rejectReady(error)
      failPending(error)
      resolveExit(exitResult)
    }))
    child.once('error', error => {
      rejectReady(error)
      failPending(error)
    })

    await withTimeout(ready, 30_000, 'Windows Publisher Worker pipe connection')
    const request = async (id, method) => {
      if (protocolFailure !== undefined) throw protocolFailure
      if (exitResult !== undefined) throw new Error('Windows Publisher Worker exited before the request')
      const response = new Promise((resolveResponse, rejectResponse) => {
        pendingRequests.set(id, { method, resolve: resolveResponse, reject: rejectResponse })
      })
      try {
        socket.write(`${JSON.stringify({ id, method, params: {} })}\n`, error => {
          if (error) failPending(error)
        })
        return await withTimeout(response, 30_000, `Windows Publisher Worker ${method}`)
      }
      finally { pendingRequests.delete(id) }
    }
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
    const outcome = await withTimeout(exited, 5_000, 'Windows Publisher Worker shutdown')
    if (outcome.code !== 0 || outcome.signal !== null) {
      throw new Error(`Windows Publisher Worker exited after shutdown (${outcome.signal ?? String(outcome.code)})`)
    }
    console.log(`Windows Publisher Worker lifecycle passed: protocol ${result.protocolVersion}, ${result.platforms.length} platforms`)
  } catch (error) {
    if (child?.pid !== undefined && exitResult === undefined) {
      child.kill()
      await withTimeout(exited, 3_000, 'Windows Publisher Worker termination').catch(() => undefined)
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}; ${bootDetails()}`)
  } finally {
    socket?.destroy()
    if (child?.pid !== undefined && exitResult === undefined) {
      child.kill()
      await withTimeout(exited, 3_000, 'Windows Publisher Worker termination').catch(() => undefined)
    }
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose))
    try {
      rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch (error) {
      // Electron subprocesses can briefly retain Windows file handles after the
      // Worker exits. This disposable profile contains no account credentials.
      if (['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) {
        console.warn(`Windows Publisher Worker smoke profile cleanup deferred: ${error.code}`)
      } else {
        throw error
      }
    }
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  smokeWindowsPublisherWorker().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
