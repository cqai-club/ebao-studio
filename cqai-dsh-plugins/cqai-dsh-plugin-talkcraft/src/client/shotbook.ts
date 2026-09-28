import type { Job } from '../protocol.ts'

export interface ShotCard {
  id: string
  title: string
  start: number
  end: number
  narration: string
  visual: string
  source: string
  upload?: Job['uploads'][number]
  body: string
}

function detail(body: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body.match(new RegExp(`^\\s*-\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? ''
}

export function parseShotbook(markdown: string, uploads: Job['uploads']): ShotCard[] {
  const headings = [...markdown.matchAll(/^###\s+(S\d{2,})\s+(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:[·•]\s*(.*))?$/gmi)]
  return headings.map((match, index) => {
    const body = markdown.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? markdown.length).trim()
    const upload = uploads.find(item => item.kind !== 'voice' && body.includes(item.file.split(/[\\/]/).pop() ?? '\0'))
    const source = body.match(/^\s*-\s*来源\s*[:：]\s*(.+)$/mi)?.[1]?.trim() ?? ''
    return {
      id: match[1].toUpperCase(),
      start: Number(match[2]),
      end: Number(match[3]),
      title: match[4]?.trim() ?? `画面 ${index + 1}`,
      narration: detail(body, '文案'),
      visual: detail(body, '画面意图'),
      source,
      upload,
      body,
    }
  })
}
