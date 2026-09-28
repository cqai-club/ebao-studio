import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EDGE_VOICES, isEdgeVoiceId, type EdgeVoice, type EdgeVoiceList } from './protocol.ts'
import { command, pythonExecutable } from './runtime.ts'

const CACHE_AGE_MS = 24 * 60 * 60 * 1000
const names = new Map(EDGE_VOICES.map(item => [item.id, item.label]))
const localePattern = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}$/

export function normalizeEdgeVoices(input: unknown): EdgeVoice[] {
  if (!Array.isArray(input)) return []
  const voices = new Map<string, EdgeVoice>()
  for (const item of input.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue
    const {id, locale, gender} = item as Record<string, unknown>
    if (!isEdgeVoiceId(id) || typeof locale !== 'string' || !localePattern.test(locale)
      || !id.startsWith(`${locale}-`) || (gender !== 'Female' && gender !== 'Male')) continue
    voices.set(id, {id, locale, gender, ...(names.get(id) ? {label: names.get(id)} : {})})
  }
  const rank = (locale: string) => locale === 'zh-CN' ? 0 : locale === 'zh-HK' ? 1 : locale === 'zh-TW' ? 2 : 3
  return [...voices.values()].sort((a, b) => rank(a.locale) - rank(b.locale) || a.locale.localeCompare(b.locale) || a.id.localeCompare(b.id))
}

export class EdgeVoiceCatalog {
  private cache?: {savedAt: number; voices: EdgeVoice[]}
  constructor(readonly upstream: string, readonly cachePath: string) {
    try {
      const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as {savedAt?: unknown; voices?: unknown}
      const voices = normalizeEdgeVoices(parsed.voices)
      if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) && voices.length > 10) this.cache = {savedAt: parsed.savedAt, voices}
    } catch { /* no valid previous catalog */ }
  }
  async list(refresh = false): Promise<EdgeVoiceList> {
    if (!refresh && this.cache && Date.now() - this.cache.savedAt < CACHE_AGE_MS) return {voices: this.cache.voices, source: 'cache'}
    try {
      const result = await command(pythonExecutable(this.upstream), [join(this.upstream, '..', 'scripts', 'list_edge_voices.py')],
        {env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}, timeout: 20000, maxOutput: 100000})
      if (result.code !== 0) throw new Error('Edge voice catalog unavailable')
      const voices = normalizeEdgeVoices(JSON.parse(result.output) as unknown)
      if (voices.length < 10) throw new Error('Edge voice catalog incomplete')
      const savedAt = Date.now()
      this.cache = {savedAt, voices}
      try {
        mkdirSync(dirname(this.cachePath), {recursive: true})
        const temp = this.cachePath + '.tmp'
        writeFileSync(temp, JSON.stringify(this.cache))
        renameSync(temp, this.cachePath)
      } catch { /* keep the live catalog in memory if disk caching fails */ }
      return {voices, source: 'live'}
    } catch {
      return this.cache ? {voices: this.cache.voices, source: 'cache'} : {voices: [...EDGE_VOICES], source: 'fallback'}
    }
  }
}
