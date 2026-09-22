import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { PLATFORM_LABELS, VIDEO_PLATFORMS } from '../src/protocol.ts'
import { MatrixMedia, RUNTIME_ENV, type Launcher } from '../src/runtime.ts'

/**
 * A scriptable stand-in for `matrixmedia.exe`.
 *
 * Upstream's real executable is a 162 MiB Electron binary that cannot run in a
 * test, and it is never a TTY — so the only things the bundle reads back are
 * stdout and the exit code upstream prints in its own epilogue. The fake writes
 * exactly that epilogue, and its launcher runs it through `process.execPath`
 * with the script as `argv[1]`: Node's executable plays the part of
 * "matrixmedia.exe" because copying the real one is not an option.
 *
 * The epilogue is what makes a real run terminate, so a fake that omits it
 * exercises the `close`/timeout fallback rather than the normal path.
 */

/** One scripted run: what the fake prints, and the code it claims. */
export interface FixtureRun {
  /** Lines printed on stdout before the epilogue. */
  stdout?: string[]
  /** Lines printed on stderr; upstream's Chromium writes there too. */
  stderr?: string[]
  /** Exit code announced by the epilogue, and the process's own code. */
  code?: number
  /** Print nothing at all and exit, as a crashed child would. */
  silent?: boolean
  /** Epoch ms to spend "running" before printing anything. */
  delayMs?: number
}

/** Scripted child harness: one temporary directory, one fake, one call log. */
export interface FakeCli {
  /** Directory the fake lives in; also usable as the runtime's `cwd`. */
  dir: string
  /** Every argument list handed to the launcher, in order. */
  calls: string[][]
  /** A {@link Launcher} that runs the fake instead of a real binary. */
  launch: Launcher
  /** Remove the directory. Safe to call twice. */
  dispose: () => void
}

/** A 1×1 PNG, so a QR the fake "wrote" is a real image the panel could render. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/**
 * Build a fake runtime. Each launch consumes the next run from `runs`; once
 * they are exhausted the fake exits 0 silently, so a test that expects fewer
 * calls than it gets fails on its own assertions instead of hanging.
 * @param runs - the scripted runs, consumed in spawn order.
 * @returns the harness, owning its own temporary directory.
 */
export function fakeCli(runs: readonly FixtureRun[] = []): FakeCli {
  const dir = mkdtempSync(join(tmpdir(), 'ejianbao-fake-mm-'))
  const exe = join(dir, 'matrixmedia.exe')
  const script = join(dir, 'fake.cjs')
  const runsFile = join(dir, 'runs.json')
  const atFile = join(dir, 'at.txt')
  let index = 0
  writeFileSync(runsFile, JSON.stringify(runs))
  writeFileSync(atFile, '0')
  // Plain CJS on purpose: no package.json in the temp dir means Node would
  // otherwise have to guess, and `.cjs` removes the guess entirely.
  writeFileSync(script, [
    "'use strict'",
    "const {readFileSync, writeFileSync} = require('node:fs')",
    'const args = process.argv.slice(2)',
    `const runs = JSON.parse(readFileSync(${JSON.stringify(runsFile)}, 'utf8'))`,
    `const run = runs[Number(readFileSync(${JSON.stringify(atFile)}, 'utf8'))] || {code: 0}`,
    "// Upstream writes the scan-login QR where --save-qr-png points; so does the fake.",
    "const qr = args.indexOf('--save-qr-png')",
    `if (qr >= 0 && args[qr + 1]) writeFileSync(args[qr + 1], Buffer.from(${JSON.stringify(PNG)}, 'base64'))`,
    'const print = () => {',
    '  for (const line of run.stdout || []) console.log(line)',
    '  for (const line of run.stderr || []) console.error(line)',
    '  if (!run.silent) console.log(`[startup] CLI 执行结束，退出码=${run.code || 0}`)',
    '  process.exitCode = run.code || 0',
    '}',
    'if (run.delayMs) setTimeout(print, run.delayMs)',
    'else print()',
    '',
  ].join('\n'))
  // The runtime only checks that its executable exists; the launcher ignores
  // the path and runs `process.execPath` with the fake as the first argument.
  writeFileSync(exe, '')
  const calls: string[][] = []
  const launch: Launcher = (_exe, args, cwd): ChildProcess => {
    calls.push([...args])
    writeFileSync(atFile, String(index))
    index += 1
    return spawn(process.execPath, [script, ...args], {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  }
  return {dir, calls, launch, dispose: () => { rmSync(dir, {recursive: true, force: true}) }}
}

/** A {@link MatrixMedia} driven by a fake, with every path inside a temp tree. */
export interface FakeRuntime {
  /** The scripted child harness, including the call log. */
  cli: FakeCli
  /** Runtime whose executable and data directory both live in temporary trees. */
  mm: MatrixMedia
  /** Environment to hand to anything that resolves paths itself. */
  env: NodeJS.ProcessEnv
  /** Remove the fake's directory and the temporary profile. Safe twice. */
  dispose: () => void
}

/**
 * Wire a {@link MatrixMedia} to a scripted runtime. `resolveRuntime` and
 * `dataDirectory` are what make that possible: the fake's directory is handed
 * over as {@link RUNTIME_ENV}, and a throwaway `USERPROFILE` puts
 * `<Documents>/MatrixMedia/data` inside the temp tree too, so a test can write
 * records with {@link writeRecord} and have the plugin actually read them.
 * @param runs - the scripted runs, consumed in spawn order.
 */
export function fakeRuntime(runs: readonly FixtureRun[] = []): FakeRuntime {
  const cli = fakeCli(runs)
  const home = mkdtempSync(join(tmpdir(), 'ejianbao-fake-home-'))
  const env: NodeJS.ProcessEnv = {[RUNTIME_ENV]: cli.dir, USERPROFILE: home}
  return {
    cli,
    mm: new MatrixMedia(env, undefined, cli.launch),
    env,
    dispose: () => {cli.dispose(); rmSync(home, {recursive: true, force: true})},
  }
}

/**
 * Write a MatrixMedia-shaped record, as upstream would after a publish.
 * @param dataDir - the `<Documents>/MatrixMedia/data` stand-in.
 * @param record - fields merged into the record upstream would have written.
 * @param at - epoch ms the record is stamped with.
 */
export function writeRecord(dataDir: string, record: Record<string, unknown>, at = Date.now()): void {
  const dir = join(dataDir, 'pushData')
  mkdirSync(dir, {recursive: true})
  const date = new Date(at)
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify([{lastPublishAt: at, createTime: at, ...record}]))
}

/** A temporary 成片 file that satisfies `validateInput`'s absolute-path checks. */
export function fakeVideo(bytes = 32): {dir: string; file: string; dispose: () => void} {
  const dir = mkdtempSync(join(tmpdir(), 'ejianbao-fake-video-'))
  const file = join(dir, '成片.mp4')
  writeFileSync(file, Buffer.alloc(bytes, 7))
  return {dir, file, dispose: () => { rmSync(dir, {recursive: true, force: true}) }}
}

/** Platform ids and labels, re-exported so expectations read clearly. */
export {PLATFORM_LABELS, VIDEO_PLATFORMS}
