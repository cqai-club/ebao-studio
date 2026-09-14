import type { Options, UploadKind } from './protocol.ts'

export const UPLOADS: Record<UploadKind, {label: string; extensions: string[]; max: number}> = {
  script: {label: '文案文件', extensions: ['.txt', '.md', '.docx'], max: 50 * 1024 ** 2},
  video: {label: '口播视频', extensions: ['.mp4', '.mov', '.webm', '.mkv'], max: 1024 ** 3},
  avatar: {label: '形象照', extensions: ['.png', '.jpg', '.jpeg', '.webp'], max: 50 * 1024 ** 2},
  voice: {label: '参考录音', extensions: ['.mp3', '.m4a', '.wav', '.ogg'], max: 50 * 1024 ** 2},
}

export function uploadKinds(options: Options): UploadKind[] {
  return [...(options.text.trim() ? [] : ['script' as const]), ...(options.mode === 'video' ? ['video' as const] : options.mode === 'digitalhuman' ? ['avatar' as const, 'voice' as const] : [])]
}

export function validateUpload(kind: UploadKind, file: {name: string; size?: number}): void {
  const rule = UPLOADS[kind]
  const ext = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase() ?? ''
  if (!rule) throw new Error('不支持的素材类型')
  if (!rule.extensions.includes(ext)) {
    if (kind === 'video' && UPLOADS.voice.extensions.includes(ext)) throw new Error(`“${file.name}”是音频。请切换到“数字人口播”，将它放入“参考录音”栏，并上传形象照。`)
    throw new Error(`${rule.label}“${file.name}”格式不支持，请选择 ${rule.extensions.join(' / ')} 文件`)
  }
  if (file.size === 0) throw new Error(`${rule.label}“${file.name}”为空（0 字节），请选择有内容的文件`)
  if (file.size !== undefined && file.size > rule.max) throw new Error(`${rule.label}“${file.name}”过大，最大 ${rule.max / 1024 ** 2} MB`)
}
