import JSZip from 'jszip'
import { inflateRawSync } from 'node:zlib'

const MAX_INPUT = 8 * 1024 * 1024
const MAX_EXPANDED = 40 * 1024 * 1024
const MAX_ENTRY = 16 * 1024 * 1024
const crcTable = Uint32Array.from({ length: 256 }, (_, x) => {
  let c = x
  for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Parse and inflate entries ourselves with bounded output before handing them to
// JSZip. Never extract paths to disk. Zip64 and encrypted entries are rejected.
function readEntries(data: Buffer): Map<string, Buffer> {
  if (data.length > MAX_INPUT || data.length < 22) throw new Error('文件为空或超过 8 MB。')
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break }
  }
  if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) throw new Error('不支持的 DOCX 文件。')
  const count = data.readUInt16LE(end + 10)
  const size = data.readUInt32LE(end + 12)
  const offset = data.readUInt32LE(end + 16)
  if (!count || count > 2000 || offset + size > end || data.readUInt16LE(end + 8) !== count) throw new Error('DOCX 目录无效或过大。')
  const entries = new Map<string, Buffer>()
  let cursor = offset, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > offset + size || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('DOCX 目录损坏。')
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10)
    const compressed = data.readUInt32LE(cursor + 20), expanded = data.readUInt32LE(cursor + 24)
    const n = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32)
    const local = data.readUInt32LE(cursor + 42), next = cursor + 46 + n + extra + comment
    if (next > offset + size || flags & 1 || (method !== 0 && method !== 8) || compressed === 0xffffffff || expanded > MAX_ENTRY) throw new Error('DOCX 包含不支持或过大的内容。')
    total += expanded
    if (total > MAX_EXPANDED) throw new Error('DOCX 展开后超过大小限制。')
    const name = data.subarray(cursor + 46, cursor + 46 + n).toString('utf8')
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || entries.has(name)) throw new Error('DOCX 包含无效路径。')
    if (local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50) throw new Error('DOCX 文件损坏。')
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (start + compressed > offset) throw new Error('DOCX 文件损坏。')
    const chunk = data.subarray(start, start + compressed)
    const body = method === 0 ? Buffer.from(chunk) : inflateRawSync(chunk, { maxOutputLength: MAX_ENTRY })
    if (body.length !== expanded || crc32(body) !== data.readUInt32LE(cursor + 16)) throw new Error('DOCX 内容损坏或长度不一致。')
    entries.set(name, body)
    cursor = next
  }
  if (cursor !== offset + size || !entries.has('[Content_Types].xml') || !entries.has('word/document.xml') || !entries.has('word/styles.xml')) throw new Error('文件不是支持的 Word DOCX。')
  if ([...entries.keys()].some(name => name.startsWith('_xmlsignatures/') || /(?:^|\/)vbaProject\.bin$/i.test(name))) throw new Error('不支持带数字签名或宏的文档。')
  return entries
}

