import imagegenCover from '../../assets/covers/imagegen.webp'
import videoCover from '../../assets/covers/video.webp'
import shortVideoCover from '../../assets/covers/short-video.webp'
import talkcraftCover from '../../assets/covers/talkcraft.webp'
import publisherCover from '../../assets/covers/publisher.webp'
import nebulaCover from '../../assets/covers/default-nebula.webp'
import sculptureCover from '../../assets/covers/default-sculpture.webp'
import jadeCover from '../../assets/covers/default-jade.webp'

export const coverImages = {
  imagegen: imagegenCover,
  video: videoCover,
  'short-video': shortVideoCover,
  talkcraft: talkcraftCover,
  publisher: publisherCover,
  'default-nebula': nebulaCover,
  'default-sculpture': sculptureCover,
  'default-jade': jadeCover,
} as const

export type CoverId = keyof typeof coverImages

const knownCovers = new Map<string, CoverId>([
  ['cqai-imagegen', 'imagegen'],
  ['cqai-video', 'video'],
  ['cqai-short-video', 'short-video'],
  ['cqai-talkcraft', 'talkcraft'],
  ['cqai-publisher', 'publisher'],
])

const defaultCovers: readonly CoverId[] = ['default-nebula', 'default-sculpture', 'default-jade']
const plannedCovers = new Map<string, CoverId>([
  ['planned:writing', 'default-sculpture'],
  ['planned:customer', 'default-jade'],
  ['planned:sales', 'default-nebula'],
  ['planned:whiteboard', 'default-nebula'],
  ['planned:relationship', 'default-sculpture'],
])

/** Installed panels without dedicated artwork keep the same default cover across renders. */
export function coverForCard(card: { id: string; panelId?: string }): CoverId {
  const matched = knownCovers.get(card.panelId ?? '') ?? knownCovers.get(card.id) ?? plannedCovers.get(card.id)
  if (matched !== undefined) return matched

  const identity = card.panelId ?? card.id
  let hash = 2166136261
  for (let index = 0; index < identity.length; index++) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619)
  }
  return defaultCovers[(hash >>> 0) % defaultCovers.length]!
}
