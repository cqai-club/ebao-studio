import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installWorker, officialTarballs, restoreWorkerLock } from './install-matrixmedia-ci.mjs'

const original = Buffer.from('# lock 中文\r\npkg@1:\r\n  version "1.2.3"\r\n  resolved "https://registry.npmmirror.com/pkg/-/pkg-1.2.3.tgz#abcdef"\r\n  integrity sha512-example\r\n')

test('rewrites only locked npm tarball origins, preserving bytes, hashes and integrity', () => {
  assert.equal(officialTarballs(original).toString(), original.toString().replace('https://registry.npmmirror.com/', 'https://registry.npmjs.org/'))
  assert.throws(() => officialTarballs(Buffer.from('no mirror')), /no supported mirror/u)
})

test('preserves every version, checksum and integrity entry in the pinned Worker lock', () => {
  const lock = readFileSync(new URL('../matrixmedia-publisher/yarn.lock', import.meta.url))
  const rewritten = officialTarballs(lock)
  assert.deepEqual(Buffer.from(rewritten.toString().replaceAll('https://registry.npmjs.org/', 'https://registry.npmmirror.com/')), lock)
  assert.ok((rewritten.toString().match(/^  integrity /gmu) ?? []).length > 0)
})

for (const code of [0, 17]) {
  test(`restores the original submodule lock after installer exit ${code}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'matrixmedia-install-'))
    const backupPath = join(root, 'original.lock')
    const lockPath = join(root, 'yarn.lock')
    const npmrcPath = join(root, '.npmrc')
    writeFileSync(lockPath, original)
    writeFileSync(npmrcPath, 'electron_mirror=https://example.test/electron/\n')
    try {
      const script = `const fs=require('node:fs');const l=fs.readFileSync('yarn.lock','utf8');if(!l.includes('https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz#abcdef')||!l.includes('integrity sha512-example')||process.env.npm_config_registry!=='https://registry.npmjs.org/')process.exit(98);process.exit(${code})`
      const run = installWorker({ workerRoot: root, backupPath, command: process.execPath, args: ['-e', script] })
      if (code === 0) await run
      else await assert.rejects(run, /install failed: 17/u)
      assert.deepEqual(readFileSync(lockPath), original)
      assert.equal(readFileSync(npmrcPath, 'utf8'), 'electron_mirror=https://example.test/electron/\n')
      assert.equal(existsSync(backupPath), false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('restores an interrupted install and protects unrelated edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'matrixmedia-recover-'))
  const lockPath = join(root, 'yarn.lock')
  const backupPath = join(root, 'original.lock')
  try {
    writeFileSync(backupPath, original)
    writeFileSync(lockPath, officialTarballs(original))
    assert.equal(restoreWorkerLock(lockPath, backupPath), true)
    assert.deepEqual(readFileSync(lockPath), original)
    assert.equal(restoreWorkerLock(lockPath, backupPath), false)
    writeFileSync(backupPath, original)
    writeFileSync(lockPath, 'unrelated edit')
    assert.throws(() => restoreWorkerLock(lockPath, backupPath), /backup retained/u)
    assert.equal(readFileSync(lockPath, 'utf8'), 'unrelated edit')
    assert.deepEqual(readFileSync(backupPath), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('restores the lock when the installer is interrupted', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'matrixmedia-signal-'))
  const lockPath = join(root, 'yarn.lock')
  const backupPath = join(root, 'original.lock')
  const runner = join(root, 'runner.mjs')
  writeFileSync(lockPath, original)
  writeFileSync(runner, `import { installWorker } from ${JSON.stringify(new URL('./install-matrixmedia-ci.mjs', import.meta.url).href)}; await installWorker({workerRoot:${JSON.stringify(root)},backupPath:${JSON.stringify(backupPath)},command:process.execPath,args:['-e','console.log("ready");setInterval(()=>{},1000)']})`)
  try {
    const child = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready')) child.kill('SIGTERM') })
    const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode) })
    assert.notEqual(code, 0)
    assert.deepEqual(readFileSync(lockPath), original)
    assert.equal(existsSync(backupPath), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
