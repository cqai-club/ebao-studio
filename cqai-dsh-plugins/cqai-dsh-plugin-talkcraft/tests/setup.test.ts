import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadModel, prepareSnapshot, snapshotPath, snapshotReady } from '../src/setup.ts'
import { matchesCompositorPackage, modelReady } from '../src/runtime.ts'

afterEach(() => vi.unstubAllGlobals())

describe('private TalkCraft runtime', () => {
  it('recognizes locked Remotion platform packages', () => {
    expect(matchesCompositorPackage('compositor-darwin-arm64', 'darwin', 'arm64')).toBe(true)
    expect(matchesCompositorPackage('compositor-darwin-x64', 'darwin', 'x64')).toBe(true)
    expect(matchesCompositorPackage('compositor-linux-x64-gnu', 'linux', 'x64')).toBe(true)
    expect(matchesCompositorPackage('compositor-win32-x64-msvc', 'win32', 'x64')).toBe(true)
    expect(matchesCompositorPackage('compositor-win32-arm64-msvc', 'win32', 'x64')).toBe(false)
  })
  it('copies the fixed source without local development dependencies', () => {
    const source = fileURLToPath(new URL('../', import.meta.url))
    const temporary = mkdtempSync(join(tmpdir(), 'talkcraft-snapshot-'))
    try {
      expect(readFileSync(join(source, 'upstream', 'runtime', 'remotion-lock.json'), 'utf8'))
        .toBe(readFileSync(join(source, 'upstream', 'runtime', 'package-lock.json'), 'utf8'))
      const target = snapshotPath(source, temporary)
      prepareSnapshot(source, target)
      expect(snapshotReady(target)).toBe(true)
      expect(existsSync(join(target, 'upstream', 'runtime', 'node_modules'))).toBe(false)
      expect(existsSync(join(target, 'upstream', 'runtime', '.venv'))).toBe(false)
      expect(existsSync(join(target, 'upstream', 'scripts', 'render_shots.mjs'))).toBe(true)
      expect(readFileSync(join(target, 'upstream', 'runtime', 'package-lock.json'), 'utf8'))
        .toBe(readFileSync(join(source, 'upstream', 'runtime', 'remotion-lock.json'), 'utf8'))
      prepareSnapshot(source, target)
    } finally {rmSync(temporary, {recursive: true, force: true})}
  }, 30000)

  it('does not publish an interrupted model download as ready', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'talkcraft-download-'))
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {controller.enqueue(new Uint8Array([1, 2, 3]));controller.error(new Error('connection lost'))},
    })))
    try {
      await expect(downloadModel(temporary, () => {})).rejects.toThrow('connection lost')
      expect(existsSync(join(temporary, 'model.int8.onnx'))).toBe(false)
      expect(existsSync(join(temporary, 'model.int8.onnx.download'))).toBe(false)
      expect(modelReady(temporary)).toBe(false)
    } finally {rmSync(temporary, {recursive: true, force: true})}
  })
})
