import type { Platform } from '../protocol.ts'
import { ICONFONT_GLYPHS } from './platform-iconfont-data.ts'

export function PlatformIcon({ platform, size = 44, className }: {
  platform: Platform
  size?: number
  className?: string
}) {
  const glyph = ICONFONT_GLYPHS[platform]
  return <svg className={className} width={size} height={size} role="presentation" aria-hidden focusable={false}
    style={{ display: 'block', flex: 'none' }} viewBox={glyph.viewBox}>
    {glyph.paths.map((path, index) => <path key={index} d={path.d} fill={path.fill}/>)}
  </svg>
}
