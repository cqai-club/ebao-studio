import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { PublisherSupervisor } from '../src/publisher-supervisor.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(protocolVersion = 2) {
  const root = mkdtempSync(join(tmpdir(), 'ebao-publisher-worker-'))
  roots.push(root)
  const workerPath = join(root, 'worker.cjs')
  writeFileSync(workerPath, `
    const { createInterface } = require('node:readline');
    const lines = createInterface({ input: process.stdin });
    lines.on('line', line => {
      const { id, method, params } = JSON.parse(line);
      let result;
      if (method === 'system.handshake') result = { protocolVersion: ${protocolVersion}, platforms: ['dy'], modes: ['draft', 'publish'] };
      if (method === 'accounts.list') result = [{ id: 'test', platform: 'dy' }];
      if (method === 'submissions.create') result = params;
      process.stdout.write(JSON.stringify({ id, result }) + '\\n', () => {
        if (method === 'system.shutdown') process.exit(0);
      });
    });
  `)
  return { workerPath, dataRoot: join(root, 'isolated-data') }
}

describe('official Host Publisher Worker', () => {
  it('starts lazily, negotiates the protocol, and shuts down', async () => {
    const { workerPath, dataRoot } = fixture()
    const launches: string[] = []
    const supervisor = new PublisherSupervisor({
      platform: 'darwin', workerPath, dataRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      launch: (executable, args, options) => {
        launches.push(executable)
        expect(args).toEqual(['--publisher-worker', '--data-dir', dataRoot])
        expect(options?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
        expect(options?.env?.MATRIXMEDIA_DATA_DIR).toBe(join(dataRoot, 'matrix-data'))
        return spawn(process.execPath, [executable], options) as ChildProcessWithoutNullStreams
      },
    })
    try {
      expect(supervisor.status()).toMatchObject({ supported: true, running: false })
      expect(existsSync(dataRoot)).toBe(false)
      await expect(supervisor.request('arbitrary.method' as never)).rejects.toMatchObject({ code: 'method-not-allowed' })
      expect(launches).toHaveLength(0)
      const first = supervisor.request('accounts.list')
      const second = supervisor.request('accounts.list')
      await expect(first).resolves.toEqual([{ id: 'test', platform: 'dy' }])
      await expect(second).resolves.toEqual([{ id: 'test', platform: 'dy' }])
      expect(launches).toEqual([workerPath])
      expect(supervisor.status()).toMatchObject({ running: true })
    } finally {
      await supervisor.shutdown()
    }
    expect(supervisor.status()).toMatchObject({ running: false })
    await expect(supervisor.request('accounts.list')).rejects.toMatchObject({ code: 'worker-disconnected' })
    expect(launches).toEqual([workerPath])
  })

  it('rejects concurrent requests when the Worker handshake is incompatible', async () => {
    const options = fixture(1)
    const supervisor = new PublisherSupervisor({
      ...options, platform: 'darwin',
      launch: (executable, _args, spawnOptions) =>
        spawn(process.execPath, [executable], spawnOptions) as ChildProcessWithoutNullStreams,
    })
    try {
      const first = supervisor.request('accounts.list')
      const second = supervisor.request('system.health')
      await Promise.all([first, second].map(request =>
        expect(request).rejects.toMatchObject({ code: 'protocol-mismatch' })))
      expect(supervisor.status()).toMatchObject({ running: false })
    } finally {
      await supervisor.shutdown()
    }
  })

  it('stores only selected video bytes and rejects broken uploads without leaving files', async () => {
    const options = { ...fixture(), platform: 'darwin' as const }
    const supervisor = new PublisherSupervisor(options)
    const sample = Buffer.from('MP4 sample')
    await expect(supervisor.saveLocalVideo('../outside.mp4', sample.length, Readable.from([sample])))
      .rejects.toMatchObject({ code: 'invalid-video-file' })
    await expect(supervisor.saveLocalVideo('short.mp4', sample.length + 1, Readable.from([sample])))
      .rejects.toMatchObject({ code: 'video-upload-failed' })
    await expect(supervisor.saveLocalVideo('long.mp4', sample.length - 1, Readable.from([sample])))
      .rejects.toMatchObject({ code: 'video-upload-failed' })
    expect(readdirSync(join(options.dataRoot, 'local-videos'))).toEqual([])

    const selected = await supervisor.saveLocalVideo('样片.MP4', sample.length, Readable.from([sample]))
    expect(selected).toEqual({ id: expect.any(String), fileName: '样片.MP4', title: '样片', bytes: sample.length })
    const reopened = new PublisherSupervisor(options)
    await expect(reopened.readLocalVideoChunk(selected.id, 1, 3)).resolves.toEqual({
      ok: true, bytes: sample.length, dataBase64: sample.subarray(1, 4).toString('base64'),
    })
    writeFileSync(join(options.dataRoot, 'local-videos', `${selected.id}.mp4`), 'changed bytes')
    await expect(reopened.readLocalVideoChunk(selected.id, 0, 0)).resolves.toMatchObject({
      ok: false, code: 'video-file-changed',
    })
  })
})