type Fields = Record<string, string>
type Styles = { fonts: Fields; size: Fields; complexSize: Fields; spacing: Fields }
const genericStyles: Styles = { fonts: { 'w:ascii': 'Times New Roman', 'w:hAnsi': 'Times New Roman', 'w:eastAsia': '宋体' }, size: { 'w:val': '24' }, complexSize: { 'w:val': '24' }, spacing: { 'w:line': '360', 'w:lineRule': 'auto' } }
const labels: Record<string, string> = { 'fonts.w:ascii': '西文字体', 'fonts.w:hAnsi': '西文高位字体', 'fonts.w:eastAsia': '东亚字体', 'size.w:val': '字号（半磅）', 'complexSize.w:val': '复杂文字字号（半磅）', 'spacing.w:line': '行距（Word 单位）', 'spacing.w:lineRule': '行距规则' }
function decodeDocx(value: unknown): Map<string, Buffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_INPUT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('文件内容无效或超过 8 MB。')
  return readEntries(Buffer.from(value, 'base64'))
}
function attributes(xml: string, tag: string, allowed: string[]): Fields {
  const hit = new RegExp(`<w:${tag}(?=\\s|/|>)([^>]*)`).exec(xml)
  const result: Fields = {}
  if (!hit) return result
  for (const key of allowed) {
    const match = new RegExp(`\\s${key}=(?:"([^"]*)"|'([^']*)')`).exec(hit[1])
    if (match) {
      const value = match[1] ?? match[2]
      // Copy no entity references or markup from untrusted XML.
      if (value.length > 100 || /[&<>"'\x00-\x1f]/.test(value)) throw new Error('模板默认样式含有不支持的值。')
      if (key === 'w:val' && (!/^\d+$/.test(value) || Number(value) < 2 || Number(value) > 400)) throw new Error('模板字号无效。')
      if (key === 'w:line' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 31680)) throw new Error('模板行距无效。')
      if (key === 'w:lineRule' && !['auto', 'exact', 'atLeast'].includes(value)) throw new Error('模板行距规则无效。')
      result[key] = value
    }
  }
  return result
}
function extractStyles(entries: Map<string, Buffer>): Styles {
  const xml = entries.get('word/styles.xml')!.toString('utf8')
  if (!/<w:styles(?:\s|>)/.test(xml) || !xml.includes('</w:styles>')) throw new Error('无法识别文档样式。')
  const defaults = /<w:docDefaults(?:\s[^>]*)?>([\s\S]*?)<\/w:docDefaults>/.exec(xml)?.[1] ?? ''
  const run = /<w:rPrDefault(?:\s[^>]*)?>([\s\S]*?)<\/w:rPrDefault>/.exec(defaults)?.[1] ?? ''
  const para = /<w:pPrDefault(?:\s[^>]*)?>([\s\S]*?)<\/w:pPrDefault>/.exec(defaults)?.[1] ?? ''
  return { fonts: attributes(run, 'rFonts', ['w:ascii', 'w:hAnsi', 'w:eastAsia']), size: attributes(run, 'sz', ['w:val']), complexSize: attributes(run, 'szCs', ['w:val']), spacing: attributes(para, 'spacing', ['w:line', 'w:lineRule']) }
}
function prepare(input: unknown): { entries: Map<string, Buffer>; fileName: string; selected: Styles; changes: Array<{ field: string; before: string | null; after: string }> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('排版请求无效。')
  const { fileName, dataBase64, preset, templateBase64, templateFileName } = input as Record<string, unknown>
  if (typeof fileName !== 'string' || !/\.docx$/i.test(fileName) || fileName.length > 180) throw new Error('请选择 DOCX 文件。')
  if (preset !== 'journal' && preset !== 'thesis' && preset !== 'custom') throw new Error('请选择排版基线。')
  const entries = decodeDocx(dataBase64)
  const before = extractStyles(entries)
  if (preset === 'custom' && (typeof templateFileName !== 'string' || !/\.docx$/i.test(templateFileName) || templateFileName.length > 180)) throw new Error('请选择 DOCX 模板。')
  const selected = preset === 'custom' ? extractStyles(decodeDocx(templateBase64)) : genericStyles
  const changes = Object.entries(selected).flatMap(([group, values]) => Object.entries(values).map(([key, value]) => ({ field: labels[`${group}.${key}`], before: (before[group as keyof Styles] as Fields)[key] ?? null, after: value })))
  if (!changes.length) throw new Error('模板没有可提取的默认字体、字号或行距。')
  return { entries, fileName, selected, changes }
}
export function previewDocx(input: unknown): { changes: Array<{ field: string; before: string | null; after: string }>; limitations: string } {
  const { changes } = prepare(input)
  return { changes, limitations: '仅比较和应用文档默认字体、字号、行距；命名样式、页边距、页眉、目录、参考文献及直接格式不会按模板迁移，需人工检查。' }
}
export async function formatDocx(input: unknown): Promise<{ buffer: Buffer; name: string }> {
  const { entries, fileName, selected } = prepare(input)
  const original = entries.get('word/styles.xml')!.toString('utf8')
  if (!/<w:styles(?:\s|>)/.test(original) || !original.includes('</w:styles>')) throw new Error('无法识别文档样式。')
  const escapeReg = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const container = (xml: string, name: string, update: (body: string) => string): string => {
    const tag = escapeReg(name)
    const pair = new RegExp(`<${tag}(?=\\s|>)([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`)
    const closed = new RegExp(`<${tag}(?=\\s|/)([^>]*?)\\s*/>`)
    if (pair.test(xml)) return xml.replace(pair, (_all, attrs: string, body: string) => `<${name}${attrs}>${update(body)}</${name}>`)
    if (closed.test(xml)) return xml.replace(closed, (_all, attrs: string) => `<${name}${attrs}>${update('')}</${name}>`)
    return xml + `<${name}>${update('')}</${name}>`
  }
  const property = (xml: string, name: string, values: Record<string, string>): string => {
    const tag = escapeReg(name)
    const pattern = new RegExp(`<${tag}(?=\\s|/|>)([^>]*?)(?:\\s*/>|>[\\s\\S]*?<\\/${tag}\\s*>)`)
    const found = pattern.exec(xml)
    let attrs = found?.[1] ?? ''
    for (const [key, value] of Object.entries(values)) {
      attrs = attrs.replace(new RegExp(`\\s+${escapeReg(key)}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '')
      attrs += ` ${key}="${value}"`
    }
    const replacement = `<${name}${attrs}/>`
    return found ? xml.replace(pattern, replacement) : xml + replacement
  }
  const updateDefaults = (body: string) => {
    if (Object.keys(selected.fonts).length || Object.keys(selected.size).length || Object.keys(selected.complexSize).length) {
      body = container(body, 'w:rPrDefault', content => container(content, 'w:rPr', props => {
        if (Object.keys(selected.fonts).length) props = property(props, 'w:rFonts', selected.fonts)
        if (Object.keys(selected.size).length) props = property(props, 'w:sz', selected.size)
        if (Object.keys(selected.complexSize).length) props = property(props, 'w:szCs', selected.complexSize)
        return props
      }))
    }
    if (Object.keys(selected.spacing).length) body = container(body, 'w:pPrDefault', content => container(content, 'w:pPr', props => property(props, 'w:spacing', selected.spacing)))
    return body
  }
  const rootEnd = original.lastIndexOf('</w:styles>')
  const root = original.slice(0, rootEnd)
  const stylesRoot = /<w:docDefaults(?=\s|\/|>)/.test(root)
    ? container(root, 'w:docDefaults', updateDefaults)
    : root.replace(/(<w:styles(?:\s[^>]*)?>)/, `$1<w:docDefaults>${updateDefaults('')}</w:docDefaults>`)
  const styles = stylesRoot + original.slice(rootEnd)
  entries.set('word/styles.xml', Buffer.from(styles))
  const zip = new JSZip()
  for (const [name, value] of entries) zip.file(name, value)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const stem = fileName.replace(/.*[\\/]/, '').replace(/\.docx$/i, '').replace(/[\x00-\x1f<>:"|?*]/g, '_') || '论文'
  return { buffer, name: `${stem}-格式副本.docx` }
}
