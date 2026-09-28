import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isEdgeVoiceId } from './protocol.ts'
import { command, pythonExecutable } from './runtime.ts'

const MAX_PREVIEW_CHARS = 80
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

export function validateEdgePreview(voice: unknown, text: unknown): {voice: string; text: string} {
  if (!isEdgeVoiceId(voice)) throw new Error('请选择有效的 Edge TTS 音色')
  if (typeof text !== 'string') throw new Error('试听文案无效')
  const sample = text.replace(/\s+/g, ' ').trim()
  if (!sample || Array.from(sample).length > MAX_PREVIEW_CHARS) throw new Error(`试听文案需为 1–${MAX_PREVIEW_CHARS} 字`)
  return {voice, text: sample}
}

export class EdgeVoicePreview {
  private active = 0
  constructor(readonly upstream: string, readonly directory: string) {}

  async generate(rawVoice: unknown, rawText: unknown, signal?: AbortSignal): Promise<Buffer> {
    const {voice, text} = validateEdgePreview(rawVoice, rawText)
    if (this.active >= 2) throw new Error('正在生成其他试听，请稍后再试')
    const python = pythonExecutable(this.upstream)
    if (python === 'python') throw new Error('Edge TTS 依赖尚未准备，请先在设置中完成首次准备')
    this.active++
    const output = join(this.directory, `${randomUUID()}.mp3`)
    try {
      await mkdir(this.directory, {recursive: true})
      const result = await command(python, [join(this.upstream, '..', 'scripts', 'preview_edge_voice.py'), output, voice, text],
        {env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}, signal, timeout: 45000, maxOutput: 2000})
      if (result.code !== 0) throw new Error('试听生成失败，请检查网络后重试')
      const size = (await stat(output)).size
      if (size < 128 || size > MAX_PREVIEW_BYTES) throw new Error('Edge TTS 返回的试听音频无效')
      return await readFile(output)
    } finally {
      await rm(output, {force: true})
      this.active--
    }
  }
}
